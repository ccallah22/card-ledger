// TheBinder Backup V2 -- Phase 4C1: read-only restore preflight.
//
// This module is the safety gate that must run, and report `canProceed:
// true`, BEFORE any future destructive restore RPC is ever called. It
// performs ONLY read/SELECT-shaped operations (see the
// BackupV2RestorePreflightDeps interface below -- every function it can
// call returns a read result, none can mutate anything) and never touches
// user_cards, locations, card_media, card_value_snapshots,
// manual_evidence_overrides, or any shared catalog/grading table. It does
// not write anything, anywhere, ever.
//
// Deliberately a SEPARATE module from src/lib/backup/v2.ts: v2.ts owns the
// portable Backup V2 protocol (types + pure structural validation) and must
// stay free of any Supabase/network dependency (see its own file-header
// comment). This module is the opposite: it exists specifically to make
// authenticated, read-only Supabase calls, resolving an already-validated
// BackupV2Manifest's catalog/grading references against the CURRENT
// database before a restore is ever allowed to proceed. v2.ts's
// `BackupV2Manifest`/`BackupV2Card` types are imported and read, never
// re-defined or mutated.
//
// Every dependency this module needs is expressed as an explicit
// BackupV2RestorePreflightDeps interface (an object of plain async
// functions) rather than importing repository modules directly inside the
// resolution logic. Two reasons: (1) it makes the "zero mutation" property
// checkable by inspection -- the interface's own shape has no
// insert/update/delete/upsert-shaped member, so nothing calling only
// through it can mutate anything, by construction; (2) it makes the
// resolution algorithms trivially unit-testable with fully in-memory fixture
// data, no real Supabase connection, and no mocking library.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackupV2Card, BackupV2Manifest } from "@/lib/backup/v2";
import { getCard, listCardsBySetAndNumber, type CardRow } from "@/lib/repositories/cards";
import { getCardVariant, listCardVariants, type CardVariantRow } from "@/lib/repositories/cardVariants";
import { findSetBySlug } from "@/lib/repositories/sets";
import { findParallelTypeByName } from "@/lib/repositories/parallelTypes";
import { listGradingCompaniesMatchingName, type GradingCompanyRow } from "@/lib/repositories/gradingCompanies";
import { parsePlayerNames } from "@/lib/catalog/parsePlayerNames";
import { slugify } from "@/lib/slug";
import { supabase } from "@/lib/supabaseClient";

// ---------------------------------------------------------------------------
// Part 3: preflight types
// ---------------------------------------------------------------------------

/** Why one card could not be safely resolved -- structured, not just prose. */
export type BackupV2PreflightBlockingReason =
  | { kind: "grading_company_not_found"; grader: string }
  | { kind: "grading_company_ambiguous"; grader: string; matchCount: number }
  | { kind: "base_card_missing_identity_evidence" }
  | { kind: "base_card_set_not_found"; setName: string; year?: string }
  | { kind: "base_card_zero_candidates"; setName: string; cardNumber: string }
  | { kind: "base_card_no_match_after_narrowing"; setName: string; cardNumber: string }
  | { kind: "base_card_ambiguous"; setName: string; cardNumber: string; matchCount: number };

/** One blocking problem, tagged with enough to identify the card in a future UI. */
export type BackupV2PreflightBlockingError = {
  /** The original BackupV2Card.id (preserved user_cards.id) -- stable UI key. */
  cardId: string;
  /** Human-readable label, e.g. "Patrick Mahomes -- 2024 Prizm #1". */
  cardLabel: string;
  reason: BackupV2PreflightBlockingReason;
  /** Ready-to-display explanation of `reason`. */
  message: string;
};

/** A non-blocking fidelity note (currently: variant resolution fallbacks). */
export type BackupV2PreflightWarning = {
  cardId: string;
  cardLabel: string;
  message: string;
};

/**
 * One successfully-resolved card. `resolvedCardId` is intentionally NOT
 * nullable -- a card with no safe base-card resolution never becomes a
 * ResolvedBackupV2Card at all; it only ever appears in `blockingErrors`
 * (see BackupV2RestorePreflight below). This is a read-only resolution
 * result -- it carries ids, never a capability to write anything.
 */
export type ResolvedBackupV2Card = {
  backupCard: BackupV2Card;
  resolvedCardId: number;
  resolvedCardVariantId: number | null;
  resolvedGradingCompanyId: number | null;
  /** Per-card fidelity warnings (currently: variant resolution fallbacks). */
  warnings: string[];
};

export type BackupV2RestorePreflight = {
  /** Only cards that resolved cleanly enough to be restore-eligible. */
  resolvedCards: ResolvedBackupV2Card[];
  warnings: BackupV2PreflightWarning[];
  blockingErrors: BackupV2PreflightBlockingError[];
  /**
   * All-or-nothing per the locked product decision: true only when
   * EVERY card in the manifest resolved with no blocking error. A future
   * restore RPC must never be called unless this is true.
   */
  canProceed: boolean;
};

// ---------------------------------------------------------------------------
// Dependency interface -- the zero-mutation surface. Every member here
// returns a read result; there is no member shaped like an insert/update/
// delete/upsert/rpc call. See Part 10's return-report call-chain proof for
// exactly which underlying repository function backs each one.
// ---------------------------------------------------------------------------

export type BackupV2RestorePreflightDeps = {
  getCard: (id: number) => Promise<CardRow | null>;
  listCardsBySetAndNumber: (setId: number, cardNumber: string) => Promise<CardRow[]>;
  findSetBySlug: (slug: string) => Promise<{ id: number } | null>;
  getCardVariant: (id: number) => Promise<CardVariantRow | null>;
  listCardVariants: (cardId: number) => Promise<CardVariantRow[]>;
  findParallelTypeByName: (name: string) => Promise<{ id: number } | null>;
  /** Every player slug (players.slug) linked to a catalog card via card_players. */
  listCardPlayerSlugs: (cardId: number) => Promise<string[]>;
  listGradingCompaniesMatchingName: (name: string) => Promise<GradingCompanyRow[]>;
};

/**
 * Wires the interface above to the real, already-audited read-only
 * repository functions. `client` defaults to the shared browser client
 * (matching every repository function's own default), and is threaded
 * through uniformly -- no function here ever falls back to a different,
 * unexpected client.
 *
 * listCardPlayerSlugs is the one query not already exposed by an existing
 * repository export: a small, single-purpose, read-only join
 * (card_players -> players(slug)) kept local to this module rather than
 * added as new permanent repository surface, per the task's narrow-scope
 * instruction. It is a plain `.select().eq()` -- no interpolated filter
 * text, no injection surface (unlike the grading-company lookup this phase
 * hardened, nothing here builds a filter string from untrusted input).
 */
export function createDefaultRestorePreflightDeps(
  client: SupabaseClient = supabase,
): BackupV2RestorePreflightDeps {
  return {
    getCard: (id) => getCard(id, client),
    listCardsBySetAndNumber: (setId, cardNumber) => listCardsBySetAndNumber(setId, cardNumber, client),
    findSetBySlug: (slug) => findSetBySlug(slug, client),
    getCardVariant: (id) => getCardVariant(id),
    listCardVariants: (cardId) => listCardVariants(cardId),
    findParallelTypeByName: (name) => findParallelTypeByName(name, client),
    listGradingCompaniesMatchingName: (name) => listGradingCompaniesMatchingName(name, client),
    listCardPlayerSlugs: async (cardId) => {
      const { data, error } = await client
        .from("card_players")
        .select("players(slug)")
        .eq("card_id", cardId);
      if (error) throw error;
      return ((data ?? []) as unknown as { players: { slug: string } | null }[])
        .map((row) => row.players?.slug)
        .filter((slug): slug is string => !!slug);
    },
  };
}

// ---------------------------------------------------------------------------
// Human-readable descriptions
// ---------------------------------------------------------------------------

function describeCard(card: BackupV2Card): string {
  const setPart = card.cardNumber ? `${card.setName} #${card.cardNumber}` : card.setName;
  return `${card.playerName || "(no player name)"} -- ${setPart}`;
}

function describeBlockingReason(reason: BackupV2PreflightBlockingReason): string {
  switch (reason.kind) {
    case "grading_company_not_found":
      return `No existing grading company matches "${reason.grader}". Restore never creates grading companies, so this card cannot be safely restored.`;
    case "grading_company_ambiguous":
      return `"${reason.grader}" matched ${reason.matchCount} different existing grading companies. Restore will not guess which one is correct.`;
    case "base_card_missing_identity_evidence":
      return `This card has neither a usable catalog card id nor enough identity evidence (set name and card number) to safely find its existing catalog card.`;
    case "base_card_set_not_found":
      return `No existing catalog set matches "${reason.setName}"${reason.year ? ` (${reason.year})` : ""}. Restore never creates catalog sets.`;
    case "base_card_zero_candidates":
      return `No existing catalog card matches set "${reason.setName}", card number "${reason.cardNumber}". Restore never creates catalog cards.`;
    case "base_card_no_match_after_narrowing":
      return `Multiple existing catalog cards share set "${reason.setName}", card number "${reason.cardNumber}", but none of them match this card's other recorded details (insert/rookie/player).`;
    case "base_card_ambiguous":
      return `${reason.matchCount} existing catalog cards share set "${reason.setName}", card number "${reason.cardNumber}", and this card's other recorded details do not narrow it to exactly one. Restore will not guess.`;
  }
}

// ---------------------------------------------------------------------------
// Part 4: grading-company resolution (read-only, never create)
// ---------------------------------------------------------------------------

async function resolveGradingCompany(
  card: BackupV2Card,
  deps: BackupV2RestorePreflightDeps,
): Promise<{ resolvedGradingCompanyId: number | null; blockingReason: BackupV2PreflightBlockingReason | null }> {
  const grader = card.grader?.trim();
  if (!grader) {
    return { resolvedGradingCompanyId: null, blockingReason: null };
  }

  const matches = await deps.listGradingCompaniesMatchingName(grader);
  if (matches.length === 1) {
    return { resolvedGradingCompanyId: matches[0].id, blockingReason: null };
  }
  if (matches.length === 0) {
    return {
      resolvedGradingCompanyId: null,
      blockingReason: { kind: "grading_company_not_found", grader },
    };
  }
  return {
    resolvedGradingCompanyId: null,
    blockingReason: { kind: "grading_company_ambiguous", grader, matchCount: matches.length },
  };
}

// ---------------------------------------------------------------------------
// Parts 5-7: base catalog card resolution (read-only, never create)
// ---------------------------------------------------------------------------

/** Applies `predicate` to `candidates`, in order, async-safe. */
async function narrow<T>(candidates: T[], predicate: (item: T) => boolean | Promise<boolean>): Promise<T[]> {
  const survivors: T[] = [];
  for (const item of candidates) {
    if (await predicate(item)) survivors.push(item);
  }
  return survivors;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

/**
 * Deterministic base-card resolution. See Part 7's report writeup for the
 * exact, documented matching rule this implements; summarized inline at
 * each stage below. Every stage is an exact/normalized comparison against
 * existing rows -- no fuzzy text search, no scoring, no "best guess."
 */
async function resolveBaseCard(
  card: BackupV2Card,
  deps: BackupV2RestorePreflightDeps,
): Promise<{ resolvedCardId: number | null; blockingReason: BackupV2PreflightBlockingReason | null }> {
  // Stage 0: a valid existing catalogCardId is trusted directly, no
  // fallback cross-check against free-text evidence -- matches the
  // existing "common case needs no pre-step" precedent (resolveCatalogIdsServer).
  if (card.catalogCardId !== undefined) {
    const existing = await deps.getCard(card.catalogCardId);
    if (existing) {
      return { resolvedCardId: existing.id, blockingReason: null };
    }
    // stale -- fall through to fallback matching below.
  }

  const cardNumber = card.cardNumber?.trim();
  const setName = card.setName?.trim();
  if (!cardNumber || !setName) {
    return { resolvedCardId: null, blockingReason: { kind: "base_card_missing_identity_evidence" } };
  }

  // Stage 1: exact set identity via the SAME slug derivation the catalog
  // write path already uses (createSet/findOrCreateSet: slugify(`${name}-
  // ${release_year ?? ""}`)) -- deterministic, not fuzzy. Reproducing the
  // exact formula is what makes this an exact-identity lookup rather than a
  // guess.
  const releaseYear = card.year ? Number.parseInt(card.year, 10) : NaN;
  const slug = slugify(`${setName}-${Number.isFinite(releaseYear) ? releaseYear : ""}`);
  const set = await deps.findSetBySlug(slug);
  if (!set) {
    return {
      resolvedCardId: null,
      blockingReason: { kind: "base_card_set_not_found", setName, year: card.year },
    };
  }

  // Stage 2: exact (set_id, card_number) candidates. Card_number uniqueness
  // within a set was intentionally relaxed by Catalog v2 (different
  // checklist sections may reuse the same number), so more than one
  // candidate here is expected and handled explicitly rather than treated
  // as an error.
  let candidates = await deps.listCardsBySetAndNumber(set.id, cardNumber);
  if (candidates.length === 0) {
    return { resolvedCardId: null, blockingReason: { kind: "base_card_zero_candidates", setName, cardNumber } };
  }
  if (candidates.length === 1) {
    return { resolvedCardId: candidates[0].id, blockingReason: null };
  }

  // Stage 3: deterministic, strictly progressive narrowing -- only entered
  // because (set, number) is genuinely ambiguous. Each filter is applied,
  // in this fixed order, to the survivors of the previous one; resolution
  // stops the instant exactly one candidate remains. A filter is never
  // skipped just because it would eliminate every remaining candidate --
  // that itself means none of the current survivors is a genuine match.
  const insertValue = card.insert?.trim() || null;
  candidates = await narrow(candidates, (c) => (c.title?.trim() || null) === insertValue);
  if (candidates.length === 1) return { resolvedCardId: candidates[0].id, blockingReason: null };
  if (candidates.length === 0) {
    return { resolvedCardId: null, blockingReason: { kind: "base_card_no_match_after_narrowing", setName, cardNumber } };
  }

  candidates = await narrow(candidates, (c) => c.rookie_card === !!card.isRookie);
  if (candidates.length === 1) return { resolvedCardId: candidates[0].id, blockingReason: null };
  if (candidates.length === 0) {
    return { resolvedCardId: null, blockingReason: { kind: "base_card_no_match_after_narrowing", setName, cardNumber } };
  }

  // Final dimension: exact linked-player identity, via slug-set equality
  // (the same identity key findOrCreatePlayer already uses) -- not fuzzy
  // name matching.
  const expectedPlayerSlugs = [...new Set(parsePlayerNames(card.playerName).map((n) => slugify(n)))].sort();
  candidates = await narrow(candidates, async (c) => {
    const linkedSlugs = [...new Set(await deps.listCardPlayerSlugs(c.id))].sort();
    return arraysEqual(linkedSlugs, expectedPlayerSlugs);
  });

  if (candidates.length === 1) return { resolvedCardId: candidates[0].id, blockingReason: null };
  if (candidates.length === 0) {
    return { resolvedCardId: null, blockingReason: { kind: "base_card_no_match_after_narrowing", setName, cardNumber } };
  }
  return {
    resolvedCardId: null,
    blockingReason: { kind: "base_card_ambiguous", setName, cardNumber, matchCount: candidates.length },
  };
}

// ---------------------------------------------------------------------------
// Part 8: variant resolution (read-only, never create, never blocking)
// ---------------------------------------------------------------------------

async function resolveVariant(
  card: BackupV2Card,
  resolvedCardId: number,
  deps: BackupV2RestorePreflightDeps,
): Promise<{ resolvedCardVariantId: number | null; warning: string | null }> {
  // Explicit id path first (Part 5): trust it only if it still exists AND
  // still belongs to the resolved base card.
  if (card.catalogVariantId !== undefined) {
    const variant = await deps.getCardVariant(card.catalogVariantId);
    if (variant && variant.card_id === resolvedCardId) {
      return { resolvedCardVariantId: variant.id, warning: null };
    }
  }

  // Fallback: deterministic evidence-based matching among the resolved
  // card's own existing variants only (never another card's).
  let candidates = await deps.listCardVariants(resolvedCardId);

  // Correction (Phase 4C1 narrow fix): missing evidence must never be
  // treated as negative evidence. BackupV2Card.parallel/variation/
  // serialTotal/isAutograph/isPatch are all optional (`?`) in v2.ts's own
  // contract -- `undefined` means "we don't know," not "we know it's
  // none/false." A restore that filtered on `parallel_type_id === null` or
  // `has_autograph === false` merely because the backup happened not to
  // record that field would manufacture negative evidence the backup never
  // actually asserted, potentially eliminating the one genuine variant
  // match. Every filter below is therefore applied ONLY when the
  // corresponding backup field is actually present -- absence always means
  // "do not narrow on this dimension," never "require the falsy/null value."
  if (card.parallel?.trim()) {
    const parallelType = await deps.findParallelTypeByName(card.parallel.trim());
    // No such parallel type exists at all -- no existing variant could
    // reference it, so this correctly narrows to zero rather than being
    // silently skipped.
    candidates = candidates.filter((v) => v.parallel_type_id === (parallelType?.id ?? -1));
  }

  if (card.variation?.trim()) {
    const variation = card.variation.trim();
    candidates = candidates.filter((v) => (v.name_override?.trim() || null) === variation);
  }

  if (card.serialTotal !== undefined) {
    candidates = candidates.filter((v) => v.print_run === card.serialTotal);
  }

  if (card.isAutograph !== undefined) {
    candidates = candidates.filter((v) => v.has_autograph === card.isAutograph);
  }

  if (card.isPatch !== undefined) {
    candidates = candidates.filter((v) => v.has_memorabilia === card.isPatch);
  }

  if (candidates.length === 1) {
    return { resolvedCardVariantId: candidates[0].id, warning: null };
  }
  if (candidates.length === 0) {
    return {
      resolvedCardVariantId: null,
      warning:
        "No existing catalog variant matches this card's recorded parallel/print-run/autograph/memorabilia details -- restoring without a linked catalog variant.",
    };
  }
  return {
    resolvedCardVariantId: null,
    warning: `${candidates.length} existing catalog variants matched this card's recorded details ambiguously -- restoring without a linked catalog variant.`,
  };
}

// ---------------------------------------------------------------------------
// Part 9: all-or-nothing manifest-level orchestration
// ---------------------------------------------------------------------------

/**
 * Runs preflight resolution for every card in the manifest, never stopping
 * early on a per-card blocking condition (only an unexpected `deps` call
 * failure -- a genuine infrastructure/query error -- aborts the whole run,
 * by propagating as a rejected promise, since nothing can be safely said
 * about ANY card once the database itself is unreliable).
 *
 * `canProceed` is the single safety gate: a future restore RPC must never
 * be invoked unless this is `true`. Locked product decision: restore is
 * all-or-nothing at the manifest level -- a single blocked card blocks the
 * entire restore, never a silent per-card skip.
 */
export async function runBackupV2RestorePreflight(
  manifest: BackupV2Manifest,
  deps: BackupV2RestorePreflightDeps = createDefaultRestorePreflightDeps(),
): Promise<BackupV2RestorePreflight> {
  const resolvedCards: ResolvedBackupV2Card[] = [];
  const warnings: BackupV2PreflightWarning[] = [];
  const blockingErrors: BackupV2PreflightBlockingError[] = [];

  for (const card of manifest.cards) {
    const cardLabel = describeCard(card);
    let blocked = false;

    const grading = await resolveGradingCompany(card, deps);
    if (grading.blockingReason) {
      blocked = true;
      blockingErrors.push({
        cardId: card.id,
        cardLabel,
        reason: grading.blockingReason,
        message: describeBlockingReason(grading.blockingReason),
      });
    }

    const base = await resolveBaseCard(card, deps);
    if (base.blockingReason || base.resolvedCardId === null) {
      blocked = true;
      const reason = base.blockingReason ?? { kind: "base_card_missing_identity_evidence" as const };
      blockingErrors.push({ cardId: card.id, cardLabel, reason, message: describeBlockingReason(reason) });
    }

    if (blocked) continue;

    const variant = await resolveVariant(card, base.resolvedCardId as number, deps);
    const cardWarnings: string[] = [];
    if (variant.warning) {
      cardWarnings.push(variant.warning);
      warnings.push({ cardId: card.id, cardLabel, message: variant.warning });
    }

    resolvedCards.push({
      backupCard: card,
      resolvedCardId: base.resolvedCardId as number,
      resolvedCardVariantId: variant.resolvedCardVariantId,
      resolvedGradingCompanyId: grading.resolvedGradingCompanyId,
      warnings: cardWarnings,
    });
  }

  return {
    resolvedCards,
    warnings,
    blockingErrors,
    canProceed: blockingErrors.length === 0,
  };
}

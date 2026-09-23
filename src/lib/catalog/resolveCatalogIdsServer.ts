import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateSet } from "@/lib/repositories/sets";
import { findOrCreatePlayer } from "@/lib/repositories/players";
import {
  listCardsBySetAndNumber,
  createCard,
  findOrCreateCardV2,
  getCard,
  type CardRow,
} from "@/lib/repositories/cards";
import { findOrCreateCardPlayer, listCardPlayers } from "@/lib/repositories/cardPlayers";
import { findOrCreateParallelType } from "@/lib/repositories/parallelTypes";
import {
  findOrCreateCardVariant,
  findOrCreateCardVariantV2,
} from "@/lib/repositories/cardVariants";
import { findOrCreateGradingCompany } from "@/lib/repositories/gradingCompanies";
import { findOrCreateLocation } from "@/lib/repositories/locations";
import type { MyCardInput } from "@/lib/repositories/myCards";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { parsePlayerNames } from "./parsePlayerNames";
import type { CatalogResolutionInput, CatalogResolutionResult } from "./resolveCatalogTypes";

/**
 * Phase 2 correction: resolveCatalogIds/resolveCardForPlayer used to live in
 * src/lib/repositories/myCards.ts (imported from here with the browser
 * client as their default parameter). That worked functionally, but a
 * production build showed the catalog write calls (cards/sets/players/
 * card_variants/card_players/parallel_types/manufacturers/brands .insert(...))
 * still shipped in the /cards/new client bundle -- because these functions
 * stayed *exported* from a module the client also imports (for createMyCard),
 * webpack/Turbopack's tree-shaking didn't eliminate them just because
 * nothing in the client's call graph invoked them anymore. Moving the
 * actual implementations into this server-only file (`import "server-only"`)
 * means the client bundle's source graph can never contain them at all --
 * not "unreachable at runtime", physically absent. myCards.ts now only
 * calls the HTTP endpoint (resolveCatalogIdsViaApi) and no longer imports
 * any of the catalog findOrCreate* functions.
 *
 * The logic itself is unchanged from Phase 1/the original browser
 * implementation -- same manufacturer/brand/set ordering, player
 * resolution, card-number collision handling, checklist-section-aware card
 * resolution, card_players linking, parallel-type resolution, card-variant
 * resolution (including swatch-descriptor identity), and find-before-create
 * normalization. `client` is now a required parameter (no default) since
 * this file is only ever called with a service-role client.
 */

/**
 * Thrown when multiple catalog `cards` rows share (set_id, card_number) and
 * cannot be safely narrowed down to exactly one using canonical player
 * membership, title, or rookie evidence. Never guessed/created around --
 * the caller should ask the user to pick the exact catalog card (e.g. via
 * Search) instead of manual entry.
 */
export class AmbiguousCatalogCardError extends Error {
  constructor(setId: number, cardNumber: string, matchCount: number) {
    super(
      `Catalog card is ambiguous for set ${setId}, card number "${cardNumber}": ` +
        `${matchCount} existing catalog cards matched and could not be ` +
        `deterministically resolved to exactly one using player membership, ` +
        `title, or rookie evidence. Use Search to select the exact catalog ` +
        `card instead of manual entry.`,
    );
    this.name = "AmbiguousCatalogCardError";
  }
}

function normalizedTitle(title: string | null): string | null {
  return title?.trim() || null;
}

/**
 * (set_id, card_number) is NOT guaranteed unique at the database level --
 * the old cards_set_id_card_number_key constraint that used to make this
 * true was intentionally dropped in
 * 202607100001_catalog_v2_drop_old_cards_constraint.sql, because Catalog v2
 * legitimately allows different checklist sections within the same set to
 * reuse the same card_number. This function fetches every candidate at a
 * card_number (listCardsBySetAndNumber) instead of assuming at most one row
 * exists, and narrows deterministically:
 *
 *   - 0 candidates: create here (unchanged from before this file's Catalog
 *     v2 hardening).
 *   - 1 candidate: reuse it under the original legacy rule (no player, or
 *     no player linked yet, or already linked to this player -- else walk
 *     forward to a synthetic "~2"/"~3" number). Left byte-for-byte
 *     equivalent to the pre-hardening single-row behavior -- this task does
 *     not redesign that legacy path.
 *   - >1 candidates (genuine Catalog v2 ambiguity): evidence is applied in
 *     RELIABILITY order, not availability order. `input.insert` (title) and
 *     `isRookie` are free-text/checkbox fields that can be OCR-derived,
 *     blank, stale, or user-edited (e.g. "Future" for a card whose catalog
 *     title is "Select Future"), so they must never veto an exact,
 *     FK-backed card_players relationship. Concretely: canonical player
 *     membership is checked FIRST; title/rookie only narrow *within* a
 *     player-identified subset, and are only used as the sole evidence when
 *     no player id is available at all. A narrowing step that discards a
 *     real player match down to zero survivors is treated as conflicting
 *     evidence, not proof of non-existence -- it fails with
 *     AmbiguousCatalogCardError rather than creating a duplicate. The
 *     synthetic "~2" walk-forward mechanism is NOT used in this branch --
 *     it predates Catalog v2 and would fabricate a card_number that was
 *     never printed on the card; unresolved ambiguity here always fails
 *     explicitly instead.
 *
 * Player identity uses membership (`links.some(...)`), not exact-set
 * equality, so a legitimate multi-player card is never rejected merely for
 * having more than one card_players row.
 *
 * Never selects an arbitrary row, never uses .limit(1)/first-result
 * selection, never uses a confidence score.
 */
export async function resolveCardForPlayer(
  setId: number,
  cardNumber: string,
  playerId: number | null,
  cardFields: { title: string | null; rookie_card: boolean; is_insert: boolean },
  client: SupabaseClient,
): Promise<CardRow> {
  const matchesPlayer = (l: { player_id: number }) => l.player_id === playerId;

  // Reuse rule for the legacy single-candidate path only: no player to
  // attach, or the row has no player yet, or it's already linked to this
  // exact player -- otherwise it's a genuine conflict with a different
  // player's card and the caller should walk forward to a fresh candidate
  // number. Unchanged from before this task.
  async function canReuse(existing: CardRow): Promise<boolean> {
    if (playerId === null) return true;
    const links = await listCardPlayers(existing.id, client);
    return links.length === 0 || links.some(matchesPlayer);
  }

  // Secondary-evidence narrowing for the ambiguous (>1 candidate) branch
  // only. Title first, then rookie -- strictly progressive (mirrors
  // restorePreflight.ts's resolveBaseCard), applied only within a subset
  // that reliable evidence has already isolated (or, when no player id
  // exists at all, the full candidate set, since there is no stronger
  // evidence to isolate a subset with). Returns the single resolved row, or
  // null if evidence is insufficient/conflicting -- callers must fail
  // rather than guess when this returns null, never fall back to creation.
  function narrowBySecondaryEvidence(subset: CardRow[]): CardRow | null {
    const titleValue = normalizedTitle(cardFields.title);
    const titleMatches = subset.filter((c) => normalizedTitle(c.title) === titleValue);
    if (titleMatches.length === 1) return titleMatches[0];
    if (titleMatches.length === 0) return null;

    const rookieMatches = titleMatches.filter((c) => c.rookie_card === cardFields.rookie_card);
    if (rookieMatches.length === 1) return rookieMatches[0];
    return null;
  }

  let candidateNumber = cardNumber;
  let attempt = 1;

  while (true) {
    const matches = await listCardsBySetAndNumber(setId, candidateNumber, client);

    if (matches.length === 0) {
      return createCard({ set_id: setId, card_number: candidateNumber, ...cardFields }, client);
    }

    if (matches.length === 1) {
      const existing = matches[0];
      if (await canReuse(existing)) return existing;
      attempt += 1;
      candidateNumber = `${cardNumber}~${attempt}`;
      continue;
    }

    // Genuine Catalog v2 ambiguity: multiple rows legitimately share
    // (set_id, candidateNumber).
    if (playerId === null) {
      // No player evidence at all -- title/rookie are the only signal
      // available. Resolve if they uniquely identify one row; otherwise
      // this is unresolved ambiguity, never a creation trigger (there is
      // no reliable evidence to support "this is genuinely a new
      // identity" versus "our text just didn't match").
      const resolved = narrowBySecondaryEvidence(matches);
      if (resolved) return resolved;
      throw new AmbiguousCatalogCardError(setId, candidateNumber, matches.length);
    }

    const linkedness = await Promise.all(
      matches.map(async (c) => {
        const links = await listCardPlayers(c.id, client);
        return { card: c, linkedToPlayer: links.some(matchesPlayer), unclaimed: links.length === 0 };
      }),
    );

    const linked = linkedness.filter((l) => l.linkedToPlayer).map((l) => l.card);
    if (linked.length === 1) {
      // Unique canonical, FK-backed player match -- reuse directly. Title/
      // rookie agreement is deliberately NOT required: they are free-text/
      // OCR-derived and must never override an exact card_players
      // relationship.
      return linked[0];
    }
    if (linked.length > 1) {
      // More than one of THIS player's own cards share this number (e.g.
      // distinct insert types) -- title/rookie narrow within their cards
      // only, never expanding back to the full ambiguous set.
      const resolved = narrowBySecondaryEvidence(linked);
      if (resolved) return resolved;
      throw new AmbiguousCatalogCardError(setId, candidateNumber, linked.length);
    }

    // linked.length === 0: this player isn't linked to any candidate at
    // this number yet. That does NOT prove the card doesn't exist -- check
    // for a legitimately unclaimed row before ever creating.
    const unclaimed = linkedness.filter((l) => l.unclaimed).map((l) => l.card);
    if (unclaimed.length === 1) {
      // Single unclaimed slot -- reuse/link it, exactly like the legacy
      // single-candidate rule (which never required title agreement for
      // an unclaimed reuse either).
      return unclaimed[0];
    }
    if (unclaimed.length > 1) {
      const resolved = narrowBySecondaryEvidence(unclaimed);
      if (resolved) return resolved;
      throw new AmbiguousCatalogCardError(setId, candidateNumber, unclaimed.length);
    }

    // unclaimed.length === 0: every existing candidate at this number
    // already belongs to a different player, and none are free. No
    // reliable evidence was discarded to reach this conclusion (there was
    // no player-linked or unclaimed row to override) -- this genuinely is
    // a new identity for this player, so create it here, at the real
    // number, with the caller-supplied title. This is exactly the
    // legitimate multi-row identity that dropping the old uniqueness
    // constraint was meant to allow -- NOT a synthetic "~2" number.
    return createCard({ set_id: setId, card_number: candidateNumber, ...cardFields }, client);
  }
}

// Production Add Card save investigation: a real request reached
// resolution-start and then failed with a thrown value that had no useful
// name/message (see route.ts's error log for that request -- name:
// "object", message: "[object Object]"). Root cause of THAT shape: nothing
// in this codebase's repository layer ever calls postgrest-js's
// .throwOnError() (confirmed -- no occurrences anywhere in src/), so every
// `if (error) throw error` in sets.ts/players.ts/cards.ts/cardPlayers.ts/
// parallelTypes.ts/cardVariants.ts/gradingCompanies.ts/locations.ts
// rethrows the exact plain object postgrest-js's own PostgrestBuilder
// parses straight from the HTTP response body (JSON.parse(body), or
// {message: body} when the response isn't even valid JSON) -- never a
// PostgrestError instance, never anything `instanceof Error`. That's a
// property of every Supabase call in this app, not of one specific
// operation, so it explains the SHAPE of what was logged but not WHICH of
// this function's many sequential operations produced it. `stage` below
// exists only to answer that -- tagged onto whatever the error already is
// (never replacing it, never changing what's thrown, never altering
// control flow or which branch runs) so route.ts's catch can report which
// operation failed without needing to catch/log at every call site
// individually.
async function resolveCatalogIds(profileId: string, input: MyCardInput, client: SupabaseClient) {
  let stage = "start";
  try {
    return await resolveCatalogIdsWithStages(profileId, input, client, (s) => {
      stage = s;
    });
  } catch (err) {
    if (typeof err === "object" && err !== null) {
      (err as Record<string, unknown>).resolutionStage = stage;
    }
    throw err;
  }
}

// The original resolveCatalogIds body, renamed and given one extra
// `setStage(...)` parameter/call before each operation -- otherwise
// unchanged (see git history): same order, same arguments, same branches,
// same return value. Kept as its own function, called from the thin
// try/catch wrapper above, specifically so this function's own
// indentation stays untouched -- wrapping these ~140 existing lines in a
// new try block in place would have touched every one of them just to
// re-indent, a much larger diff than this investigation needs.
async function resolveCatalogIdsWithStages(
  profileId: string,
  input: MyCardInput,
  client: SupabaseClient,
  setStage: (stage: string) => void,
) {
  let card: CardRow;

  if (input.catalogCardId) {
    setStage("catalog-card-lookup");
    // "Search -> Add to Collection" / manual catalog lookup: the collector
    // already explicitly picked this exact catalog card (selectedCard.id
    // in cards/new/page.tsx), so it is the authoritative identity -- skip
    // set/player/card resolution (and any player_card linking) entirely
    // rather than re-deriving/guessing a card from the free-text fields
    // below, which could disagree with what was explicitly picked (e.g.
    // stale playerName/year/setName left over from a prior manual search).
    // Still validated here, server-side, against the trusted service-role
    // client -- never trusted merely because the browser sent a number.
    const existing = await getCard(input.catalogCardId, client);
    if (!existing) {
      throw new Error(`Catalog card ${input.catalogCardId} not found`);
    }
    card = existing;
  } else {
    const releaseYear = input.year ? Number.parseInt(input.year, 10) : NaN;

    setStage("set-resolution");
    const set = await findOrCreateSet(
      {
        name: input.setName,
        release_year: Number.isFinite(releaseYear) ? releaseYear : null,
      },
      client,
    );

    // Bug fix: this is the trusted server-side boundary (service-role
    // client, the only live-app path that writes to `players`) -- input
    // is defensively parsed here, before any findOrCreatePlayer call,
    // rather than trusting the client to have already split it. This
    // matters concretely because /cards/new's catalog-candidate autofill
    // can set the Player field to `result.playerNames.join(" / ")`; if a
    // user accepts that suggestion and saves without editing it, this is
    // the only place standing between that string and a bogus combined-name
    // `players` row. A plain single-player name (the overwhelmingly common
    // case, with no "/") parses to a one-element array, so this changes
    // nothing about existing single-player behavior -- see
    // parsePlayerNames.ts.
    const playerNames = parsePlayerNames(input.playerName.trim());
    const primaryPlayerName = playerNames[0] ?? null;
    setStage("player-resolution");
    const player = primaryPlayerName
      ? await findOrCreatePlayer({ full_name: primaryPlayerName }, client)
      : null;

    // Catalog v2: when a checklist section is given, resolve the card through
    // the section-scoped identity instead of the v1 set-scoped
    // resolveCardForPlayer path. Omitted (the case for every existing caller
    // today) falls through to the exact existing Catalog v1 behavior.
    setStage("card-resolution");
    card = input.checklistSectionId
      ? await findOrCreateCardV2(
          {
            checklistSectionId: input.checklistSectionId,
            setId: set.id,
            cardNumber: input.cardNumber ?? "",
            title: input.insert ?? null,
            isInsert: !!input.insert,
          },
          client,
        )
      : await resolveCardForPlayer(
          set.id,
          input.cardNumber ?? "",
          player?.id ?? null,
          {
            title: input.insert ?? null,
            rookie_card: input.isRookie ?? false,
            is_insert: !!input.insert,
          },
          client,
        );

    if (player) {
      setStage("card-player-link");
      await findOrCreateCardPlayer(card.id, player.id, "primary", client);

      // For a genuine multi-player "/"-combined name (e.g.
      // "Ashton Jeanty/Omarion Hampton"), link every additional distinct
      // parsed name to this same card too, using the existing
      // findOrCreateCardPlayer/findOrCreatePlayer functions as-is --
      // card_players' primary key is (card_id, player_id), not scoped to
      // one row per card, so this needs no schema change. This does NOT
      // change resolveCardForPlayer's card-number disambiguation contract:
      // that still keys only off `player` (the first/primary parsed name),
      // exactly as before this fix -- additional players are linked only
      // AFTER the card itself is already resolved. No redesign of the
      // resolver's single-primary-player card-matching logic was needed to
      // do this safely.
      for (const additionalName of playerNames.slice(1)) {
        const additionalPlayer = await findOrCreatePlayer({ full_name: additionalName }, client);
        await findOrCreateCardPlayer(card.id, additionalPlayer.id, "primary", client);
      }
    }
  }

  let parallelTypeId: number | null = null;
  if (input.parallel?.trim()) {
    setStage("parallel-type-resolution");
    const parallelType = await findOrCreateParallelType(input.parallel.trim(), client);
    parallelTypeId = parallelType.id;
  }

  // Catalog v2: when a swatch descriptor is given, resolve the variant
  // through the wider (card, parallel, print run, swatch descriptor)
  // identity instead of the v1 (card, parallel, print run) lookup. Omitted
  // falls through to the exact existing Catalog v1 behavior.
  setStage("variant-resolution");
  const variant = input.swatchDescriptor
    ? await findOrCreateCardVariantV2(
        {
          cardId: card.id,
          parallelTypeId,
          printRun: input.serialTotal ?? null,
          swatchDescriptor: input.swatchDescriptor,
          isAutograph: input.isAutograph ?? false,
          isMemorabilia: input.isPatch ?? false,
        },
        client,
      )
    : await findOrCreateCardVariant(
        {
          card_id: card.id,
          parallel_type_id: parallelTypeId,
          print_run: input.serialTotal ?? null,
          name_override: input.variation ?? null,
          serial_numbered: !!input.serialTotal,
          has_autograph: input.isAutograph ?? false,
          has_memorabilia: input.isPatch ?? false,
        },
        client,
      );

  let locationId: number | null = null;
  if (input.location?.trim()) {
    setStage("location-resolution");
    const location = await findOrCreateLocation(profileId, input.location.trim(), client);
    locationId = location.id;
  }

  let gradingCompanyId: number | null = null;
  if (input.grader?.trim()) {
    setStage("grading-company-resolution");
    const company = await findOrCreateGradingCompany(input.grader.trim(), client);
    gradingCompanyId = company.id;
  }

  return { cardId: card.id, cardVariantId: variant.id, locationId, gradingCompanyId };
}

/**
 * Server-only entry point for trusted catalog writes. Resolves only shared
 * catalog/lookup ids. Never touches user_cards, never performs a save
 * submission, never writes image/media rows -- callers still own that step
 * exactly as createMyCard does today.
 */
export async function resolveCatalogIdsServer(
  profileId: string,
  input: CatalogResolutionInput,
): Promise<CatalogResolutionResult> {
  const client = createServiceRoleClient();

  const mappedInput: MyCardInput = {
    playerName: input.playerName,
    setName: input.setName,
    year: input.year ?? undefined,
    cardNumber: input.cardNumber ?? undefined,
    catalogCardId: input.catalogCardId ?? undefined,
    checklistSectionId: input.checklistSectionId ?? undefined,
    swatchDescriptor: input.swatchDescriptor ?? undefined,
    insert: input.insert ?? undefined,
    parallel: input.parallel ?? undefined,
    variation: input.variation ?? undefined,
    serialTotal: input.serialTotal ?? undefined,
    isRookie: input.isRookie,
    isAutograph: input.isAutograph,
    isPatch: input.isPatch,
    location: input.location ?? undefined,
    grader: input.grader ?? undefined,
  };

  return resolveCatalogIds(profileId, mappedInput, client);
}

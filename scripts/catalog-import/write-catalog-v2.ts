import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadChecklistRows,
  mapHeaders,
  normalizeBeckettRows,
  isXlsxFile,
  applyXlsxDerivations,
} from "./import-beckett-checklist.ts";
import {
  buildEntities,
  slugify,
  type EntityCollections,
  type Manufacturer,
  type Brand,
  type Sport,
  type League,
  type Team,
  type CardSet,
  type ChecklistSection,
  type Player,
  type Card,
  type CardVariant,
  type CardPlayer,
  type TeamResolutionStats,
} from "./build-catalog-entities.ts";

/**
 * Catalog v2 database writer -- dry-run capable (Phase 3A) with a real
 * write mode (Phase 4). Takes the in-memory entity collections
 * build-catalog-entities.ts already produces and either (dry-run, default)
 * shapes each entity into the insert payload its real table expects
 * without ever connecting to Supabase, or (--write) actually resolves and
 * inserts each entity via the existing repository find-or-create
 * functions.
 *
 * Reuses (does not duplicate):
 *   - parsing/normalization from import-beckett-checklist.ts
 *   - entity building (including the Set -> ChecklistSection -> Card ->
 *     Variant hierarchy and CARD SET decomposition) from
 *     build-catalog-entities.ts
 *   - findOrCreateManufacturer/findOrCreateBrand/findOrCreateSet (sets.ts),
 *     findOrCreateChecklistSection (checklistSections.ts),
 *     findOrCreatePlayer (players.ts), findOrCreateCardV2 (cards.ts),
 *     findOrCreateCardVariantV2 (cardVariants.ts), findOrCreateCardPlayer
 *     (cardPlayers.ts), findOrCreateParallelType (parallelTypes.ts) -- see
 *     runWrite() below.
 *
 * FK placeholders (dry-run only): every shaped insert payload in dry-run
 * mode uses `*_ref` fields (e.g. `sport_ref`, `set_ref`) holding the OTHER
 * entity's *temporary* string id (e.g. "sport:football"), not a real
 * numeric database id -- real ids don't exist until that row is actually
 * inserted. Write mode resolves each of these to the real id returned by
 * the insert/find that happened earlier in dependency order (see the
 * `*IdByTemp` maps in runWrite()).
 *
 * Manufacturers/Brands: real `manufacturers`/`brands` tables now exist
 * (see docs/database/manufacturer-brand-normalization-plan.md, applied as
 * migration 202607090002) -- the note that used to appear here in dry-run
 * output claiming no such table existed is now stale and has been
 * corrected below; write mode inserts them as real rows via
 * findOrCreateManufacturer/findOrCreateBrand like everything else.
 *
 * Canonical Team import (Phase 2): Sports/Leagues/Teams ARE now written by
 * --write, via the findOrCreateSport/findOrCreateLeague/findOrCreateTeam
 * repository functions the canonical-per-card-Team architecture task
 * added to sports.ts/leagues.ts/teams.ts. Each CardPlayer's resolved
 * in-memory Team reference (CardPlayer.teamId, set by
 * build-catalog-entities.ts's positional player<->team pairing -- see its
 * own header comment) is resolved to a real teams.id here and passed
 * through to findOrCreateCardPlayer's existing optional teamId argument.
 * A CardPlayer with no resolvable team relationship (no team text, a
 * player/team segment-count mismatch, or the Panini "Multiverse Jerseys"
 * same-player/multi-team case -- see TeamResolutionStats) is written with
 * team_id left null, exactly like before this row had any team data at
 * all -- never guessed. Sets' sport_id/league_id remain optional and
 * unpopulated by this pipeline, unchanged.
 *
 * IMPORTANT -- confirmed environment limitation, not a bug in this file's
 * logic: every src/lib/repositories/*.ts file is imported elsewhere in the
 * app using the "@/lib/..." tsconfig path alias, which Next.js's bundler
 * understands but Node's native module resolver (used by
 * `node --experimental-strip-types`, how every script in this directory
 * runs) does not. Verified directly: `import("@/lib/repositories/sets")`
 * fails with ERR_MODULE_NOT_FOUND under plain Node, even via a relative
 * path to the file, because the file itself transitively imports more
 * "@/lib/..." paths. `npx tsc --noEmit` reports no error for these imports
 * because TypeScript resolves "@/" via tsconfig.json's `paths` mapping at
 * the type-check level -- that mapping has no effect on actual module
 * resolution outside a bundler. Fixing this needs either a Node loader /
 * tsconfig-paths registration, or converting the repository layer to
 * relative imports -- both are changes outside this file, so neither is
 * attempted here (per this task's explicit instruction not to invent
 * infrastructure the repository architecture doesn't already support).
 * Repository imports are therefore *dynamic* (`await import(...)`), scoped
 * inside the write path only: a *static* top-level import of any
 * "@/lib/..." path would crash this entire module before any code (dry-run
 * included) runs at all, since ES module imports resolve eagerly. `--write`
 * catches this specific failure and reports it clearly instead of crashing
 * uninformatively; dry-run mode never touches these imports and is
 * completely unaffected either way.
 */

export const DEPENDENCY_ORDER = [
  "manufacturers",
  "brands",
  "sports",
  "leagues",
  "teams",
  "sets",
  "checklist_sections",
  "players",
  "cards",
  "parallel_types",
  "card_variants",
  "card_players",
] as const;

export type ParallelTypeEntity = { id: string; name: string };

/**
 * parallel_types has no in-memory collection of its own in
 * EntityCollections (parallel names live as plain strings on
 * CardVariant.parallelName) -- derive one distinct entity per normalized
 * parallel name, the same way build-catalog-entities.ts derives
 * manufacturers/brands from sets.
 */
export function deriveParallelTypes(entities: EntityCollections): Map<string, ParallelTypeEntity> {
  const map = new Map<string, ParallelTypeEntity>();
  for (const variant of entities.cardVariants.values()) {
    if (!variant.parallelName) continue;
    const id = `parallel_type:${slugify(variant.parallelName)}`;
    if (!map.has(id)) map.set(id, { id, name: variant.parallelName });
  }
  return map;
}

/**
 * Collapses ChecklistSection's isAutograph/isMemorabilia/classification
 * into the single section_category column the real table has (see
 * docs/architecture/catalog-v2-spec.md's "section_category should replace
 * scattered section booleans" design decision).
 */
export function deriveSectionCategory(section: ChecklistSection): string {
  if (section.classification === "base") return "base";
  if (section.isAutograph && section.isMemorabilia) return "autograph_memorabilia";
  if (section.isAutograph) return "autograph";
  if (section.isMemorabilia) return "memorabilia";
  return "insert";
}

export function shapeManufacturer(m: Manufacturer) {
  return { name: m.name };
}
export function shapeBrand(b: Brand) {
  return { name: b.name, manufacturer_ref: b.manufacturerId };
}
export function shapeSport(s: Sport) {
  return { name: s.name, slug: slugify(s.name) };
}
export function shapeLeague(l: League) {
  return { sport_ref: l.sportId, name: l.name, slug: slugify(l.name) };
}
export function shapeTeam(t: Team) {
  return { league_ref: t.leagueId, name: t.name, slug: slugify(t.name) };
}
export function shapeSet(s: CardSet, entities: EntityCollections) {
  const manufacturer = entities.manufacturers.get(s.manufacturerId)?.name ?? null;
  const brand = entities.brands.get(s.brandId)?.name ?? null;
  const releaseYear = Number.parseInt(s.releaseYear, 10);
  return {
    name: s.name,
    manufacturer,
    brand,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    slug: slugify(`${s.name}-${s.releaseYear}`),
  };
}
export function shapeChecklistSection(section: ChecklistSection) {
  return {
    set_ref: section.setId,
    name: section.name,
    slug: slugify(section.name),
    section_category: deriveSectionCategory(section),
  };
}
export function shapePlayer(p: Player) {
  return { full_name: p.name, slug: slugify(p.name) };
}
export function shapeCard(c: Card) {
  return {
    set_ref: c.setId,
    checklist_section_ref: c.checklistSectionId,
    card_number: c.cardNumber,
  };
}
export function shapeParallelType(pt: ParallelTypeEntity) {
  return { name: pt.name, slug: slugify(pt.name) };
}
export function shapeCardVariant(v: CardVariant) {
  const printRun = v.printRun ? Number.parseInt(v.printRun, 10) : null;
  return {
    card_ref: v.cardId,
    parallel_type_ref: v.parallelName ? `parallel_type:${slugify(v.parallelName)}` : null,
    print_run: printRun !== null && Number.isFinite(printRun) ? printRun : null,
    swatch_descriptor: v.trailingModifier,
    has_autograph: v.isAutograph,
    has_memorabilia: v.isMemorabilia,
  };
}
export function shapeCardPlayer(cp: CardPlayer) {
  return { card_ref: cp.cardId, player_ref: cp.playerId, role: "primary", team_ref: cp.teamId };
}

/**
 * Canonical Team import (Phase 2): formats TeamResolutionStats into the
 * same "planned/summary" style the rest of this CLI already uses, shown in
 * both dry-run and write-mode output. Never folds the unresolved
 * categories into resolvedCardPlayerTeamsResolved or omits them --
 * Step 9's explicit "do not hide skipped/unresolved relationships inside a
 * generic count" requirement.
 */
export function formatTeamResolutionStats(stats: TeamResolutionStats): string[] {
  return [
    `Rows with TEAM source text: ${stats.rowsWithTeamText}`,
    `CardPlayer relationships with a resolved team_id: ${stats.cardPlayerTeamsResolved}`,
    `Rows skipped for team pairing (player/team segment-count mismatch): ${stats.segmentMismatchRows}`,
    `CardPlayer relationships left unresolved (Multiverse Jerseys-style same-player/multi-team): ${stats.multiversePlayers}`,
  ];
}

export type PlanSection = {
  label: (typeof DEPENDENCY_ORDER)[number];
  count: number;
  sampleInserts: unknown[];
};

export type CatalogV2Plan = {
  sections: PlanSection[];
  parallelTypes: Map<string, ParallelTypeEntity>;
};

/**
 * Shapes every entity in `entities` into its real-table insert payload, in
 * dependency order. Pure computation -- no I/O, no Supabase.
 */
export function buildCatalogV2Plan(entities: EntityCollections): CatalogV2Plan {
  const parallelTypes = deriveParallelTypes(entities);

  const sections: PlanSection[] = [
    {
      label: "manufacturers",
      count: entities.manufacturers.size,
      sampleInserts: [...entities.manufacturers.values()].slice(0, 10).map(shapeManufacturer),
    },
    {
      label: "brands",
      count: entities.brands.size,
      sampleInserts: [...entities.brands.values()].slice(0, 10).map(shapeBrand),
    },
    {
      label: "sports",
      count: entities.sports.size,
      sampleInserts: [...entities.sports.values()].slice(0, 10).map(shapeSport),
    },
    {
      label: "leagues",
      count: entities.leagues.size,
      sampleInserts: [...entities.leagues.values()].slice(0, 10).map(shapeLeague),
    },
    {
      label: "teams",
      count: entities.teams.size,
      sampleInserts: [...entities.teams.values()].slice(0, 10).map(shapeTeam),
    },
    {
      label: "sets",
      count: entities.sets.size,
      sampleInserts: [...entities.sets.values()].slice(0, 10).map((s) => shapeSet(s, entities)),
    },
    {
      label: "checklist_sections",
      count: entities.checklistSections.size,
      sampleInserts: [...entities.checklistSections.values()].slice(0, 10).map(shapeChecklistSection),
    },
    {
      label: "players",
      count: entities.players.size,
      sampleInserts: [...entities.players.values()].slice(0, 10).map(shapePlayer),
    },
    {
      label: "cards",
      count: entities.cards.size,
      sampleInserts: [...entities.cards.values()].slice(0, 10).map(shapeCard),
    },
    {
      label: "parallel_types",
      count: parallelTypes.size,
      sampleInserts: [...parallelTypes.values()].slice(0, 10).map(shapeParallelType),
    },
    {
      label: "card_variants",
      count: entities.cardVariants.size,
      sampleInserts: [...entities.cardVariants.values()].slice(0, 10).map(shapeCardVariant),
    },
    {
      label: "card_players",
      count: entities.cardPlayers.size,
      sampleInserts: [...entities.cardPlayers.values()].slice(0, 10).map(shapeCardPlayer),
    },
  ];

  return { sections, parallelTypes };
}

export type WriteCounts = { created: number; existing: number; skipped: number; errors: number };

function emptyWriteCounts(): WriteCounts {
  return { created: 0, existing: 0, skipped: 0, errors: 0 };
}

export type WriteSummary = Record<(typeof DEPENDENCY_ORDER)[number], WriteCounts>;

function emptyWriteSummary(): WriteSummary {
  const summary = {} as WriteSummary;
  for (const label of DEPENDENCY_ORDER) summary[label] = emptyWriteCounts();
  return summary;
}

// A repository find-or-create call returns the same row shape whether it
// found an existing row or inserted a new one -- there's no "created"
// flag to reuse (adding one would mean modifying repository files, out of
// scope here). Every entity type except card_players has a standalone
// `find*` function already exported alongside its `findOrCreate*`, so for
// those we call the find function ourselves first and classify created-
// vs-existing from whether it returned null -- exact, no ambiguity.
//
// card_players is the one exception: cardPlayers.ts only exports
// findOrCreateCardPlayer, with no standalone find. For that type only, we
// fall back to a created_at-timestamp heuristic (a row created at/after
// this run's start, within a clock-skew tolerance, is assumed new).
// CONFIRMED LIMITATION (caught by this task's own idempotency test, not
// theoretical): re-running shortly after a previous run -- well within
// realistic re-run timing, e.g. retrying right after a partial failure --
// can misclassify a genuinely pre-existing card_players row as newly
// created, because its created_at timestamp still falls inside the
// tolerance window of the new run's start time. This affects only the
// *reported* created/existing count for card_players; it does NOT create
// a duplicate row (findOrCreateCardPlayer's own find-then-insert logic is
// unaffected and still correctly idempotent) -- it's a reporting-accuracy
// limitation, not a data-correctness one. Fixing it properly needs a
// standalone findCardPlayer export, which would mean modifying
// cardPlayers.ts -- out of scope for this task.
const CLOCK_SKEW_TOLERANCE_MS = 5000;

function recordHeuristicOutcome(
  counts: WriteCounts,
  row: { created_at: string },
  runStartedAt: Date
): void {
  const isNew = new Date(row.created_at).getTime() >= runStartedAt.getTime() - CLOCK_SKEW_TOLERANCE_MS;
  if (isNew) counts.created++;
  else counts.existing++;
}

// Strictly one-at-a-time processing was confirmed too slow for real use:
// against the actual 2025 Select Football file, ~500 cards and ~570
// card_variants completed in ~10 minutes of real production runtime before
// this was added, projecting 8+ hours for card_variants alone (27,870 of
// them). Bounded concurrency processes several entities at once instead of
// waiting for each round trip serially, without firing thousands of
// simultaneous requests at Supabase's connection pooler at once.
const WRITE_CONCURRENCY = 15;

/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once. Each
 * worker claims the next index synchronously between awaits -- safe under
 * JS's single-threaded event loop, since no two workers can ever claim the
 * same index -- so every item is processed exactly once regardless of
 * concurrency.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

/** Prints roughly 20 progress lines across `total` items, plus the final one. */
function makeProgressLogger(label: string, total: number): () => void {
  let completed = 0;
  const step = Math.max(1, Math.round(total / 20));
  return () => {
    completed++;
    if (completed % step === 0 || completed === total) {
      console.log(`  ${label}: ${completed}/${total}`);
    }
  };
}

/**
 * Dynamically imports the repository functions this writer reuses, PLUS
 * (administrative-authorization task) the server-only service-role client
 * factory (src/lib/supabase/serviceRole.ts) this writer now requires for
 * every privileged operation -- see the file header comment for why this
 * is a dynamic import scoped to the write path, not a static top-level
 * one, and why it's expected to fail under plain Node in this environment.
 *
 * serviceRole.ts itself begins with `import "server-only"`, a marker
 * package whose default (non-bundler) export unconditionally throws --
 * intentional, so an accidental import from a Next.js client bundle is a
 * build-time error. Next.js's own bundler resolves that package's
 * "react-server" conditional export (a no-op) when compiling Server
 * Components; a bare Node/tsx process does not set that condition by
 * default, so this script's own documented invocation now also requires
 * `--conditions=react-server` (in addition to the already-required
 * `--env-file=.env.local`) for exactly this one import to succeed. No
 * application code (serviceRole.ts included) is changed to accommodate
 * this -- it is an invocation-only requirement, verified to work as-is.
 */
async function loadWriteRepositories() {
  const [
    sets,
    checklistSections,
    players,
    cards,
    cardVariants,
    cardPlayers,
    parallelTypes,
    sports,
    leagues,
    teams,
    serviceRole,
  ] = await Promise.all([
    import("@/lib/repositories/sets"),
    import("@/lib/repositories/checklistSections"),
    import("@/lib/repositories/players"),
    import("@/lib/repositories/cards"),
    import("@/lib/repositories/cardVariants"),
    import("@/lib/repositories/cardPlayers"),
    import("@/lib/repositories/parallelTypes"),
    import("@/lib/repositories/sports"),
    import("@/lib/repositories/leagues"),
    import("@/lib/repositories/teams"),
    import("@/lib/supabase/serviceRole"),
  ]);
  return {
    sets,
    checklistSections,
    players,
    cards,
    cardVariants,
    cardPlayers,
    parallelTypes,
    sports,
    leagues,
    teams,
    serviceRole,
  };
}

type WriteRepositories = Awaited<ReturnType<typeof loadWriteRepositories>>;

/**
 * Writes every entity to Supabase via the existing repository
 * find-or-create functions, in dependency order, all through ONE explicit
 * administrative (service-role) client -- see loadWriteRepositories'/
 * main()'s own comments for why. Every call is find-or-create, so
 * re-running against the same input is idempotent by construction -- see
 * the transaction note below for what that does and doesn't guarantee.
 *
 * No database transaction wraps this, and none is invented here. The
 * repository layer (sets.ts, cards.ts, cardVariants.ts, etc.) is built
 * entirely on the Supabase JS client's PostgREST interface
 * (`supabase.from(table).insert()/.select()`), where every call is its own
 * independent, auto-committing HTTP request -- there is no shared
 * transaction context anywhere in this codebase, and PostgREST exposes no
 * BEGIN/COMMIT primitive for a client to opt into. Real multi-statement
 * transactionality would require either a Postgres RPC function wrapping
 * this whole sequence in one stored procedure (called via
 * `supabase.rpc(...)`), or a direct low-level Postgres connection
 * bypassing PostgREST entirely -- both are new infrastructure, not
 * something to invent inside this task. This function stops at that
 * repository boundary instead: idempotency comes from find-or-create
 * semantics (safe to re-run), not from rollback-on-failure. If a stage
 * fails partway through, rows already written by earlier stages are NOT
 * rolled back.
 *
 * Failure semantics (administrative-authorization task): within one
 * entity-type stage, every item is still attempted and its own outcome
 * caught/counted individually (a single bad row -- e.g. one malformed
 * card_variant -- never aborts the rest of that same stage's items, exactly
 * as before this task). BETWEEN stages, assertStageSucceeded() below is
 * called once each stage's loop/runWithConcurrency finishes; if that stage
 * recorded ANY error, it throws immediately, so no later stage in
 * DEPENDENCY_ORDER is ever attempted -- e.g. a failed "sports" write means
 * this function never even starts "leagues", "teams", or the 27,870
 * card_variants. The throw propagates out of runWrite() uncaught, is
 * caught by main()'s own top-level `main().catch(...)` at the bottom of
 * this file (already existing, unchanged), and results in a non-zero
 * process exit -- a real database error can therefore never be silently
 * swallowed into a "successful" (exit 0) run.
 */
// Caps how many error messages get printed per entity type, so a systemic
// failure affecting thousands of rows doesn't flood the console -- the
// first few are almost always enough to diagnose the actual cause, and the
// per-type Errors count in the summary already reflects the true total.
const MAX_LOGGED_ERRORS_PER_TYPE = 5;
const loggedErrorCounts = new Map<string, number>();

function logEntityError(label: string, err: unknown): void {
  const alreadyLogged = loggedErrorCounts.get(label) ?? 0;
  if (alreadyLogged >= MAX_LOGGED_ERRORS_PER_TYPE) return;
  loggedErrorCounts.set(label, alreadyLogged + 1);
  const message = err instanceof Error ? err.message : JSON.stringify(err);
  console.error(`  [${label} error] ${message}`);
}

/**
 * The one fail-fast gate between stages (see runWrite()'s own doc comment
 * above). Deliberately checks only `.errors` -- never `.skipped`, which is
 * the normal, legitimate outcome for a row whose dependency stage simply
 * hasn't produced an id yet (already reported under its own label) and
 * must never itself be escalated into a fabricated error.
 */
function assertStageSucceeded(label: (typeof DEPENDENCY_ORDER)[number], counts: WriteCounts): void {
  if (counts.errors > 0) {
    throw new Error(
      `Write aborted after "${label}": ${counts.errors} error(s) recorded for this entity type ` +
        `(see the [${label} error] message(s) above for details). No later stage in the ` +
        `dependency order was attempted.`,
    );
  }
}

export async function runWrite(
  entities: EntityCollections,
  parallelTypesLocal: Map<string, ParallelTypeEntity>,
  repos: WriteRepositories,
  client: SupabaseClient,
): Promise<WriteSummary> {
  const summary = emptyWriteSummary();
  loggedErrorCounts.clear();

  console.log(`\nWriting manufacturers (${entities.manufacturers.size})...`);
  const manufacturerIdByTemp = new Map<string, number>();
  for (const [tempId, m] of entities.manufacturers) {
    try {
      const existing = await repos.sets.findManufacturerBySlug(slugify(m.name), client);
      const row = existing ?? (await repos.sets.findOrCreateManufacturer({ name: m.name }, client));
      manufacturerIdByTemp.set(tempId, row.id);
      if (existing) summary.manufacturers.existing++;
      else summary.manufacturers.created++;
    } catch (err) {
      logEntityError("manufacturers", err);
      summary.manufacturers.errors++;
    }
  }
  assertStageSucceeded("manufacturers", summary.manufacturers);

  console.log(`\nWriting brands (${entities.brands.size})...`);
  const brandIdByTemp = new Map<string, number>();
  for (const [tempId, b] of entities.brands) {
    const manufacturerId = manufacturerIdByTemp.get(b.manufacturerId);
    if (manufacturerId === undefined) {
      summary.brands.skipped++;
      continue;
    }
    try {
      const existing = await repos.sets.findBrandBySlug(manufacturerId, slugify(b.name), client);
      const row =
        existing ??
        (await repos.sets.findOrCreateBrand({ manufacturer_id: manufacturerId, name: b.name }, client));
      brandIdByTemp.set(tempId, row.id);
      if (existing) summary.brands.existing++;
      else summary.brands.created++;
    } catch (err) {
      logEntityError("brands", err);
      summary.brands.errors++;
    }
  }
  assertStageSucceeded("brands", summary.brands);

  // Canonical Team import (Phase 2): Sport -> League -> Team, in that
  // dependency order (DEPENDENCY_ORDER above already listed them here;
  // this is the first phase that actually writes them). Each uses the
  // same find-by-slug-then-find-or-create pattern as manufacturers/brands
  // above, via the repository functions the canonical-per-card-Team
  // architecture task added (sports.ts/leagues.ts/teams.ts) -- no
  // NFL-specific behavior lives in those generic functions; the Sport/
  // League *names* themselves (e.g. "Football" -> "NFL") were already
  // resolved upstream in build-catalog-entities.ts's row loop.
  console.log(`\nWriting sports (${entities.sports.size})...`);
  const sportIdByTemp = new Map<string, number>();
  for (const [tempId, sp] of entities.sports) {
    try {
      const existing = await repos.sports.findSportBySlug(slugify(sp.name), client);
      const row = existing ?? (await repos.sports.findOrCreateSport({ name: sp.name }, client));
      sportIdByTemp.set(tempId, row.id);
      if (existing) summary.sports.existing++;
      else summary.sports.created++;
    } catch (err) {
      logEntityError("sports", err);
      summary.sports.errors++;
    }
  }
  assertStageSucceeded("sports", summary.sports);

  console.log(`\nWriting leagues (${entities.leagues.size})...`);
  const leagueIdByTemp = new Map<string, number>();
  for (const [tempId, lg] of entities.leagues) {
    const sportId = sportIdByTemp.get(lg.sportId);
    if (sportId === undefined) {
      summary.leagues.skipped++;
      continue;
    }
    try {
      const existing = await repos.leagues.findLeagueBySlug(sportId, slugify(lg.name), client);
      const row =
        existing ??
        (await repos.leagues.findOrCreateLeague({ sport_id: sportId, name: lg.name }, client));
      leagueIdByTemp.set(tempId, row.id);
      if (existing) summary.leagues.existing++;
      else summary.leagues.created++;
    } catch (err) {
      logEntityError("leagues", err);
      summary.leagues.errors++;
    }
  }
  assertStageSucceeded("leagues", summary.leagues);

  console.log(`\nWriting teams (${entities.teams.size})...`);
  const teamIdByTemp = new Map<string, number>();
  for (const [tempId, tm] of entities.teams) {
    const leagueId = leagueIdByTemp.get(tm.leagueId);
    if (leagueId === undefined) {
      summary.teams.skipped++;
      continue;
    }
    try {
      const existing = await repos.teams.findTeamBySlug(leagueId, slugify(tm.name), client);
      const row =
        existing ??
        (await repos.teams.findOrCreateTeam({ league_id: leagueId, name: tm.name }, client));
      teamIdByTemp.set(tempId, row.id);
      if (existing) summary.teams.existing++;
      else summary.teams.created++;
    } catch (err) {
      logEntityError("teams", err);
      summary.teams.errors++;
    }
  }
  assertStageSucceeded("teams", summary.teams);

  console.log(`\nWriting sets (${entities.sets.size})...`);
  const setIdByTemp = new Map<string, number>();
  for (const [tempId, s] of entities.sets) {
    const manufacturer = entities.manufacturers.get(s.manufacturerId)?.name ?? null;
    const brand = entities.brands.get(s.brandId)?.name ?? null;
    const releaseYear = Number.parseInt(s.releaseYear, 10);
    // Matches sets.ts's own createSet()/findOrCreateSet() slug formula
    // exactly, so this pre-check finds the same row findOrCreateSet would.
    const slug = slugify(`${s.name}-${s.releaseYear}`);
    try {
      const existing = await repos.sets.findSetBySlug(slug, client);
      const row =
        existing ??
        (await repos.sets.findOrCreateSet(
          {
            name: s.name,
            manufacturer,
            brand,
            release_year: Number.isFinite(releaseYear) ? releaseYear : null,
          },
          client,
        ));
      setIdByTemp.set(tempId, row.id);
      if (existing) summary.sets.existing++;
      else summary.sets.created++;
    } catch (err) {
      logEntityError("sets", err);
      summary.sets.errors++;
    }
  }
  assertStageSucceeded("sets", summary.sets);

  console.log(`\nWriting checklist_sections (${entities.checklistSections.size})...`);
  const sectionIdByTemp = new Map<string, number>();
  for (const [tempId, section] of entities.checklistSections) {
    const setId = setIdByTemp.get(section.setId);
    if (setId === undefined) {
      summary.checklist_sections.skipped++;
      continue;
    }
    try {
      const existing = await repos.checklistSections.findChecklistSectionBySlug(
        setId,
        slugify(section.name),
        client,
      );
      const row =
        existing ??
        (await repos.checklistSections.findOrCreateChecklistSection(
          {
            set_id: setId,
            name: section.name,
            section_category: deriveSectionCategory(section),
          },
          client,
        ));
      sectionIdByTemp.set(tempId, row.id);
      if (existing) summary.checklist_sections.existing++;
      else summary.checklist_sections.created++;
    } catch (err) {
      logEntityError("checklist_sections", err);
      summary.checklist_sections.errors++;
    }
  }
  assertStageSucceeded("checklist_sections", summary.checklist_sections);

  console.log(`\nWriting players (${entities.players.size})...`);
  const playerIdByTemp = new Map<string, number>();
  {
    const logProgress = makeProgressLogger("players", entities.players.size);
    await runWithConcurrency(
      [...entities.players],
      WRITE_CONCURRENCY,
      async ([tempId, p]) => {
        try {
          // The entity builder doesn't resolve a league for players,
          // matching findOrCreatePlayer's own `input.league_id ?? null`
          // fallback.
          const existing = await repos.players.findPlayerBySlug(slugify(p.name), null, client);
          const row = existing ?? (await repos.players.findOrCreatePlayer({ full_name: p.name }, client));
          playerIdByTemp.set(tempId, row.id);
          if (existing) summary.players.existing++;
          else summary.players.created++;
        } catch (err) {
          logEntityError("players", err);
          summary.players.errors++;
        } finally {
          logProgress();
        }
      }
    );
  }
  assertStageSucceeded("players", summary.players);

  console.log(`\nWriting cards (${entities.cards.size})...`);
  const cardIdByTemp = new Map<string, number>();
  {
    const logProgress = makeProgressLogger("cards", entities.cards.size);
    await runWithConcurrency(
      [...entities.cards],
      WRITE_CONCURRENCY,
      async ([tempId, c]) => {
        const setId = setIdByTemp.get(c.setId);
        const sectionId = sectionIdByTemp.get(c.checklistSectionId);
        if (setId === undefined || sectionId === undefined) {
          summary.cards.skipped++;
          logProgress();
          return;
        }
        try {
          const existing = await repos.cards.findCardBySectionAndNumber(sectionId, c.cardNumber, client);
          const row =
            existing ??
            (await repos.cards.findOrCreateCardV2(
              {
                checklistSectionId: sectionId,
                setId,
                cardNumber: c.cardNumber,
              },
              client,
            ));
          cardIdByTemp.set(tempId, row.id);
          if (existing) summary.cards.existing++;
          else summary.cards.created++;
        } catch (err) {
          logEntityError("cards", err);
          summary.cards.errors++;
        } finally {
          logProgress();
        }
      }
    );
  }
  assertStageSucceeded("cards", summary.cards);

  console.log(`\nWriting parallel_types (${parallelTypesLocal.size})...`);
  const parallelTypeIdByTemp = new Map<string, number>();
  for (const [tempId, pt] of parallelTypesLocal) {
    try {
      const existing = await repos.parallelTypes.findParallelTypeByName(pt.name, client);
      const row = existing ?? (await repos.parallelTypes.findOrCreateParallelType(pt.name, client));
      parallelTypeIdByTemp.set(tempId, row.id);
      if (existing) summary.parallel_types.existing++;
      else summary.parallel_types.created++;
    } catch (err) {
      logEntityError("parallel_types", err);
      summary.parallel_types.errors++;
    }
  }
  assertStageSucceeded("parallel_types", summary.parallel_types);

  console.log(`\nWriting card_variants (${entities.cardVariants.size})...`);
  {
    const logProgress = makeProgressLogger("card_variants", entities.cardVariants.size);
    await runWithConcurrency(
      [...entities.cardVariants.values()],
      WRITE_CONCURRENCY,
      async (v) => {
        const cardId = cardIdByTemp.get(v.cardId);
        if (cardId === undefined) {
          summary.card_variants.skipped++;
          logProgress();
          return;
        }
        const parallelTypeId = v.parallelName
          ? (parallelTypeIdByTemp.get(`parallel_type:${slugify(v.parallelName)}`) ?? null)
          : null;
        const printRun = v.printRun ? Number.parseInt(v.printRun, 10) : null;
        const variantInput = {
          cardId,
          parallelTypeId,
          printRun: printRun !== null && Number.isFinite(printRun) ? printRun : null,
          swatchDescriptor: v.trailingModifier,
          isAutograph: v.isAutograph,
          isMemorabilia: v.isMemorabilia,
        };
        try {
          const existing = await repos.cardVariants.findCardVariantV2(variantInput, client);
          if (existing) {
            summary.card_variants.existing++;
          } else {
            await repos.cardVariants.findOrCreateCardVariantV2(variantInput, client);
            summary.card_variants.created++;
          }
        } catch (err) {
          logEntityError("card_variants", err);
          summary.card_variants.errors++;
        } finally {
          logProgress();
        }
      }
    );
  }
  assertStageSucceeded("card_variants", summary.card_variants);

  // card_players has no standalone find export -- see the comment above
  // recordHeuristicOutcome() for why this one type uses the timestamp
  // heuristic instead of a find-first check.
  console.log(`\nWriting card_players (${entities.cardPlayers.size})...`);
  {
    const logProgress = makeProgressLogger("card_players", entities.cardPlayers.size);
    const cardPlayersRunStartedAt = new Date();
    await runWithConcurrency(
      [...entities.cardPlayers.values()],
      WRITE_CONCURRENCY,
      async (cp) => {
        const cardId = cardIdByTemp.get(cp.cardId);
        const playerId = playerIdByTemp.get(cp.playerId);
        if (cardId === undefined || playerId === undefined) {
          summary.card_players.skipped++;
          logProgress();
          return;
        }
        // Canonical Team import (Phase 2): cp.teamId is null whenever
        // build-catalog-entities.ts couldn't safely resolve a per-player
        // team relationship for this row (no team text, a segment-count
        // mismatch, or a Multiverse Jerseys-style same-player/multi-team
        // row -- see TeamResolutionStats) -- in every one of those cases
        // this simply passes null through, identical to card_players'
        // pre-Phase-2 behavior. A resolved cp.teamId that this run somehow
        // failed to write (teamIdByTemp miss, e.g. that team's own write
        // errored) also degrades to null here rather than guessing --
        // never a wrong team, only ever a missing one, and
        // findOrCreateCardPlayer's own null-safe enrichment behavior means
        // a later, successful run can still fill it in.
        const teamId = cp.teamId ? (teamIdByTemp.get(cp.teamId) ?? null) : null;
        try {
          const row = await repos.cardPlayers.findOrCreateCardPlayer(
            cardId,
            playerId,
            "primary",
            client,
            teamId,
          );
          recordHeuristicOutcome(summary.card_players, row, cardPlayersRunStartedAt);
        } catch (err) {
          logEntityError("card_players", err);
          summary.card_players.errors++;
        } finally {
          logProgress();
        }
      }
    );
  }
  assertStageSucceeded("card_players", summary.card_players);

  return summary;
}

function parseArgs(argv: string[]): { filePath: string | undefined; write: boolean } {
  const write = argv.includes("--write");
  const filePath = argv.find((a) => !a.startsWith("--"));
  return { filePath, write };
}

async function main() {
  console.log("=== Catalog v2 Database Writer (dry-run capable, offline input) ===\n");

  const { filePath, write } = parseArgs(process.argv.slice(2));

  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/write-catalog-v2.ts <path-to-file.csv|.tsv|.txt|.xlsx> [--write]"
    );
    process.exitCode = 1;
    return;
  }

  if (write) {
    console.log("Mode: WRITE (--write supplied). This will insert rows into Supabase.\n");

    let repos: WriteRepositories;
    let adminClient: SupabaseClient;
    try {
      repos = await loadWriteRepositories();
      // Administrative catalog imports must use a server-only service-role
      // client, never the browser/anon default -- see runWrite()'s own doc
      // comment. Constructed exactly once, here, only in --write mode;
      // dry-run mode never reaches this line and never imports/constructs
      // this client at all.
      adminClient = repos.serviceRole.createServiceRoleClient();
    } catch (err) {
      console.error(
        "FAILED: could not initialize the administrative write path.\n\n" +
          'This can fail for three different reasons, none of which are bugs in this ' +
          "script's logic:\n\n" +
          '  1. Path-alias resolution: every src/lib/*.ts file is imported elsewhere in ' +
          'the app using the "@/..." tsconfig path alias, which Next.js\'s bundler ' +
          "understands but Node's native module resolver does not. `npx tsc --noEmit` " +
          'reports no error because TypeScript resolves "@/" via tsconfig.json\'s `paths` ' +
          "mapping at the type-check level only. Run this script with `tsx` (already a " +
          "project devDependency), which does resolve it.\n\n" +
          "  2. The service-role client factory (src/lib/supabase/serviceRole.ts) begins " +
          'with `import "server-only"` -- a marker package whose non-bundler export ' +
          "unconditionally throws, so an accidental import from browser code is a " +
          "build-time error. A bare tsx/Node process must add Node's own " +
          "`--conditions=react-server` flag (the same condition Next.js's bundler sets " +
          "when compiling Server Components) for this one import to succeed.\n\n" +
          "  3. Missing configuration: createServiceRoleClient() itself throws a plain " +
          '"Missing NEXT_PUBLIC_SUPABASE_URL" or "Missing SUPABASE_SERVICE_ROLE_KEY" ' +
          "error (never a value) if the required environment variable isn't loaded -- " +
          "supply it via `--env-file=.env.local` at the CLI, not by hardcoding it here.\n\n" +
          `Underlying error: ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
      return;
    }

    let writeRows: string[][];
    try {
      writeRows = (await loadChecklistRows(filePath)).rows;
    } catch (err) {
      console.error(
        `FAILED: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
      );
      process.exitCode = 1;
      return;
    }
    if (writeRows.length === 0) {
      console.error("FAILED: no rows could be parsed from this file.");
      process.exitCode = 1;
      return;
    }

    const writeHeaders = writeRows[0];
    const writeDataRows = writeRows.slice(1);
    const { mapping: writeMapping } = mapHeaders(writeHeaders);
    let writeNormalizedRows = normalizeBeckettRows(writeDataRows, writeMapping);
    if (isXlsxFile(filePath)) {
      writeNormalizedRows = applyXlsxDerivations(writeNormalizedRows);
    }

    const writeEntities = buildEntities(writeNormalizedRows);
    const writeParallelTypes = deriveParallelTypes(writeEntities);

    console.log("Dependency order:");
    DEPENDENCY_ORDER.forEach((label, i) => console.log(`  ${i + 1}. ${label}`));

    const summary = await runWrite(writeEntities, writeParallelTypes, repos, adminClient);

    console.log("\n=== Write Summary ===");
    for (const label of DEPENDENCY_ORDER) {
      const c = summary[label];
      console.log(`\n${label}`);
      console.log(`  Created: ${c.created}`);
      console.log(`  Existing: ${c.existing}`);
      console.log(`  Skipped: ${c.skipped}`);
      console.log(`  Errors: ${c.errors}`);
    }

    console.log("\n=== Team Resolution ===");
    formatTeamResolutionStats(writeEntities.teamResolutionStats).forEach((line) =>
      console.log(`  ${line}`),
    );

    console.log("\nWrite complete.");
    return;
  }

  console.log("Mode: DRY RUN (default). No database writes will occur.\n");

  let rows: string[][];
  try {
    rows = (await loadChecklistRows(filePath)).rows;
  } catch (err) {
    console.error(
      `FAILED: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
    return;
  }

  if (rows.length === 0) {
    console.error("FAILED: no rows could be parsed from this file.");
    process.exitCode = 1;
    return;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const { mapping } = mapHeaders(headers);
  let normalizedRows = normalizeBeckettRows(dataRows, mapping);
  if (isXlsxFile(filePath)) {
    normalizedRows = applyXlsxDerivations(normalizedRows);
  }

  const entities = buildEntities(normalizedRows);
  const { sections } = buildCatalogV2Plan(entities);

  console.log("Dependency order:");
  sections.forEach((section, i) => console.log(`  ${i + 1}. ${section.label}`));

  console.log("\nPlanned inserts by entity type:");
  for (const section of sections) {
    console.log(`  ${section.label}: ${section.count}`);
  }

  console.log(
    "\nNote: manufacturers/brands now have real tables (see " +
      "docs/database/manufacturer-brand-normalization-plan.md) -- shown below as their " +
      "own planned inserts; sets.manufacturer/sets.brand text columns are still " +
      "populated too, for compatibility."
  );

  for (const section of sections) {
    console.log(
      `\n--- First ${Math.min(10, section.sampleInserts.length)} planned ${section.label} inserts ---`
    );
    if (section.sampleInserts.length === 0) {
      console.log("  (none)");
    } else {
      section.sampleInserts.forEach((insert, i) => {
        console.log(`  [${i + 1}]`, JSON.stringify(insert));
      });
    }
  }

  const totalPlanned = sections.reduce((sum, s) => sum + s.count, 0);

  console.log("\n=== Summary ===");
  console.log("Entities by type:");
  for (const section of sections) {
    console.log(`  ${section.label}: ${section.count}`);
  }
  console.log(`Total planned inserts: ${totalPlanned}`);
  console.log(`Dependency order: ${sections.map((s) => s.label).join(" -> ")}`);

  console.log("\n=== Team Resolution ===");
  formatTeamResolutionStats(entities.teamResolutionStats).forEach((line) => console.log(`  ${line}`));

  console.log("\nDry-run complete. No database writes occurred.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

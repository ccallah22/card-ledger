import { pathToFileURL } from "node:url";
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
 * Sports/Leagues/Teams are NOT written by --write: sports.ts/leagues.ts/
 * teams.ts currently only export list* functions, no find-or-create --
 * adding one would mean modifying those repository files, which is out of
 * scope for this task (scoped to write-catalog-v2.ts only). They're
 * counted as "Skipped" in the write summary, not silently dropped. Nothing
 * downstream actually depends on them existing first: Sets' sport_id/
 * league_id are optional and unpopulated by this pipeline already, and
 * Player has no team/league reference in the current entity model.
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
  return { card_ref: cp.cardId, player_ref: cp.playerId, role: "primary" };
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

/**
 * Dynamically imports the repository functions this writer reuses. See the
 * file header comment for why this is a dynamic import scoped to the write
 * path, not a static top-level one, and why it's expected to fail under
 * plain Node in this environment.
 */
async function loadWriteRepositories() {
  const [sets, checklistSections, players, cards, cardVariants, cardPlayers, parallelTypes] =
    await Promise.all([
      import("@/lib/repositories/sets"),
      import("@/lib/repositories/checklistSections"),
      import("@/lib/repositories/players"),
      import("@/lib/repositories/cards"),
      import("@/lib/repositories/cardVariants"),
      import("@/lib/repositories/cardPlayers"),
      import("@/lib/repositories/parallelTypes"),
    ]);
  return { sets, checklistSections, players, cards, cardVariants, cardPlayers, parallelTypes };
}

type WriteRepositories = Awaited<ReturnType<typeof loadWriteRepositories>>;

/**
 * Writes every entity to Supabase via the existing repository
 * find-or-create functions, in dependency order. Every call is
 * find-or-create, so re-running against the same input is idempotent by
 * construction -- see the transaction note below for what that does and
 * doesn't guarantee.
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
 * semantics (safe to re-run), not from rollback-on-failure. If a write
 * fails partway through, rows already written by earlier steps are NOT
 * rolled back -- each entity's outcome is caught and counted individually
 * so one bad row doesn't abort the rest of the run.
 */
export async function runWrite(
  entities: EntityCollections,
  parallelTypesLocal: Map<string, ParallelTypeEntity>,
  repos: WriteRepositories
): Promise<WriteSummary> {
  const summary = emptyWriteSummary();

  // Sports/Leagues/Teams: no find-or-create repository function exists yet
  // -- see the file header comment. Skipped and counted, not silently
  // dropped.
  summary.sports.skipped = entities.sports.size;
  summary.leagues.skipped = entities.leagues.size;
  summary.teams.skipped = entities.teams.size;

  const manufacturerIdByTemp = new Map<string, number>();
  for (const [tempId, m] of entities.manufacturers) {
    try {
      const existing = await repos.sets.findManufacturerBySlug(slugify(m.name));
      const row = existing ?? (await repos.sets.findOrCreateManufacturer({ name: m.name }));
      manufacturerIdByTemp.set(tempId, row.id);
      if (existing) summary.manufacturers.existing++;
      else summary.manufacturers.created++;
    } catch {
      summary.manufacturers.errors++;
    }
  }

  const brandIdByTemp = new Map<string, number>();
  for (const [tempId, b] of entities.brands) {
    const manufacturerId = manufacturerIdByTemp.get(b.manufacturerId);
    if (manufacturerId === undefined) {
      summary.brands.skipped++;
      continue;
    }
    try {
      const existing = await repos.sets.findBrandBySlug(manufacturerId, slugify(b.name));
      const row =
        existing ?? (await repos.sets.findOrCreateBrand({ manufacturer_id: manufacturerId, name: b.name }));
      brandIdByTemp.set(tempId, row.id);
      if (existing) summary.brands.existing++;
      else summary.brands.created++;
    } catch {
      summary.brands.errors++;
    }
  }

  const setIdByTemp = new Map<string, number>();
  for (const [tempId, s] of entities.sets) {
    const manufacturer = entities.manufacturers.get(s.manufacturerId)?.name ?? null;
    const brand = entities.brands.get(s.brandId)?.name ?? null;
    const releaseYear = Number.parseInt(s.releaseYear, 10);
    // Matches sets.ts's own createSet()/findOrCreateSet() slug formula
    // exactly, so this pre-check finds the same row findOrCreateSet would.
    const slug = slugify(`${s.name}-${s.releaseYear}`);
    try {
      const existing = await repos.sets.findSetBySlug(slug);
      const row =
        existing ??
        (await repos.sets.findOrCreateSet({
          name: s.name,
          manufacturer,
          brand,
          release_year: Number.isFinite(releaseYear) ? releaseYear : null,
        }));
      setIdByTemp.set(tempId, row.id);
      if (existing) summary.sets.existing++;
      else summary.sets.created++;
    } catch {
      summary.sets.errors++;
    }
  }

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
        slugify(section.name)
      );
      const row =
        existing ??
        (await repos.checklistSections.findOrCreateChecklistSection({
          set_id: setId,
          name: section.name,
          section_category: deriveSectionCategory(section),
        }));
      sectionIdByTemp.set(tempId, row.id);
      if (existing) summary.checklist_sections.existing++;
      else summary.checklist_sections.created++;
    } catch {
      summary.checklist_sections.errors++;
    }
  }

  const playerIdByTemp = new Map<string, number>();
  for (const [tempId, p] of entities.players) {
    try {
      // The entity builder doesn't resolve a league for players, matching
      // findOrCreatePlayer's own `input.league_id ?? null` fallback.
      const existing = await repos.players.findPlayerBySlug(slugify(p.name), null);
      const row = existing ?? (await repos.players.findOrCreatePlayer({ full_name: p.name }));
      playerIdByTemp.set(tempId, row.id);
      if (existing) summary.players.existing++;
      else summary.players.created++;
    } catch {
      summary.players.errors++;
    }
  }

  const cardIdByTemp = new Map<string, number>();
  for (const [tempId, c] of entities.cards) {
    const setId = setIdByTemp.get(c.setId);
    const sectionId = sectionIdByTemp.get(c.checklistSectionId);
    if (setId === undefined || sectionId === undefined) {
      summary.cards.skipped++;
      continue;
    }
    try {
      const existing = await repos.cards.findCardBySectionAndNumber(sectionId, c.cardNumber);
      const row =
        existing ??
        (await repos.cards.findOrCreateCardV2({
          checklistSectionId: sectionId,
          setId,
          cardNumber: c.cardNumber,
        }));
      cardIdByTemp.set(tempId, row.id);
      if (existing) summary.cards.existing++;
      else summary.cards.created++;
    } catch {
      summary.cards.errors++;
    }
  }

  const parallelTypeIdByTemp = new Map<string, number>();
  for (const [tempId, pt] of parallelTypesLocal) {
    try {
      const existing = await repos.parallelTypes.findParallelTypeByName(pt.name);
      const row = existing ?? (await repos.parallelTypes.findOrCreateParallelType(pt.name));
      parallelTypeIdByTemp.set(tempId, row.id);
      if (existing) summary.parallel_types.existing++;
      else summary.parallel_types.created++;
    } catch {
      summary.parallel_types.errors++;
    }
  }

  for (const v of entities.cardVariants.values()) {
    const cardId = cardIdByTemp.get(v.cardId);
    if (cardId === undefined) {
      summary.card_variants.skipped++;
      continue;
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
      const existing = await repos.cardVariants.findCardVariantV2(variantInput);
      if (existing) {
        summary.card_variants.existing++;
      } else {
        await repos.cardVariants.findOrCreateCardVariantV2(variantInput);
        summary.card_variants.created++;
      }
    } catch {
      summary.card_variants.errors++;
    }
  }

  // card_players has no standalone find export -- see the comment above
  // recordHeuristicOutcome() for why this one type uses the timestamp
  // heuristic instead of a find-first check.
  const cardPlayersRunStartedAt = new Date();
  for (const cp of entities.cardPlayers.values()) {
    const cardId = cardIdByTemp.get(cp.cardId);
    const playerId = playerIdByTemp.get(cp.playerId);
    if (cardId === undefined || playerId === undefined) {
      summary.card_players.skipped++;
      continue;
    }
    try {
      const row = await repos.cardPlayers.findOrCreateCardPlayer(cardId, playerId);
      recordHeuristicOutcome(summary.card_players, row, cardPlayersRunStartedAt);
    } catch {
      summary.card_players.errors++;
    }
  }

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
    try {
      repos = await loadWriteRepositories();
    } catch (err) {
      console.error(
        "FAILED: could not load repository modules for write mode.\n\n" +
          'This is a known environment limitation, not a bug in this script\'s logic: ' +
          'every src/lib/repositories/*.ts file is imported elsewhere in the app using ' +
          'the "@/lib/..." tsconfig path alias, which Next.js\'s bundler understands ' +
          "but Node's native module resolver (used by `node --experimental-strip-types`) " +
          'does not. `npx tsc --noEmit` reports no error for these imports because ' +
          'TypeScript resolves "@/" via tsconfig.json\'s `paths` mapping at the ' +
          "type-check level -- but that mapping has no effect on actual module " +
          "resolution outside a bundler. Fixing this needs either a Node loader / " +
          "tsconfig-paths registration, or converting the repository layer to relative " +
          "imports -- both are changes outside this file, so neither is attempted here.\n\n" +
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
    console.log(
      "\nSports/Leagues/Teams are skipped (no find-or-create repository function exists " +
        "yet -- see this file's header comment)."
    );

    const summary = await runWrite(writeEntities, writeParallelTypes, repos);

    console.log("\n=== Write Summary ===");
    for (const label of DEPENDENCY_ORDER) {
      const c = summary[label];
      console.log(`\n${label}`);
      console.log(`  Created: ${c.created}`);
      console.log(`  Existing: ${c.existing}`);
      console.log(`  Skipped: ${c.skipped}`);
      console.log(`  Errors: ${c.errors}`);
    }
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
  console.log("Dry-run complete. No database writes occurred.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

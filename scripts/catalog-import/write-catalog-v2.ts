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
 * Catalog v2 database writer -- dry-run capable (Phase 3A). Takes the
 * in-memory entity collections build-catalog-entities.ts already produces
 * and shapes each entity into the insert payload its real table expects,
 * in dependency order, WITHOUT ever connecting to Supabase.
 *
 * Dry-run is the only mode this task implements. `--write` is scaffolded
 * but intentionally does nothing except report that write mode isn't
 * implemented yet -- no Supabase client is created, no row is ever
 * inserted, updated, deleted, or upserted by this file.
 *
 * Reuses (does not duplicate):
 *   - parsing/normalization from import-beckett-checklist.ts
 *   - entity building (including the Set -> ChecklistSection -> Card ->
 *     Variant hierarchy and CARD SET decomposition) from
 *     build-catalog-entities.ts
 *
 * FK placeholders: every shaped insert payload below uses `*_ref` fields
 * (e.g. `sport_ref`, `set_ref`) holding the OTHER entity's *temporary*
 * string id (e.g. "sport:football"), not a real numeric database id --
 * real ids don't exist until that row is actually inserted. A future real
 * writer resolves each `*_ref` to the real id returned by the insert that
 * happened earlier in dependency order. Naming them `_ref` instead of the
 * real column name (e.g. `sport_id`) keeps this placeholder-vs-real
 * distinction visible at a glance.
 *
 * Manufacturers/Brands note: the current schema has no dedicated
 * `manufacturers`/`brands` tables -- `sets.manufacturer`/`sets.brand` are
 * still free-text columns (see docs/architecture/catalog-v2-erd.md open
 * questions). They're included here for completeness since the task
 * explicitly lists them in the dependency order, but a real writer may
 * need to fold them into the Set insert's text columns instead of
 * inserting them as their own rows, depending on how that open question is
 * resolved.
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
    console.log("--write flag detected.");
    console.log("Write mode not implemented yet.");
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
    "\nNote: manufacturers/brands have no dedicated table in the current schema " +
      "(see docs/architecture/catalog-v2-erd.md open questions) -- shown below for " +
      "completeness; a real writer may need to fold them into sets.manufacturer/" +
      "sets.brand instead of inserting them as their own rows."
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

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  stripBom,
  detectDelimiter,
  parseDelimitedText,
  mapHeaders,
  normalizeBeckettRows,
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
  type Player,
  type CardSet,
  type Card,
  type CardVariant,
  type CardPlayer,
} from "./build-catalog-entities.ts";

/**
 * Offline-input, read-only Catalog Dependency Resolver: compares the
 * in-memory entities produced by build-catalog-entities.ts against the
 * *real* Supabase catalog tables, and prints an import execution plan
 * (existing / create / update / conflict counts per entity type).
 *
 * Read-only: only ever issues `.select()` queries. Never inserts, updates,
 * deletes, upserts, or runs a migration. Requires the service role key only
 * because it needs to read the real catalog tables directly for comparison
 * (the same key already used by this directory's other audit scripts) --
 * not because it writes anything.
 *
 * Schema note: the real database (see
 * supabase/migrations/202607040001_thebinder_database_v1.sql) has no
 * `manufacturers` or `brands` tables -- `manufacturer` and `brand` are free
 * -text columns on `sets`. So for those two entity types, "existing" means
 * "this name already appears somewhere in sets.manufacturer / sets.brand",
 * not a row in a dedicated table, and there is no DB constraint that could
 * make one "conflict". Sports/leagues/teams/players are real tables.
 *
 * Natural keys used for comparison (matching the task spec, and the actual
 * DB unique constraints where one exists):
 *   Manufacturer: slug(name)
 *   Brand:        slug(manufacturer) + slug(name)
 *   Sport:        slug(name)                                  [sports.name unique]
 *   League:       slug(sport name) + slug(league name)        [leagues (sport_id, name) unique]
 *   Team:         slug(league name) + slug(team name)         [teams (league_id, name) unique]
 *   Player:       slug(full name)                             [players (league_id, slug) unique --
 *                 approximated globally here since no league is resolved pre-import]
 *   Set:          release_year + slug(name)                   [sets.slug unique, matches createSet's
 *                 own `slugify(name-year)` -- manufacturer/brand are compared separately as
 *                 enrichable/conflicting attributes, since they aren't part of the slug]
 *   Card:         set key + slug(card_number)                 [cards (set_id, card_number) unique]
 *   Variant:      card key + slug(parallel) + print_run        [card_variants (card_id,
 *                 parallel_type_id, print_run) unique -- has_autograph/has_memorabilia compared
 *                 separately since they aren't part of that constraint]
 *   CardPlayer:   card key + player key                        [card_players (card_id, player_id)
 *                 primary key]
 *
 * "Update" vs "Conflict": for nullable/free-text attributes that sit outside
 * a natural key (sets.manufacturer/brand, card_variants.print_run/parallel),
 * a mismatch is only a safe "Update" when the existing DB value is null/empty
 * (pure enrichment, nothing overwritten); if the DB already has a different
 * non-null value, it's a "Conflict" (the two sources disagree). Boolean flags
 * (has_autograph/has_memorabilia) are never null in the DB, so any mismatch
 * there is always a "Conflict", never an "Update".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type PlanCounts = {
  existing: number;
  create: number;
  update: number;
  conflict: number;
};

function emptyCounts(): PlanCounts {
  return { existing: 0, create: 0, update: 0, conflict: 0 };
}

type PlannedCreate = { entityType: string; id: string; summary: string };

// ---- DB row shapes (select-only, matching the real schema columns) ----

type DbSetRow = {
  id: number;
  name: string;
  manufacturer: string | null;
  brand: string | null;
  release_year: number | null;
  slug: string;
};
type DbSportRow = { id: number; name: string };
type DbLeagueRow = { id: number; name: string; sports: { name: string } | null };
type DbTeamRow = { id: number; name: string; leagues: { name: string } | null };
type DbPlayerRow = { id: number; full_name: string };
type DbCardRow = {
  id: number;
  card_number: string;
  sets: { name: string; release_year: number | null } | null;
};
type DbCardVariantRow = {
  id: number;
  print_run: number | null;
  has_autograph: boolean;
  has_memorabilia: boolean;
  parallel_types: { name: string } | null;
  cards: { card_number: string; sets: { name: string; release_year: number | null } | null } | null;
};
type DbCardPlayerRow = {
  card_id: number;
  player_id: number;
  cards: { card_number: string; sets: { name: string; release_year: number | null } | null } | null;
  players: { full_name: string } | null;
};

// ---- natural-key helpers (independent of build-catalog-entities.ts's
// internal temporary ids, since those ids don't carry every field a real DB
// uniqueness constraint cares about -- e.g. a variant's temp id omits
// print_run) ----

function setKey(releaseYear: string | number | null, name: string): string {
  return `${releaseYear ?? ""}|${slugify(name)}`;
}
function cardKey(setK: string, cardNumber: string): string {
  return `${setK}|${slugify(cardNumber)}`;
}
function variantKey(cardK: string, parallelName: string | null, printRun: string | number | null): string {
  return `${cardK}|${slugify(parallelName ?? "")}|${printRun ?? ""}`;
}

async function main() {
  console.log("=== Catalog Dependency Resolver / Import Plan (read-only) ===\n");

  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --env-file=.env.local --experimental-strip-types scripts/catalog-import/build-import-plan.ts <path-to-file.csv|.tsv|.txt>"
    );
    process.exitCode = 1;
    return;
  }
  if (!SUPABASE_URL) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- no queries were run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. This script reads the full catalog tables " +
        "directly for comparison, which requires the service role key. Aborting -- no queries were " +
        "run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }

  // ---- load + normalize + build in-memory entities (fully offline) ----
  let raw: string;
  try {
    raw = stripBom(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(
      `FAILED: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
    return;
  }
  if (!raw.trim()) {
    console.error("FAILED: file is empty.");
    process.exitCode = 1;
    return;
  }

  const firstLine = raw.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine, filePath);
  const rows = parseDelimitedText(raw, delimiter);
  if (rows.length === 0) {
    console.error("FAILED: no rows could be parsed from this file.");
    process.exitCode = 1;
    return;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const { mapping } = mapHeaders(headers);
  const normalizedRows = normalizeBeckettRows(dataRows, mapping);
  const entities = buildEntities(normalizedRows);

  // ---- connect (SELECT-only) ----
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: setsData, error: setsErr } = await supabase
    .from("sets")
    .select("id, name, manufacturer, brand, release_year, slug");
  if (setsErr) throw setsErr;
  const dbSets = (setsData ?? []) as DbSetRow[];

  const { data: sportsData, error: sportsErr } = await supabase.from("sports").select("id, name");
  if (sportsErr) throw sportsErr;
  const dbSports = (sportsData ?? []) as DbSportRow[];

  const { data: leaguesData, error: leaguesErr } = await supabase
    .from("leagues")
    .select("id, name, sports(name)");
  if (leaguesErr) throw leaguesErr;
  const dbLeagues = (leaguesData ?? []) as unknown as DbLeagueRow[];

  const { data: teamsData, error: teamsErr } = await supabase
    .from("teams")
    .select("id, name, leagues(name)");
  if (teamsErr) throw teamsErr;
  const dbTeams = (teamsData ?? []) as unknown as DbTeamRow[];

  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name");
  if (playersErr) throw playersErr;
  const dbPlayers = (playersData ?? []) as DbPlayerRow[];

  const { data: cardsData, error: cardsErr } = await supabase
    .from("cards")
    .select("id, card_number, sets(name, release_year)");
  if (cardsErr) throw cardsErr;
  const dbCards = (cardsData ?? []) as unknown as DbCardRow[];

  const { data: variantsData, error: variantsErr } = await supabase
    .from("card_variants")
    .select(
      "id, print_run, has_autograph, has_memorabilia, parallel_types(name), cards(card_number, sets(name, release_year))"
    );
  if (variantsErr) throw variantsErr;
  const dbVariants = (variantsData ?? []) as unknown as DbCardVariantRow[];

  const { data: cardPlayersData, error: cardPlayersErr } = await supabase
    .from("card_players")
    .select("card_id, player_id, cards(card_number, sets(name, release_year)), players(full_name)");
  if (cardPlayersErr) throw cardPlayersErr;
  const dbCardPlayers = (cardPlayersData ?? []) as unknown as DbCardPlayerRow[];

  // ---- build DB-side lookup maps, keyed by the same natural keys used for
  // the generated entities ----

  const dbManufacturerNames = new Set(
    dbSets.map((s) => s.manufacturer).filter((v): v is string => !!v)
  );
  const dbBrandPairs = new Set(
    dbSets
      .filter((s) => s.manufacturer && s.brand)
      .map((s) => `${slugify(s.manufacturer as string)}|${slugify(s.brand as string)}`)
  );
  const dbSportNames = new Map(dbSports.map((s) => [slugify(s.name), s]));
  const dbLeagueByKey = new Map(
    dbLeagues
      .filter((l) => l.sports)
      .map((l) => [`${slugify(l.sports!.name)}|${slugify(l.name)}`, l])
  );
  const dbTeamByKey = new Map(
    dbTeams.filter((t) => t.leagues).map((t) => [`${slugify(t.leagues!.name)}|${slugify(t.name)}`, t])
  );
  const dbPlayerByKey = new Map(dbPlayers.map((p) => [slugify(p.full_name), p]));
  const dbSetByKey = new Map(
    dbSets.map((s) => [setKey(s.release_year, s.name), s])
  );
  const dbCardByKey = new Map(
    dbCards
      .filter((c) => c.sets)
      .map((c) => [cardKey(setKey(c.sets!.release_year, c.sets!.name), c.card_number), c])
  );
  const dbVariantByKey = new Map(
    dbVariants
      .filter((v) => v.cards?.sets)
      .map((v) => {
        const ck = cardKey(setKey(v.cards!.sets!.release_year, v.cards!.sets!.name), v.cards!.card_number);
        return [variantKey(ck, v.parallel_types?.name ?? null, v.print_run), v];
      })
  );
  const dbCardPlayerKeys = new Set(
    dbCardPlayers
      .filter((cp) => cp.cards?.sets && cp.players)
      .map((cp) => {
        const ck = cardKey(
          setKey(cp.cards!.sets!.release_year, cp.cards!.sets!.name),
          cp.cards!.card_number
        );
        return `${ck}|${slugify(cp.players!.full_name)}`;
      })
  );

  // ---- compare each generated entity type against DB state ----

  const counts: Record<string, PlanCounts> = {
    manufacturers: emptyCounts(),
    brands: emptyCounts(),
    sports: emptyCounts(),
    leagues: emptyCounts(),
    teams: emptyCounts(),
    players: emptyCounts(),
    sets: emptyCounts(),
    cards: emptyCounts(),
    card_variants: emptyCounts(),
    card_players: emptyCounts(),
  };
  const creates: PlannedCreate[] = [];

  for (const m of entities.manufacturers.values() as IterableIterator<Manufacturer>) {
    if (dbManufacturerNames.has(m.name)) counts.manufacturers.existing++;
    else {
      counts.manufacturers.create++;
      creates.push({ entityType: "manufacturer", id: m.id, summary: m.name });
    }
  }

  for (const b of entities.brands.values() as IterableIterator<Brand>) {
    const manufacturer = entities.manufacturers.get(b.manufacturerId);
    const key = `${slugify(manufacturer?.name ?? "")}|${slugify(b.name)}`;
    if (dbBrandPairs.has(key)) counts.brands.existing++;
    else {
      counts.brands.create++;
      creates.push({ entityType: "brand", id: b.id, summary: `${manufacturer?.name ?? "?"} / ${b.name}` });
    }
  }

  for (const sp of entities.sports.values() as IterableIterator<Sport>) {
    if (dbSportNames.has(slugify(sp.name))) counts.sports.existing++;
    else {
      counts.sports.create++;
      creates.push({ entityType: "sport", id: sp.id, summary: sp.name });
    }
  }

  for (const lg of entities.leagues.values() as IterableIterator<League>) {
    const sport = entities.sports.get(lg.sportId);
    const key = `${slugify(sport?.name ?? "")}|${slugify(lg.name)}`;
    if (dbLeagueByKey.has(key)) counts.leagues.existing++;
    else {
      counts.leagues.create++;
      creates.push({ entityType: "league", id: lg.id, summary: `${sport?.name ?? "?"} / ${lg.name}` });
    }
  }

  for (const tm of entities.teams.values() as IterableIterator<Team>) {
    const league = entities.leagues.get(tm.leagueId);
    const key = `${slugify(league?.name ?? "")}|${slugify(tm.name)}`;
    if (dbTeamByKey.has(key)) counts.teams.existing++;
    else {
      counts.teams.create++;
      creates.push({ entityType: "team", id: tm.id, summary: `${league?.name ?? "?"} / ${tm.name}` });
    }
  }

  for (const pl of entities.players.values() as IterableIterator<Player>) {
    if (dbPlayerByKey.has(slugify(pl.name))) counts.players.existing++;
    else {
      counts.players.create++;
      creates.push({ entityType: "player", id: pl.id, summary: pl.name });
    }
  }

  for (const st of entities.sets.values() as IterableIterator<CardSet>) {
    const key = setKey(st.releaseYear, st.name);
    const dbRow = dbSetByKey.get(key);
    if (!dbRow) {
      counts.sets.create++;
      creates.push({ entityType: "set", id: st.id, summary: `${st.releaseYear} ${st.name}` });
      continue;
    }
    const manufacturer = entities.manufacturers.get(st.manufacturerId)?.name ?? null;
    const brand = entities.brands.get(st.brandId)?.name ?? null;
    const manufacturerConflict = !!dbRow.manufacturer && !!manufacturer && dbRow.manufacturer !== manufacturer;
    const brandConflict = !!dbRow.brand && !!brand && dbRow.brand !== brand;
    const manufacturerFillable = !dbRow.manufacturer && !!manufacturer;
    const brandFillable = !dbRow.brand && !!brand;
    if (manufacturerConflict || brandConflict) counts.sets.conflict++;
    else if (manufacturerFillable || brandFillable) counts.sets.update++;
    else counts.sets.existing++;
  }

  for (const cd of entities.cards.values() as IterableIterator<Card>) {
    const set = entities.sets.get(cd.setId);
    const key = cardKey(setKey(set?.releaseYear ?? null, set?.name ?? ""), cd.cardNumber);
    if (dbCardByKey.has(key)) counts.cards.existing++;
    else {
      counts.cards.create++;
      creates.push({
        entityType: "card",
        id: cd.id,
        summary: `${set?.name ?? "?"} #${cd.cardNumber}`,
      });
    }
  }

  for (const vr of entities.cardVariants.values() as IterableIterator<CardVariant>) {
    const card = entities.cards.get(vr.cardId);
    const set = card ? entities.sets.get(card.setId) : undefined;
    const ck = cardKey(setKey(set?.releaseYear ?? null, set?.name ?? ""), card?.cardNumber ?? "");
    const key = variantKey(ck, vr.parallelName, vr.printRun);
    const dbRow = dbVariantByKey.get(key);
    if (!dbRow) {
      counts.card_variants.create++;
      creates.push({
        entityType: "card_variant",
        id: vr.id,
        summary: `${set?.name ?? "?"} #${card?.cardNumber ?? "?"} ${vr.parallelName ?? "base"}`,
      });
      continue;
    }
    const flagsConflict =
      dbRow.has_autograph !== vr.isAutograph || dbRow.has_memorabilia !== vr.isMemorabilia;
    if (flagsConflict) counts.card_variants.conflict++;
    else counts.card_variants.existing++;
  }

  for (const cp of entities.cardPlayers.values() as IterableIterator<CardPlayer>) {
    const card = entities.cards.get(cp.cardId);
    const set = card ? entities.sets.get(card.setId) : undefined;
    const player = entities.players.get(cp.playerId);
    const ck = cardKey(setKey(set?.releaseYear ?? null, set?.name ?? ""), card?.cardNumber ?? "");
    const key = `${ck}|${slugify(player?.name ?? "")}`;
    if (dbCardPlayerKeys.has(key)) counts.card_players.existing++;
    else {
      counts.card_players.create++;
      creates.push({
        entityType: "card_player",
        id: cp.id,
        summary: `${set?.name ?? "?"} #${card?.cardNumber ?? "?"} -- ${player?.name ?? "?"}`,
      });
    }
  }

  // ---- print report ----

  console.log("=========================");
  console.log("IMPORT PLAN");
  console.log("=========================\n");

  const sections: Array<[string, string]> = [
    ["manufacturers", "Manufacturers"],
    ["brands", "Brands"],
    ["sports", "Sports"],
    ["leagues", "Leagues"],
    ["teams", "Teams"],
    ["players", "Players"],
    ["sets", "Sets"],
    ["cards", "Cards"],
    ["card_variants", "Variants"],
    ["card_players", "CardPlayers"],
  ];

  const totals = emptyCounts();
  for (const [key, label] of sections) {
    const c = counts[key];
    totals.existing += c.existing;
    totals.create += c.create;
    totals.update += c.update;
    totals.conflict += c.conflict;

    console.log(label);
    console.log(`Existing: ${c.existing}`);
    console.log(`Create: ${c.create}`);
    if (c.update > 0) console.log(`Update: ${c.update}`);
    console.log(`Conflicts: ${c.conflict}`);
    console.log("");
  }

  console.log("Totals\n");
  console.log(`Create: ${totals.create}`);
  console.log(`Update: ${totals.update}`);
  console.log(`Existing: ${totals.existing}`);
  console.log(`Conflicts: ${totals.conflict}`);

  console.log("\nFirst 10 planned creates:");
  if (creates.length === 0) {
    console.log("  (none)");
  } else {
    creates.slice(0, 10).forEach((c, i) => {
      console.log(`  [${i + 1}] ${c.entityType}: ${c.id} -- ${c.summary}`);
    });
  }

  console.log(
    "\nThis was a read-only comparison against the real database. No rows were inserted, updated, " +
      "deleted, or upserted, and no migration was run."
  );
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  stripBom,
  detectDelimiter,
  parseDelimitedText,
  mapHeaders,
  normalizeBeckettRows,
  type NormalizedBeckettRow,
} from "./import-beckett-checklist.ts";

/**
 * Offline transformer: turns normalized Beckett/Sheets checklist rows into
 * deduplicated, in-memory catalog entities (manufacturers, brands, sports,
 * leagues, teams, players, sets, cards, card_variants, card_players) using
 * temporary deterministic string ids instead of database-assigned ids.
 *
 * Does NOT connect to Supabase, does NOT insert/update/delete/upsert
 * anything, and assigns no database ids -- this is purely a preview of
 * what the eventual entity set would look like.
 *
 * Heuristic note: the normalized Beckett fields (see
 * import-beckett-checklist.ts) have no explicit manufacturer/brand/
 * sport/league columns, so those four are *derived*, not read directly:
 *   - manufacturer/brand: split from set_name using a small known-
 *     manufacturer prefix list (e.g. "Panini Prizm" -> manufacturer
 *     "Panini", brand "Prizm"). Falls back to manufacturer "Unknown".
 *   - sport/league: looked up from team_name against a small known-team
 *     list. Falls back to "Unknown"/"Unknown". This is intentionally
 *     minimal (just enough to cover realistic fixtures) and is not a
 *     database of sports/teams.
 */

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export type Manufacturer = { id: string; name: string };
export type Brand = { id: string; name: string; manufacturerId: string };
export type Sport = { id: string; name: string };
export type League = { id: string; name: string; sportId: string };
export type Team = { id: string; name: string; leagueId: string };
export type Player = { id: string; name: string };
export type CardSet = {
  id: string;
  name: string;
  releaseYear: string;
  manufacturerId: string;
  brandId: string;
};
export type Card = { id: string; setId: string; cardNumber: string };
export type CardVariant = {
  id: string;
  cardId: string;
  parallelName: string | null;
  printRun: string | null;
  isAutograph: boolean;
  isMemorabilia: boolean;
};
export type CardPlayer = { id: string; cardId: string; playerId: string };

const KNOWN_MANUFACTURERS = ["Panini", "Topps", "Upper Deck", "Bowman", "Donruss", "Leaf"];

function splitManufacturerBrand(setName: string): { manufacturer: string; brand: string } {
  for (const manufacturer of KNOWN_MANUFACTURERS) {
    const prefix = manufacturer.toLowerCase() + " ";
    if (setName.toLowerCase().startsWith(prefix)) {
      return { manufacturer, brand: setName.slice(prefix.length).trim() || setName };
    }
  }
  return { manufacturer: "Unknown", brand: setName };
}

// Minimal known-team lookup for the sport/league heuristic. Not a real
// sports database -- covers common team names well enough for a fixture
// or a first real checklist, and falls back gracefully otherwise.
const KNOWN_NFL_TEAMS = new Set(
  [
    "Kansas City Chiefs",
    "Cincinnati Bengals",
    "Minnesota Vikings",
    "Dallas Cowboys",
    "Philadelphia Eagles",
    "Jacksonville Jaguars",
    "New York Giants",
    "Cleveland Browns",
  ].map((t) => t.toLowerCase())
);

function resolveSportLeague(teamName: string): { sport: string; league: string } {
  if (KNOWN_NFL_TEAMS.has(teamName.toLowerCase())) {
    return { sport: "Football", league: "NFL" };
  }
  return { sport: "Unknown", league: "Unknown" };
}

export type EntityCollections = {
  manufacturers: Map<string, Manufacturer>;
  brands: Map<string, Brand>;
  sports: Map<string, Sport>;
  leagues: Map<string, League>;
  teams: Map<string, Team>;
  players: Map<string, Player>;
  sets: Map<string, CardSet>;
  cards: Map<string, Card>;
  cardVariants: Map<string, CardVariant>;
  cardPlayers: Map<string, CardPlayer>;
};

function createCollections(): EntityCollections {
  return {
    manufacturers: new Map(),
    brands: new Map(),
    sports: new Map(),
    leagues: new Map(),
    teams: new Map(),
    players: new Map(),
    sets: new Map(),
    cards: new Map(),
    cardVariants: new Map(),
    cardPlayers: new Map(),
  };
}

export function buildEntities(rows: NormalizedBeckettRow[]): EntityCollections {
  const c = createCollections();

  for (const row of rows) {
    // Without these three, there's nothing to anchor a Card (or anything
    // downstream of it) to -- skip the row rather than guessing.
    if (!row.set_name || !row.release_year || !row.card_number) continue;

    const { manufacturer, brand } = splitManufacturerBrand(row.set_name);
    const manufacturerId = `manufacturer:${slugify(manufacturer)}`;
    if (!c.manufacturers.has(manufacturerId)) {
      c.manufacturers.set(manufacturerId, { id: manufacturerId, name: manufacturer });
    }

    const brandId = `brand:${slugify(manufacturer)}-${slugify(brand)}`;
    if (!c.brands.has(brandId)) {
      c.brands.set(brandId, { id: brandId, name: brand, manufacturerId });
    }

    const setSlug = slugify(row.set_name);
    const setId = `set:${row.release_year}-${setSlug}`;
    if (!c.sets.has(setId)) {
      c.sets.set(setId, {
        id: setId,
        name: row.set_name,
        releaseYear: row.release_year,
        manufacturerId,
        brandId,
      });
    }

    const cardNumberSlug = slugify(row.card_number);
    const cardId = `card:${row.release_year}-${setSlug}-${cardNumberSlug}`;
    if (!c.cards.has(cardId)) {
      c.cards.set(cardId, { id: cardId, setId, cardNumber: row.card_number });
    }

    const isAutograph = row.is_autograph === "true";
    const isMemorabilia = row.is_memorabilia === "true";
    const variantSuffixParts = [
      row.parallel_name ? slugify(row.parallel_name) : null,
      isAutograph ? "au" : null,
      isMemorabilia ? "mem" : null,
    ].filter((part): part is string => !!part);
    const variantSuffix = variantSuffixParts.length > 0 ? variantSuffixParts.join("-") : "base";
    const variantId = `variant:${row.release_year}-${setSlug}-${cardNumberSlug}-${variantSuffix}`;
    if (!c.cardVariants.has(variantId)) {
      c.cardVariants.set(variantId, {
        id: variantId,
        cardId,
        parallelName: row.parallel_name || null,
        printRun: row.print_run,
        isAutograph,
        isMemorabilia,
      });
    }

    if (row.team_name) {
      const { sport, league } = resolveSportLeague(row.team_name);

      const sportId = `sport:${slugify(sport)}`;
      if (!c.sports.has(sportId)) c.sports.set(sportId, { id: sportId, name: sport });

      const leagueId = `league:${slugify(league)}`;
      if (!c.leagues.has(leagueId)) {
        c.leagues.set(leagueId, { id: leagueId, name: league, sportId });
      }

      const teamId = `team:${slugify(row.team_name)}`;
      if (!c.teams.has(teamId)) {
        c.teams.set(teamId, { id: teamId, name: row.team_name, leagueId });
      }
    }

    if (row.player_name) {
      const playerId = `player:${slugify(row.player_name)}`;
      if (!c.players.has(playerId)) {
        c.players.set(playerId, { id: playerId, name: row.player_name });
      }

      const cardPlayerId = `cardplayer:${row.release_year}-${setSlug}-${cardNumberSlug}-${slugify(
        row.player_name
      )}`;
      if (!c.cardPlayers.has(cardPlayerId)) {
        c.cardPlayers.set(cardPlayerId, { id: cardPlayerId, cardId, playerId });
      }
    }
  }

  return c;
}

function printFirstFive<T>(label: string, map: Map<string, T>): void {
  const entries = Array.from(map.values()).slice(0, 5);
  console.log(`\nFirst ${entries.length} ${label}:`);
  if (entries.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const entity of entries) {
    console.log(" ", JSON.stringify(entity));
  }
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/build-catalog-entities.ts <path-to-file.csv|.tsv|.txt>"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== Catalog Entity Builder (offline, no database access) ===\n");

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

  console.log("Entity Summary\n");
  console.log(`Manufacturers: ${entities.manufacturers.size}`);
  console.log(`Brands: ${entities.brands.size}`);
  console.log(`Sports: ${entities.sports.size}`);
  console.log(`Leagues: ${entities.leagues.size}`);
  console.log(`Teams: ${entities.teams.size}`);
  console.log(`Players: ${entities.players.size}`);
  console.log(`Sets: ${entities.sets.size}`);
  console.log(`Cards: ${entities.cards.size}`);
  console.log(`Variants: ${entities.cardVariants.size}`);
  console.log(`CardPlayers: ${entities.cardPlayers.size}`);

  printFirstFive("manufacturers", entities.manufacturers);
  printFirstFive("brands", entities.brands);
  printFirstFive("sports", entities.sports);
  printFirstFive("leagues", entities.leagues);
  printFirstFive("teams", entities.teams);
  printFirstFive("players", entities.players);
  printFirstFive("sets", entities.sets);
  printFirstFive("cards", entities.cards);
  printFirstFive("card_variants", entities.cardVariants);
  printFirstFive("card_players", entities.cardPlayers);

  console.log(
    "\nThis was an offline entity-building preview only. No database connection was made, no ids " +
      "were assigned by a database, and no data was written anywhere."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

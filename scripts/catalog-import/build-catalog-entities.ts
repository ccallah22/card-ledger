import { pathToFileURL } from "node:url";
import {
  mapHeaders,
  normalizeBeckettRows,
  loadChecklistRows,
  isXlsxFile,
  applyXlsxDerivations,
  type NormalizedBeckettRow,
} from "./import-beckett-checklist.ts";
import { analyzeCardSet, normalizeParallelName } from "./analyze-card-set-patterns.ts";
// Plain relative import (not the "@/..." alias) so this still resolves
// under plain Node -- see parsePlayerNames.ts's own header comment for why.
import { parsePlayerNames } from "../../src/lib/catalog/parsePlayerNames.ts";

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
 * Heuristic note: some checklist formats (Beckett's plain CSV/TSV exports,
 * or pasted Sheets text) have no explicit manufacturer/brand/sport columns,
 * so those are *derived* when not directly present:
 *   - manufacturer/brand: preferred from row.set_manufacturer/set_brand
 *     when present (real columns on Beckett's XLSX "Master Checklist"
 *     exports -- see import-beckett-checklist.ts); otherwise split from
 *     set_name using a small known-manufacturer prefix list (e.g. "Panini
 *     Prizm" -> manufacturer "Panini", brand "Prizm"). Falls back to
 *     manufacturer "Unknown".
 *   - sport: preferred from row.sport when present; otherwise looked up
 *     from team_name against a small known-team list.
 *   - league: derived from sport, not from team_name -- a real checklist
 *     can reference many decades' worth of NFL teams (retired/relocated
 *     included), far more than any small hardcoded team list could cover,
 *     so matching league by team name reliably produced "Unknown" for
 *     ordinary rows. Football -> NFL is the only rule modeled today; a
 *     non-football sport (or no sport at all) falls back to "Unknown".
 *
 * Entity hierarchy: Set -> ChecklistSection -> Card -> Variant. set_name is
 * the *release* (e.g. "2025 Panini Select Football"); CARD SET (subset_or_
 * insert) is decomposed via analyze-card-set-patterns.ts's analyzeCardSet()
 * into a ChecklistSection (e.g. "Base Club Level", "Rookie Signatures") and
 * a per-row parallel/trailing-modifier/flags that live on the Variant.
 * Because different sections within one release commonly restart card
 * numbering from 1, Card ids are keyed by section + card number (not just
 * card number) so two different sections' "#1" don't collide and silently
 * overwrite each other under the same Set. Parallel names are normalized
 * (normalizeParallelName) so word-order variants of the same parallel
 * (e.g. "Disco Black Prizm" / "Black Disco Prizm") collapse to one identity.
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
export type ChecklistSection = {
  id: string;
  setId: string;
  name: string;
  isAutograph: boolean;
  isMemorabilia: boolean;
  classification: "base" | "insert";
};
export type Card = { id: string; setId: string; checklistSectionId: string; cardNumber: string };
export type CardVariant = {
  id: string;
  cardId: string;
  parallelName: string | null;
  trailingModifier: string | null;
  printRun: string | null;
  isAutograph: boolean;
  isMemorabilia: boolean;
};
// Canonical Team import, Phase 2: teamId references an entry in this same
// EntityCollections' `teams` map (e.g. "team:las-vegas-raiders") -- never a
// raw team-name string duplicated here -- so the writer resolves it to a
// real teams.id the exact same way it already resolves cardId/playerId.
// null means "no trustworthy per-player Team relationship for this row"
// (no team text at all, a player/team segment-count mismatch, or the
// Panini "Multiverse Jerseys" same-player/multiple-team case) -- see
// buildEntities()'s own comment for exactly which of those applies and how
// each is counted in TeamResolutionStats, never guessed.
export type CardPlayer = { id: string; cardId: string; playerId: string; teamId: string | null };

// Canonical Team import, Phase 2: counts why some CardPlayer relationships
// do NOT get a team_id, so a caller (write-catalog-v2.ts's dry-run/write
// summaries) can show this explicitly rather than folding it into a
// generic count. Every category here is mutually exclusive per row/player
// -- see buildEntities().
export type TeamResolutionStats = {
  /** Rows with non-empty TEAM source text (before any splitting). */
  rowsWithTeamText: number;
  /**
   * Rows where TEAM had text but the number of "/"-split team segments
   * didn't match the number of "/"-split player segments -- positional
   * pairing would be a guess, so NO player on that row gets a team_id from
   * it (Step 3's explicit "do not guess" requirement).
   */
  segmentMismatchRows: number;
  /**
   * Distinct CardPlayer relationships affected by the same player's name
   * appearing more than once in one row's ATHLETE text (Panini "Multiverse
   * Jerseys"-style dual/multi-team swatch cards, e.g. "James Conner/James
   * Conner" + "Arizona Cardinals/Pittsburgh Steelers"). The single
   * CardPlayer entity card_players' (card_id, player_id) primary key
   * allows for that player-on-that-card is left team_id = null rather than
   * arbitrarily picking one of the multiple teams -- see the Team
   * architecture audit for why this is a real, not-yet-solved schema
   * limitation, intentionally not redesigned in this phase.
   */
  multiversePlayers: number;
  /** CardPlayer relationships that DID get a resolved, non-null teamId. */
  cardPlayerTeamsResolved: number;
};

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

// Sport fallback for formats with no explicit SPORT column (e.g. Beckett's
// plain CSV exports, identified only by team name).
function resolveSportFromTeam(teamName: string): string {
  return KNOWN_NFL_TEAMS.has(teamName.toLowerCase()) ? "Football" : "Unknown";
}

// League is derived from sport, not team name -- see the file header
// comment for why. Only football/NFL is modeled today.
function resolveLeagueForSport(sport: string): string {
  return sport.toLowerCase() === "football" ? "NFL" : "Unknown";
}

export type EntityCollections = {
  manufacturers: Map<string, Manufacturer>;
  brands: Map<string, Brand>;
  sports: Map<string, Sport>;
  leagues: Map<string, League>;
  teams: Map<string, Team>;
  players: Map<string, Player>;
  sets: Map<string, CardSet>;
  checklistSections: Map<string, ChecklistSection>;
  cards: Map<string, Card>;
  cardVariants: Map<string, CardVariant>;
  cardPlayers: Map<string, CardPlayer>;
  // Canonical Team import, Phase 2: not an entity collection itself --
  // diagnostic counters accumulated while resolving CardPlayer.teamId
  // below, exposed here (rather than a second return value) so every
  // existing buildEntities() caller keeps compiling unchanged.
  teamResolutionStats: TeamResolutionStats;
};

function emptyTeamResolutionStats(): TeamResolutionStats {
  return {
    rowsWithTeamText: 0,
    segmentMismatchRows: 0,
    multiversePlayers: 0,
    cardPlayerTeamsResolved: 0,
  };
}

function createCollections(): EntityCollections {
  return {
    manufacturers: new Map(),
    brands: new Map(),
    sports: new Map(),
    leagues: new Map(),
    teams: new Map(),
    players: new Map(),
    sets: new Map(),
    checklistSections: new Map(),
    cards: new Map(),
    cardVariants: new Map(),
    cardPlayers: new Map(),
    teamResolutionStats: emptyTeamResolutionStats(),
  };
}

export function buildEntities(rows: NormalizedBeckettRow[]): EntityCollections {
  const c = createCollections();

  for (const row of rows) {
    // Without these three, there's nothing to anchor a Card (or anything
    // downstream of it) to -- skip the row rather than guessing.
    if (!row.set_name || !row.release_year || !row.card_number) continue;

    // Prefer real BRAND/PROGRAM columns (Beckett's XLSX "Master Checklist"
    // format) over the set_name prefix heuristic when they're present.
    const { manufacturer, brand } = row.set_manufacturer
      ? { manufacturer: row.set_manufacturer, brand: row.set_brand || row.set_manufacturer }
      : splitManufacturerBrand(row.set_name);
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

    // Decompose CARD SET (subset_or_insert) into its checklist section,
    // parallel, trailing modifier, and flags -- see
    // analyze-card-set-patterns.ts for the parsing rules. Every row has raw
    // CARD SET text (possibly empty for older CSV formats with no such
    // column), so this always resolves to at least a section name.
    const parsed = analyzeCardSet(row.subset_or_insert ?? "");

    // Different checklist sections within the same release commonly
    // restart card numbering from 1 -- key the Card by section + card
    // number (not just card number) so e.g. "Signatures Prizm #1" and
    // "Alter Ego #1" don't collide under one Set. (The real DB's
    // `cards (set_id, card_number)` constraint doesn't yet have this
    // dimension; see the schema-plan task's report for that open question.)
    const sectionSlug = slugify(parsed.section);
    const checklistSectionId = `section:${row.release_year}-${setSlug}-${sectionSlug}`;
    if (!c.checklistSections.has(checklistSectionId)) {
      c.checklistSections.set(checklistSectionId, {
        id: checklistSectionId,
        setId,
        name: parsed.section,
        isAutograph: parsed.isAutograph,
        isMemorabilia: parsed.isMemorabilia,
        classification: parsed.classification,
      });
    }

    const cardNumberSlug = slugify(row.card_number);
    const cardId = `card:${row.release_year}-${setSlug}-${sectionSlug}-${cardNumberSlug}`;
    if (!c.cards.has(cardId)) {
      c.cards.set(cardId, {
        id: cardId,
        setId,
        checklistSectionId,
        cardNumber: row.card_number,
      });
    }

    // Prefer the CARD-SET-derived parallel (from CARD SET text) over the
    // older explicit Parallel column (row.parallel_name, used by Beckett's
    // plain CSV format, which has no CARD SET decomposition of its own) --
    // whichever is present wins, and the result is normalized so word-order
    // variants of the same parallel don't fork into separate identities.
    const rawParallel = parsed.parallel || row.parallel_name || null;
    const normalizedParallel = rawParallel ? normalizeParallelName(rawParallel) : null;
    const isAutograph = row.is_autograph === "true" || parsed.isAutograph;
    const isMemorabilia = row.is_memorabilia === "true" || parsed.isMemorabilia;

    const variantSuffixParts = [
      normalizedParallel ? slugify(normalizedParallel) : null,
      parsed.trailingModifier ? slugify(parsed.trailingModifier) : null,
      isAutograph ? "au" : null,
      isMemorabilia ? "mem" : null,
    ].filter((part): part is string => !!part);
    const variantSuffix = variantSuffixParts.length > 0 ? variantSuffixParts.join("-") : "base";
    const variantId = `variant:${cardId}-${variantSuffix}`;
    if (!c.cardVariants.has(variantId)) {
      c.cardVariants.set(variantId, {
        id: variantId,
        cardId,
        parallelName: normalizedParallel,
        trailingModifier: parsed.trailingModifier,
        printRun: parsed.printRun ?? row.print_run,
        isAutograph,
        isMemorabilia,
      });
    }

    // Canonical Team import, Phase 2: row.team_name uses the same
    // "/"-combined convention as row.player_name, for two different real
    // reasons -- a genuine multi-player card ("Ashton Jeanty/Omarion
    // Hampton" + "Las Vegas Raiders/Los Angeles Chargers") or the SAME
    // player shown across two team jerseys on one physical card (Panini's
    // "Multiverse Jerseys" insert, e.g. "James Conner/James Conner" +
    // "Arizona Cardinals/Pittsburgh Steelers"). Confirmed against the real
    // 2025 Select Football file (Team-import audit): 100% of rows have
    // team text, 0 rows have a player/team segment-count mismatch, and
    // player[i] always corresponds to team[i] positionally -- but that is
    // confirmed for THIS file/format, not guaranteed for every future
    // source, so both defensive cases below (mismatch, same-player-repeat)
    // are handled rather than assumed away.
    //
    // Sport/League/Team entities are now created per DISTINCT team
    // segment (not per raw, possibly-combined row.team_name string as
    // before this phase) -- "Arizona Cardinals" and "Pittsburgh Steelers"
    // become two real, separately-named Team entities, never one bogus
    // "Arizona Cardinals/Pittsburgh Steelers" entity.
    const rawTeamSegments = (row.team_name ?? "")
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    if (rawTeamSegments.length > 0) {
      c.teamResolutionStats.rowsWithTeamText++;
    }

    // teamIdBySegmentIndex[i] is the resolved in-memory Team entity id for
    // rawTeamSegments[i], in the same order -- computed once per row,
    // referenced (never duplicated) by whichever CardPlayer(s) below the
    // positional-pairing logic assigns them to.
    const teamIdBySegmentIndex: string[] = [];
    for (const teamSegment of rawTeamSegments) {
      // SPORT is a real column on Beckett's XLSX "Master Checklist" format
      // -- prefer it over the team-name heuristic when present. Unchanged
      // from before this phase.
      const sport = row.sport || resolveSportFromTeam(teamSegment);
      const league = resolveLeagueForSport(sport);

      const sportId = `sport:${slugify(sport)}`;
      if (!c.sports.has(sportId)) c.sports.set(sportId, { id: sportId, name: sport });

      const leagueId = `league:${slugify(league)}`;
      if (!c.leagues.has(leagueId)) {
        c.leagues.set(leagueId, { id: leagueId, name: league, sportId });
      }

      const teamId = `team:${slugify(teamSegment)}`;
      if (!c.teams.has(teamId)) {
        c.teams.set(teamId, { id: teamId, name: teamSegment, leagueId });
      }
      teamIdBySegmentIndex.push(teamId);
    }

    // Bug fix: row.player_name is the raw ATHLETE cell, which Beckett's
    // checklist legitimately combines with "/" for two different reasons
    // (see parsePlayerNames.ts's header comment) -- it is never one
    // player's own canonical name. Parsing it into distinct names before
    // building entities means a self-duplicate cell like
    // "A.J. Brown/A.J. Brown" collapses to the ONE real "A.J. Brown"
    // player (the same player:a-j-brown id a plain "A.J. Brown" row
    // produces -- see requirement #3), and a genuine multi-player cell
    // like "Ashton Jeanty/Omarion Hampton" produces two separate players
    // each linked to this same card, instead of one bogus combined-name
    // player entity.
    if (row.player_name) {
      // Raw (pre-dedup) segments, in original order and casing -- needed
      // for positional pairing against rawTeamSegments (parsePlayerNames'
      // own output below is deduplicated, which would misalign indices),
      // and for detecting a repeated name (the Multiverse case) via its
      // own count in this array.
      const rawPlayerSegments = row.player_name
        .split("/")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      // Positional pairing is only safe when both sides split into the
      // same number of segments -- Step 3's explicit "do not guess"
      // requirement. A present-but-mismatched segment count means NO
      // player parsed from this row gets a team relationship from it.
      const segmentsMatch =
        rawTeamSegments.length > 0 && rawPlayerSegments.length === rawTeamSegments.length;
      if (rawTeamSegments.length > 0 && !segmentsMatch) {
        c.teamResolutionStats.segmentMismatchRows++;
      }

      // Case-insensitive occurrence count per raw segment -- exactly how
      // parsePlayerNames.ts's own dedup rule identifies "the same player,"
      // applied here to detect a Multiverse-style repeated name instead.
      const lowerCaseCounts = new Map<string, number>();
      for (const segment of rawPlayerSegments) {
        const key = segment.toLowerCase();
        lowerCaseCounts.set(key, (lowerCaseCounts.get(key) ?? 0) + 1);
      }

      for (const playerName of parsePlayerNames(row.player_name)) {
        const playerId = `player:${slugify(playerName)}`;
        if (!c.players.has(playerId)) {
          c.players.set(playerId, { id: playerId, name: playerName });
        }

        const cardPlayerId = `cardplayer:${cardId}-${slugify(playerName)}`;
        if (!c.cardPlayers.has(cardPlayerId)) {
          const isRepeatedName = (lowerCaseCounts.get(playerName.toLowerCase()) ?? 0) > 1;

          let teamId: string | null = null;
          if (isRepeatedName) {
            // Panini "Multiverse Jerseys"-style same-player/multi-team row
            // -- never guess which of the multiple teams belongs to the
            // ONE card_players row this player-on-this-card can have (see
            // CardPlayer's own type comment / the Team architecture
            // audit). Counted, never silently dropped.
            c.teamResolutionStats.multiversePlayers++;
          } else if (segmentsMatch) {
            const index = rawPlayerSegments.findIndex(
              (segment) => segment.toLowerCase() === playerName.toLowerCase(),
            );
            teamId = index >= 0 ? (teamIdBySegmentIndex[index] ?? null) : null;
            if (teamId) c.teamResolutionStats.cardPlayerTeamsResolved++;
          }

          c.cardPlayers.set(cardPlayerId, { id: cardPlayerId, cardId, playerId, teamId });
        }
      }
    }
  }

  return c;
}

function printFirstN<T>(label: string, map: Map<string, T>, n = 10): void {
  const entries = Array.from(map.values()).slice(0, n);
  console.log(`\nFirst ${entries.length} ${label}:`);
  if (entries.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const entity of entries) {
    console.log(" ", JSON.stringify(entity));
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/build-catalog-entities.ts <path-to-file.csv|.tsv|.txt|.xlsx>"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== Catalog Entity Builder (offline, no database access) ===\n");

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

  console.log("Entity Summary\n");
  console.log(`Manufacturers: ${entities.manufacturers.size}`);
  console.log(`Brands: ${entities.brands.size}`);
  console.log(`Sports: ${entities.sports.size}`);
  console.log(`Leagues: ${entities.leagues.size}`);
  console.log(`Teams: ${entities.teams.size}`);
  console.log(`Players: ${entities.players.size}`);
  console.log(`Sets: ${entities.sets.size}`);
  console.log(`ChecklistSections: ${entities.checklistSections.size}`);
  console.log(`Cards: ${entities.cards.size}`);
  console.log(`Variants: ${entities.cardVariants.size}`);
  console.log(`CardPlayers: ${entities.cardPlayers.size}`);

  printFirstN("manufacturers", entities.manufacturers);
  printFirstN("brands", entities.brands);
  printFirstN("sports", entities.sports);
  printFirstN("leagues", entities.leagues);
  printFirstN("teams", entities.teams);
  printFirstN("players", entities.players);
  printFirstN("sets", entities.sets);
  printFirstN("checklist_sections", entities.checklistSections);
  printFirstN("cards", entities.cards);
  printFirstN("card_variants", entities.cardVariants);
  printFirstN("card_players", entities.cardPlayers);

  console.log(
    "\nThis was an offline entity-building preview only. No database connection was made, no ids " +
      "were assigned by a database, and no data was written anywhere."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

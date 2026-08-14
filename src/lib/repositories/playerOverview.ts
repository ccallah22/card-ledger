import { supabase } from "@/lib/supabaseClient";
import type { GradingStatus } from "@/lib/types";
import { getPlayerWithContext, type PlayerWithContext } from "@/lib/repositories/players";
import {
  listCardsForPlayer,
  type CardForPlayer,
} from "@/lib/repositories/cardPlayers";
import { compareCardNumbers } from "@/lib/repositories/cards";

/**
 * Player Overview (Phase 3A): a single, focused, read-only summary of a
 * player's catalog population and one profile's owned collection for that
 * player -- the data layer the future player-centered UI (collector
 * fact panel, completion, top/missing cards) will read from, so pages never
 * assemble this by hand from several independent queries.
 *
 * Deliberately NOT included here (future phases, not this one):
 * Collector Score, collection grades, percentile/rarity rank, career
 * highlights, biography, market data. This phase is factual collection data
 * only, derived entirely from existing tables -- nothing is written,
 * cached, or persisted.
 */

// ---- Owned-card summary (topCards) ----

export type PlayerOwnedCardSummary = {
  userCardId: string;
  cardId: number;
  title: string | null;
  cardNumber: string;
  year: number | null;
  setName: string | null;
  parallel: string | null;
  grade: string | null;
  gradingStatus: GradingStatus;
  estimatedValue: number | null;
  // Phase 3A originally exposed user_cards.image_path/thumb_path here, but
  // Phase 3C's media audit confirmed those columns are never populated by
  // the current Add/Edit Card flow (they're always null in practice) --
  // genuinely dead, misleadingly-named fields, not a real image source.
  // userCardId above is what actually resolves a display image now, via
  // useUserCardDisplayImages (persisted card_media, falling back to the
  // legacy localStorage image) -- see hooks/cards/useUserCardDisplayImages.ts.
};

// ---- Catalog (not-yet-owned) card summary (missingCards) ----

export type PlayerCatalogCardSummary = {
  cardId: number;
  title: string | null;
  cardNumber: string;
  year: number | null;
  setName: string | null;
};

// ---- Collection Journey (Phase 4A) ----

export type PlayerJourneyMilestone = {
  key: string;
  label: string;
  achieved: boolean;
  // The real user_cards.created_at of the owned row that satisfied this
  // milestone -- never a fabricated/estimated date. null when not yet
  // achieved. Milestones are recomputed fresh from CURRENT owned rows on
  // every call (nothing here is persisted -- see the module doc comment),
  // so a milestone can become "not achieved" again if the qualifying
  // card(s) are later removed; that's an inherent property of deriving
  // everything live rather than a bug.
  achievedDate: string | null;
};

export type PlayerJourney = {
  firstCardAddedDate: string;
  latestCardAddedDate: string;
  // Sum of quantity (physical copies, same convention as
  // collection.totalCardsOwned) among owned rows added in the last 30 days.
  cardsAddedLast30Days: number;
  // Newest 3 owned cards by created_at descending -- chronological, NOT the
  // same ordering as topCards (which is value-ranked). Reuses
  // PlayerOwnedCardSummary as-is; no new card shape.
  recentlyAdded: PlayerOwnedCardSummary[];
  milestones: PlayerJourneyMilestone[];
};

export type PlayerOverview = {
  player: PlayerWithContext;

  collection: {
    // Sum of quantity across owned rows -- a physical-copy count, not a row
    // count. quantity is schema-defined per user_cards row (see
    // userCards.ts) but is currently always 1 everywhere in the app (no UI
    // ever sets it otherwise), so today this equals a plain row count; it's
    // written as a sum so it stays correct if a future feature starts using
    // quantity > 1 on a single row instead of separate rows per copy.
    totalCardsOwned: number;
    // Distinct cards.id values among owned rows -- the basis for catalog
    // completion below (duplicate physical copies of the same catalog card
    // must not inflate completion).
    uniqueCatalogCardsOwned: number;

    // Sum of estimated_value across owned rows that HAVE a known value.
    // null (not 0) when zero owned rows have a known value, so the UI can
    // distinguish "known to be worth $0" from "no pricing data yet" instead
    // of silently misrepresenting an unpriced collection as worthless.
    // pricedCardCount/unpricedCardCount expose exactly how many rows fed
    // (or didn't feed) that sum, for a future "priced X of Y cards" caption.
    estimatedValue: number | null;
    pricedCardCount: number;
    unpricedCardCount: number;

    // All five counts below are plain row counts (not quantity-weighted),
    // matching collectionSummary.ts's existing `graded` computation
    // (`inventory.filter(...).length`) -- the one established precedent in
    // this codebase for this style of count.
    gradedCount: number;
    autographCount: number;
    memorabiliaCount: number;
    serialNumberedCount: number;
    // cards.rookie_card is a real structured boolean column (set from the
    // Add Card form's Rookie checkbox at catalog-resolution time -- see
    // resolveCatalogIdsServer.ts / cards.ts's createCard), not a text/title
    // heuristic, so this is safe to report as a genuine count.
    rookieCount: number;
  };

  catalog: {
    totalCatalogCards: number;
    ownedCatalogCards: number;
    missingCatalogCards: number;
    // null (not 0%) when the player has zero catalog cards at all, so the
    // UI can distinguish "nothing to complete" from "0% complete".
    completionPercent: number | null;
  };

  // Ordering: estimated value descending (unpriced cards sorted after every
  // priced card, never treated as if worth $0); graded-before-raw as a
  // secondary tie-break; user_card id as a final stable fallback. See
  // compareForTopCards below.
  topCards: PlayerOwnedCardSummary[];

  // Catalog cards for this player the profile does not own, ordered release
  // year ascending, then set name, then card number (numeric-aware, reusing
  // cards.ts's compareCardNumbers so "10" sorts after "2"), then card id --
  // a deterministic, bounded first slice (MISSING_CARDS_LIMIT). The total
  // count of ALL missing cards (not just this slice) is
  // catalog.missingCatalogCards above.
  missingCards: PlayerCatalogCardSummary[];

  // null when the profile owns zero cards for this player -- the Player
  // page hides the whole Collection Journey section in that case rather
  // than rendering empty/meaningless placeholders (there is nothing honest
  // to derive a journey from yet).
  journey: PlayerJourney | null;
};

const MISSING_CARDS_LIMIT = 20;
const TOP_CARDS_LIMIT = 5;
const RECENTLY_ADDED_LIMIT = 3;
const CARD_COUNT_MILESTONES = [10, 25, 50, 100] as const;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// "Owned" mirrors the app's one existing collection-membership convention
// (collectionSummary.ts's `inventory` filter, also used by
// collectionHealth.ts): everything except WANT (wishlist) and SOLD counts as
// owned, so HAVE and FOR_SALE both count -- a listed-for-sale card is still
// physically in the collection until it actually sells. This is a read of
// the existing status field, not a new policy invented for this phase.
function isOwnedStatus(status: string): boolean {
  return status !== "SOLD" && status !== "WANT";
}

type OwnedForPlayerRow = {
  id: string;
  card_id: number;
  status: string;
  grading_status: string;
  grade: string | null;
  estimated_value: number | null;
  serial_number: number | null;
  quantity: number;
  created_at: string;
  cards: {
    id: number;
    card_number: string;
    title: string | null;
    rookie_card: boolean;
    sets: { name: string | null; release_year: number | null } | null;
  } | null;
  card_variants: {
    has_autograph: boolean;
    has_memorabilia: boolean;
    serial_numbered: boolean;
    print_run: number | null;
    parallel_types: { name: string } | null;
  } | null;
};

// Same inner-join-as-filter shape myCards.ts's SELECT_FOR_PLAYER already
// uses and relies on for listMyCardsForPlayer (cards!inner + a nested
// card_players!inner filtered via .eq("cards.card_players.player_id", ...))
// -- proven not to duplicate rows for a multi-player card, since
// card_players has a (card_id, player_id) primary key, so at most one
// card_players row can match a single player_id per card. This is a
// separate, purpose-built select (not a reuse of MyCard's own SELECT)
// because MyCard's shape intentionally omits the raw cards.id this phase
// needs for catalog-identity dedup.
const OWNED_FOR_PLAYER_SELECT = `
  id,
  card_id,
  status,
  grading_status,
  grade,
  estimated_value,
  serial_number,
  quantity,
  created_at,
  cards!inner(
    id,
    card_number,
    title,
    rookie_card,
    card_players!inner(player_id),
    sets(name, release_year)
  ),
  card_variants(
    has_autograph,
    has_memorabilia,
    serial_numbered,
    print_run,
    parallel_types(name)
  )
`;

async function fetchOwnedRowsForPlayer(
  profileId: string,
  playerId: number,
): Promise<OwnedForPlayerRow[]> {
  const { data, error } = await supabase
    .from("user_cards")
    .select(OWNED_FOR_PLAYER_SELECT)
    .eq("profile_id", profileId)
    .eq("cards.card_players.player_id", playerId);

  if (error) throw error;

  return (data ?? []) as unknown as OwnedForPlayerRow[];
}

function compareForTopCards(a: OwnedForPlayerRow, b: OwnedForPlayerRow): number {
  const av = a.estimated_value;
  const bv = b.estimated_value;
  if (av != null && bv != null && av !== bv) return bv - av;
  if (av != null && bv == null) return -1;
  if (av == null && bv != null) return 1;

  const aGraded = a.grading_status === "GRADED";
  const bGraded = b.grading_status === "GRADED";
  if (aGraded !== bGraded) return aGraded ? -1 : 1;

  return a.id.localeCompare(b.id);
}

function toOwnedCardSummary(row: OwnedForPlayerRow): PlayerOwnedCardSummary {
  return {
    userCardId: row.id,
    cardId: row.card_id,
    title: row.cards?.title ?? null,
    cardNumber: row.cards?.card_number ?? "",
    year: row.cards?.sets?.release_year ?? null,
    setName: row.cards?.sets?.name ?? null,
    parallel: row.card_variants?.parallel_types?.name ?? null,
    grade: row.grade,
    gradingStatus: (row.grading_status as GradingStatus) ?? "RAW",
    estimatedValue: row.estimated_value,
  };
}

function compareCatalogCardsForMissing(a: CardForPlayer, b: CardForPlayer): number {
  const ay = a.releaseYear;
  const by = b.releaseYear;
  if (ay != null && by != null && ay !== by) return ay - by;
  if (ay != null && by == null) return -1;
  if (ay == null && by != null) return 1;

  const setCompare = (a.setName ?? "").localeCompare(b.setName ?? "");
  if (setCompare !== 0) return setCompare;

  const numberCompare = compareCardNumbers(a.cardNumber, b.cardNumber);
  if (numberCompare !== 0) return numberCompare;

  return a.cardId - b.cardId;
}

function buildMissingCards(
  catalogCards: CardForPlayer[],
  ownedCardIds: ReadonlySet<number>,
): PlayerCatalogCardSummary[] {
  return catalogCards
    .filter((c) => !ownedCardIds.has(c.cardId))
    .sort(compareCatalogCardsForMissing)
    .slice(0, MISSING_CARDS_LIMIT)
    .map((c) => ({
      cardId: c.cardId,
      title: c.title,
      cardNumber: c.cardNumber,
      year: c.releaseYear,
      setName: c.setName,
    }));
}

function buildCatalogSummary(totalCatalogCards: number, ownedCatalogCards: number) {
  const missingCatalogCards = Math.max(0, totalCatalogCards - ownedCatalogCards);
  const completionPercent =
    totalCatalogCards === 0
      ? null
      : Math.max(0, Math.min(100, Math.round((ownedCatalogCards / totalCatalogCards) * 100)));

  return { totalCatalogCards, ownedCatalogCards, missingCatalogCards, completionPercent };
}

// Every date used below is user_cards.created_at -- when the row was
// actually added to this profile's collection. Preferred over
// purchase_date (optional, user-entered, may be blank or reflect when the
// card was physically bought rather than logged here) per this phase's
// instruction to prefer created_at unless another field is clearly more
// appropriate; nothing here is invented or estimated.
function buildJourney(ownedRows: OwnedForPlayerRow[]): PlayerJourney | null {
  if (ownedRows.length === 0) return null;

  const chronological = [...ownedRows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const firstCardAddedDate = chronological[0].created_at;
  const latestCardAddedDate = chronological[chronological.length - 1].created_at;

  const cutoff = Date.now() - THIRTY_DAYS_MS;
  let cardsAddedLast30Days = 0;
  for (const row of ownedRows) {
    if (new Date(row.created_at).getTime() >= cutoff) cardsAddedLast30Days += row.quantity ?? 1;
  }

  const recentlyAdded = [...chronological]
    .reverse()
    .slice(0, RECENTLY_ADDED_LIMIT)
    .map(toOwnedCardSummary);

  function firstDateWhere(predicate: (row: OwnedForPlayerRow) => boolean): string | null {
    return chronological.find(predicate)?.created_at ?? null;
  }

  const milestones: PlayerJourneyMilestone[] = [
    {
      key: "first_card",
      label: "First Card",
      achieved: true,
      achievedDate: firstCardAddedDate,
    },
    {
      key: "first_rookie",
      label: "First Rookie",
      achieved: chronological.some((r) => !!r.cards?.rookie_card),
      achievedDate: firstDateWhere((r) => !!r.cards?.rookie_card),
    },
    {
      key: "first_autograph",
      label: "First Autograph",
      achieved: chronological.some((r) => !!r.card_variants?.has_autograph),
      achievedDate: firstDateWhere((r) => !!r.card_variants?.has_autograph),
    },
    {
      key: "first_memorabilia",
      label: "First Memorabilia",
      achieved: chronological.some((r) => !!r.card_variants?.has_memorabilia),
      achievedDate: firstDateWhere((r) => !!r.card_variants?.has_memorabilia),
    },
    {
      key: "first_serial_numbered",
      label: "First Serial Numbered",
      achieved: chronological.some(
        (r) => !!r.card_variants?.serial_numbered || r.serial_number != null,
      ),
      achievedDate: firstDateWhere(
        (r) => !!r.card_variants?.serial_numbered || r.serial_number != null,
      ),
    },
  ];

  // Walks chronological order accumulating physical-copy count (same
  // quantity-weighted convention as collection.totalCardsOwned), recording
  // the exact created_at of the row that pushed the running total past each
  // threshold -- an honest "this is the card that made it N" date, not an
  // estimate.
  let cumulative = 0;
  const dateByThreshold = new Map<number, string>();
  for (const row of chronological) {
    cumulative += row.quantity ?? 1;
    for (const threshold of CARD_COUNT_MILESTONES) {
      if (cumulative >= threshold && !dateByThreshold.has(threshold)) {
        dateByThreshold.set(threshold, row.created_at);
      }
    }
  }
  for (const threshold of CARD_COUNT_MILESTONES) {
    const achievedDate = dateByThreshold.get(threshold) ?? null;
    milestones.push({
      key: `${threshold}_cards`,
      label: `${threshold} Cards`,
      achieved: achievedDate !== null,
      achievedDate,
    });
  }

  return {
    firstCardAddedDate,
    latestCardAddedDate,
    cardsAddedLast30Days,
    recentlyAdded,
    milestones,
  };
}

function emptyCollection(): PlayerOverview["collection"] {
  return {
    totalCardsOwned: 0,
    uniqueCatalogCardsOwned: 0,
    estimatedValue: null,
    pricedCardCount: 0,
    unpricedCardCount: 0,
    gradedCount: 0,
    autographCount: 0,
    memorabiliaCount: 0,
    serialNumberedCount: 0,
    rookieCount: 0,
  };
}

/**
 * The one coherent Player Overview object a future player page can request
 * instead of fetching player/collection/catalog data independently.
 * profileId is nullable so a signed-out (or profile-less) view still
 * returns full catalog population/missing-card data with an empty
 * collection, matching how the current /players/[slug] page already treats
 * "no profile" (see its getCurrentProfile() handling).
 *
 * Query shape: two queries total, regardless of catalog size --
 * fetchOwnedRowsForPlayer (this profile's own cards for this player; small,
 * bounded by what one user owns) and listCardsForPlayer (this player's full
 * catalog population, reused unchanged from cardPlayers.ts). Neither is
 * per-card/per-row, so this is O(1) queries, not O(n). listCardsForPlayer
 * itself has no LIMIT -- fine for realistic per-player catalog sizes today,
 * but for a player whose catalog population could reach into the thousands,
 * that unbounded fetch (not any per-row work) is the first place to add
 * pagination or a server-side COUNT once that becomes real, rather than
 * something this phase needs to solve.
 */
export async function getPlayerOverview(
  playerId: number,
  profileId: string | null,
): Promise<PlayerOverview | null> {
  const player = await getPlayerWithContext(playerId);
  if (!player) return null;

  const catalogCards = await listCardsForPlayer(playerId);

  if (!profileId) {
    return {
      player,
      collection: emptyCollection(),
      catalog: buildCatalogSummary(catalogCards.length, 0),
      topCards: [],
      missingCards: buildMissingCards(catalogCards, new Set()),
      journey: null,
    };
  }

  const rows = await fetchOwnedRowsForPlayer(profileId, playerId);
  const ownedRows = rows.filter((row) => isOwnedStatus(row.status));

  const ownedCardIds = new Set<number>();
  let totalCardsOwned = 0;
  let gradedCount = 0;
  let autographCount = 0;
  let memorabiliaCount = 0;
  let serialNumberedCount = 0;
  let rookieCount = 0;
  let valueSum = 0;
  let pricedCardCount = 0;
  let unpricedCardCount = 0;

  for (const row of ownedRows) {
    totalCardsOwned += row.quantity ?? 1;
    ownedCardIds.add(row.card_id);

    if (row.grading_status === "GRADED") gradedCount += 1;
    if (row.card_variants?.has_autograph) autographCount += 1;
    if (row.card_variants?.has_memorabilia) memorabiliaCount += 1;
    // Serial-numbered evidence can come from either the catalog variant
    // (serial_numbered, set when the parallel itself is known to be
    // numbered) or the user's own entered serial_number (e.g. "07" of a
    // "/25" the variant data doesn't yet have serial_numbered set for) --
    // either is sufficient, per this task's instruction to check both.
    if (row.card_variants?.serial_numbered || row.serial_number != null) {
      serialNumberedCount += 1;
    }
    if (row.cards?.rookie_card) rookieCount += 1;

    if (row.estimated_value != null) {
      valueSum += row.estimated_value;
      pricedCardCount += 1;
    } else {
      unpricedCardCount += 1;
    }
  }

  const uniqueCatalogCardsOwned = ownedCardIds.size;
  // ownedCardIds is built entirely from rows already scoped (via the
  // cards!inner/card_players!inner filter above) to cards linked to this
  // exact player, so it's already a subset of catalogCards by construction
  // -- no separate intersection needed here.
  const ownedCatalogCards = uniqueCatalogCardsOwned;

  const topCards = [...ownedRows]
    .sort(compareForTopCards)
    .slice(0, TOP_CARDS_LIMIT)
    .map(toOwnedCardSummary);

  return {
    player,
    collection: {
      totalCardsOwned,
      uniqueCatalogCardsOwned,
      estimatedValue: pricedCardCount > 0 ? valueSum : null,
      pricedCardCount,
      unpricedCardCount,
      gradedCount,
      autographCount,
      memorabiliaCount,
      serialNumberedCount,
      rookieCount,
    },
    catalog: buildCatalogSummary(catalogCards.length, ownedCatalogCards),
    topCards,
    missingCards: buildMissingCards(catalogCards, ownedCardIds),
    journey: buildJourney(ownedRows),
  };
}

import type { MyCard } from "@/lib/repositories/myCards";

/**
 * Collection Insights (Phase 2D.1, extended Phase 2D.2): interesting FACTS
 * about a profile's own collection -- never a recommendation, never a score.
 * Pure and synchronous, like getNextActions/getCollectionHealthScore/
 * getDefaultCollectionGoal already are: takes the same already-fetched
 * MyCard[] Dashboard (and any future caller) already has in memory, does no
 * repository query of its own, and derives everything from real fields only
 * -- never invents data for a field the app doesn't actually track.
 *
 * Ownership semantics (Phase 2D.2 audit): "my collection" here means the
 * exact same owned-card population already established independently in
 * three other places -- collectionSummary.ts's `inventory` filter,
 * playerOverview.ts's isOwnedStatus, and the Binder's own baseList (see
 * cards/page.tsx) -- status !== "WANT" && status !== "SOLD", i.e. HAVE and
 * FOR_SALE count, WANT (wishlist) and SOLD do not. A FOR_SALE card is still
 * physically in the collection until it actually sells. See isOwnedCard
 * below; getCollectionInsights derives `ownedCards` from it ONCE and every
 * helper in this file is handed that same array, rather than each helper
 * re-filtering `cards` independently.
 *
 * Phase 2D.2 correction: the Phase 2D.1 version of this file had an
 * undocumented inconsistency here -- highestValueCard (then
 * "mostValuableCard") applied no status filter at all (a WANT or SOLD card
 * with an estimatedValue could still win), and biggestUnrealizedGain
 * excluded only SOLD, not WANT. Both were faithful extractions of
 * dashboard/page.tsx's original inline useMemo behavior, preserved as-is at
 * the time and flagged in that phase's report rather than silently
 * "fixed" out of scope. This phase's instructions explicitly asked for that
 * inconsistency to be corrected, so both now run over the same `ownedCards`
 * population as every other insight here.
 *
 * Phase 2D.2 bug fix (found while rewriting the year-based insights below):
 * MyCard.year is "" (empty string), not undefined, when a card's set has no
 * known release_year (see myCards.ts's toMyCard). The Phase 2D.1
 * computeYearExtremes did `Number(card.year)` guarded only by
 * Number.isFinite -- but `Number("")` is `0`, which IS finite, so a card
 * with an unknown year was silently treated as "year 0" and would almost
 * always win "oldest card". Fixed here by skipping cards with an empty
 * `year` before parsing.
 *
 * Deliberately NOT included here (re-audited this phase, unchanged since
 * commit 7e8feb7):
 * - "Most collected team" -- MyCard.team still comes straight from
 *   user_cards.team_name, free text with no normalized team_id relationship
 *   (see myCards.ts). Grouping by it would silently split "Chiefs" from
 *   "Kansas City Chiefs" into different buckets. Still omitted rather than
 *   producing a misleading answer from unreliable data.
 * - "Most represented sport" -- MyCard exposes no sport/league field at
 *   all, and the Binder's own resolveSport() still unconditionally returns
 *   "Unknown" for every card (cards/page.tsx). Still omitted for the same
 *   reason.
 * - Average card age -- collectionSummary.ts's getCollectionSummary()
 *   already computes this correctly (age.avgAgeDays) from a value Dashboard
 *   already fetches; duplicating it here would be exactly the kind of
 *   duplicated algorithm this repository is meant to avoid. Callers that
 *   already have a CollectionSummary should keep reading it from there.
 *
 * Documented gap on composition.serialNumberedCount: playerOverview.ts's
 * equivalent count treats a card as serial-numbered if EITHER the catalog
 * variant's own `serial_numbered` flag is set OR the user entered their own
 * serialNumber -- but MyCard (myCards.ts's toMyCard) never maps
 * card_variants.serial_numbered onto MyCard at all, only the user-entered
 * serialNumber. So this repository's serialNumberedCount can only use the
 * narrower, currently-reliable signal (serialNumber != null), which may
 * undercount serial-numbered parallels the user hasn't logged a specific
 * number for. Not invented/estimated around -- documented instead, the same
 * way team/sport are handled above. Extending MyCard itself to carry that
 * flag would be a reasonable, small follow-up, but is more than the "tiny
 * shared helper change" this phase's instructions allow for.
 *
 * Documented gap on players.highestValuePlayer: when a card features more
 * than one player (dual autos, team cards -- MyCard.players[], not just a
 * single playerName), its full estimatedValue is attributed to EACH player
 * on it, not split between them. This matches the attribution rule
 * mostCollectedPlayer already used before this phase (the same card counts
 * once per player it features) -- kept consistent rather than inventing a
 * new splitting scheme for value specifically.
 */

// Same convention as collectionSummary.ts's `inventory` filter and
// playerOverview.ts's isOwnedStatus -- see the module doc comment above.
function isOwnedCard(c: MyCard): boolean {
  return c.status !== "WANT" && c.status !== "SOLD";
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export type InsightCardRef = {
  id: string;
  playerName: string;
  year: string;
  setName: string;
  cardNumber?: string;
};

export type InsightPlayerRef = {
  id: number;
  name: string;
  slug: string;
  cardCount: number;
};

export type InsightSetRef = {
  name: string;
  slug?: string;
  cardCount: number;
};

export type InsightYearRef = {
  year: number;
  cardCount: number;
};

export type CollectionInsights = {
  value: {
    highestValueCard: (InsightCardRef & { estimatedValue: number }) | null;
    biggestUnrealizedGain: (InsightCardRef & { gain: number }) | null;
    // Deterministic tie-break: total estimated value descending; ties
    // broken by card count descending; further ties broken by player id
    // ascending (a stable numeric identifier, never insertion order).
    // Players with zero priced cards are excluded entirely, not treated as
    // a $0 total -- see the module doc comment.
    highestValuePlayer: (InsightPlayerRef & { totalEstimatedValue: number }) | null;
    coverage: {
      pricedCardCount: number;
      unpricedCardCount: number;
      // null (not 0) when there are zero owned cards -- "no data" is not
      // the same fact as "0% priced".
      coveragePercent: number | null;
    };
  };
  players: {
    mostCollectedPlayer: InsightPlayerRef | null;
    uniquePlayerCount: number;
  };
  sets: {
    mostCollectedSet: InsightSetRef | null;
    uniqueSetCount: number;
  };
  years: {
    // Deterministic tie-break: card count descending; ties broken by
    // preferring the more recent (higher) year.
    mostRepresentedYear: InsightYearRef | null;
    uniqueYearCount: number;
    earliestCardYear: number | null;
    latestCardYear: number | null;
  };
  grading: {
    gradedCount: number;
    rawCount: number;
    // null (not 0) when there are zero owned cards.
    gradedPercent: number | null;
  };
  composition: {
    rookieCount: number;
    autographCount: number;
    memorabiliaCount: number;
    serialNumberedCount: number;
  };
  timeline: {
    oldestCard: InsightCardRef | null;
    newestCard: InsightCardRef | null;
  };
};

function toCardRef(card: MyCard): InsightCardRef {
  return {
    id: card.id,
    playerName: card.playerName,
    year: card.year,
    setName: card.setName,
    cardNumber: card.cardNumber,
  };
}

// One pass over ownedCards computing highestValueCard, biggestUnrealizedGain,
// and value coverage together -- all three are simple per-card checks over
// the same estimatedValue/purchasePrice fields.
//
// highestValueCard tie-break: estimated value descending; ties broken by
// preferring the most recently added card (createdAt descending) -- the
// same tie-break convention every other "most"/"highest" insight in this
// file uses.
// biggestUnrealizedGain uses the same tie-break rule, over (estimatedValue -
// purchasePrice).
function computeValueInsights(ownedCards: MyCard[]): CollectionInsights["value"] {
  let bestValue: { card: MyCard; value: number } | null = null;
  let bestGain: { card: MyCard; gain: number } | null = null;
  let pricedCardCount = 0;
  let unpricedCardCount = 0;

  for (const card of ownedCards) {
    const value = asNumber(card.estimatedValue);
    const createdAt = card.createdAt ?? "";

    if (value === undefined) {
      unpricedCardCount += 1;
      continue;
    }
    pricedCardCount += 1;

    if (
      !bestValue ||
      value > bestValue.value ||
      (value === bestValue.value && createdAt > (bestValue.card.createdAt ?? ""))
    ) {
      bestValue = { card, value };
    }

    const purchasePrice = asNumber(card.purchasePrice);
    if (purchasePrice !== undefined) {
      const gain = value - purchasePrice;
      if (
        !bestGain ||
        gain > bestGain.gain ||
        (gain === bestGain.gain && createdAt > (bestGain.card.createdAt ?? ""))
      ) {
        bestGain = { card, gain };
      }
    }
  }

  const total = ownedCards.length;

  return {
    highestValueCard: bestValue
      ? { ...toCardRef(bestValue.card), estimatedValue: bestValue.value }
      : null,
    biggestUnrealizedGain: bestGain ? { ...toCardRef(bestGain.card), gain: bestGain.gain } : null,
    // highestValuePlayer is computed alongside mostCollectedPlayer/
    // uniquePlayerCount in computePlayerInsights below (all three need the
    // same per-card player loop) -- getCollectionInsights merges it in here.
    highestValuePlayer: null,
    coverage: {
      pricedCardCount,
      unpricedCardCount,
      coveragePercent: total > 0 ? Math.round((pricedCardCount / total) * 100) : null,
    },
  };
}

type PlayerAgg = {
  id: number;
  name: string;
  slug: string;
  cardCount: number;
  newestCreatedAt: string;
  valueSum: number;
  pricedCount: number;
};

// One pass over ownedCards building a per-player aggregate (count, newest
// createdAt, summed known value) that mostCollectedPlayer, uniquePlayerCount,
// and highestValuePlayer are all derived from -- combined because all three
// need the same per-card, per-card-deduped walk of card.players[].
//
// mostCollectedPlayer tie-break: card count descending; ties broken by the
// player's most recently added card (createdAt descending) -- unchanged
// from Phase 2D.1.
// highestValuePlayer tie-break: documented on the CollectionInsights type
// above (value sum desc, then card count desc, then player id asc). Only
// players with at least one priced card are considered, so a player with
// zero known-value cards can never "win" with an implied $0.
function computePlayerInsights(ownedCards: MyCard[]): {
  mostCollectedPlayer: InsightPlayerRef | null;
  uniquePlayerCount: number;
  highestValuePlayer: (InsightPlayerRef & { totalEstimatedValue: number }) | null;
} {
  const byPlayerId = new Map<number, PlayerAgg>();

  for (const card of ownedCards) {
    const value = asNumber(card.estimatedValue);
    const createdAt = card.createdAt ?? "";
    const seenOnThisCard = new Set<number>();

    for (const player of card.players ?? []) {
      if (seenOnThisCard.has(player.id)) continue;
      seenOnThisCard.add(player.id);

      const existing = byPlayerId.get(player.id);
      if (!existing) {
        byPlayerId.set(player.id, {
          id: player.id,
          name: player.name,
          slug: player.slug,
          cardCount: 1,
          newestCreatedAt: createdAt,
          valueSum: value ?? 0,
          pricedCount: value !== undefined ? 1 : 0,
        });
      } else {
        existing.cardCount += 1;
        if (createdAt > existing.newestCreatedAt) existing.newestCreatedAt = createdAt;
        if (value !== undefined) {
          existing.valueSum += value;
          existing.pricedCount += 1;
        }
      }
    }
  }

  const players = Array.from(byPlayerId.values());

  const mostCollectedAgg =
    players.length === 0
      ? null
      : players.reduce((best, entry) => {
          if (entry.cardCount > best.cardCount) return entry;
          if (entry.cardCount < best.cardCount) return best;
          return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
        });

  const pricedPlayers = players.filter((p) => p.pricedCount > 0);
  const highestValueAgg =
    pricedPlayers.length === 0
      ? null
      : pricedPlayers.reduce((best, entry) => {
          if (entry.valueSum > best.valueSum) return entry;
          if (entry.valueSum < best.valueSum) return best;
          if (entry.cardCount > best.cardCount) return entry;
          if (entry.cardCount < best.cardCount) return best;
          return entry.id < best.id ? entry : best;
        });

  return {
    mostCollectedPlayer: mostCollectedAgg
      ? {
          id: mostCollectedAgg.id,
          name: mostCollectedAgg.name,
          slug: mostCollectedAgg.slug,
          cardCount: mostCollectedAgg.cardCount,
        }
      : null,
    // byPlayerId accumulates exactly one entry per distinct player id seen
    // across ownedCards (per-card dedup above prevents a dual-player card
    // double-counting a repeated id), so its size IS the unique-player
    // count -- no separate pass needed.
    uniquePlayerCount: byPlayerId.size,
    highestValuePlayer: highestValueAgg
      ? {
          id: highestValueAgg.id,
          name: highestValueAgg.name,
          slug: highestValueAgg.slug,
          cardCount: highestValueAgg.cardCount,
          totalEstimatedValue: highestValueAgg.valueSum,
        }
      : null,
  };
}

type SetAgg = {
  key: number | string;
  name: string;
  slug?: string;
  count: number;
  newestCreatedAt: string;
};

// Unchanged grouping/tie-break from Phase 2D.1's mostCollectedSet (count
// descending, ties broken by newest createdAt), extended to also return
// uniqueSetCount as a free byproduct of the same Map (its size is exactly
// the number of distinct sets seen).
//
// Key is setId when available, falling back to setName only when setId is
// missing -- same reliability limitation documented in Phase 2D.1: two
// differently-spelled names for the same real set (no setId) would count as
// different sets. Not fuzzy-collapsed here, per this phase's instructions.
function computeSetInsights(ownedCards: MyCard[]): {
  mostCollectedSet: InsightSetRef | null;
  uniqueSetCount: number;
} {
  const bySetKey = new Map<number | string, SetAgg>();

  for (const card of ownedCards) {
    if (!card.setName) continue;
    const key = card.setId ?? card.setName;
    const createdAt = card.createdAt ?? "";

    const existing = bySetKey.get(key);
    if (!existing) {
      bySetKey.set(key, {
        key,
        name: card.setName,
        slug: card.setSlug,
        count: 1,
        newestCreatedAt: createdAt,
      });
    } else {
      existing.count += 1;
      if (createdAt > existing.newestCreatedAt) existing.newestCreatedAt = createdAt;
    }
  }

  if (bySetKey.size === 0) return { mostCollectedSet: null, uniqueSetCount: 0 };

  const best = Array.from(bySetKey.values()).reduce((best, entry) => {
    if (entry.count > best.count) return entry;
    if (entry.count < best.count) return best;
    return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
  });

  return {
    mostCollectedSet: { name: best.name, slug: best.slug, cardCount: best.count },
    uniqueSetCount: bySetKey.size,
  };
}

type YearInsights = {
  oldestCard: InsightCardRef | null;
  newestCard: InsightCardRef | null;
  mostRepresentedYear: InsightYearRef | null;
  uniqueYearCount: number;
  earliestCardYear: number | null;
  latestCardYear: number | null;
};

// One pass over ownedCards computing the card-year distribution
// (mostRepresentedYear/uniqueYearCount) together with the oldest/newest
// card by release year -- both timeline.{oldest,newest}Card and
// years.{earliest,latest}CardYear are read straight off this same result by
// getCollectionInsights rather than recomputed.
//
// This is the card's own catalog release year (MyCard.year, from
// sets.release_year), never user_cards.created_at -- deliberately distinct
// from "Recent Additions"/Collection Journey, which are about when a card
// was added to the collection, not when it was released.
//
// Cards with an unknown year (MyCard.year === "") are skipped entirely
// rather than parsed as 0 -- see the Phase 2D.2 bug-fix note in the module
// doc comment.
//
// oldest/newest tie-break: year (min/max) first; ties broken by preferring
// the most recently added card (createdAt descending) -- same convention as
// every other insight here.
// mostRepresentedYear tie-break: card count descending; ties broken by
// preferring the more recent (higher) year -- years are unique map keys, so
// this is always fully deterministic.
function computeYearInsights(ownedCards: MyCard[]): YearInsights {
  const yearCounts = new Map<number, number>();
  let oldest: { card: MyCard; year: number } | null = null;
  let newest: { card: MyCard; year: number } | null = null;

  for (const card of ownedCards) {
    if (!card.year) continue;
    const year = Number(card.year);
    if (!Number.isFinite(year)) continue;

    yearCounts.set(year, (yearCounts.get(year) ?? 0) + 1);

    const createdAt = card.createdAt ?? "";
    if (
      !oldest ||
      year < oldest.year ||
      (year === oldest.year && createdAt > (oldest.card.createdAt ?? ""))
    ) {
      oldest = { card, year };
    }
    if (
      !newest ||
      year > newest.year ||
      (year === newest.year && createdAt > (newest.card.createdAt ?? ""))
    ) {
      newest = { card, year };
    }
  }

  let mostRepresentedYear: InsightYearRef | null = null;
  for (const [year, cardCount] of yearCounts) {
    if (
      !mostRepresentedYear ||
      cardCount > mostRepresentedYear.cardCount ||
      (cardCount === mostRepresentedYear.cardCount && year > mostRepresentedYear.year)
    ) {
      mostRepresentedYear = { year, cardCount };
    }
  }

  return {
    oldestCard: oldest ? toCardRef(oldest.card) : null,
    newestCard: newest ? toCardRef(newest.card) : null,
    mostRepresentedYear,
    uniqueYearCount: yearCounts.size,
    earliestCardYear: oldest ? oldest.year : null,
    latestCardYear: newest ? newest.year : null,
  };
}

// One pass over ownedCards computing grading and composition counts
// together -- all six are simple structured-field checks per card sharing
// the same loop. gradingStatus/isRookie/isAutograph/isPatch are all real
// structured columns (see myCards.ts's toMyCard: grading_status,
// cards.rookie_card, card_variants.has_autograph/has_memorabilia), never
// inferred from free text. serialNumberedCount's narrower definition (vs.
// playerOverview.ts's) is documented in the module doc comment.
function computeGradingAndComposition(ownedCards: MyCard[]): {
  grading: CollectionInsights["grading"];
  composition: CollectionInsights["composition"];
} {
  let gradedCount = 0;
  let rookieCount = 0;
  let autographCount = 0;
  let memorabiliaCount = 0;
  let serialNumberedCount = 0;

  for (const card of ownedCards) {
    if (card.gradingStatus === "GRADED") gradedCount += 1;
    if (card.isRookie) rookieCount += 1;
    if (card.isAutograph) autographCount += 1;
    if (card.isPatch) memorabiliaCount += 1;
    if (card.serialNumber != null) serialNumberedCount += 1;
  }

  const total = ownedCards.length;
  const rawCount = Math.max(0, total - gradedCount);

  return {
    grading: {
      gradedCount,
      rawCount,
      gradedPercent: total > 0 ? Math.round((gradedCount / total) * 100) : null,
    },
    composition: { rookieCount, autographCount, memorabiliaCount, serialNumberedCount },
  };
}

export function getCollectionInsights(cards: MyCard[]): CollectionInsights {
  const ownedCards = cards.filter(isOwnedCard);

  const valueInsights = computeValueInsights(ownedCards);
  const playerInsights = computePlayerInsights(ownedCards);
  const setInsights = computeSetInsights(ownedCards);
  const yearInsights = computeYearInsights(ownedCards);
  const { grading, composition } = computeGradingAndComposition(ownedCards);

  return {
    value: {
      ...valueInsights,
      highestValuePlayer: playerInsights.highestValuePlayer,
    },
    players: {
      mostCollectedPlayer: playerInsights.mostCollectedPlayer,
      uniquePlayerCount: playerInsights.uniquePlayerCount,
    },
    sets: setInsights,
    years: {
      mostRepresentedYear: yearInsights.mostRepresentedYear,
      uniqueYearCount: yearInsights.uniqueYearCount,
      earliestCardYear: yearInsights.earliestCardYear,
      latestCardYear: yearInsights.latestCardYear,
    },
    grading,
    composition,
    timeline: {
      oldestCard: yearInsights.oldestCard,
      newestCard: yearInsights.newestCard,
    },
  };
}

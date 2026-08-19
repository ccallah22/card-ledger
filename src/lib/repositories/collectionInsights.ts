import type { MyCard } from "@/lib/repositories/myCards";

/**
 * Collection Insights (Phase 2D.1): interesting FACTS about a profile's own
 * collection -- never a recommendation, never a score. Pure and
 * synchronous, like getNextActions/getCollectionHealthScore/
 * getDefaultCollectionGoal already are: takes the same already-fetched
 * MyCard[] Dashboard (and any future caller) already has in memory, does
 * no repository query of its own, and derives everything from real fields
 * only -- never invents data for a field the app doesn't actually track.
 *
 * Four of these (highestValueCard, biggestUnrealizedGain,
 * mostCollectedPlayer, mostCollectedSet) are a faithful extraction of logic
 * that already existed inline in dashboard/page.tsx's own useMemo blocks --
 * same filters, same tie-break rules, moved here so Dashboard (and any
 * future consumer, e.g. Player Hub or Binder) can share one implementation
 * instead of each recomputing it. See each function's own comment for
 * exactly what carried over unchanged.
 *
 * Deliberately NOT included here:
 * - "Most collected team" -- user_cards.team_name is free text (no
 *   normalized teams relationship wired up yet, see myCards.ts), so
 *   grouping by it would silently split "Chiefs" from "Kansas City Chiefs"
 *   into different buckets. Omitted rather than producing a misleading
 *   answer from unreliable data.
 * - "Most represented sport" -- the Binder's own resolveSport() already
 *   documents that every card currently resolves to a single "Unknown"
 *   bucket (no sport/league picker exists in Add Card yet), so this
 *   insight would always answer "100% Unknown". Omitted for the same
 *   reason.
 * - Average card age -- collectionSummary.ts's getCollectionSummary()
 *   already computes this correctly (age.avgAgeDays) from a value
 *   Dashboard already fetches; duplicating that computation here would be
 *   exactly the kind of duplicated algorithm this phase was told to avoid.
 *   Callers that already have a CollectionSummary should read it from
 *   there directly.
 */

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

export type CollectionInsights = {
  value: {
    highestValueCard: (InsightCardRef & { estimatedValue: number }) | null;
    biggestUnrealizedGain: (InsightCardRef & { gain: number }) | null;
  };
  players: {
    mostCollectedPlayer: InsightPlayerRef | null;
    uniquePlayerCount: number;
  };
  sets: {
    mostCollectedSet: InsightSetRef | null;
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

// Unchanged from dashboard/page.tsx's original mostValuableCard: no status
// filter (a WANT/SOLD card with an estimatedValue is currently still
// eligible) -- carried over exactly as it already behaved, not corrected
// here. See this phase's report for why that's flagged as a discovered gap
// rather than silently fixed.
function computeHighestValueCard(
  cards: MyCard[],
): (InsightCardRef & { estimatedValue: number }) | null {
  const withValue = cards.filter(
    (c): c is MyCard & { estimatedValue: number } =>
      typeof c.estimatedValue === "number" && Number.isFinite(c.estimatedValue),
  );
  if (withValue.length === 0) return null;

  const best = withValue.reduce((best, c) => {
    if (c.estimatedValue > best.estimatedValue) return c;
    if (c.estimatedValue < best.estimatedValue) return best;
    return (c.createdAt ?? "") > (best.createdAt ?? "") ? c : best;
  });

  return { ...toCardRef(best), estimatedValue: best.estimatedValue };
}

// Unchanged from dashboard/page.tsx's original biggestUnrealizedGain:
// excludes SOLD only (not WANT) -- same pre-existing behavior, carried
// over as-is.
function computeBiggestUnrealizedGain(
  cards: MyCard[],
): (InsightCardRef & { gain: number }) | null {
  const withGain = cards
    .filter((c) => c.status !== "SOLD")
    .filter(
      (c): c is MyCard & { estimatedValue: number; purchasePrice: number } =>
        typeof c.estimatedValue === "number" &&
        Number.isFinite(c.estimatedValue) &&
        typeof c.purchasePrice === "number" &&
        Number.isFinite(c.purchasePrice),
    )
    .map((c) => ({ card: c, gain: c.estimatedValue - c.purchasePrice }));
  if (withGain.length === 0) return null;

  const best = withGain.reduce((best, entry) => {
    if (entry.gain > best.gain) return entry;
    if (entry.gain < best.gain) return best;
    return (entry.card.createdAt ?? "") > (best.card.createdAt ?? "") ? entry : best;
  });

  return { ...toCardRef(best.card), gain: best.gain };
}

// Unchanged from dashboard/page.tsx's original mostCollectedPlayer,
// including the owned-cards convention (status !== WANT && status !==
// SOLD -- the same one collectionSummary.ts/playerOverview.ts/Binder all
// already use) and the per-card de-dup for dual-player cards.
function computeMostCollectedPlayer(cards: MyCard[]): InsightPlayerRef | null {
  type PlayerAgg = { id: number; name: string; slug: string; count: number; newestCreatedAt: string };
  const byPlayerId = new Map<number, PlayerAgg>();

  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  for (const card of qualifyingCards) {
    const seenOnThisCard = new Set<number>();
    for (const player of card.players ?? []) {
      if (seenOnThisCard.has(player.id)) continue;
      seenOnThisCard.add(player.id);

      const existing = byPlayerId.get(player.id);
      const createdAt = card.createdAt ?? "";
      if (!existing) {
        byPlayerId.set(player.id, {
          id: player.id,
          name: player.name,
          slug: player.slug,
          count: 1,
          newestCreatedAt: createdAt,
        });
      } else {
        existing.count += 1;
        if (createdAt > existing.newestCreatedAt) existing.newestCreatedAt = createdAt;
      }
    }
  }

  if (byPlayerId.size === 0) return null;
  const best = Array.from(byPlayerId.values()).reduce((best, entry) => {
    if (entry.count > best.count) return entry;
    if (entry.count < best.count) return best;
    return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
  });

  return { id: best.id, name: best.name, slug: best.slug, cardCount: best.count };
}

// Unchanged from dashboard/page.tsx's original mostCollectedSet.
function computeMostCollectedSet(cards: MyCard[]): InsightSetRef | null {
  type SetAgg = {
    key: number | string;
    name: string;
    slug?: string;
    count: number;
    newestCreatedAt: string;
  };
  const bySetKey = new Map<number | string, SetAgg>();

  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  for (const card of qualifyingCards) {
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

  if (bySetKey.size === 0) return null;
  const best = Array.from(bySetKey.values()).reduce((best, entry) => {
    if (entry.count > best.count) return entry;
    if (entry.count < best.count) return best;
    return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
  });

  return { name: best.name, slug: best.slug, cardCount: best.count };
}

// New: distinct from "most collected player" (a count), this is the card's
// own release year (card.year), not when it was added to the collection --
// Dashboard's separate "Recent Additions" section already covers
// newest-added. Uses the same owned-cards convention as the other
// aggregate insights. Ties broken the same way as every other insight
// here (prefer the most recently added card), for consistency.
function computeYearExtremes(cards: MyCard[]): {
  oldestCard: InsightCardRef | null;
  newestCard: InsightCardRef | null;
} {
  const qualifying = cards
    .filter((c) => c.status !== "WANT" && c.status !== "SOLD")
    .map((card) => ({ card, year: Number(card.year) }))
    .filter((entry) => Number.isFinite(entry.year));

  if (qualifying.length === 0) return { oldestCard: null, newestCard: null };

  const oldest = qualifying.reduce((oldest, entry) => {
    if (entry.year < oldest.year) return entry;
    if (entry.year > oldest.year) return oldest;
    return (entry.card.createdAt ?? "") > (oldest.card.createdAt ?? "") ? entry : oldest;
  });
  const newest = qualifying.reduce((newest, entry) => {
    if (entry.year > newest.year) return entry;
    if (entry.year < newest.year) return newest;
    return (entry.card.createdAt ?? "") > (newest.card.createdAt ?? "") ? entry : newest;
  });

  return { oldestCard: toCardRef(oldest.card), newestCard: toCardRef(newest.card) };
}

// New: a simple, reliable count -- player identity is already normalized
// (card_players -> players, not free text), unlike team/sport, so this is
// safe to report without the caveats those needed.
function computeUniquePlayerCount(cards: MyCard[]): number {
  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  const ids = new Set<number>();
  for (const card of qualifyingCards) {
    for (const player of card.players ?? []) ids.add(player.id);
  }
  return ids.size;
}

export function getCollectionInsights(cards: MyCard[]): CollectionInsights {
  const { oldestCard, newestCard } = computeYearExtremes(cards);

  return {
    value: {
      highestValueCard: computeHighestValueCard(cards),
      biggestUnrealizedGain: computeBiggestUnrealizedGain(cards),
    },
    players: {
      mostCollectedPlayer: computeMostCollectedPlayer(cards),
      uniquePlayerCount: computeUniquePlayerCount(cards),
    },
    sets: {
      mostCollectedSet: computeMostCollectedSet(cards),
    },
    timeline: {
      oldestCard,
      newestCard,
    },
  };
}

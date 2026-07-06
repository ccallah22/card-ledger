import { listMyCards, type MyCard } from "@/lib/repositories/myCards";

const STALE_DAYS = 90;

export type Extreme = {
  id: string;
  label: string;
  pl: number;
};

export type CollectionSummary = {
  counts: {
    have: number;
    forSale: number;
    wanted: number;
    sold: number;
    graded: number;
    raw: number;
  };
  financial: {
    totalSpent: number;
    portfolioValue: number;
    unrealizedNetGain: number;
    forSaleAskTotal: number;
    soldRevenue: number;
    soldCostBasis: number;
    realizedNet: number;
    roi: number;
    winRate: number;
    wins: number;
    losses: number;
    avgProfitPerSale: number;
  };
  age: {
    staleCount: number;
    avgAgeDays: number;
    medianAgeDays: number;
  };
  holdTime: {
    avgDaysToSell: number;
    medianDaysToSell: number;
    holdCount: number;
  };
  bestSale: Extreme | null;
  worstSale: Extreme | null;
};

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

// Days between a stored date and now (used for inventory aging).
function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const ms = new Date().getTime() - d.getTime();
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

// Days between two stored dates (used for purchase -> sold hold time).
function daysBetween(purchaseDate?: string, soldDate?: string): number | null {
  const p = purchaseDate ? parseLocalDate(purchaseDate) : null;
  const s = soldDate ? parseLocalDate(soldDate) : null;
  if (!p || !s) return null;
  const ms = s.getTime() - p.getTime();
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function median(sortedValues: number[]): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  return n % 2 === 1
    ? sortedValues[(n - 1) / 2]
    : (sortedValues[n / 2 - 1] + sortedValues[n / 2]) / 2;
}

function cardLabel(c: MyCard): string {
  return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
}

/**
 * Collection-wide statistics for a profile, built from a single
 * listMyCards(profileId) pass. Definitions are kept aligned with the
 * existing per-page computations in cards/page.tsx, cards/wishlist/page.tsx,
 * cards/for-sale/page.tsx, and cards/sold/page.tsx (see the collection
 * summary repository design audit) so this can later replace them without
 * changing the numbers users already see. Not yet wired into any page.
 */
export async function getCollectionSummary(profileId: string): Promise<CollectionSummary> {
  const cards = await listMyCards(profileId);

  const have = cards.filter((c) => (c.status ?? "HAVE") === "HAVE").length;
  const forSale = cards.filter((c) => (c.status ?? "HAVE") === "FOR_SALE").length;
  const wanted = cards.filter((c) => (c.status ?? "HAVE") === "WANT").length;

  const inventory = cards.filter((c) => {
    const s = c.status ?? "HAVE";
    return s !== "SOLD" && s !== "WANT";
  });
  const graded = inventory.filter((c) => c.gradingStatus === "GRADED").length;
  const raw = Math.max(0, inventory.length - graded);

  const soldCards = cards.filter((c) => (c.status ?? "HAVE") === "SOLD");
  const sold = soldCards.length;

  const totalSpent = cards
    .filter((c) => (c.status ?? "HAVE") !== "WANT")
    .reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

  const portfolioValue = inventory.reduce(
    (sum, c) => sum + (asNumber(c.estimatedValue) ?? 0),
    0
  );

  const unrealizedNetGain = inventory.reduce((sum, c) => {
    const estimatedValue = asNumber(c.estimatedValue);
    if (typeof estimatedValue !== "number") return sum;
    const paid = asNumber(c.purchasePrice) ?? 0;
    return sum + (estimatedValue - paid);
  }, 0);

  const forSaleAskTotal = cards
    .filter((c) => (c.status ?? "HAVE") === "FOR_SALE")
    .reduce((sum, c) => sum + (asNumber(c.askingPrice) ?? 0), 0);

  const soldRevenue = soldCards.reduce((sum, c) => sum + (asNumber(c.soldPrice) ?? 0), 0);
  const soldCostBasis = soldCards.reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);
  const realizedNet = soldRevenue - soldCostBasis;

  const wins = soldCards.filter((c) => {
    const pl = (asNumber(c.soldPrice) ?? 0) - (asNumber(c.purchasePrice) ?? 0);
    return pl > 0;
  }).length;
  const losses = soldCards.filter((c) => {
    const pl = (asNumber(c.soldPrice) ?? 0) - (asNumber(c.purchasePrice) ?? 0);
    return pl < 0;
  }).length;

  const winRate = sold > 0 ? wins / sold : 0;
  const avgProfitPerSale = sold > 0 ? realizedNet / sold : 0;
  const roi = soldCostBasis > 0 ? realizedNet / soldCostBasis : 0;

  const ages: number[] = [];
  let staleCount = 0;
  for (const c of inventory) {
    const d = daysSince(c.purchaseDate);
    if (typeof d === "number") {
      ages.push(d);
      if (d >= STALE_DAYS) staleCount += 1;
    }
  }
  ages.sort((a, b) => a - b);

  const holdDays: number[] = [];
  let bestSale: Extreme | null = null;
  let worstSale: Extreme | null = null;
  for (const c of soldCards) {
    const pl = (asNumber(c.soldPrice) ?? 0) - (asNumber(c.purchasePrice) ?? 0);
    const label = cardLabel(c);
    if (!bestSale || pl > bestSale.pl) bestSale = { id: c.id, label, pl };
    if (!worstSale || pl < worstSale.pl) worstSale = { id: c.id, label, pl };

    const d = daysBetween(c.purchaseDate, c.soldDate);
    if (typeof d === "number") holdDays.push(d);
  }
  holdDays.sort((a, b) => a - b);

  return {
    counts: { have, forSale, wanted, sold, graded, raw },
    financial: {
      totalSpent,
      portfolioValue,
      unrealizedNetGain,
      forSaleAskTotal,
      soldRevenue,
      soldCostBasis,
      realizedNet,
      roi,
      winRate,
      wins,
      losses,
      avgProfitPerSale,
    },
    age: {
      staleCount,
      avgAgeDays: mean(ages),
      medianAgeDays: median(ages),
    },
    holdTime: {
      avgDaysToSell: mean(holdDays),
      medianDaysToSell: median(holdDays),
      holdCount: holdDays.length,
    },
    bestSale,
    worstSale,
  };
}

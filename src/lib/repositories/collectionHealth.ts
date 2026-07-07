import type { MyCard } from "@/lib/repositories/myCards";
import { getDataQualitySignals } from "@/lib/repositories/dataQualitySignals";

export function getCollectionHealthScore(cards: MyCard[]): number | null {
  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  if (qualifyingCards.length === 0) return null;

  const signals = getDataQualitySignals();

  let missingChecks = 0;
  let totalChecks = 0;
  for (const card of qualifyingCards) {
    for (const signal of signals) {
      if (!signal.appliesTo(card)) continue;
      totalChecks += 1;
      if (!signal.isComplete(card)) missingChecks += 1;
    }
  }

  if (totalChecks === 0) return null;
  return Math.round(100 * (1 - missingChecks / totalChecks));
}

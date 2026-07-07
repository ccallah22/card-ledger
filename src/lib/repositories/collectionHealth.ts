import type { MyCard } from "@/lib/repositories/myCards";

// Each check inspects one card and returns true if that data-quality signal
// is present (a "pass"), or false if it's missing. These mirror the same
// three signals nextActions.ts already flags (photo/value/location). Add a
// new signal later by appending another function here -- the formula below
// divides by CHECKS.length, so nothing else needs to change.
const CHECKS: ((card: MyCard) => boolean)[] = [
  (card) => !!card.imagePath,
  (card) => typeof card.estimatedValue === "number" && Number.isFinite(card.estimatedValue),
  (card) => !!card.location?.trim(),
];

export function getCollectionHealthScore(cards: MyCard[]): number | null {
  const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
  if (qualifyingCards.length === 0) return null;

  let missingChecks = 0;
  for (const card of qualifyingCards) {
    for (const check of CHECKS) {
      if (!check(card)) missingChecks += 1;
    }
  }

  const totalChecks = qualifyingCards.length * CHECKS.length;
  return Math.round(100 * (1 - missingChecks / totalChecks));
}

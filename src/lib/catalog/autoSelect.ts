import type { CardWithContext } from "@/lib/repositories/cards";

/**
 * Decides whether the top-ranked catalog result is unambiguous enough to
 * auto-fill without the user clicking it. Deterministic, no AI, no fuzzy
 * matching. Requires an exact card-number match that is unique among all
 * returned results -- a card number alone is not unique across sets/years
 * (confirmed against real catalog data: two different players' cards shared
 * the same cardNumber in this environment) -- plus at least one independent
 * corroborating exact match (full player name or set name). Year-only or
 * partial-player-name-only signals never qualify on their own.
 */
export function shouldAutoSelect(query: string, rankedResults: CardWithContext[]): boolean {
  if (rankedResults.length === 0) return false;

  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);

  const top = rankedResults[0];
  if (!top.cardNumber || !queryTokens.includes(top.cardNumber.toLowerCase())) {
    return false;
  }

  const cardNumberIsUnique = rankedResults.every(
    (result) => result === top || result.cardNumber !== top.cardNumber
  );
  if (!cardNumberIsUnique) return false;

  const exactFullPlayerNameMatch = top.playerNames.some((name) =>
    queryLower.includes(name.toLowerCase())
  );
  const exactSetNameMatch = !!top.setName && queryLower.includes(top.setName.toLowerCase());

  return exactFullPlayerNameMatch || exactSetNameMatch;
}

import type { CardWithContext } from "@/lib/repositories/cards";

// searchCatalog() already requires every query token to match something (it
// intersects per-token results), so every result here has already cleared a
// bar. This engine only differentiates *how specifically* each already-
// qualified result matched, so the best candidate surfaces first instead of
// relying on searchCatalog's unordered DB return order (it has no ORDER BY).
const SCORE = {
  exactCardNumber: 100,
  exactFullPlayerName: 60,
  partialPlayerNameToken: 20,
  exactSetName: 40,
  exactReleaseYear: 15,
};

function scoreResult(queryLower: string, queryTokens: string[], result: CardWithContext): number {
  let score = 0;

  if (result.cardNumber && queryTokens.includes(result.cardNumber.toLowerCase())) {
    score += SCORE.exactCardNumber;
  }

  const fullPlayerNameMatch = result.playerNames.some((name) =>
    queryLower.includes(name.toLowerCase())
  );
  if (fullPlayerNameMatch) {
    score += SCORE.exactFullPlayerName;
  } else {
    const partialPlayerNameMatch = result.playerNames.some((name) =>
      name
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
        .some((word) => queryTokens.includes(word))
    );
    if (partialPlayerNameMatch) {
      score += SCORE.partialPlayerNameToken;
    }
  }

  if (result.setName && queryLower.includes(result.setName.toLowerCase())) {
    score += SCORE.exactSetName;
  }

  if (result.releaseYear != null && queryTokens.includes(String(result.releaseYear))) {
    score += SCORE.exactReleaseYear;
  }

  return score;
}

/**
 * Orders already-retrieved catalog results by how specifically each one
 * matches the query (card number > full player name > set name > year >
 * partial player name token), with a deterministic id-ascending tie-break.
 * Deterministic, no AI, no fuzzy matching. Does not yet score brand,
 * manufacturer, team, or rookie/autograph/memorabilia flags -- later phases.
 */
export function rankCatalogMatches(
  query: string,
  results: CardWithContext[]
): CardWithContext[] {
  const queryLower = query.toLowerCase();
  const queryTokens = queryLower.split(/\s+/).filter(Boolean);

  const scores = new Map<number, number>();
  for (const result of results) {
    scores.set(result.id, scoreResult(queryLower, queryTokens, result));
  }

  return [...results].sort((a, b) => {
    const scoreDiff = (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    return a.id - b.id;
  });
}

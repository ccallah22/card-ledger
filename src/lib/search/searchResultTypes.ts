/**
 * Phase 2C.1: the shared shape a future grouped ("Player → Set → Card")
 * search UI will consume, so that UI never needs to know the different
 * field names/shapes each entity's own repository already returns
 * (PlayerWithContext, CardWithContext, SetRow, ...). This file defines
 * ONLY the type and a couple of pure, dependency-free helpers -- it does
 * not fetch anything and is not wired into any page yet. See
 * toSearchResult.ts for the adapters that build these from each
 * repository's existing result types.
 *
 * Deliberately minimal: no ranking/scoring field, no pagination cursor, no
 * highlighting metadata -- add those only when a real consumer needs them,
 * not speculatively.
 */

export type SearchResultKind = "player" | "set" | "card";

export type SearchResult = {
  kind: SearchResultKind;
  // Globally unique across every kind (e.g. "player:123", "card:456"), so a
  // future grouped list can use this directly as a React key without ever
  // colliding two different kinds that happen to share a numeric id.
  id: string;
  // The underlying repository's own numeric id, for kind-specific lookups
  // (e.g. navigating, or a future "load more of this player's cards")
  // without needing to re-parse it out of `id`.
  entityId: number;
  label: string;
  sublabel: string | null;
  href: string;
};

/**
 * Groups an already-fetched, mixed list of results by kind, in a stable
 * Player → Set → Card order regardless of the input order -- the exact
 * grouping a future UI would render as three sections. Pure and
 * synchronous; does no fetching, no ranking within each group (callers
 * that already sorted their input keep that order within each bucket).
 */
export function groupSearchResultsByKind(
  results: SearchResult[],
): Record<SearchResultKind, SearchResult[]> {
  const grouped: Record<SearchResultKind, SearchResult[]> = {
    player: [],
    set: [],
    card: [],
  };

  for (const result of results) {
    grouped[result.kind].push(result);
  }

  return grouped;
}

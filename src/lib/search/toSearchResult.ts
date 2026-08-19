import type { PlayerWithContext } from "@/lib/repositories/players";
import type { CardWithContext } from "@/lib/repositories/cards";
import type { SetRow } from "@/lib/repositories/sets";
import type { SearchResult } from "./searchResultTypes";

/**
 * Phase 2C.1: pure adapters from each entity's existing, already-proven
 * repository result shape into the shared SearchResult model
 * (searchResultTypes.ts). None of these fetch anything or change what
 * searchPlayers/searchCatalog/searchSets themselves return -- today's
 * PlayerExplorer/CatalogSearch UIs keep consuming those raw types exactly
 * as before. These adapters exist so a future grouped search UI can map
 * results from all three repositories into one array and render/group them
 * uniformly, without inventing a fourth shape or teaching that UI about
 * PlayerWithContext/CardWithContext/SetRow's differing field names.
 */

export function playerToSearchResult(player: PlayerWithContext): SearchResult {
  const sublabelParts = [player.team_name, player.league_name, player.sport_name].filter(
    (part): part is string => !!part,
  );

  return {
    kind: "player",
    id: `player:${player.id}`,
    entityId: player.id,
    label: player.full_name,
    sublabel: sublabelParts.length > 0 ? sublabelParts.join(" • ") : null,
    href: `/players/${player.slug}`,
  };
}

export function setToSearchResult(set: SetRow): SearchResult {
  const sublabelParts = [
    set.release_year != null ? String(set.release_year) : null,
    set.brand,
    set.manufacturer,
  ].filter((part): part is string => !!part);

  return {
    kind: "set",
    id: `set:${set.id}`,
    entityId: set.id,
    label: set.name,
    sublabel: sublabelParts.length > 0 ? sublabelParts.join(" • ") : null,
    // No dedicated /sets/[id] route exists yet -- the catalog card route is
    // the only place set identity is currently browsable from, so this
    // points there filtered by nothing in particular yet. Left as the
    // closest existing honest destination rather than inventing a route
    // this phase doesn't build.
    href: "/catalog",
  };
}

export function cardToSearchResult(card: CardWithContext): SearchResult {
  const sublabelParts = [
    card.releaseYear != null ? String(card.releaseYear) : null,
    card.setName,
    card.cardNumber ? `#${card.cardNumber}` : null,
  ].filter((part): part is string => !!part);

  return {
    kind: "card",
    id: `card:${card.id}`,
    entityId: card.id,
    label: card.title || `Card #${card.cardNumber}`,
    sublabel: sublabelParts.length > 0 ? sublabelParts.join(" • ") : null,
    href: `/catalog/cards/${card.id}`,
  };
}

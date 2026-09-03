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

// Search UX phase "Show Player Identity in Card Results": player identity
// belongs in the primary label -- a base card's title is almost always
// null (title is really only populated for inserts/special checklist
// entries), so the previous `card.title || Card #N` label routinely showed
// no player name at all, even on an app whose whole premise is organizing
// a collection around players. Card number stays out of the label (it
// already lives in sublabel below) so a card with a known player never
// shows the same number twice on one row.
//
// Multi-player join uses " / ", the same separator already established
// elsewhere in this codebase for the exact same playerNames array (see
// myCards.ts's `playerName: playerNames.join(" / ")`,
// candidateEngine.ts, and cards/new/page.tsx's own catalog-match rows) --
// reusing it here keeps this row consistent with how the rest of the app
// already renders a multi-player name, rather than introducing a new
// separator convention. Capped at 2 full names plus a "+N more" tail (the
// same "show a few, then '...and N more'" shape already used for overflow
// elsewhere in the app, e.g. admin/checklists's section-count lists) so an
// unusually large team/checklist card can't blow out the row.
const MAX_DISPLAYED_CARD_PLAYERS = 2;

function playerDisplayForCard(playerNames: string[]): string {
  if (playerNames.length <= MAX_DISPLAYED_CARD_PLAYERS) {
    return playerNames.join(" / ");
  }
  const shown = playerNames.slice(0, MAX_DISPLAYED_CARD_PLAYERS).join(" / ");
  return `${shown} +${playerNames.length - MAX_DISPLAYED_CARD_PLAYERS} more`;
}

export function cardToSearchResult(card: CardWithContext): SearchResult {
  const playerDisplay = playerDisplayForCard(card.playerNames);

  // Player name is primary when known. A meaningful title (an insert name,
  // not just a fallback) rides alongside it rather than being dropped --
  // "Patrick Mahomes — Fireworks" identifies both who the card is AND which
  // specific card, where either alone would lose information. Without a
  // player, this falls back to exactly the same title/card-number
  // hierarchy the label always used, so a card with no player association
  // still gets a sensible, never-blank label.
  const label = playerDisplay
    ? card.title
      ? `${playerDisplay} — ${card.title}`
      : playerDisplay
    : card.title || `Card #${card.cardNumber}`;

  const sublabelParts = [
    card.releaseYear != null ? String(card.releaseYear) : null,
    card.setName,
    card.cardNumber ? `#${card.cardNumber}` : null,
  ].filter((part): part is string => !!part);

  return {
    kind: "card",
    id: `card:${card.id}`,
    entityId: card.id,
    label,
    sublabel: sublabelParts.length > 0 ? sublabelParts.join(" • ") : null,
    href: `/catalog/cards/${card.id}`,
  };
}

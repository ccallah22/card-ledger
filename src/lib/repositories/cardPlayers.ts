import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export type CardPlayerRow = {
  card_id: number;
  player_id: number;
  role: string;
  // Canonical per-card Team architecture, Phase 1: the team this player
  // was on FOR THIS SPECIFIC CARD -- never the player's general/current
  // team (players.team_id). Nullable: most existing rows (and any row
  // created without explicit, trustworthy team evidence) simply don't
  // know their team yet, which is an honest, expected value here, not a
  // fetch failure. See findOrCreateCardPlayer below for how it's written.
  team_id: number | null;
  created_at: string;
};

export async function listCardPlayers(
  cardId: number,
  client: SupabaseClient = supabase,
): Promise<CardPlayerRow[]> {
  const { data, error } = await client
    .from("card_players")
    .select("*")
    .eq("card_id", cardId);

  if (error) throw error;

  return (data ?? []) as CardPlayerRow[];
}

/**
 * Display-ready catalog card info for a player's detail page: the card
 * itself plus its set, resolved via card_players -> cards -> sets. This is
 * the catalog card (cards.id), not any specific user's owned copy
 * (user_cards) -- there's no catalog-level card detail route in the app
 * yet, only the per-owner /cards/[id] page, so callers shouldn't assume
 * this id is linkable on its own.
 */
export type CardForPlayer = {
  cardId: number;
  cardNumber: string;
  title: string | null;
  setName: string | null;
  releaseYear: number | null;
};

type CardForPlayerRow = {
  cards: {
    id: number;
    card_number: string;
    title: string | null;
    sets: { name: string | null; release_year: number | null } | null;
  } | null;
};

export async function listCardsForPlayer(playerId: number): Promise<CardForPlayer[]> {
  const { data, error } = await supabase
    .from("card_players")
    .select("cards(id, card_number, title, sets(name, release_year))")
    .eq("player_id", playerId);

  if (error) throw error;

  return ((data ?? []) as unknown as CardForPlayerRow[])
    .map((row) => row.cards)
    .filter((card): card is NonNullable<typeof card> => !!card)
    .map((card) => ({
      cardId: card.id,
      cardNumber: card.card_number,
      title: card.title,
      setName: card.sets?.name ?? null,
      releaseYear: card.sets?.release_year ?? null,
    }));
}

// Canonical per-card Team architecture, Phase 1: `teamId` is a new,
// optional, LAST positional parameter (appended after the existing
// `client` param, not inserted before it) specifically so every existing
// positional call site -- resolveCatalogIdsServer.ts's two calls and
// write-catalog-v2.ts's -- keeps compiling and behaving identically
// without being touched: none of them pass a 5th argument, so `teamId` is
// always `undefined` for them today, which this function treats exactly
// like "no team information supplied" (see below). No caller is wired to
// pass a real teamId yet in this phase -- that's later work, once a
// trustworthy per-card team source actually exists.
//
// Semantics, in order:
//   1. No existing (card_id, player_id) row: insert one, including
//      team_id only when the caller explicitly supplied one (never
//      guessed, never derived from players.team_id).
//   2. Existing row with team_id IS NULL, and a team WAS supplied: this is
//      exactly the "team info arrives later" case -- update the row to
//      the supplied team.
//   3. Existing row with a non-null team_id, and a DIFFERENT team was
//      supplied: a genuine conflict against already-recorded historical
//      data. Never silently overwritten -- the existing value always
//      wins. Reported via console.warn (matching this codebase's existing
//      convention of logging unexpected-but-non-fatal conditions rather
//      than throwing for them, e.g. the API routes' `console.error(...)`
//      calls) rather than a new conflict-tracking mechanism.
//   4. No team supplied at all (teamId undefined/null): behavior is
//      byte-for-byte identical to before this phase -- return the
//      existing row untouched.
export async function findOrCreateCardPlayer(
  cardId: number,
  playerId: number,
  role: string = "primary",
  client: SupabaseClient = supabase,
  teamId?: number | null,
): Promise<CardPlayerRow> {
  const { data: existing, error: findError } = await client
    .from("card_players")
    .select("*")
    .eq("card_id", cardId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (findError) throw findError;

  if (existing) {
    const existingRow = existing as CardPlayerRow;

    if (teamId === undefined || teamId === null) {
      return existingRow;
    }

    if (existingRow.team_id === null) {
      const { data, error } = await client
        .from("card_players")
        .update({ team_id: teamId })
        .eq("card_id", cardId)
        .eq("player_id", playerId)
        .select("*")
        .single();

      if (error) throw error;

      return data as CardPlayerRow;
    }

    if (existingRow.team_id !== teamId) {
      console.warn(
        `[cardPlayers] team_id conflict for card_players(card_id=${cardId}, player_id=${playerId}): ` +
          `existing team_id=${existingRow.team_id}, supplied team_id=${teamId} -- keeping existing value.`,
      );
    }

    return existingRow;
  }

  const { data, error } = await client
    .from("card_players")
    .insert({ card_id: cardId, player_id: playerId, role, team_id: teamId ?? null })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardPlayerRow;
}

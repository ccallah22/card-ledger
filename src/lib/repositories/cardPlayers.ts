import { supabase } from "@/lib/supabaseClient";

export type CardPlayerRow = {
  card_id: number;
  player_id: number;
  role: string;
  created_at: string;
};

export async function listCardPlayers(cardId: number): Promise<CardPlayerRow[]> {
  const { data, error } = await supabase
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

export async function findOrCreateCardPlayer(
  cardId: number,
  playerId: number,
  role: string = "primary",
): Promise<CardPlayerRow> {
  const { data: existing, error: findError } = await supabase
    .from("card_players")
    .select("*")
    .eq("card_id", cardId)
    .eq("player_id", playerId)
    .maybeSingle();

  if (findError) throw findError;
  if (existing) return existing as CardPlayerRow;

  const { data, error } = await supabase
    .from("card_players")
    .insert({ card_id: cardId, player_id: playerId, role })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardPlayerRow;
}

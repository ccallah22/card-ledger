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

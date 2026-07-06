import { supabase } from "@/lib/supabaseClient";

export type CardRow = {
  id: number;
  set_id: number;
  card_number: string;
  title: string | null;
  rookie_card: boolean;
  printed_year: number | null;
  release_year: number | null;
  is_insert: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  search_text: string | null;
  created_at: string;
  updated_at: string;
};

export async function listCards(): Promise<CardRow[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as CardRow[];
}

export async function searchCards(query: string): Promise<CardRow[]> {
  if (!query.trim()) return [];

  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .or(
      `title.ilike.%${query}%,card_number.ilike.%${query}%,search_text.ilike.%${query}%`,
    )
    .limit(25);

  if (error) throw error;

  return (data ?? []) as CardRow[];
}

export async function getCard(id: number): Promise<CardRow | null> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as CardRow | null;
}

export async function findCardBySetAndNumber(
  setId: number,
  cardNumber: string,
): Promise<CardRow | null> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("set_id", setId)
    .eq("card_number", cardNumber)
    .maybeSingle();

  if (error) throw error;

  return data as CardRow | null;
}

export type CreateCardInput = {
  set_id: number;
  card_number: string;
  title?: string | null;
  rookie_card?: boolean;
  printed_year?: number | null;
  release_year?: number | null;
  is_insert?: boolean;
  is_autograph?: boolean;
  is_memorabilia?: boolean;
  search_text?: string | null;
};

export async function createCard(input: CreateCardInput): Promise<CardRow> {
  const { data, error } = await supabase
    .from("cards")
    .insert({
      set_id: input.set_id,
      card_number: input.card_number,
      title: input.title ?? null,
      rookie_card: input.rookie_card ?? false,
      printed_year: input.printed_year ?? null,
      release_year: input.release_year ?? null,
      is_insert: input.is_insert ?? false,
      is_autograph: input.is_autograph ?? false,
      is_memorabilia: input.is_memorabilia ?? false,
      search_text: input.search_text ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardRow;
}

export async function findOrCreateCard(input: CreateCardInput): Promise<CardRow> {
  const existing = await findCardBySetAndNumber(input.set_id, input.card_number);
  if (existing) return existing;
  return createCard(input);
}

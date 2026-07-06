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

/**
 * Display-ready catalog card for the read-only /catalog/cards/[id] page:
 * the card's own fields plus its set (cards.set_id -> sets) and the
 * player(s) featured on it (via card_players -> players). This is the
 * catalog card (cards.id), not a specific user's owned copy.
 */
export type CardWithContext = {
  id: number;
  cardNumber: string;
  title: string | null;
  rookieCard: boolean;
  isInsert: boolean;
  isAutograph: boolean;
  isMemorabilia: boolean;
  releaseYear: number | null;
  setName: string | null;
  setBrand: string | null;
  setManufacturer: string | null;
  playerNames: string[];
};

type CardWithContextRow = {
  id: number;
  card_number: string;
  title: string | null;
  rookie_card: boolean;
  is_insert: boolean;
  is_autograph: boolean;
  is_memorabilia: boolean;
  sets: { name: string | null; release_year: number | null; brand: string | null; manufacturer: string | null } | null;
  card_players: { players: { full_name: string } | null }[] | null;
};

const CARD_CONTEXT_SELECT =
  "id, card_number, title, rookie_card, is_insert, is_autograph, is_memorabilia, sets(name, release_year, brand, manufacturer), card_players(players(full_name))";

export async function getCardWithContext(id: number): Promise<CardWithContext | null> {
  const { data, error } = await supabase
    .from("cards")
    .select(CARD_CONTEXT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const row = data as unknown as CardWithContextRow;

  return {
    id: row.id,
    cardNumber: row.card_number,
    title: row.title,
    rookieCard: row.rookie_card,
    isInsert: row.is_insert,
    isAutograph: row.is_autograph,
    isMemorabilia: row.is_memorabilia,
    releaseYear: row.sets?.release_year ?? null,
    setName: row.sets?.name ?? null,
    setBrand: row.sets?.brand ?? null,
    setManufacturer: row.sets?.manufacturer ?? null,
    playerNames: (row.card_players ?? [])
      .map((cp) => cp.players?.full_name)
      .filter((name): name is string => !!name),
  };
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

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

function toCardWithContext(row: CardWithContextRow): CardWithContext {
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

export async function getCardWithContext(id: number): Promise<CardWithContext | null> {
  const { data, error } = await supabase
    .from("cards")
    .select(CARD_CONTEXT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toCardWithContext(data as unknown as CardWithContextRow);
}

/**
 * Catalog card search for the /catalog search page: same title/card_number/
 * search_text ilike match as searchCards, but returns the display-ready
 * CardWithContext shape (with set name/year) that result cards need,
 * reusing the same sets/card_players join as getCardWithContext.
 */
export async function searchCardsWithContext(query: string): Promise<CardWithContext[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await supabase
    .from("cards")
    .select(CARD_CONTEXT_SELECT)
    .or(
      `title.ilike.%${trimmed}%,card_number.ilike.%${trimmed}%,search_text.ilike.%${trimmed}%`,
    )
    .limit(25);

  if (error) throw error;

  return ((data ?? []) as unknown as CardWithContextRow[]).map(toCardWithContext);
}

// PostgREST cannot OR across multiple tables in a single query (the
// supabase-js `.or()` docs call this out explicitly), so a token that should
// match "title OR set name OR player name" can't be one query. Instead, each
// token resolves to a *union* of card ids from up to three separately
// scoped lookups (own columns, joined set, joined player), and the tokens
// are combined by *intersecting* those per-token id sets (every token must
// match something). This keeps each individual query simple/native and only
// does client-side set math, at the cost of extra round trips per token.
const TOKEN_ID_LOOKUP_LIMIT = 200;

async function cardIdsMatchingOwnFields(orClause: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id")
    .or(orClause)
    .limit(TOKEN_ID_LOOKUP_LIMIT);

  if (error) throw error;

  return (data ?? []).map((row) => (row as { id: number }).id);
}

async function cardIdsMatchingSetYear(year: number): Promise<number[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, sets!inner(release_year)")
    .eq("sets.release_year", year)
    .limit(TOKEN_ID_LOOKUP_LIMIT);

  if (error) throw error;

  return (data ?? []).map((row) => (row as { id: number }).id);
}

async function cardIdsMatchingSetText(token: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, sets!inner(name, search_text)")
    .or(`name.ilike.%${token}%,search_text.ilike.%${token}%`, { referencedTable: "sets" })
    .limit(TOKEN_ID_LOOKUP_LIMIT);

  if (error) throw error;

  return (data ?? []).map((row) => (row as { id: number }).id);
}

async function cardIdsMatchingPlayerText(token: string): Promise<number[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, card_players!inner(players!inner(full_name, search_text))")
    .or(`full_name.ilike.%${token}%,search_text.ilike.%${token}%`, {
      referencedTable: "card_players.players",
    })
    .limit(TOKEN_ID_LOOKUP_LIMIT);

  if (error) throw error;

  return (data ?? []).map((row) => (row as { id: number }).id);
}

/**
 * Resolves one search token to the set of card ids it matches: numeric
 * tokens match card_number (plus, if 4 digits, release_year/printed_year on
 * cards and release_year on the joined set); everything else matches
 * title/search_text on cards, name/search_text on the joined set, and
 * full_name/search_text on the joined player.
 */
async function matchingCardIdsForToken(token: string): Promise<Set<number>> {
  const isNumeric = /^\d+$/.test(token);
  const isFourDigitYear = isNumeric && /^\d{4}$/.test(token);

  if (isNumeric) {
    const ownClauses = [`card_number.ilike.%${token}%`];
    if (isFourDigitYear) {
      ownClauses.push(`release_year.eq.${token}`, `printed_year.eq.${token}`);
    }

    const idLists = await Promise.all([
      cardIdsMatchingOwnFields(ownClauses.join(",")),
      isFourDigitYear ? cardIdsMatchingSetYear(Number(token)) : Promise.resolve([]),
    ]);

    return new Set(idLists.flat());
  }

  const idLists = await Promise.all([
    cardIdsMatchingOwnFields(`title.ilike.%${token}%,search_text.ilike.%${token}%`),
    cardIdsMatchingSetText(token),
    cardIdsMatchingPlayerText(token),
  ]);

  return new Set(idLists.flat());
}

function intersectIdSets(sets: Set<number>[]): number[] {
  if (sets.length === 0) return [];

  const [first, ...rest] = sets;
  const result = new Set(first);

  for (const s of rest) {
    for (const id of result) {
      if (!s.has(id)) result.delete(id);
    }
  }

  return [...result];
}

/**
 * First-pass intelligent catalog search: splits the query into whitespace
 * tokens and requires every token to match at least one relevant field
 * across cards/sets/players (see matchingCardIdsForToken), then fetches the
 * display-ready CardWithContext shape for the resulting card ids. Only
 * handles year/card-number/title/set-name/player-name; no ranking, no
 * filters, no ownership awareness yet.
 */
export async function searchCatalog(query: string): Promise<CardWithContext[]> {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const perTokenIds = await Promise.all(tokens.map(matchingCardIdsForToken));
  const finalIds = intersectIdSets(perTokenIds);
  if (finalIds.length === 0) return [];

  const { data, error } = await supabase
    .from("cards")
    .select(CARD_CONTEXT_SELECT)
    .in("id", finalIds)
    .limit(25);

  if (error) throw error;

  return ((data ?? []) as unknown as CardWithContextRow[]).map(toCardWithContext);
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

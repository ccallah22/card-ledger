import { supabase } from "@/lib/supabaseClient";

export type CardRow = {
  id: number;
  set_id: number;
  // Catalog v2: nullable during the transition (see
  // docs/database/catalog-v2-migration-plan.md) -- not yet backfilled or
  // required, so existing rows may still have this null.
  checklist_section_id: number | null;
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

// ---- Catalog v2 (checklist_section_id, card_number) identity ----
//
// Additive alongside the functions above, which remain unchanged for
// compatibility with existing callers (see
// docs/database/catalog-v2-migration-plan.md). Nothing here is wired up to
// any caller yet.

/** Reusable (checklist_section_id, card_number) lookup shape for callers. */
export type CardLookupInput = {
  checklistSectionId: number;
  cardNumber: string;
};

export async function findCardBySectionAndNumber(
  checklistSectionId: number,
  cardNumber: string,
): Promise<CardRow | null> {
  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("checklist_section_id", checklistSectionId)
    .eq("card_number", cardNumber)
    .maybeSingle();

  if (error) throw error;

  return data as CardRow | null;
}

export type CreateCardV2Input = {
  checklistSectionId: number;
  // Temporary compatibility: cards.set_id is kept during the Catalog v2
  // transition (see the migration plan), so it's still supplied on create.
  setId: number;
  cardNumber: string;
  title?: string | null;
  isInsert?: boolean;
};

export async function findOrCreateCardV2(input: CreateCardV2Input): Promise<CardRow> {
  const existing = await findCardBySectionAndNumber(input.checklistSectionId, input.cardNumber);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("cards")
    .insert({
      set_id: input.setId,
      checklist_section_id: input.checklistSectionId,
      card_number: input.cardNumber,
      title: input.title ?? null,
      is_insert: input.isInsert ?? false,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardRow;
}

export type CardSummary = { id: number; card_number: string; title: string | null };

// card_number is text (not guaranteed purely numeric -- some checklists use
// values like "RC-5"), so "ordered numerically where possible" is done
// client-side after fetching rather than via a plain PostgREST .order(),
// which would sort it lexicographically (e.g. "10" before "2").
function compareCardNumbers(a: string, b: string): number {
  const numA = Number(a);
  const numB = Number(b);
  const aIsNum = a.trim() !== "" && Number.isFinite(numA);
  const bIsNum = b.trim() !== "" && Number.isFinite(numB);
  if (aIsNum && bIsNum) return numA - numB;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return a.localeCompare(b);
}

export async function listCardsForChecklistSection(
  checklistSectionId: number,
): Promise<CardSummary[]> {
  const { data, error } = await supabase
    .from("cards")
    .select("id, card_number, title")
    .eq("checklist_section_id", checklistSectionId);

  if (error) throw error;

  return ((data ?? []) as CardSummary[]).sort((a, b) =>
    compareCardNumbers(a.card_number, b.card_number),
  );
}

// ---- Vision Engine V2, Phase 7A: catalog candidate engine search ----
//
// Reuses the exact per-field id-lookup building blocks searchCatalog()
// above already has (cardIdsMatchingPlayerText/SetYear/SetText,
// cardIdsMatchingOwnFields for card_number, intersectIdSets) rather than
// duplicating that query logic. The only new behavior is *how* those
// per-field id sets get combined: searchCatalog() ORs tokens together
// per-field then intersects every token; this instead ANDs whichever
// structured fields (player/year/set/card-number) are actually present,
// with a fallback that progressively drops the least-recently-added field
// (in Player -> Year -> Set -> Card Number priority order) if the
// fully-narrowed combination returns nothing -- so one noisy OCR field
// (e.g. a misread year) never zeroes out real candidates. This is a
// deliberate simplification (drop-from-the-end-of-the-priority-list), not
// an exhaustive search over every field subset.

export type CandidateSearchFilters = {
  playerName?: string | null;
  year?: number | null;
  // Text used for the "set" narrowing stage. Phase 7A correction: this is
  // resolved by the caller (src/lib/catalog/candidateEngine.ts) from the
  // merged OCR's genuine setName evidence, falling back to brand/
  // manufacturer text ONLY when no setName evidence exists at all -- this
  // repository function stays a plain single-value search stage and has no
  // opinion on that fallback policy. cardIdsMatchingSetText already
  // searches both sets.name and sets.search_text, so a brand/manufacturer
  // fallback value is still a reasonable (if broader) text search here,
  // even though it is never used for *scoring* set evidence.
  setName?: string | null;
  cardNumber?: string | null;
};

// Smaller than searchCatalog()'s TOKEN_ID_LOOKUP_LIMIT (200): the candidate
// engine (src/lib/catalog/candidateEngine.ts) does one additional variant
// lookup per pooled card to score the parallel field, so the pool this
// feeds is deliberately kept modest.
const CANDIDATE_POOL_LIMIT = 50;

// Card numbers are compared/searched with a conservative normalization:
// trim, and ignore a single leading "#" (a common OCR/typed artifact) --
// nothing else is stripped, so meaningful prefixes/suffixes like "RC-12"
// are preserved exactly.
function normalizeCardNumberForSearch(value: string): string {
  return value.trim().replace(/^#/, "");
}

/**
 * Staged catalog narrowing for the OCR candidate engine: given whichever of
 * playerName/year/setName/cardNumber are actually available, returns a
 * bounded pool of CardWithContext candidates (same shape as
 * searchCardsWithContext) for the engine to score -- never the whole
 * catalog, and never empty just because one field didn't narrow cleanly
 * when a broader combination would have matched something.
 */
export async function searchCandidateCards(
  filters: CandidateSearchFilters,
): Promise<CardWithContext[]> {
  const stages: Array<() => Promise<number[]>> = [];

  const playerName = filters.playerName?.trim();
  if (playerName) {
    stages.push(() => cardIdsMatchingPlayerText(playerName));
  }
  const year = filters.year;
  if (year !== null && year !== undefined && Number.isFinite(year)) {
    stages.push(() => cardIdsMatchingSetYear(year));
  }
  const setName = filters.setName?.trim();
  if (setName) {
    stages.push(() => cardIdsMatchingSetText(setName));
  }
  const cardNumber = filters.cardNumber?.trim();
  if (cardNumber) {
    const normalized = normalizeCardNumberForSearch(cardNumber);
    stages.push(() => cardIdsMatchingOwnFields(`card_number.ilike.%${normalized}%`));
  }

  if (stages.length === 0) return [];

  const idSets = (await Promise.all(stages.map((stage) => stage()))).map(
    (ids) => new Set(ids),
  );

  let finalIds: number[] = [];
  for (let count = idSets.length; count >= 1; count -= 1) {
    finalIds = intersectIdSets(idSets.slice(0, count));
    if (finalIds.length > 0) break;
  }

  if (finalIds.length === 0) return [];

  const { data, error } = await supabase
    .from("cards")
    .select(CARD_CONTEXT_SELECT)
    .in("id", finalIds)
    .order("id", { ascending: true })
    .limit(CANDIDATE_POOL_LIMIT);

  if (error) throw error;

  return ((data ?? []) as unknown as CardWithContextRow[]).map(toCardWithContext);
}

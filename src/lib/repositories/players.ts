import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type PlayerRow = {
  id: number;
  league_id: number | null;
  team_id: number | null;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  slug: string;
  search_text: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Display-ready player shape for list/search results: identity fields plus
 * team/league/sport context resolved via players.team_id -> teams and
 * players.league_id -> leagues -> sports. Any of the three context fields
 * may be null if that relationship isn't set on the player yet.
 */
export type PlayerWithContext = {
  id: number;
  full_name: string;
  slug: string;
  team_name: string | null;
  league_name: string | null;
  sport_name: string | null;
};

type PlayerWithContextRow = {
  id: number;
  full_name: string;
  slug: string;
  teams: { name: string } | null;
  leagues: { name: string; sports: { name: string } | null } | null;
};

const CONTEXT_SELECT = "id, full_name, slug, teams(name), leagues(name, sports(name))";

// Filtering on a nested/embedded resource (leagues.sports) requires that
// embed to be `!inner`, otherwise it's a left join and doesn't restrict the
// outer `players` rows. Only swap to the inner-join select when a sportId
// filter is actually requested, so unfiltered callers keep the cheaper
// left-join select (players with no league still show up).
const CONTEXT_SELECT_SPORT_FILTERED =
  "id, full_name, slug, teams(name), leagues!inner(name, sports!inner(name))";

export type PlayerFilters = {
  sportId?: number;
  leagueId?: number;
  teamId?: number;
};

function toPlayerWithContext(row: PlayerWithContextRow): PlayerWithContext {
  return {
    id: row.id,
    full_name: row.full_name,
    slug: row.slug,
    team_name: row.teams?.name ?? null,
    league_name: row.leagues?.name ?? null,
    sport_name: row.leagues?.sports?.name ?? null,
  };
}

export async function listPlayers(filters?: PlayerFilters): Promise<PlayerWithContext[]> {
  let query = supabase
    .from("players")
    .select(filters?.sportId ? CONTEXT_SELECT_SPORT_FILTERED : CONTEXT_SELECT)
    .order("full_name", { ascending: true })
    .limit(100);

  if (filters?.teamId) query = query.eq("team_id", filters.teamId);
  if (filters?.leagueId) query = query.eq("league_id", filters.leagueId);
  if (filters?.sportId) query = query.eq("leagues.sports.id", filters.sportId);

  const { data, error } = await query;

  if (error) throw error;

  return ((data ?? []) as unknown as PlayerWithContextRow[]).map(toPlayerWithContext);
}

export async function searchPlayers(
  queryText: string,
  filters?: PlayerFilters,
): Promise<PlayerWithContext[]> {
  const trimmed = queryText.trim();

  if (!trimmed) return [];

  let query = supabase
    .from("players")
    .select(filters?.sportId ? CONTEXT_SELECT_SPORT_FILTERED : CONTEXT_SELECT)
    .or(`full_name.ilike.%${trimmed}%,search_text.ilike.%${trimmed}%`)
    .order("full_name", { ascending: true })
    .limit(25);

  if (filters?.teamId) query = query.eq("team_id", filters.teamId);
  if (filters?.leagueId) query = query.eq("league_id", filters.leagueId);
  if (filters?.sportId) query = query.eq("leagues.sports.id", filters.sportId);

  const { data, error } = await query;

  if (error) throw error;

  return ((data ?? []) as unknown as PlayerWithContextRow[]).map(toPlayerWithContext);
}

/**
 * Looks up a player by slug for the player detail route, with the same
 * display context as listPlayers/searchPlayers. Slugs are only unique per
 * league (players_league_id_slug_key), so a bare slug lookup could in
 * principle match more than one player across different leagues; this
 * takes the first match rather than erroring, since disambiguating further
 * would need a league in the URL, which the detail route doesn't have yet.
 */
export async function getPlayerBySlug(slug: string): Promise<PlayerWithContext | null> {
  const { data, error } = await supabase
    .from("players")
    .select(CONTEXT_SELECT)
    .eq("slug", slug)
    .limit(1);

  if (error) throw error;

  const row = (data as unknown as PlayerWithContextRow[] | null)?.[0];
  return row ? toPlayerWithContext(row) : null;
}

export async function getPlayer(id: number): Promise<PlayerRow | null> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as PlayerRow | null;
}

export async function findPlayerBySlug(
  slug: string,
  leagueId?: number | null,
): Promise<PlayerRow | null> {
  let query = supabase.from("players").select("*").eq("slug", slug);
  query = leagueId ? query.eq("league_id", leagueId) : query.is("league_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  return data as PlayerRow | null;
}

export type CreatePlayerInput = {
  full_name: string;
  first_name?: string | null;
  last_name?: string | null;
  league_id?: number | null;
  team_id?: number | null;
  search_text?: string | null;
};

export async function createPlayer(input: CreatePlayerInput): Promise<PlayerRow> {
  const { data, error } = await supabase
    .from("players")
    .insert({
      full_name: input.full_name,
      first_name: input.first_name ?? null,
      last_name: input.last_name ?? null,
      league_id: input.league_id ?? null,
      team_id: input.team_id ?? null,
      search_text: input.search_text ?? null,
      slug: slugify(input.full_name),
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as PlayerRow;
}

export async function findOrCreatePlayer(input: CreatePlayerInput): Promise<PlayerRow> {
  const slug = slugify(input.full_name);
  const existing = await findPlayerBySlug(slug, input.league_id ?? null);
  if (existing) return existing;
  return createPlayer(input);
}

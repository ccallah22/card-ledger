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

export async function listPlayers(): Promise<PlayerRow[]> {
  const { data, error } = await supabase
    .from("players")
    .select("*")
    .order("full_name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as PlayerRow[];
}

export async function searchPlayers(queryText: string): Promise<PlayerRow[]> {
  const trimmed = queryText.trim();

  if (!trimmed) return [];

  const { data, error } = await supabase
    .from("players")
    .select("*")
    .or(`full_name.ilike.%${trimmed}%,search_text.ilike.%${trimmed}%`)
    .order("full_name", { ascending: true })
    .limit(25);

  if (error) throw error;

  return (data ?? []) as PlayerRow[];
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

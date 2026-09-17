import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type LeagueRow = {
  id: number;
  sport_id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function listLeagues(
  sportId?: number,
): Promise<LeagueRow[]> {
  let query = supabase
    .from("leagues")
    .select("*")
    .order("name", { ascending: true });

  if (sportId) {
    query = query.eq("sport_id", sportId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as LeagueRow[];
}

// Canonical per-card Team architecture, Phase 1: find-or-create foundation,
// mirroring findOrCreateBrand's parent-scoped pattern in sets.ts (a brand
// is scoped by manufacturer_id the same way a league is scoped by
// sport_id: leagues_sport_id_slug_key). Not yet called from anywhere in
// this phase -- see sports.ts's findOrCreateSport for the same note.
// Deliberately generic: a league must be given a canonical sport id by its
// caller; this function has no NFL-specific behavior of its own.
export async function findLeagueBySlug(
  sportId: number,
  slug: string,
  client: SupabaseClient = supabase,
): Promise<LeagueRow | null> {
  const { data, error } = await client
    .from("leagues")
    .select("*")
    .eq("sport_id", sportId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as LeagueRow | null;
}

export type CreateLeagueInput = {
  sport_id: number;
  name: string;
};

export async function createLeague(
  input: CreateLeagueInput,
  client: SupabaseClient = supabase,
): Promise<LeagueRow> {
  const { data, error } = await client
    .from("leagues")
    .insert({
      sport_id: input.sport_id,
      name: input.name,
      slug: slugify(input.name),
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as LeagueRow;
}

export async function findOrCreateLeague(
  input: CreateLeagueInput,
  client: SupabaseClient = supabase,
): Promise<LeagueRow> {
  const existing = await findLeagueBySlug(input.sport_id, slugify(input.name), client);
  if (existing) return existing;
  return createLeague(input, client);
}

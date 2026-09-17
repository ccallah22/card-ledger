import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type TeamRow = {
  id: number;
  league_id: number;
  name: string;
  city: string | null;
  abbreviation: string | null;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function listTeams(
  leagueId?: number,
): Promise<TeamRow[]> {
  let query = supabase
    .from("teams")
    .select("*")
    .order("name", { ascending: true });

  if (leagueId) {
    query = query.eq("league_id", leagueId);
  }

  const { data, error } = await query;

  if (error) throw error;

  return (data ?? []) as TeamRow[];
}

// Canonical per-card Team architecture, Phase 1: find-or-create foundation,
// mirroring findOrCreateBrand's parent-scoped pattern in sets.ts (a team is
// scoped by league_id the same way a brand is scoped by manufacturer_id:
// teams_league_id_slug_key). Not yet called from anywhere in this phase --
// see sports.ts's findOrCreateSport for the same note. Deliberately
// generic and conservative: a team must be given a canonical league id by
// its caller, and no alias/nickname/abbreviation matching or guessing
// happens here -- only an exact (league_id, slug) lookup, matching the
// database's own uniqueness rule.
export async function findTeamBySlug(
  leagueId: number,
  slug: string,
  client: SupabaseClient = supabase,
): Promise<TeamRow | null> {
  const { data, error } = await client
    .from("teams")
    .select("*")
    .eq("league_id", leagueId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as TeamRow | null;
}

export type CreateTeamInput = {
  league_id: number;
  name: string;
  city?: string | null;
  abbreviation?: string | null;
};

export async function createTeam(
  input: CreateTeamInput,
  client: SupabaseClient = supabase,
): Promise<TeamRow> {
  const { data, error } = await client
    .from("teams")
    .insert({
      league_id: input.league_id,
      name: input.name,
      city: input.city ?? null,
      abbreviation: input.abbreviation ?? null,
      slug: slugify(input.name),
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as TeamRow;
}

export async function findOrCreateTeam(
  input: CreateTeamInput,
  client: SupabaseClient = supabase,
): Promise<TeamRow> {
  const existing = await findTeamBySlug(input.league_id, slugify(input.name), client);
  if (existing) return existing;
  return createTeam(input, client);
}

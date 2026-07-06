import { supabase } from "@/lib/supabaseClient";

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

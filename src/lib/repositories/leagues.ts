import { supabase } from "@/lib/supabaseClient";

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

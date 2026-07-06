import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type SetRow = {
  id: number;
  sport_id: number | null;
  league_id: number | null;
  name: string;
  manufacturer: string | null;
  brand: string | null;
  release_year: number | null;
  season: string | null;
  slug: string;
  search_text: string | null;
  created_at: string;
  updated_at: string;
};

export async function listSets(): Promise<SetRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as SetRow[];
}

export async function searchSets(queryText: string): Promise<SetRow[]> {
  const trimmed = queryText.trim();

  if (!trimmed) return [];

  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .or(`name.ilike.%${trimmed}%,search_text.ilike.%${trimmed}%`)
    .order("name", { ascending: true })
    .limit(25);

  if (error) throw error;

  return (data ?? []) as SetRow[];
}

export async function getSet(id: number): Promise<SetRow | null> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as SetRow | null;
}

export async function findSetBySlug(slug: string): Promise<SetRow | null> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as SetRow | null;
}

export type CreateSetInput = {
  name: string;
  manufacturer?: string | null;
  brand?: string | null;
  release_year?: number | null;
  season?: string | null;
  sport_id?: number | null;
  league_id?: number | null;
  search_text?: string | null;
};

export async function createSet(input: CreateSetInput): Promise<SetRow> {
  const slug = slugify(`${input.name}-${input.release_year ?? ""}`);

  const { data, error } = await supabase
    .from("sets")
    .insert({
      name: input.name,
      manufacturer: input.manufacturer ?? null,
      brand: input.brand ?? null,
      release_year: input.release_year ?? null,
      season: input.season ?? null,
      sport_id: input.sport_id ?? null,
      league_id: input.league_id ?? null,
      search_text: input.search_text ?? null,
      slug,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as SetRow;
}

export async function findOrCreateSet(input: CreateSetInput): Promise<SetRow> {
  const slug = slugify(`${input.name}-${input.release_year ?? ""}`);
  const existing = await findSetBySlug(slug);
  if (existing) return existing;
  return createSet(input);
}

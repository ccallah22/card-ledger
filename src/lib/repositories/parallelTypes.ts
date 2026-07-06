import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type ParallelTypeRow = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export async function listParallelTypes(): Promise<ParallelTypeRow[]> {
  const { data, error } = await supabase
    .from("parallel_types")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as ParallelTypeRow[];
}

export async function findParallelTypeByName(
  name: string,
): Promise<ParallelTypeRow | null> {
  const { data, error } = await supabase
    .from("parallel_types")
    .select("*")
    .ilike("name", name)
    .maybeSingle();

  if (error) throw error;

  return data as ParallelTypeRow | null;
}

export async function findOrCreateParallelType(
  name: string,
): Promise<ParallelTypeRow> {
  const existing = await findParallelTypeByName(name);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("parallel_types")
    .insert({ name, slug: slugify(name) })
    .select("*")
    .single();

  if (error) throw error;

  return data as ParallelTypeRow;
}

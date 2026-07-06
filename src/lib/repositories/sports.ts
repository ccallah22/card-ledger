import { supabase } from "@/lib/supabaseClient";

export type SportRow = {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function listSports(): Promise<SportRow[]> {
  const { data, error } = await supabase
    .from("sports")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as SportRow[];
}

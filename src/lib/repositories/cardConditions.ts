import { supabase } from "@/lib/supabaseClient";

export type CardConditionRow = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export async function listCardConditions(): Promise<CardConditionRow[]> {
  const { data, error } = await supabase
    .from("card_conditions")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) throw error;

  return (data ?? []) as CardConditionRow[];
}

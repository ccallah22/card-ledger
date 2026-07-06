import { supabase } from "@/lib/supabaseClient";

export type SaleStatusRow = {
  id: number;
  name: string;
  slug: string;
  display_order: number;
  created_at: string;
  updated_at: string;
};

export async function listSaleStatuses(): Promise<SaleStatusRow[]> {
  const { data, error } = await supabase
    .from("sale_statuses")
    .select("*")
    .order("display_order", { ascending: true });

  if (error) throw error;

  return (data ?? []) as SaleStatusRow[];
}

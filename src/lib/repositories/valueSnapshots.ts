import { supabase } from "@/lib/supabaseClient";

export type ValueSnapshotRow = {
  id: number;
  user_card_id: string;
  market_value: number;
  source: string | null;
  recorded_at: string;
  created_at: string;
};

export async function listValueSnapshots(
  userCardId: string,
): Promise<ValueSnapshotRow[]> {
  const { data, error } = await supabase
    .from("card_value_snapshots")
    .select("*")
    .eq("user_card_id", userCardId)
    .order("recorded_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as ValueSnapshotRow[];
}

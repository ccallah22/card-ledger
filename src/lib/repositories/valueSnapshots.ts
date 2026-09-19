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

// Backup V2 metadata export: bulk counterpart to listValueSnapshots, for
// exporting every snapshot across an entire collection in one query
// instead of one request per card. Ownership stays RLS-enforced exactly
// as listValueSnapshots already is (card_value_snapshots' own policies
// only ever return rows whose user_card_id maps to a user_cards row owned
// by the caller -- see 202607050001_user_collections.sql); the caller is
// still expected to pass only ids it already knows belong to the current
// profile (mirrors the existing bulk pattern in
// repositories/cardMedia.ts's listCardMediaForUserCardsBySide).
export async function listValueSnapshotsForUserCards(
  userCardIds: string[],
): Promise<ValueSnapshotRow[]> {
  if (userCardIds.length === 0) return [];

  const { data, error } = await supabase
    .from("card_value_snapshots")
    .select("*")
    .in("user_card_id", userCardIds)
    .order("user_card_id", { ascending: true })
    .order("recorded_at", { ascending: false });

  if (error) throw error;

  return (data ?? []) as ValueSnapshotRow[];
}

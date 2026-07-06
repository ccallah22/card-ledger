import { supabase } from "@/lib/supabaseClient";
import type { CardComp } from "@/lib/types";

export type UserCardRow = {
  id: string;
  profile_id: string;
  card_id: number;
  card_variant_id: number | null;
  location_id: number | null;

  team_name: string | null;
  serial_number: number | null;

  grading_status: string;
  condition: string | null;
  grading_company_id: number | null;
  grade: string | null;
  cert_number: string | null;

  status: string;

  purchase_price: number | null;
  purchase_date: string | null;
  purchase_source: string | null;

  estimated_value: number | null;

  asking_price: number | null;
  sold_price: number | null;
  sold_date: string | null;
  sold_fees: number | null;

  sold_notes: string | null;

  quantity: number;

  notes: string | null;

  comps: CardComp[];

  image_path: string | null;
  thumb_path: string | null;
  image_shared: boolean;
  image_type: string | null;

  created_at: string;
  updated_at: string;
};

export async function listUserCards(
  profileId: string,
): Promise<UserCardRow[]> {
  const { data, error } = await supabase
    .from("user_cards")
    .select("*")
    .eq("profile_id", profileId);

  if (error) throw error;

  return (data ?? []) as UserCardRow[];
}

export async function getUserCard(
  id: string,
): Promise<UserCardRow | null> {
  const { data, error } = await supabase
    .from("user_cards")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as UserCardRow | null;
}

export type UserCardWriteInput = Partial<Omit<UserCardRow, "id" | "created_at" | "updated_at">> & {
  profile_id: string;
  card_id: number;
};

export async function createUserCard(
  input: UserCardWriteInput,
): Promise<UserCardRow> {
  const { data, error } = await supabase
    .from("user_cards")
    .insert(input)
    .select("*")
    .single();

  if (error) throw error;

  return data as UserCardRow;
}

export async function updateUserCard(
  id: string,
  patch: Partial<Omit<UserCardRow, "id" | "profile_id" | "created_at" | "updated_at">>,
): Promise<UserCardRow> {
  const { data, error } = await supabase
    .from("user_cards")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return data as UserCardRow;
}

export async function deleteUserCard(id: string): Promise<void> {
  const { error } = await supabase.from("user_cards").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteUserCards(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("user_cards").delete().in("id", ids);
  if (error) throw error;
}

export async function deleteAllUserCardsForProfile(profileId: string): Promise<void> {
  const { error } = await supabase.from("user_cards").delete().eq("profile_id", profileId);
  if (error) throw error;
}

// src/lib/db/cards.ts
import type { SportsCard } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";
import { fromCardsV1Row, toCardsV1Insert, type CardsV1Row } from "@/lib/cardsDbMapper";

const TABLE = "cards_v1";

export async function getUserOrThrow() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("Not signed in");
  return data.user;
}

export async function dbLoadCards(): Promise<SportsCard[]> {
  const user = await getUserOrThrow();

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as CardsV1Row[] | null)?.map(fromCardsV1Row) ?? [];
}

export async function dbUpsertCard(card: SportsCard): Promise<void> {
  const user = await getUserOrThrow();

  const row = toCardsV1Insert(card, user.id);

  // NOTE: this assumes your table has a UNIQUE or PRIMARY KEY on "id"
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function dbDeleteCard(id: string): Promise<void> {
  const user = await getUserOrThrow();

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

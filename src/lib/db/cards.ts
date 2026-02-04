// src/lib/db/cards.ts
import type { SportsCard } from "@/lib/types";
import { supabase } from "@/lib/supabase/client";

type DbCard = SportsCard & {
  user_id: string;
};

const TABLE = "cards_v1";

function toDbRow(card: SportsCard, userId: string): DbCard {
  // Store images however you want later; for now keep imageUrl if you already have it in schema.
  return {
    ...(card as any),
    user_id: userId,
  };
}

function fromDbRow(row: any): SportsCard {
  // Strip user_id so UI keeps using SportsCard
  const { user_id, ...rest } = row ?? {};
  return rest as SportsCard;
}

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
    .order("createdAt", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(fromDbRow);
}

export async function dbUpsertCard(card: SportsCard): Promise<void> {
  const user = await getUserOrThrow();

  const row = toDbRow(card, user.id);

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

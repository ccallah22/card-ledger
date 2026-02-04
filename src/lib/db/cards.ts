// src/lib/db/cards.ts
import type { SportsCard } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const TABLE = "cards_v1";

export async function getUserOrThrow() {
  const supabase = createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data?.user) throw new Error("Not signed in");
  return data.user;
}

export async function dbLoadCards(): Promise<SportsCard[]> {
  const supabase = createClient();
  const user = await getUserOrThrow();

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, card, created_at, updated_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  const rows = (data ?? []) as Array<{
    id: string;
    card: SportsCard | null;
    created_at: string | null;
    updated_at: string | null;
  }>;

  return rows.map((row) => {
    const base = (row.card ?? {}) as SportsCard;
    return {
      ...base,
      id: row.id,
      createdAt: row.created_at ?? base.createdAt,
      updatedAt: row.updated_at ?? base.updatedAt,
    };
  });
}

export async function dbUpsertCard(card: SportsCard): Promise<void> {
  const supabase = createClient();
  const user = await getUserOrThrow();

  const isUuid =
    typeof card.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      card.id
    );

  const id =
    isUuid
      ? String(card.id)
      : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : String(card.id);

  if (!isUuid && id === String(card.id)) {
    throw new Error("Card id must be a UUID to save to Supabase");
  }

  const row = {
    id,
    user_id: user.id,
    card: { ...card, id },
  };

  // NOTE: this assumes your table has a UNIQUE or PRIMARY KEY on "id"
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
  if (error) throw error;
}

export async function dbDeleteCard(id: string): Promise<void> {
  const supabase = createClient();
  const user = await getUserOrThrow();

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}

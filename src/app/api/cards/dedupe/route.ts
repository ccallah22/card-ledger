import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { SportsCard } from "@/lib/types";

function normalize(value: string | number | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function fingerprint(card: SportsCard) {
  return [
    normalize(card.playerName),
    normalize(card.year),
    normalize(card.setName),
    normalize(card.cardNumber ?? ""),
  ].join("__");
}

export async function POST() {
  const supabase = await createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userErr || !user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("cards_v1")
    .select("id, card, created_at, updated_at")
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    card: SportsCard | null;
    created_at: string | null;
    updated_at: string | null;
  }>;

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const card = (row.card ?? {}) as SportsCard;
    const key = fingerprint(card);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const idsToDelete: string[] = [];
  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    const sorted = [...list].sort((a, b) => {
      const aTime = new Date(a.updated_at ?? a.created_at ?? 0).getTime();
      const bTime = new Date(b.updated_at ?? b.created_at ?? 0).getTime();
      return bTime - aTime;
    });
    const [, ...dupes] = sorted;
    idsToDelete.push(...dupes.map((d) => d.id));
  }

  if (idsToDelete.length === 0) {
    return NextResponse.json({ deleted: 0, total: rows.length });
  }

  // Delete in chunks to avoid query limits
  const chunkSize = 100;
  for (let i = 0; i < idsToDelete.length; i += chunkSize) {
    const chunk = idsToDelete.slice(i, i + chunkSize);
    const { error: delErr } = await supabase
      .from("cards_v1")
      .delete()
      .in("id", chunk)
      .eq("user_id", user.id);

    if (delErr) {
      return NextResponse.json({ message: delErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ deleted: idsToDelete.length, total: rows.length });
}

// src/app/api/cards/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fromCardsV1Row, toCardsV1Insert, type CardsV1Row } from "@/lib/cardsDbMapper";
import type { SportsCard } from "@/lib/types";

export async function GET() {
  const supabase = await createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userErr || !user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("cards_v1")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  const cards = (data as CardsV1Row[]).map(fromCardsV1Row);
  return NextResponse.json({ cards });
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  const user = userData?.user;

  if (userErr || !user) {
    return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ message: "Invalid JSON" }, { status: 400 });
  }

  const card = body?.card as SportsCard | undefined;
  if (!card || !card.id || !card.playerName || !card.year || !card.setName) {
    return NextResponse.json({ message: "Missing required card fields" }, { status: 400 });
  }

  const row = toCardsV1Insert(card, user.id);

  const { data, error } = await supabase
    .from("cards_v1")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }

  return NextResponse.json({ card: fromCardsV1Row(data as CardsV1Row) });
}

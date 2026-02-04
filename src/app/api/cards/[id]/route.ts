// src/app/api/cards/[id]/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fromCardsV1Row, type CardsV1Row } from "@/lib/cardsDbMapper";

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return NextResponse.json({ message: "Not authenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const cardId = String(id || "");
  if (!cardId) return NextResponse.json({ message: "Missing id" }, { status: 400 });

  const { data, error } = await supabase.from("cards_v1").select("*").eq("id", cardId).single();
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  return NextResponse.json({ card: fromCardsV1Row(data as CardsV1Row) });
}

export async function DELETE(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const supabase = createClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData?.user) return NextResponse.json({ message: "Not authenticated" }, { status: 401 });

  const { id } = await ctx.params;
  const cardId = String(id || "");
  if (!cardId) return NextResponse.json({ message: "Missing id" }, { status: 400 });

  const { error } = await supabase.from("cards_v1").delete().eq("id", cardId);
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}

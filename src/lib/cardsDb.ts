import { supabase } from "@/lib/supabaseClient";

export type DbCard = {
  id: string;
  created_at: string;
  user_id: string;

  title: string;
  year: string | null;
  brand: string | null;
  set_name: string | null;
  card_number: string | null;
  condition: string | null;
  status: string | null;

  paid: number | null;
  asking: number | null;
  sold_price: number | null;
  sold_fees: number | null;

  notes: string | null;
};

export async function fetchCards() {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) throw new Error("Not logged in");

  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as DbCard[];
}

export async function insertCardsBulk(cards: Array<Partial<DbCard>>) {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) throw new Error("Not logged in");

  const rows = cards.map((c) => ({
    user_id: user.id,
    title: c.title ?? "Untitled",
    year: c.year ?? null,
    brand: c.brand ?? null,
    set_name: c.set_name ?? null,
    card_number: c.card_number ?? null,
    condition: c.condition ?? null,
    status: c.status ?? null,
    paid: c.paid ?? null,
    asking: c.asking ?? null,
    sold_price: c.sold_price ?? null,
    sold_fees: c.sold_fees ?? null,
    notes: c.notes ?? null,
  }));

  const { error } = await supabase.from("cards").insert(rows);
  if (error) throw error;
}

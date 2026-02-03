import { supabase } from "./supabaseClient";

export type CardRow = {
  id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  name: string;
  status: string;
  paid: number | null;
  image_front_url: string | null;
  image_back_url: string | null;
};

export async function createCardRow(params: {
  id: string;
  userId: string;
  name: string;
  status?: string;
  paid?: number | null;
  imageFrontPath?: string | null;
  imageBackPath?: string | null;
}) {
  const { id, userId, name, status = "have", paid = null, imageFrontPath, imageBackPath } = params;

  const { data, error } = await supabase
    .from("cards")
    .insert({
      id,
      user_id: userId,
      name,
      status,
      paid,
      image_front_url: imageFrontPath ?? null,
      image_back_url: imageBackPath ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`Insert failed: ${error.message}`);
  return data as CardRow;
}

export async function fetchCardsPage(params: { page: number; pageSize: number }) {
  const { page, pageSize } = params;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await supabase
    .from("cards")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`Fetch failed: ${error.message}`);

  return {
    rows: (data ?? []) as CardRow[],
    total: count ?? 0,
  };
}

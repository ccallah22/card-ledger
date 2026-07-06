import { supabase } from "@/lib/supabaseClient";

export type CardVariantRow = {
  id: number;
  card_id: number;
  parallel_type_id: number | null;

  name_override: string | null;

  serial_numbered: boolean;
  print_run: number | null;

  has_autograph: boolean;
  has_memorabilia: boolean;

  is_refractor: boolean;
  is_die_cut: boolean;
  is_short_print: boolean;

  notes: string | null;

  created_at: string;
  updated_at: string;
};

export async function listCardVariants(
  cardId: number,
): Promise<CardVariantRow[]> {
  const { data, error } = await supabase
    .from("card_variants")
    .select("*")
    .eq("card_id", cardId)
    .order("id");

  if (error) throw error;

  return (data ?? []) as CardVariantRow[];
}

export async function getCardVariant(id: number): Promise<CardVariantRow | null> {
  const { data, error } = await supabase
    .from("card_variants")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as CardVariantRow | null;
}

export type CreateCardVariantInput = {
  card_id: number;
  parallel_type_id?: number | null;
  name_override?: string | null;
  serial_numbered?: boolean;
  print_run?: number | null;
  has_autograph?: boolean;
  has_memorabilia?: boolean;
  is_refractor?: boolean;
  is_die_cut?: boolean;
  is_short_print?: boolean;
  notes?: string | null;
};

export async function findCardVariant(
  cardId: number,
  parallelTypeId: number | null,
  printRun: number | null,
): Promise<CardVariantRow | null> {
  let query = supabase.from("card_variants").select("*").eq("card_id", cardId);
  query = parallelTypeId
    ? query.eq("parallel_type_id", parallelTypeId)
    : query.is("parallel_type_id", null);
  query = printRun !== null ? query.eq("print_run", printRun) : query.is("print_run", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  return data as CardVariantRow | null;
}

export async function createCardVariant(
  input: CreateCardVariantInput,
): Promise<CardVariantRow> {
  const { data, error } = await supabase
    .from("card_variants")
    .insert({
      card_id: input.card_id,
      parallel_type_id: input.parallel_type_id ?? null,
      name_override: input.name_override ?? null,
      serial_numbered: input.serial_numbered ?? false,
      print_run: input.print_run ?? null,
      has_autograph: input.has_autograph ?? false,
      has_memorabilia: input.has_memorabilia ?? false,
      is_refractor: input.is_refractor ?? false,
      is_die_cut: input.is_die_cut ?? false,
      is_short_print: input.is_short_print ?? false,
      notes: input.notes ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardVariantRow;
}

export async function findOrCreateCardVariant(
  input: CreateCardVariantInput,
): Promise<CardVariantRow> {
  const existing = await findCardVariant(
    input.card_id,
    input.parallel_type_id ?? null,
    input.print_run ?? null,
  );
  if (existing) return existing;
  return createCardVariant(input);
}

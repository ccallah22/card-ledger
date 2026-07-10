import { supabase } from "@/lib/supabaseClient";

export type CardVariantRow = {
  id: number;
  card_id: number;
  parallel_type_id: number | null;

  name_override: string | null;

  serial_numbered: boolean;
  print_run: number | null;
  // Catalog v2: jersey-tag/manufacturer-logo descriptor text (e.g. "Brand
  // Logo", "NFL Shield", "Die-Cut") -- see
  // docs/database/catalog-v2-migration-plan.md. Nullable; existing variants
  // simply have none.
  swatch_descriptor: string | null;

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

// ---- Catalog v2 (card_id, parallel_type_id, print_run, swatch_descriptor)
// identity ----
//
// Additive alongside the functions above, which remain unchanged for
// compatibility with existing callers (see
// docs/database/catalog-v2-migration-plan.md). Nothing here is wired up to
// any caller yet.

export type CreateCardVariantV2Input = {
  cardId: number;
  parallelTypeId: number | null;
  printRun: number | null;
  swatchDescriptor?: string | null;

  isAutograph: boolean;
  isMemorabilia: boolean;
};

export async function findCardVariantV2(
  input: CreateCardVariantV2Input,
): Promise<CardVariantRow | null> {
  let query = supabase.from("card_variants").select("*").eq("card_id", input.cardId);
  query = input.parallelTypeId
    ? query.eq("parallel_type_id", input.parallelTypeId)
    : query.is("parallel_type_id", null);
  query =
    input.printRun !== null ? query.eq("print_run", input.printRun) : query.is("print_run", null);
  query = input.swatchDescriptor
    ? query.eq("swatch_descriptor", input.swatchDescriptor)
    : query.is("swatch_descriptor", null);

  const { data, error } = await query.maybeSingle();

  if (error) throw error;

  return data as CardVariantRow | null;
}

export async function findOrCreateCardVariantV2(
  input: CreateCardVariantV2Input,
): Promise<CardVariantRow> {
  const existing = await findCardVariantV2(input);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("card_variants")
    .insert({
      card_id: input.cardId,
      parallel_type_id: input.parallelTypeId,
      print_run: input.printRun,
      swatch_descriptor: input.swatchDescriptor ?? null,
      has_autograph: input.isAutograph,
      has_memorabilia: input.isMemorabilia,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as CardVariantRow;
}

// Display-ready variant shape for the Add Card page's variant picker:
// parallel_type_id resolved to its real name (parallel_type_id alone isn't
// useful in a picker UI), alongside the fields that distinguish otherwise
// identical-looking variants (print run, swatch descriptor, flags).
export type CardVariantSummary = {
  id: number;
  parallelName: string | null;
  printRun: number | null;
  swatchDescriptor: string | null;
  hasAutograph: boolean;
  hasMemorabilia: boolean;
};

type CardVariantSummaryRow = {
  id: number;
  print_run: number | null;
  swatch_descriptor: string | null;
  has_autograph: boolean;
  has_memorabilia: boolean;
  parallel_types: { name: string } | null;
};

export async function listCardVariantsForCard(cardId: number): Promise<CardVariantSummary[]> {
  const { data, error } = await supabase
    .from("card_variants")
    .select("id, print_run, swatch_descriptor, has_autograph, has_memorabilia, parallel_types(name)")
    .eq("card_id", cardId);

  if (error) throw error;

  return ((data ?? []) as unknown as CardVariantSummaryRow[]).map((row) => ({
    id: row.id,
    parallelName: row.parallel_types?.name ?? null,
    printRun: row.print_run,
    swatchDescriptor: row.swatch_descriptor,
    hasAutograph: row.has_autograph,
    hasMemorabilia: row.has_memorabilia,
  }));
}

import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type SetRow = {
  id: number;
  sport_id: number | null;
  league_id: number | null;
  name: string;
  // Catalog v2: kept for compatibility alongside manufacturer_id/brand_id
  // (see docs/database/manufacturer-brand-normalization-plan.md) -- not yet
  // removed, still fully populated on every create.
  manufacturer: string | null;
  brand: string | null;
  manufacturer_id: number | null;
  brand_id: number | null;
  release_year: number | null;
  season: string | null;
  slug: string;
  search_text: string | null;
  created_at: string;
  updated_at: string;
};

export async function listSets(): Promise<SetRow[]> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as SetRow[];
}

export async function searchSets(queryText: string): Promise<SetRow[]> {
  const trimmed = queryText.trim();

  if (!trimmed) return [];

  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .or(`name.ilike.%${trimmed}%,search_text.ilike.%${trimmed}%`)
    .order("name", { ascending: true })
    .limit(25);

  if (error) throw error;

  return (data ?? []) as SetRow[];
}

export async function getSet(id: number): Promise<SetRow | null> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data as SetRow | null;
}

export async function findSetBySlug(slug: string): Promise<SetRow | null> {
  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as SetRow | null;
}

// ---- Catalog v2: manufacturers/brands ----
//
// Housed here rather than in their own repository files for now (see
// docs/database/manufacturer-brand-normalization-plan.md) since sets.ts is
// currently their only consumer.

export type ManufacturerRow = {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function findManufacturerBySlug(slug: string): Promise<ManufacturerRow | null> {
  const { data, error } = await supabase
    .from("manufacturers")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as ManufacturerRow | null;
}

export type CreateManufacturerInput = {
  name: string;
};

export async function createManufacturer(
  input: CreateManufacturerInput,
): Promise<ManufacturerRow> {
  const { data, error } = await supabase
    .from("manufacturers")
    .insert({ name: input.name, slug: slugify(input.name) })
    .select("*")
    .single();

  if (error) throw error;

  return data as ManufacturerRow;
}

export async function findOrCreateManufacturer(
  input: CreateManufacturerInput,
): Promise<ManufacturerRow> {
  const existing = await findManufacturerBySlug(slugify(input.name));
  if (existing) return existing;
  return createManufacturer(input);
}

export type BrandRow = {
  id: number;
  manufacturer_id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function findBrandBySlug(
  manufacturerId: number,
  slug: string,
): Promise<BrandRow | null> {
  const { data, error } = await supabase
    .from("brands")
    .select("*")
    .eq("manufacturer_id", manufacturerId)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as BrandRow | null;
}

export type CreateBrandInput = {
  manufacturer_id: number;
  name: string;
};

export async function createBrand(input: CreateBrandInput): Promise<BrandRow> {
  const { data, error } = await supabase
    .from("brands")
    .insert({
      manufacturer_id: input.manufacturer_id,
      name: input.name,
      slug: slugify(input.name),
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as BrandRow;
}

export async function findOrCreateBrand(input: CreateBrandInput): Promise<BrandRow> {
  const existing = await findBrandBySlug(input.manufacturer_id, slugify(input.name));
  if (existing) return existing;
  return createBrand(input);
}

export type CreateSetInput = {
  name: string;
  manufacturer?: string | null;
  brand?: string | null;
  release_year?: number | null;
  season?: string | null;
  sport_id?: number | null;
  league_id?: number | null;
  search_text?: string | null;
};

export async function createSet(input: CreateSetInput): Promise<SetRow> {
  const slug = slugify(`${input.name}-${input.release_year ?? ""}`);

  // Catalog v2: resolve manufacturer/brand names to real rows when
  // supplied, so manufacturer_id/brand_id get populated alongside the
  // existing free-text columns. A brand can't exist without a manufacturer
  // (brands.manufacturer_id is not null at the database level), so brand
  // is only resolved when manufacturer is also present; brand alone with
  // no manufacturer leaves brand_id null rather than guessing one.
  let manufacturerId: number | null = null;
  let brandId: number | null = null;

  const manufacturerName = input.manufacturer?.trim();
  if (manufacturerName) {
    const manufacturer = await findOrCreateManufacturer({ name: manufacturerName });
    manufacturerId = manufacturer.id;

    const brandName = input.brand?.trim();
    if (brandName) {
      const brand = await findOrCreateBrand({ manufacturer_id: manufacturer.id, name: brandName });
      brandId = brand.id;
    }
  }

  const { data, error } = await supabase
    .from("sets")
    .insert({
      name: input.name,
      manufacturer: input.manufacturer ?? null,
      brand: input.brand ?? null,
      manufacturer_id: manufacturerId,
      brand_id: brandId,
      release_year: input.release_year ?? null,
      season: input.season ?? null,
      sport_id: input.sport_id ?? null,
      league_id: input.league_id ?? null,
      search_text: input.search_text ?? null,
      slug,
    })
    .select("*")
    .single();

  if (error) throw error;

  return data as SetRow;
}

export async function findOrCreateSet(input: CreateSetInput): Promise<SetRow> {
  const slug = slugify(`${input.name}-${input.release_year ?? ""}`);
  const existing = await findSetBySlug(slug);
  if (existing) return existing;
  return createSet(input);
}

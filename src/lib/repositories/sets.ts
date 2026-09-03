import type { SupabaseClient } from "@supabase/supabase-js";
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

/**
 * Resolves one search token to the COMPLETE set of sets.id it matches --
 * deliberately unbounded (no .limit() here), unlike cards.ts's per-token
 * lookups: those cap at TOKEN_ID_LOOKUP_LIMIT because a card search result
 * is already visibly capped at the same size class, but truncating a
 * token's id population BEFORE cross-token intersection is a correctness
 * bug here, not an optimization -- an arbitrary/unordered subset of (say)
 * the first N rows Postgres happens to return for a broad token ("Prizm")
 * could easily exclude the specific set another token ("2024") narrows
 * down to, permanently and silently dropping a genuine match. The
 * user-visible result limiting belongs solely on the final fetch below
 * (.limit(25)), which runs AFTER intersection against the complete matching
 * population, exactly like the pre-tokenization implementation did.
 *
 * Unlike cards.ts's per-token lookups, this never needs more than one query
 * or any join: name, search_text, manufacturer, and brand are all plain
 * columns directly on `sets` itself (manufacturer_id/brand_id are the newer
 * normalized Catalog v2 foreign keys, but the free-text manufacturer/brand
 * columns are still populated on every create -- see SetRow above), and
 * release_year is a plain integer column on the same row. A single .or()
 * across several of a table's OWN columns (as opposed to .or() spanning a
 * joined table, which PostgREST doesn't support cleanly) is standard,
 * well-supported syntax.
 *
 * An exact 4-digit token additionally matches release_year by equality,
 * unioned with (not replacing) the same ilike text evidence every token
 * gets -- "2024" matches a set with release_year=2024 even if its
 * search_text/name is incomplete, but a set that merely mentions "2024" in
 * its name/search_text still matches too.
 */
async function setIdsMatchingToken(token: string): Promise<Set<number>> {
  const orClauses = [
    `name.ilike.%${token}%`,
    `search_text.ilike.%${token}%`,
    `manufacturer.ilike.%${token}%`,
    `brand.ilike.%${token}%`,
  ];
  if (/^\d{4}$/.test(token)) {
    orClauses.push(`release_year.eq.${token}`);
  }

  const { data, error } = await supabase
    .from("sets")
    .select("id")
    .or(orClauses.join(","));

  if (error) throw error;

  return new Set((data ?? []).map((row) => (row as { id: number }).id));
}

// Same shape/logic as cards.ts's intersectIdSets, kept as its own small
// local copy rather than importing/exporting across repository files for
// one generic Set<number>[] -> number[] utility -- this phase is scoped to
// sets.ts alone, and this is a few lines of plain set math, not
// set-search-specific logic worth sharing.
function intersectSetIds(idSets: Set<number>[]): number[] {
  if (idSets.length === 0) return [];

  const [first, ...rest] = idSets;
  const result = new Set(first);

  for (const s of rest) {
    for (const id of result) {
      if (!s.has(id)) result.delete(id);
    }
  }

  return [...result];
}

/**
 * Tokenized catalog set search: splits the query into whitespace tokens and
 * requires every token to match at least one relevant field on the same set
 * (see setIdsMatchingToken), then fetches the full SetRow for the resulting
 * ids. This lets "2024 Prizm" find "2024 Panini Prizm" even though "2024
 * Prizm" is not a contiguous substring of that name -- each token matches
 * independently (2024 via release_year or text, Prizm via name text) and
 * the per-token id sets are intersected, so a set only survives if EVERY
 * token found evidence on that same sets.id (never token 1 satisfied by one
 * set and token 2 by an unrelated one). Preserves the existing result cap
 * (25) and name-ascending ordering; no ranking/relevance scoring added.
 */
export async function searchSets(queryText: string): Promise<SetRow[]> {
  const tokens = queryText.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const perTokenIds = await Promise.all(tokens.map(setIdsMatchingToken));
  const finalIds = intersectSetIds(perTokenIds);
  if (finalIds.length === 0) return [];

  const { data, error } = await supabase
    .from("sets")
    .select("*")
    .in("id", finalIds)
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

export async function findSetBySlug(
  slug: string,
  client: SupabaseClient = supabase,
): Promise<SetRow | null> {
  const { data, error } = await client
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

export async function findManufacturerBySlug(
  slug: string,
  client: SupabaseClient = supabase,
): Promise<ManufacturerRow | null> {
  const { data, error } = await client
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
  client: SupabaseClient = supabase,
): Promise<ManufacturerRow> {
  const { data, error } = await client
    .from("manufacturers")
    .insert({ name: input.name, slug: slugify(input.name) })
    .select("*")
    .single();

  if (error) throw error;

  return data as ManufacturerRow;
}

export async function findOrCreateManufacturer(
  input: CreateManufacturerInput,
  client: SupabaseClient = supabase,
): Promise<ManufacturerRow> {
  const existing = await findManufacturerBySlug(slugify(input.name), client);
  if (existing) return existing;
  return createManufacturer(input, client);
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
  client: SupabaseClient = supabase,
): Promise<BrandRow | null> {
  const { data, error } = await client
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

export async function createBrand(
  input: CreateBrandInput,
  client: SupabaseClient = supabase,
): Promise<BrandRow> {
  const { data, error } = await client
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

export async function findOrCreateBrand(
  input: CreateBrandInput,
  client: SupabaseClient = supabase,
): Promise<BrandRow> {
  const existing = await findBrandBySlug(input.manufacturer_id, slugify(input.name), client);
  if (existing) return existing;
  return createBrand(input, client);
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

export async function createSet(
  input: CreateSetInput,
  client: SupabaseClient = supabase,
): Promise<SetRow> {
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
    const manufacturer = await findOrCreateManufacturer({ name: manufacturerName }, client);
    manufacturerId = manufacturer.id;

    const brandName = input.brand?.trim();
    if (brandName) {
      const brand = await findOrCreateBrand(
        { manufacturer_id: manufacturer.id, name: brandName },
        client,
      );
      brandId = brand.id;
    }
  }

  const { data, error } = await client
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

export async function findOrCreateSet(
  input: CreateSetInput,
  client: SupabaseClient = supabase,
): Promise<SetRow> {
  const slug = slugify(`${input.name}-${input.release_year ?? ""}`);
  const existing = await findSetBySlug(slug, client);
  if (existing) return existing;
  return createSet(input, client);
}

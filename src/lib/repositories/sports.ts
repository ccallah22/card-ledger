import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { slugify } from "@/lib/slug";

export type SportRow = {
  id: number;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export async function listSports(): Promise<SportRow[]> {
  const { data, error } = await supabase
    .from("sports")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as SportRow[];
}

// Canonical per-card Team architecture, Phase 1: find-or-create foundation
// for the sport/league/team hierarchy, mirroring the existing
// findOrCreateManufacturer/findOrCreateSet pattern in sets.ts exactly
// (find-by-slug, then create, both accepting an optional service-role
// client). Not yet called from anywhere -- this phase only establishes the
// repository capability; wiring a real caller (the catalog importer, or
// resolveCatalogIdsServer.ts) is explicitly out of scope here. Deliberately
// generic: no NFL-specific defaults or shortcuts live in this function --
// any sport-specific behavior belongs in a caller, not here.
export async function findSportBySlug(
  slug: string,
  client: SupabaseClient = supabase,
): Promise<SportRow | null> {
  const { data, error } = await client
    .from("sports")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;

  return data as SportRow | null;
}

export type CreateSportInput = {
  name: string;
};

export async function createSport(
  input: CreateSportInput,
  client: SupabaseClient = supabase,
): Promise<SportRow> {
  const { data, error } = await client
    .from("sports")
    .insert({ name: input.name, slug: slugify(input.name) })
    .select("*")
    .single();

  if (error) throw error;

  return data as SportRow;
}

export async function findOrCreateSport(
  input: CreateSportInput,
  client: SupabaseClient = supabase,
): Promise<SportRow> {
  const existing = await findSportBySlug(slugify(input.name), client);
  if (existing) return existing;
  return createSport(input, client);
}

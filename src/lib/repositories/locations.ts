import { supabase } from "@/lib/supabaseClient";

export type LocationRow = {
  id: number;
  profile_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

export async function listLocations(
  profileId: string,
): Promise<LocationRow[]> {
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("profile_id", profileId)
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as LocationRow[];
}

export async function findLocationByName(
  profileId: string,
  name: string,
): Promise<LocationRow | null> {
  const { data, error } = await supabase
    .from("locations")
    .select("*")
    .eq("profile_id", profileId)
    .ilike("name", name)
    .maybeSingle();

  if (error) throw error;

  return data as LocationRow | null;
}

export async function findOrCreateLocation(
  profileId: string,
  name: string,
): Promise<LocationRow> {
  const existing = await findLocationByName(profileId, name);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("locations")
    .insert({ profile_id: profileId, name })
    .select("*")
    .single();

  if (error) throw error;

  return data as LocationRow;
}

export async function updateLocation(
  id: number,
  patch: { name?: string; description?: string | null },
): Promise<LocationRow> {
  const { data, error } = await supabase
    .from("locations")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return data as LocationRow;
}

export async function deleteLocation(id: number): Promise<void> {
  const { error } = await supabase.from("locations").delete().eq("id", id);
  if (error) throw error;
}

import { supabase } from "@/lib/supabaseClient";

export type ProfileRow = {
  id: string;
  display_name: string | null;
  created_at: string;
  updated_at: string;
};

export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const { data: auth, error: authError } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!auth.user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (error) throw error;

  return data as ProfileRow | null;
}

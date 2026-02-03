import { supabase } from "./supabaseClient";

export async function getThumbSignedUrl(path: string | null | undefined) {
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from("card-thumbs")
    .createSignedUrl(path, 60 * 60);

  if (error) return null;
  return data.signedUrl;
}

import { supabase } from "./supabaseClient";

export async function uploadCardImages(params: {
  userId: string;
  cardId: string;
  frontFile?: File | null;
  backFile?: File | null;
}) {
  const { userId, cardId, frontFile, backFile } = params;

  let frontPath: string | null = null;
  let backPath: string | null = null;

  if (frontFile) {
    const ext = (frontFile.name.split(".").pop() || "jpg").toLowerCase();
    frontPath = `${userId}/${cardId}/front.${ext}`;

    const { error } = await supabase.storage.from("card-images").upload(frontPath, frontFile, {
      upsert: true,
      contentType: frontFile.type || "image/jpeg",
    });

    if (error) throw new Error(`Front upload failed: ${error.message}`);
  }

  if (backFile) {
    const ext = (backFile.name.split(".").pop() || "jpg").toLowerCase();
    backPath = `${userId}/${cardId}/back.${ext}`;

    const { error } = await supabase.storage.from("card-images").upload(backPath, backFile, {
      upsert: true,
      contentType: backFile.type || "image/jpeg",
    });

    if (error) throw new Error(`Back upload failed: ${error.message}`);
  }

  return { frontPath, backPath };
}

export async function signImage(path: string, expiresInSeconds = 60 * 60) {
  const { data, error } = await supabase.storage
    .from("card-images")
    .createSignedUrl(path, expiresInSeconds);

  if (error) throw new Error(`Signing failed: ${error.message}`);
  return data.signedUrl;
}

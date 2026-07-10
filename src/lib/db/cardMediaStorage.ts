import { supabase } from "@/lib/supabaseClient";

// Vision Engine V2, Phase 5B: narrowly-scoped Storage helper for the
// private `user-card-media` bucket (see
// supabase/migrations/202607100003_user_card_media_storage.sql). This is
// deliberately not a rewrite of src/lib/db/sharedImages.ts -- that module
// stays exactly as-is for the public, fingerprint-keyed community-image
// feature. This helper only ever handles a single user_card's private
// front/back media, keyed by (profileId, userCardId, side), never by
// card-identity fingerprint.

const BUCKET = "user-card-media";

export type CardMediaSide = "front" | "back";

// Matches the object-path namespace enforced by that migration's RLS
// policies exactly: users/{auth.uid()}/cards/{userCardId}/{side}/processed.webp.
// Kept private so page code can never construct (or mistype) an invalid
// namespace -- every export below takes the identifying fields and builds
// the path itself.
function buildCardMediaObjectPath(
  profileId: string,
  userCardId: string,
  side: CardMediaSide,
): string {
  if (!profileId.trim() || !userCardId.trim()) {
    throw new Error("A profileId and userCardId are required to address card media storage.");
  }
  return `users/${profileId}/cards/${userCardId}/${side}/processed.webp`;
}

// The confirmed cropped image already lives in the browser as a data URL
// (produced by src/lib/image.ts's canvas-based crop/rotate pipeline, always
// image/webp). This converts it to a Blob for upload only -- the data URL
// itself is never written anywhere. Small, self-contained conversion
// (mirrors the equivalent private helper in src/lib/db/sharedImages.ts)
// rather than duplicating that entire module for one utility.
function dataUrlToWebpBlob(dataUrl: string): Blob {
  const [meta, data] = dataUrl.split(",");
  if (!meta || !data || !meta.startsWith("data:")) {
    throw new Error("Expected a data URL for the confirmed card image.");
  }
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/webp" });
}

// Based on @supabase/storage-js's actual StorageError/StorageApiError shape
// (status: number, statusCode: string, message: string) -- not guessed.
// Supabase Storage's remove() already does not error for a missing key in
// practice, so this mainly exists as a defensive backstop for any error
// shape that does describe one as not-found, per the requested removal
// ordering (a missing object must never block metadata cleanup).
function isObjectNotFoundError(
  error: { status?: number; statusCode?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  if (error.status === 404) return true;
  const statusCode = (error.statusCode ?? "").toLowerCase();
  if (statusCode.includes("404") || statusCode.includes("not_found") || statusCode.includes("notfound")) {
    return true;
  }
  const message = (error.message ?? "").toLowerCase();
  return message.includes("not found") || message.includes("does not exist");
}

export type UploadCardMediaImageInput = {
  profileId: string;
  userCardId: string;
  side: CardMediaSide;
  dataUrl: string;
};

export type UploadCardMediaImageResult = {
  path: string;
};

/**
 * Uploads one slot's already-confirmed (cropped) image to its deterministic
 * per-side object path in the private user-card-media bucket, overwriting
 * any previous object for the same card/side (upsert: true), so replacing
 * an image never leaves an abandoned object behind. Returns only the
 * storage object path -- never a display URL or the data URL itself -- so
 * callers can safely persist it as card_media.processed_path. Storage
 * errors are rethrown; they are never swallowed here.
 */
export async function uploadCardMediaImage(
  input: UploadCardMediaImageInput,
): Promise<UploadCardMediaImageResult> {
  const path = buildCardMediaObjectPath(input.profileId, input.userCardId, input.side);
  const blob = dataUrlToWebpBlob(input.dataUrl);

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: true });

  if (error) throw error;

  return { path };
}

export type RemoveCardMediaImageInput = {
  profileId: string;
  userCardId: string;
  side: CardMediaSide;
};

/**
 * Removes exactly one side's storage object. The path is reconstructed
 * internally from (profileId, userCardId, side) rather than accepted as a
 * raw argument, so a caller can never target another card's or side's
 * object by mistake. A missing object is treated as a successful outcome
 * (see isObjectNotFoundError) -- any other Storage error is rethrown, and
 * callers must not delete the matching card_media row unless this resolves
 * without a genuine failure.
 */
export async function removeCardMediaImage(input: RemoveCardMediaImageInput): Promise<void> {
  const path = buildCardMediaObjectPath(input.profileId, input.userCardId, input.side);

  const { error } = await supabase.storage.from(BUCKET).remove([path]);

  if (error && !isObjectNotFoundError(error)) {
    throw error;
  }
}

// 1 hour: long enough to cover a realistic add/edit session (upload, crop,
// review, save) without the signed URL remaining effectively permanent.
const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60;

/**
 * Resolves a stored card_media object path into a temporary signed display
 * URL (the bucket is private, so getPublicUrl is never usable here).
 * Returns null on any failure instead of throwing -- callers in the load
 * path already have a defined fallback for this exact case (the legacy
 * front image, or simply no back image), so null is an explicit, typed
 * signal to use it rather than a swallowed error. The signed URL this
 * returns must never be written back into card_media -- only ever into
 * transient component state for display.
 */
export async function getCardMediaImageUrl(path: string): Promise<string | null> {
  if (!path.trim()) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

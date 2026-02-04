import { createClient } from "@/lib/supabase/client";

export type SharedImage = {
  fingerprint: string;
  dataUrl: string;
  isFront: boolean;
  isSlabbed: boolean;
  createdAt: string;
};

type SharedImageRow = {
  fingerprint: string;
  image_path: string;
  is_front: boolean | null;
  is_slabbed: boolean | null;
  created_at: string;
};

const BUCKET = "card-images";
const TABLE = "shared_images";

function normalizeFingerprint(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function toBase64Url(input: string) {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function encodePath(fingerprint: string) {
  return `shared/${toBase64Url(normalizeFingerprint(fingerprint))}.webp`;
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, data] = dataUrl.split(",");
  const mimeMatch = meta?.match(/data:(.*);base64/);
  const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
  const binary = atob(data);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function toSharedImage(row: SharedImageRow, publicUrl: string): SharedImage {
  return {
    fingerprint: row.fingerprint,
    dataUrl: publicUrl,
    isFront: row.is_front ?? true,
    isSlabbed: row.is_slabbed ?? false,
    createdAt: row.created_at,
  };
}

export async function fetchSharedImagesByFingerprints(
  fingerprints: string[]
): Promise<Record<string, SharedImage>> {
  if (!fingerprints.length) return {};

  const normalized = fingerprints.map((f) => normalizeFingerprint(f));
  const unique = Array.from(new Set([...fingerprints, ...normalized]));

  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("fingerprint, image_path, is_front, is_slabbed, created_at")
    .in("fingerprint", unique);

  if (error || !data) return {};

  const normalizedToOriginals = new Map<string, string[]>();
  for (let i = 0; i < fingerprints.length; i += 1) {
    const orig = fingerprints[i];
    const norm = normalized[i];
    const list = normalizedToOriginals.get(norm);
    if (list) list.push(orig);
    else normalizedToOriginals.set(norm, [orig]);
  }

  const map: Record<string, SharedImage> = {};
  for (const row of data as SharedImageRow[]) {
    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(row.image_path).data.publicUrl;
    const norm = normalizeFingerprint(row.fingerprint);
    const originals = normalizedToOriginals.get(norm) ?? [row.fingerprint];
    for (const orig of originals) {
      map[orig] = toSharedImage(row, publicUrl);
    }
  }
  return map;
}

export async function fetchSharedImage(
  fingerprint: string
): Promise<SharedImage | null> {
  if (!fingerprint) return null;
  const map = await fetchSharedImagesByFingerprints([fingerprint]);
  return map[fingerprint] ?? null;
}

export async function saveSharedImage(entry: SharedImage): Promise<
  | { status: "saved"; path: string }
  | { status: "exists" }
  | { status: "error"; message: string }
> {
  const supabase = createClient();

  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { status: "error", message: "Not authenticated" };
  }

  // Keep first image only: if exists, bail.
  const normalizedFingerprint = normalizeFingerprint(entry.fingerprint);
  const { data: existing, error: existErr } = await supabase
    .from(TABLE)
    .select("fingerprint")
    .eq("fingerprint", normalizedFingerprint)
    .maybeSingle();

  if (existErr) {
    return { status: "error", message: existErr.message };
  }
  if (existing) return { status: "exists" };

  const path = encodePath(entry.fingerprint);
  const blob = dataUrlToBlob(entry.dataUrl);

  const { error: uploadErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: "image/webp", upsert: false });

  if (uploadErr) {
    return { status: "error", message: uploadErr.message };
  }

  const { error: insertErr } = await supabase.from(TABLE).insert({
    fingerprint: normalizedFingerprint,
    image_path: path,
    is_front: entry.isFront,
    is_slabbed: entry.isSlabbed,
    user_id: userData.user.id,
  });

  if (insertErr) {
    return { status: "error", message: insertErr.message };
  }

  return { status: "saved", path };
}

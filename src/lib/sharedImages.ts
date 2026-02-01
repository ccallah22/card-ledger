export type SharedImage = {
  fingerprint: string;
  dataUrl: string;
  isFront: boolean;
  isSlabbed: boolean;
  createdAt: string;
};

const KEY = "card-ledger:shared-images:v1";

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function loadSharedImages(): Record<string, SharedImage> {
  if (typeof window === "undefined") return {};
  const parsed = safeParse<Record<string, SharedImage>>(localStorage.getItem(KEY));
  return parsed && typeof parsed === "object" ? parsed : {};
}

export function getSharedImage(fingerprint: string) {
  if (!fingerprint) return null;
  const map = loadSharedImages();
  return map[fingerprint] ?? null;
}

export function saveSharedImage(entry: SharedImage) {
  if (typeof window === "undefined") return;
  const map = loadSharedImages();
  map[entry.fingerprint] = entry;
  localStorage.setItem(KEY, JSON.stringify(map));
}

export function removeSharedImage(fingerprint: string) {
  if (typeof window === "undefined") return;
  const map = loadSharedImages();
  if (map[fingerprint]) {
    delete map[fingerprint];
    localStorage.setItem(KEY, JSON.stringify(map));
  }
}

export function replaceSharedImages(nextMap: Record<string, SharedImage>) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(nextMap));
    return true;
  } catch {
    return false;
  }
}

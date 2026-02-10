export type SharedImage = {
  fingerprint: string;
  dataUrl: string;
  isFront: boolean;
  isSlabbed: boolean;
  createdAt: string;
};

const KEY = "thebinder:shared-images:v1";
const LEGACY_KEY = "card-ledger:shared-images:v1";

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
  if (parsed && typeof parsed === "object") return parsed;
  const legacy = safeParse<Record<string, SharedImage>>(localStorage.getItem(LEGACY_KEY));
  if (legacy && typeof legacy === "object") {
    try {
      localStorage.setItem(KEY, JSON.stringify(legacy));
      localStorage.removeItem(LEGACY_KEY);
    } catch {
      // ignore migration failures
    }
    return legacy;
  }
  return {};
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
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    return;
  } catch {
    // fall through to eviction
  }

  const entries = Object.entries(map)
    .filter(([key]) => key !== entry.fingerprint)
    .sort((a, b) => b[1].dataUrl.length - a[1].dataUrl.length);

  for (const [key] of entries) {
    delete map[key];
    try {
      localStorage.setItem(KEY, JSON.stringify(map));
      return;
    } catch {
      // keep evicting
    }
  }

  // still too big, drop the new entry
  delete map[entry.fingerprint];
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // no-op
  }
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

export function clearSharedImages() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

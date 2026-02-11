const KEY = "thebinder:images:v1";
const THUMB_KEY = "thebinder:images:thumbs:v1";
const LEGACY_KEY = "card-ledger:images:v1";

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function loadMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const parsed = safeParse<Record<string, string>>(localStorage.getItem(KEY));
  if (parsed && typeof parsed === "object") return parsed;
  const legacy = safeParse<Record<string, string>>(localStorage.getItem(LEGACY_KEY));
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

function saveMap(map: Record<string, string>) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

function loadThumbMap(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const parsed = safeParse<Record<string, string>>(localStorage.getItem(THUMB_KEY));
  if (parsed && typeof parsed === "object") return parsed;
  return {};
}

function saveThumbMap(map: Record<string, string>) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(THUMB_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

export function loadImageMap() {
  return loadMap();
}

export function loadThumbnailMap() {
  return loadThumbMap();
}

export function loadImageForCard(id: string) {
  if (!id) return null;
  const map = loadMap();
  return map[id] ?? null;
}

export function loadThumbnailForCard(id: string) {
  if (!id) return null;
  const map = loadThumbMap();
  return map[id] ?? null;
}

export function saveImageForCard(id: string, dataUrl: string) {
  if (!id || !dataUrl) return;
  const map = loadMap();
  map[id] = dataUrl;
  if (saveMap(map)) return;

  // Evict largest images first to stay within localStorage quota.
  const entries = Object.entries(map)
    .filter(([key]) => key !== id)
    .sort((a, b) => b[1].length - a[1].length);

  for (const [key] of entries) {
    delete map[key];
    if (saveMap(map)) return;
  }

  // If still too large, drop the new image rather than crashing.
  delete map[id];
  saveMap(map);
}

async function generateThumbnail(dataUrl: string) {
  const img = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image."));
  });
  img.src = dataUrl;
  await loaded;

  const maxWidth = 360;
  const maxHeight = 480;
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  const targetW = Math.max(1, Math.round(width * scale));
  const targetH = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to process image.");
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL("image/webp", 0.82);
}

export async function saveThumbnailForCard(id: string, dataUrl: string) {
  if (!id || !dataUrl || typeof window === "undefined") return;
  try {
    const thumb = await generateThumbnail(dataUrl);
    const map = loadThumbMap();
    map[id] = thumb;
    if (saveThumbMap(map)) return;

    const entries = Object.entries(map)
      .filter(([key]) => key !== id)
      .sort((a, b) => b[1].length - a[1].length);

    for (const [key] of entries) {
      delete map[key];
      if (saveThumbMap(map)) return;
    }

    delete map[id];
    saveThumbMap(map);
  } catch {
    // Ignore thumbnail failures.
  }
}

export function removeImageForCard(id: string) {
  if (!id) return;
  const map = loadMap();
  if (map[id]) {
    delete map[id];
    saveMap(map);
  }
  const thumbs = loadThumbMap();
  if (thumbs[id]) {
    delete thumbs[id];
    saveThumbMap(thumbs);
  }
}

export function replaceImageMap(nextMap: Record<string, string>) {
  if (saveMap(nextMap)) return true;

  const map = { ...nextMap };
  const entries = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  for (const [key] of entries) {
    delete map[key];
    if (saveMap(map)) return true;
  }
  return false;
}

export function replaceThumbnailMap(nextMap: Record<string, string>) {
  if (saveThumbMap(nextMap)) return true;

  const map = { ...nextMap };
  const entries = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  for (const [key] of entries) {
    delete map[key];
    if (saveThumbMap(map)) return true;
  }
  return false;
}

export function clearImageStore() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
  localStorage.removeItem(THUMB_KEY);
}

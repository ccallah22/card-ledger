const KEY = "card-ledger:images:v1";

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
  return parsed && typeof parsed === "object" ? parsed : {};
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

export function loadImageMap() {
  return loadMap();
}

export function loadImageForCard(id: string) {
  if (!id) return null;
  const map = loadMap();
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

export function removeImageForCard(id: string) {
  if (!id) return;
  const map = loadMap();
  if (map[id]) {
    delete map[id];
    saveMap(map);
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

export function clearImageStore() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}

import type { SportsCard } from "./types";
import { saveImageForCard } from "./imageStore";

const KEY = "card-ledger:sports-cards:v1";
const LEGACY_KEY = "cards";

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// One-time migration from localStorage["cards"] → KEY
function migrateLegacyOnce() {
  if (typeof window === "undefined") return;

  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return;

    const legacyParsed = safeParse<any[]>(legacyRaw);
    if (!Array.isArray(legacyParsed) || legacyParsed.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }

    const current = safeParse<any[]>(localStorage.getItem(KEY));
    const currentArr = Array.isArray(current) ? current : [];

    const seen = new Set<string>();
    const merged: SportsCard[] = [];

    for (const c of [...legacyParsed, ...currentArr]) {
      const sid = String(c?.id ?? "");
      if (!sid || seen.has(sid)) continue;
      seen.add(sid);

      merged.push({
        ...(c as SportsCard),
        id: sid, // normalize id
      });
    }

    localStorage.setItem(KEY, JSON.stringify(merged));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // never block app
  }
}

export function loadCards(): SportsCard[] {
  if (typeof window === "undefined") return [];

  migrateLegacyOnce();

  const parsed = safeParse<any[]>(localStorage.getItem(KEY));
  if (!Array.isArray(parsed)) return [];

  return parsed.map((c) => ({
    ...(c as SportsCard),
    id: String(c?.id ?? ""),
    status:
      c?.status === "IN_TRANSIT"
        ? "HAVE"
        : (c?.status as SportsCard["status"]) ?? "HAVE",
  }));
}

export function saveCards(cards: SportsCard[]) {
  if (typeof window === "undefined") return;

  const normalized = cards.map((c) => {
    const id = String(c.id);
    const imageUrl = (c as any).imageUrl as string | undefined;
    if (imageUrl) {
      saveImageForCard(id, imageUrl);
    }
    return {
      ...c,
      id,
      imageUrl: undefined,
    };
  });

  localStorage.setItem(KEY, JSON.stringify(normalized));
}

export function upsertCard(card: SportsCard) {
  const cards = loadCards();
  const sid = String(card.id);

  const idx = cards.findIndex((c) => String(c.id) === sid);

  const next: SportsCard = {
    ...card,
    id: sid,
  };

  if (idx >= 0) cards[idx] = next;
  else cards.unshift(next);

  saveCards(cards);
}

export function deleteCard(id: string) {
  const sid = String(id);
  saveCards(loadCards().filter((c) => String(c.id) !== sid));
}

export function getCard(id: string): SportsCard | undefined {
  const sid = String(id);
  return loadCards().find((c) => String(c.id) === sid);
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

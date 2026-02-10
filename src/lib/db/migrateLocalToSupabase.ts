// src/lib/db/migrateLocalToSupabase.ts
import type { SportsCard } from "@/lib/types";
import { dbUpsertCard } from "@/lib/db/cards";

const LOCAL_KEY = "thebinder:sports-cards:v1";
const MIGRATED_FLAG = "thebinder:supabase-migrated:v1";
const LEGACY_LOCAL_KEY = "card-ledger:sports-cards:v1";
const LEGACY_MIGRATED_FLAG = "card-ledger:supabase-migrated:v1";

function safeParse<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export async function migrateLocalCardsToSupabaseOnce(): Promise<{
  migrated: boolean;
  count: number;
}> {
  if (typeof window === "undefined") return { migrated: false, count: 0 };

  // already done
  if (localStorage.getItem(MIGRATED_FLAG) === "1") return { migrated: false, count: 0 };
  if (localStorage.getItem(LEGACY_MIGRATED_FLAG) === "1") {
    localStorage.setItem(MIGRATED_FLAG, "1");
    localStorage.removeItem(LEGACY_MIGRATED_FLAG);
    return { migrated: false, count: 0 };
  }

  let local = safeParse<any[]>(localStorage.getItem(LOCAL_KEY));
  if (!Array.isArray(local)) {
    const legacy = safeParse<any[]>(localStorage.getItem(LEGACY_LOCAL_KEY));
    if (Array.isArray(legacy)) {
      local = legacy;
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(legacy));
        localStorage.removeItem(LEGACY_LOCAL_KEY);
      } catch {
        // ignore migration failures
      }
    }
  }
  const cards = Array.isArray(local) ? (local as SportsCard[]) : [];

  if (!cards.length) {
    localStorage.setItem(MIGRATED_FLAG, "1");
    return { migrated: false, count: 0 };
  }

  // Upsert each card (simple + reliable)
  for (const c of cards) {
    if (!c?.id) continue;
    await dbUpsertCard(c);
  }

  // Mark done. (Optional: clear local store)
  localStorage.setItem(MIGRATED_FLAG, "1");
  localStorage.removeItem(LEGACY_MIGRATED_FLAG);
  // localStorage.removeItem(LOCAL_KEY);

  return { migrated: true, count: cards.length };
}

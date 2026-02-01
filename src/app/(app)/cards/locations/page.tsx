"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SportsCard } from "@/lib/types";
import { loadCards, saveCards } from "@/lib/storage";

function normalize(s?: string) {
  return (s ?? "").trim().toLowerCase();
}

type LocRow = {
  key: string;      // normalized key
  label: string;    // best display label
  count: number;    // how many cards use it
};

export default function LocationsPage() {
  const [cards, setCards] = useState<SportsCard[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({}); // key -> new label
  const [notice, setNotice] = useState<string>("");

  useEffect(() => {
    setCards(loadCards());
  }, []);

  const locations = useMemo<LocRow[]>(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of cards) {
      const raw = (((c as any).location as string | undefined) ?? "").trim();
      if (!raw) continue;

      const key = normalize(raw);
      const prev = map.get(key);
      if (!prev) map.set(key, { label: raw, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [cards]);

  function setEdit(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
  }

  function renameLocation(oldKey: string) {
    const oldLabel = locations.find((l) => l.key === oldKey)?.label ?? "";
    const nextLabel = (edits[oldKey] ?? "").trim();

    if (!oldLabel) return;

    if (!nextLabel) {
      setNotice("Rename value can’t be empty.");
      return;
    }

    if (normalize(nextLabel) === oldKey) {
      setNotice("No change detected.");
      return;
    }

    // Bulk replace on all cards that match oldKey (case-insensitive match)
    const updated = cards.map((c) => {
      const raw = (((c as any).location as string | undefined) ?? "").trim();
      if (!raw) return c;

      if (normalize(raw) !== oldKey) return c;

      return {
        ...(c as any),
        location: nextLabel,
        updatedAt: new Date().toISOString(),
      } as SportsCard;
    });

    saveCards(updated);
    setCards(updated);

    // Clear the edit box for that row
    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[oldKey];
      return copy;
    });

    setNotice(`Renamed "${oldLabel}" → "${nextLabel}".`);
  }

  function clearLocation(oldKey: string) {
    const oldLabel = locations.find((l) => l.key === oldKey)?.label ?? "";
    if (!oldLabel) return;

    const updated = cards.map((c) => {
      const raw = (((c as any).location as string | undefined) ?? "").trim();
      if (!raw) return c;

      if (normalize(raw) !== oldKey) return c;

      const next = { ...(c as any) } as any;
      delete next.location;

      return {
        ...next,
        updatedAt: new Date().toISOString(),
      } as SportsCard;
    });

    saveCards(updated);
    setCards(updated);

    setEdits((prev) => {
      const copy = { ...prev };
      delete copy[oldKey];
      return copy;
    });

    setNotice(`Cleared location "${oldLabel}" from matching cards.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage Locations</h1>
          <p className="text-sm text-zinc-600">Rename locations across your binder.</p>
        </div>

        <Link
          href="/cards"
          className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
        >
          Back to binder
        </Link>
      </div>

      {notice ? (
        <div className="rounded-xl border bg-white p-4 text-sm text-zinc-700">
          {notice}
        </div>
      ) : null}

      {locations.length === 0 ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-zinc-600">
          No locations found yet. Edit a card and add a Location (ex: Binder A / Box 1 / Safe).
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          <div className="grid grid-cols-12 gap-2 border-b bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-600">
            <div className="col-span-4">Location</div>
            <div className="col-span-1 text-right">Cards</div>
            <div className="col-span-5">Rename to</div>
            <div className="col-span-2 text-right">Actions</div>
          </div>

          <ul className="divide-y">
            {locations.map((loc) => (
              <li key={loc.key} className="px-4 py-3">
                <div className="grid grid-cols-12 gap-2 items-center text-sm">
                  <div className="col-span-4 font-medium text-zinc-900">{loc.label}</div>

                  <div className="col-span-1 text-right tabular-nums text-zinc-700">
                    {loc.count}
                  </div>

                  <div className="col-span-5">
                    <input
                      value={edits[loc.key] ?? ""}
                      onChange={(e) => setEdit(loc.key, e.target.value)}
                      placeholder={`Rename "${loc.label}" to...`}
                      className="w-full rounded-md border bg-white px-3 py-2 text-sm"
                    />
                  </div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => renameLocation(loc.key)}
                      className="rounded-md bg-[#2b323a] px-3 py-2 text-xs font-medium text-white hover:bg-[#242a32]"
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => clearLocation(loc.key)}
                      className="rounded-md border bg-white px-3 py-2 text-xs hover:bg-zinc-50"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Tip: Renaming to an existing location will effectively “merge” them (all cards will share the same label).
      </p>
    </div>
  );
}

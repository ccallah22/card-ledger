"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { dbLoadCards, dbUpsertCard } from "@/lib/db/cards";
import { formatCurrency } from "@/lib/format";

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function labelForCard(c: SportsCard) {
  return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
}

export default function ForSalePage() {
  const [cards, setCards] = useState<SportsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const data = await dbLoadCards();
        if (active) setCards(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load cards");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const forSaleCards = useMemo(() => {
    return cards
      .filter((c) => (c.status ?? "HAVE") === "FOR_SALE")
      .slice()
      .sort((a, b) => {
        const ap = a.playerName?.toLowerCase() ?? "";
        const bp = b.playerName?.toLowerCase() ?? "";
        if (ap !== bp) return ap.localeCompare(bp);
        return String(a.year ?? "").localeCompare(String(b.year ?? ""));
      });
  }, [cards]);

  const totals = useMemo(() => {
    const count = forSaleCards.length;
    const totalAsk = forSaleCards.reduce(
      (sum, c) => sum + (asNumber((c as any).askingPrice) ?? 0),
      0
    );
    return { count, totalAsk };
  }, [forSaleCards]);

  const selectedCount = selectedIds.size;
  const allVisibleSelected =
    forSaleCards.length > 0 && forSaleCards.every((c) => selectedIds.has(c.id));
  const someVisibleSelected = forSaleCards.some((c) => selectedIds.has(c.id));

  function toggleSelected(id: string, next?: boolean) {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      const shouldSelect = next ?? !copy.has(id);
      if (shouldSelect) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (allVisibleSelected) {
        forSaleCards.forEach((c) => copy.delete(c.id));
      } else {
        forSaleCards.forEach((c) => copy.add(c.id));
      }
      return copy;
    });
  }

  async function removeSelectedFromForSale() {
    if (!selectedIds.size || bulkBusy) return;
    const confirmed = window.confirm(
      `Remove ${selectedIds.size} card(s) from For Sale?`
    );
    if (!confirmed) return;

    setBulkBusy(true);
    try {
      const updated = cards.map((c) =>
        selectedIds.has(c.id) ? ({ ...c, status: "HAVE" } as SportsCard) : c
      );
      const changed = updated.filter((c, idx) => cards[idx].status !== c.status);
      for (const next of changed) {
        await dbUpsertCard(next);
      }
      setCards(updated);
      setSelectedIds(new Set());
    } catch (e: any) {
      setError(e?.message ?? "Failed to remove selected cards.");
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">For Sale</h1>
          <p className="text-sm text-zinc-600">Cards currently listed for sale.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/cards?forSale=1"
            className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
          >
            Choose From Binder
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Total for sale</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{totals.count}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Total ask</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">
            {formatCurrency(totals.totalAsk)}
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 text-sm font-semibold text-zinc-900">Listed cards</div>
        {selectedCount > 0 ? (
          <div className="flex flex-col gap-2 border-b px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 text-zinc-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                  }}
                  onChange={toggleSelectAllVisible}
                />
                Select all
              </label>
              <span>
                Selected: <span className="font-semibold">{selectedCount}</span>
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={removeSelectedFromForSale}
                disabled={bulkBusy}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              >
                Remove Selected
              </button>
            </div>
          </div>
        ) : null}
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">Loading…</div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">{error}</div>
        ) : forSaleCards.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            No cards marked For Sale yet.
          </div>
        ) : (
          <div className="divide-y">
            {forSaleCards.map((c) => {
              const asking = asNumber((c as any).askingPrice);
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(c.id)}
                      onChange={(e) => toggleSelected(c.id, e.target.checked)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 accent-zinc-900"
                    />
                    <Link href={`/cards/${c.id}`} className="min-w-0 flex-1">
                      <div className="font-medium text-zinc-900">{c.playerName}</div>
                      <div className="text-xs text-zinc-600">{labelForCard(c)}</div>
                      {c.team ? <div className="text-xs text-zinc-500">{c.team}</div> : null}
                    </Link>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs font-semibold text-zinc-900">
                      {typeof asking === "number" ? formatCurrency(asking) : "—"}
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const confirmed = window.confirm(
                          `Remove ${c.playerName} from For Sale?`
                        );
                        if (!confirmed) return;
                        const next: SportsCard = { ...c, status: "HAVE" };
                        try {
                          await dbUpsertCard(next);
                          setCards((prev) =>
                            prev.map((item) => (item.id === c.id ? next : item))
                          );
                        } catch (e: any) {
                          setError(e?.message ?? "Failed to remove from For Sale.");
                        }
                      }}
                      className="rounded-md border px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

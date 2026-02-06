"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { loadCards } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function labelForCard(c: SportsCard) {
  return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
}

export default function ForSalePage() {
  const [cards, setCards] = useState<SportsCard[]>([]);

  useEffect(() => {
    setCards(loadCards());
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">For Sale</h1>
          <p className="text-sm text-zinc-600">Cards currently listed for sale.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/cards"
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
        {forSaleCards.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            No cards marked For Sale yet.
          </div>
        ) : (
          <div className="divide-y">
            {forSaleCards.map((c) => {
              const asking = asNumber((c as any).askingPrice);
              return (
                <Link
                  key={c.id}
                  href={`/cards/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <div>
                    <div className="font-medium text-zinc-900">{c.playerName}</div>
                    <div className="text-xs text-zinc-600">{labelForCard(c)}</div>
                    {c.team ? <div className="text-xs text-zinc-500">{c.team}</div> : null}
                  </div>
                  <div className="text-xs font-semibold text-zinc-900">
                    {typeof asking === "number" ? formatCurrency(asking) : "—"}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

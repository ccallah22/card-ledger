"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { dbLoadCards } from "@/lib/db/cards";

function labelForCard(c: SportsCard) {
  return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
}

export default function WishlistPage() {
  const [cards, setCards] = useState<SportsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  const wishCards = useMemo(() => {
    return cards
      .filter((c) => (c.status ?? "HAVE") === "WANT")
      .slice()
      .sort((a, b) => {
        const ap = a.playerName?.toLowerCase() ?? "";
        const bp = b.playerName?.toLowerCase() ?? "";
        if (ap !== bp) return ap.localeCompare(bp);
        return String(a.year ?? "").localeCompare(String(b.year ?? ""));
      });
  }, [cards]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
          <p className="text-sm text-zinc-600">Cards you want to add to the binder.</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/cards?wishlist=1"
            className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
          >
            Choose From Binder
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-zinc-500">Total wanted</div>
          <div className="mt-1 text-xl font-semibold text-zinc-900">{wishCards.length}</div>
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 text-sm font-semibold text-zinc-900">Wanted cards</div>
        {loading ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">Loading…</div>
        ) : error ? (
          <div className="px-4 py-10 text-center text-sm text-red-600">{error}</div>
        ) : wishCards.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            No wishlist cards yet. Mark a card as Want from the binder.
          </div>
        ) : (
          <div className="divide-y">
            {wishCards.map((c) => (
              <Link
                key={c.id}
                href={`/cards/${c.id}`}
                className="block px-4 py-3 text-sm hover:bg-zinc-50"
              >
                <div className="font-medium text-zinc-900">{c.playerName}</div>
                <div className="text-xs text-zinc-600">{labelForCard(c)}</div>
                {c.team ? <div className="text-xs text-zinc-500">{c.team}</div> : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

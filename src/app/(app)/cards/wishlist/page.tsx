"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SportsCard } from "@/lib/types";
import { dbLoadCards } from "@/lib/db/cards";
import { loadImageForCard } from "@/lib/imageStore";

function labelForCard(c: SportsCard) {
  return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
}

function serialLabel(c: SportsCard) {
  const serialNumber = (c as any).serialNumber as number | undefined;
  const serialTotal = (c as any).serialTotal as number | undefined;
  if (typeof serialNumber === "number" && typeof serialTotal === "number") {
    return `${serialNumber}/${serialTotal}`;
  }
  if (typeof serialTotal === "number") return `/${serialTotal}`;
  return "";
}

function MiniBadge({
  children,
  tone = "gray",
}: {
  children: React.ReactNode;
  tone?: "gray" | "purple" | "amber";
}) {
  const toneClass =
    tone === "purple"
      ? "bg-purple-50 text-purple-700 border-purple-200"
      : tone === "amber"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-zinc-100 text-zinc-700 border-zinc-200";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] ${toneClass}`}>{children}</span>
  );
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Wishlist</h1>
          <p className="text-sm text-zinc-600">Cards you want to add to the binder.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/cards/wishlist/search" className="btn-primary">
            Add to Wishlist
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
          <div className="loading-state">Loading your wishlist…</div>
        ) : error ? (
          <div className="error-state">We couldn’t load your wishlist. {error}</div>
        ) : wishCards.length === 0 ? (
          <div className="empty-state">No wishlist cards yet—add your first one.</div>
        ) : (
          <div className="divide-y">
            {wishCards.map((c) => {
              const variation = (c as any).variation as string | undefined;
              const insert = (c as any).insert as string | undefined;
              const parallel = (c as any).parallel as string | undefined;
              const serial = serialLabel(c);
              const imageUrl =
                loadImageForCard(String(c.id)) ??
                ((c as any).imageUrl as string | undefined) ??
                "";
              return (
                <Link
                  key={c.id}
                  href={`/cards/${c.id}`}
                  className="flex gap-4 px-4 py-3 text-sm hover:bg-zinc-50"
                >
                  <div className="h-[110px] w-[78px] shrink-0 overflow-hidden rounded-md border bg-zinc-50 flex items-center justify-center">
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={`${c.playerName} ${c.cardNumber ?? ""}`.trim()}
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="px-2 text-center text-[10px] text-zinc-500">
                        No image uploaded yet
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-zinc-900">{c.playerName}</div>
                    <div className="text-xs text-zinc-600">{labelForCard(c)}</div>
                    {c.team ? <div className="text-xs text-zinc-500">{c.team}</div> : null}

                    <div className="mt-2 flex flex-wrap gap-1">
                      {variation ? <MiniBadge>{variation}</MiniBadge> : null}
                      {insert ? <MiniBadge>{insert}</MiniBadge> : null}
                      {parallel ? <MiniBadge>{parallel}</MiniBadge> : null}
                      {serial ? <MiniBadge>#{serial}</MiniBadge> : null}
                      {(c as any).isRookie ? (
                        <MiniBadge>
                          <span className="uppercase tracking-wider">Rookie</span>
                        </MiniBadge>
                      ) : null}
                      {(c as any).isAutograph ? <MiniBadge tone="purple">Auto</MiniBadge> : null}
                      {(c as any).isPatch ? <MiniBadge tone="amber">Patch</MiniBadge> : null}
                    </div>

                    {c.notes ? (
                      <div className="mt-2 text-xs text-zinc-500 line-clamp-2">{c.notes}</div>
                    ) : null}
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

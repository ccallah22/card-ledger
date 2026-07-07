"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { getCollectionSummary, type CollectionSummary } from "@/lib/repositories/collectionSummary";
import { listMyCards, type MyCard } from "@/lib/repositories/myCards";
import { Stat } from "@/components/cards/BinderUi";
import { formatCurrency } from "@/lib/format";

const RECENT_ADDITIONS_LIMIT = 5;

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

function formatPercent(n: number) {
  return `${Math.round(n * 100)}%`;
}

function formatDays(n: number) {
  return `${Math.round(n)}d`;
}

function gainTone(n: number): "positive" | "negative" | "neutral" {
  return n > 0 ? "positive" : n < 0 ? "negative" : "neutral";
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [recentCards, setRecentCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const profileId = await requireProfileId();
        const [summaryData, cards] = await Promise.all([
          getCollectionSummary(profileId),
          listMyCards(profileId),
        ]);
        if (active) {
          setSummary(summaryData);
          // listMyCards is already ordered by created_at desc, so this is
          // simply the most-recently-added cards.
          setRecentCards(cards.slice(0, RECENT_ADDITIONS_LIMIT));
        }
      } catch (e: any) {
        if (active) setError(e?.message ?? "Failed to load your dashboard");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const isEmpty =
    !!summary &&
    summary.counts.have +
      summary.counts.forSale +
      summary.counts.wanted +
      summary.counts.sold ===
      0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-zinc-600">An overview of your collection.</p>
      </div>

      {loading ? (
        <div className="loading-state">Loading your dashboard…</div>
      ) : error ? (
        <div className="error-state">We couldn’t load your dashboard. {error}</div>
      ) : isEmpty ? (
        <div className="empty-state">
          Your collection is empty. Add a card to see your dashboard stats.
        </div>
      ) : summary ? (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Collection</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Owned" value={`${summary.counts.have}`} />
              <Stat label="Wishlist" value={`${summary.counts.wanted}`} />
              <Stat label="For Sale" value={`${summary.counts.forSale}`} />
              <Stat label="Sold" value={`${summary.counts.sold}`} />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Financial</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Portfolio Value" value={formatCurrency(summary.financial.portfolioValue)} />
              <Stat label="Total Spent" value={formatCurrency(summary.financial.totalSpent)} />
              <Stat
                label="Unrealized Gain"
                value={formatCurrency(summary.financial.unrealizedNetGain, { accounting: true })}
                tone={gainTone(summary.financial.unrealizedNetGain)}
              />
              <Stat
                label="Realized Gain"
                value={formatCurrency(summary.financial.realizedNet, { accounting: true })}
                tone={gainTone(summary.financial.realizedNet)}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Quality</h2>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Graded" value={`${summary.counts.graded}`} />
              <Stat label="Raw" value={`${summary.counts.raw}`} />
              <Stat
                label="Average Hold Time"
                value={summary.counts.sold > 0 ? formatDays(summary.holdTime.avgDaysToSell) : "—"}
              />
              <Stat
                label="Win Rate"
                value={summary.counts.sold > 0 ? formatPercent(summary.financial.winRate) : "—"}
              />
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold tracking-tight">Recent Additions</h2>
            {recentCards.length === 0 ? (
              <div className="empty-state">No cards added yet.</div>
            ) : (
              <ul className="divide-y rounded-xl border bg-white">
                {recentCards.map((card) => {
                  const primaryParts = [
                    card.year,
                    card.setName,
                    card.cardNumber ? `#${card.cardNumber}` : null,
                  ].filter(Boolean);
                  return (
                    <li key={card.id}>
                      <Link
                        href={`/cards/${card.id}`}
                        className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <div className="font-medium text-zinc-900">{card.playerName}</div>
                        <div className="text-xs text-zinc-500">
                          {[primaryParts.join(" • "), card.status].filter(Boolean).join(" • ")}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

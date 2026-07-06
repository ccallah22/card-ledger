"use client";

import { useEffect, useState } from "react";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { getCollectionSummary, type CollectionSummary } from "@/lib/repositories/collectionSummary";
import { Stat } from "@/components/cards/BinderUi";
import { formatCurrency } from "@/lib/format";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const profileId = await requireProfileId();
        const data = await getCollectionSummary(profileId);
        if (active) setSummary(data);
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
        </>
      ) : null}
    </div>
  );
}

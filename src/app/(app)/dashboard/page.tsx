"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { getCollectionSummary, type CollectionSummary } from "@/lib/repositories/collectionSummary";
import { listMyCards, type MyCard } from "@/lib/repositories/myCards";
import { getNextActions, type NextAction } from "@/lib/repositories/nextActions";
import { getCollectionHealthScore } from "@/lib/repositories/collectionHealth";
import { getDefaultCollectionGoal } from "@/lib/repositories/collectionGoals";
import { getCollectionInsights } from "@/lib/repositories/collectionInsights";
import { Stat, MiniBadge } from "@/components/cards/BinderUi";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
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

function severityBadgeTone(severity: NextAction["severity"]): "amber" | "blue" | "green" {
  return severity === "warning" ? "amber" : severity === "success" ? "green" : "blue";
}

function healthLabel(score: number): string {
  if (score >= 95) return "Excellent";
  if (score >= 80) return "Great";
  if (score >= 65) return "Good";
  if (score >= 50) return "Needs Attention";
  return "Critical";
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<CollectionSummary | null>(null);
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        setError("");
        const profileId = await requireProfileId();
        const [summaryData, cardsData] = await Promise.all([
          getCollectionSummary(profileId),
          listMyCards(profileId),
        ]);
        if (active) {
          setSummary(summaryData);
          setCards(cardsData);
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

  // listMyCards is already ordered by created_at desc, so this is simply
  // the most-recently-added cards.
  const recentCards = useMemo(() => cards.slice(0, RECENT_ADDITIONS_LIMIT), [cards]);

  // Phase 2D.1: highestValueCard/biggestUnrealizedGain/mostCollectedPlayer/
  // mostCollectedSet used to be computed right here in four separate
  // useMemo blocks; that logic (same filters, same tie-break rules, moved
  // unchanged) now lives in the shared collectionInsights.ts repository so
  // a future consumer (Player Hub, Binder) can reuse it instead of
  // recomputing it. This is one pure, synchronous call over the same
  // already-fetched `cards` array -- no new query, no N+1.
  const insights = useMemo(() => getCollectionInsights(cards), [cards]);

  const growthTimeline = useMemo(() => {
    const now = new Date();
    const months: { key: string; label: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("en-US", { month: "short", year: "numeric" });
      months.push({ key, label, count: 0 });
    }
    const byKey = new Map(months.map((m) => [m.key, m]));

    for (const card of cards) {
      if (!card.createdAt) continue;
      const d = new Date(card.createdAt);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.count += 1;
    }

    return months;
  }, [cards]);

  const growthMax = Math.max(1, ...growthTimeline.map((m) => m.count));

  const nextActions = useMemo(() => getNextActions(cards), [cards]);

  const healthScore = useMemo(() => getCollectionHealthScore(cards), [cards]);

  const collectionGoal = useMemo(() => getDefaultCollectionGoal(cards), [cards]);

  const totalCards = summary
    ? summary.counts.have + summary.counts.forSale + summary.counts.wanted + summary.counts.sold
    : 0;

  const isEmpty = !!summary && totalCards === 0;

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
            <SectionHeader title="Collection Health" />
            {healthScore === null ? (
              <div className="empty-state">Add cards to begin tracking your collection health.</div>
            ) : (
              <StatCard
                title="Health Score"
                value={`${healthScore} / 100`}
                subtitle={healthLabel(healthScore)}
              />
            )}
          </section>

          <section className="space-y-2">
            <SectionHeader title="Collection Goal" />
            {collectionGoal === null ? (
              <div className="empty-state">No goals available.</div>
            ) : (
              <div className="rounded-xl border bg-white p-4">
                <div className="font-medium text-zinc-900">{collectionGoal.title}</div>
                <div className="mt-1 text-sm text-zinc-600">{collectionGoal.description}</div>
                <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    {collectionGoal.current} / {collectionGoal.target}
                  </span>
                  <span>{collectionGoal.percent}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${collectionGoal.percent}%` }}
                  />
                </div>
                {collectionGoal.achieved ? (
                  <div className="mt-3 text-sm font-medium text-emerald-700">Goal achieved!</div>
                ) : null}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeader title="Next Actions" />
            {nextActions.length === 0 ? (
              <div className="empty-state">Everything looks great!</div>
            ) : (
              <div className="space-y-2">
                {nextActions.map((action) => {
                  const content = (
                    <>
                      <div className="flex items-center gap-2">
                        <MiniBadge tone={severityBadgeTone(action.severity)}>
                          {action.severity}
                        </MiniBadge>
                        <div className="font-medium text-zinc-900">{action.title}</div>
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">{action.description}</div>
                    </>
                  );
                  return action.href ? (
                    <Link
                      key={action.id}
                      href={action.href}
                      className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div key={action.id} className="block rounded-xl border bg-white p-4">
                      {content}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <SectionHeader title="Collection" />
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Owned" value={`${summary.counts.have}`} />
              <Stat label="Wishlist" value={`${summary.counts.wanted}`} />
              <Stat label="For Sale" value={`${summary.counts.forSale}`} />
              <Stat label="Sold" value={`${summary.counts.sold}`} />
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeader title="Collection Breakdown" />
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat
                label="Owned"
                value={`${summary.counts.have} (${formatPercent(summary.counts.have / totalCards)})`}
              />
              <Stat
                label="Wishlist"
                value={`${summary.counts.wanted} (${formatPercent(summary.counts.wanted / totalCards)})`}
              />
              <Stat
                label="For Sale"
                value={`${summary.counts.forSale} (${formatPercent(summary.counts.forSale / totalCards)})`}
              />
              <Stat
                label="Sold"
                value={`${summary.counts.sold} (${formatPercent(summary.counts.sold / totalCards)})`}
              />
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeader title="Financial" />
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
            <SectionHeader title="Quality" />
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
            <SectionHeader title="Collection Insights" />
            {insights.value.highestValueCard ? (
              <Link
                href={`/cards/${insights.value.highestValueCard.id}`}
                className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
              >
                <div className="text-xs text-zinc-500">Most Valuable Card</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {insights.value.highestValueCard.playerName}
                </div>
                <div className="text-xs text-zinc-500">
                  {[
                    insights.value.highestValueCard.year,
                    insights.value.highestValueCard.setName,
                    insights.value.highestValueCard.cardNumber
                      ? `#${insights.value.highestValueCard.cardNumber}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {formatCurrency(insights.value.highestValueCard.estimatedValue)}
                </div>
              </Link>
            ) : (
              <div className="empty-state">No estimated values available yet.</div>
            )}
            {insights.value.biggestUnrealizedGain ? (
              <Link
                href={`/cards/${insights.value.biggestUnrealizedGain.id}`}
                className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
              >
                <div className="text-xs text-zinc-500">Biggest Unrealized Gain</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {insights.value.biggestUnrealizedGain.playerName}
                </div>
                <div className="text-xs text-zinc-500">
                  {[
                    insights.value.biggestUnrealizedGain.year,
                    insights.value.biggestUnrealizedGain.setName,
                    insights.value.biggestUnrealizedGain.cardNumber
                      ? `#${insights.value.biggestUnrealizedGain.cardNumber}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {formatCurrency(insights.value.biggestUnrealizedGain.gain, { accounting: true })}
                </div>
              </Link>
            ) : (
              <div className="empty-state">No unrealized gains available yet.</div>
            )}
            {insights.value.highestValuePlayer ? (
              <Link
                href={`/players/${insights.value.highestValuePlayer.slug}`}
                className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
              >
                <div className="text-xs text-zinc-500">Highest Value Player</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {insights.value.highestValuePlayer.name}
                </div>
                <div className="text-xs text-zinc-500">
                  {insights.value.highestValuePlayer.cardCount}{" "}
                  {insights.value.highestValuePlayer.cardCount === 1 ? "card" : "cards"}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {formatCurrency(insights.value.highestValuePlayer.totalEstimatedValue)}
                </div>
              </Link>
            ) : (
              <div className="empty-state">No player value data available yet.</div>
            )}
            {insights.players.mostCollectedPlayer ? (
              <div className="block rounded-xl border bg-white p-4">
                <div className="text-xs text-zinc-500">Most Collected Player</div>
                {insights.players.mostCollectedPlayer.slug ? (
                  <Link
                    href={`/players/${insights.players.mostCollectedPlayer.slug}`}
                    className="mt-1 block font-medium text-zinc-900 hover:underline"
                  >
                    {insights.players.mostCollectedPlayer.name}
                  </Link>
                ) : (
                  <div className="mt-1 font-medium text-zinc-900">
                    {insights.players.mostCollectedPlayer.name}
                  </div>
                )}
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {insights.players.mostCollectedPlayer.cardCount}{" "}
                  {insights.players.mostCollectedPlayer.cardCount === 1 ? "card" : "cards"}
                </div>
              </div>
            ) : (
              <div className="empty-state">No player data available yet.</div>
            )}
            {insights.sets.mostCollectedSet ? (
              <div className="block rounded-xl border bg-white p-4">
                <div className="text-xs text-zinc-500">Most Collected Set</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {insights.sets.mostCollectedSet.name}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {insights.sets.mostCollectedSet.cardCount}{" "}
                  {insights.sets.mostCollectedSet.cardCount === 1 ? "card" : "cards"}
                </div>
              </div>
            ) : (
              <div className="empty-state">No set data available yet.</div>
            )}

            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Unique Players" value={`${insights.players.uniquePlayerCount}`} />
              <Stat
                label="Oldest Card"
                value={
                  insights.timeline.oldestCard
                    ? `${insights.timeline.oldestCard.playerName} (${insights.timeline.oldestCard.year})`
                    : "—"
                }
              />
              <Stat
                label="Newest Card"
                value={
                  insights.timeline.newestCard
                    ? `${insights.timeline.newestCard.playerName} (${insights.timeline.newestCard.year})`
                    : "—"
                }
              />
              <Stat
                label="Average Card Age"
                value={totalCards > 0 ? formatDays(summary.age.avgAgeDays) : "—"}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Unique Sets" value={`${insights.sets.uniqueSetCount}`} />
              <Stat
                label="Most Represented Year"
                value={
                  insights.years.mostRepresentedYear
                    ? `${insights.years.mostRepresentedYear.year} (${insights.years.mostRepresentedYear.cardCount})`
                    : "—"
                }
              />
              <Stat
                label="Graded"
                value={
                  insights.grading.gradedPercent !== null
                    ? `${insights.grading.gradedPercent}% (${insights.grading.gradedCount} of ${insights.grading.gradedCount + insights.grading.rawCount})`
                    : "—"
                }
              />
              <Stat
                label="Value Coverage"
                value={
                  insights.value.coverage.coveragePercent !== null
                    ? `${insights.value.coverage.coveragePercent}% (${insights.value.coverage.pricedCardCount} of ${insights.value.coverage.pricedCardCount + insights.value.coverage.unpricedCardCount})`
                    : "—"
                }
              />
            </div>
          </section>

          <section className="space-y-2">
            <SectionHeader title="Recent Additions" />
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

          <section className="space-y-2">
            <SectionHeader title="Collection Growth" />
            <div className="rounded-xl border bg-white p-4">
              <div className="flex h-32 items-end gap-3">
                {growthTimeline.map((month) => {
                  const pct = Math.round((month.count / growthMax) * 100);
                  return (
                    <div
                      key={month.key}
                      className="flex h-full flex-1 flex-col items-center justify-end gap-1"
                    >
                      <div className="text-xs font-medium text-zinc-700">{month.count}</div>
                      <div className="w-full rounded-t bg-blue-500" style={{ height: `${pct}%` }} />
                      <div className="text-xs text-zinc-500">{month.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { getCollectionSummary, type CollectionSummary } from "@/lib/repositories/collectionSummary";
import { listMyCards, type MyCard } from "@/lib/repositories/myCards";
import { getNextActions, type NextAction } from "@/lib/repositories/nextActions";
import { getCollectionHealthScore } from "@/lib/repositories/collectionHealth";
import { getDefaultCollectionGoal } from "@/lib/repositories/collectionGoals";
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

  const mostValuableCard = useMemo(() => {
    const withValue = cards.filter(
      (c): c is MyCard & { estimatedValue: number } =>
        typeof c.estimatedValue === "number" && Number.isFinite(c.estimatedValue)
    );
    if (withValue.length === 0) return null;
    return withValue.reduce((best, c) => {
      if (c.estimatedValue > best.estimatedValue) return c;
      if (c.estimatedValue < best.estimatedValue) return best;
      // Tie on estimated value: prefer the newest created card.
      return (c.createdAt ?? "") > (best.createdAt ?? "") ? c : best;
    });
  }, [cards]);

  const biggestUnrealizedGain = useMemo(() => {
    const withGain = cards
      .filter((c) => c.status !== "SOLD")
      .filter(
        (c): c is MyCard & { estimatedValue: number; purchasePrice: number } =>
          typeof c.estimatedValue === "number" &&
          Number.isFinite(c.estimatedValue) &&
          typeof c.purchasePrice === "number" &&
          Number.isFinite(c.purchasePrice)
      )
      .map((c) => ({ card: c, gain: c.estimatedValue - c.purchasePrice }));
    if (withGain.length === 0) return null;
    return withGain.reduce((best, entry) => {
      if (entry.gain > best.gain) return entry;
      if (entry.gain < best.gain) return best;
      // Tie on gain: prefer the newest created card.
      return (entry.card.createdAt ?? "") > (best.card.createdAt ?? "") ? entry : best;
    });
  }, [cards]);

  const mostCollectedPlayer = useMemo(() => {
    type PlayerAgg = { id: number; name: string; slug: string; count: number; newestCreatedAt: string };
    const byPlayerId = new Map<number, PlayerAgg>();

    const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
    for (const card of qualifyingCards) {
      const seenOnThisCard = new Set<number>();
      for (const player of card.players ?? []) {
        if (seenOnThisCard.has(player.id)) continue;
        seenOnThisCard.add(player.id);

        const existing = byPlayerId.get(player.id);
        const createdAt = card.createdAt ?? "";
        if (!existing) {
          byPlayerId.set(player.id, {
            id: player.id,
            name: player.name,
            slug: player.slug,
            count: 1,
            newestCreatedAt: createdAt,
          });
        } else {
          existing.count += 1;
          if (createdAt > existing.newestCreatedAt) existing.newestCreatedAt = createdAt;
        }
      }
    }

    if (byPlayerId.size === 0) return null;
    return Array.from(byPlayerId.values()).reduce((best, entry) => {
      if (entry.count > best.count) return entry;
      if (entry.count < best.count) return best;
      // Tie on card count: prefer the player whose most recently added card is newest.
      return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
    });
  }, [cards]);

  const mostCollectedSet = useMemo(() => {
    type SetAgg = {
      key: number | string;
      name: string;
      slug?: string;
      count: number;
      newestCreatedAt: string;
    };
    const bySetKey = new Map<number | string, SetAgg>();

    const qualifyingCards = cards.filter((c) => c.status !== "WANT" && c.status !== "SOLD");
    for (const card of qualifyingCards) {
      if (!card.setName) continue;
      const key = card.setId ?? card.setName;
      const createdAt = card.createdAt ?? "";

      const existing = bySetKey.get(key);
      if (!existing) {
        bySetKey.set(key, {
          key,
          name: card.setName,
          slug: card.setSlug,
          count: 1,
          newestCreatedAt: createdAt,
        });
      } else {
        existing.count += 1;
        if (createdAt > existing.newestCreatedAt) existing.newestCreatedAt = createdAt;
      }
    }

    if (bySetKey.size === 0) return null;
    return Array.from(bySetKey.values()).reduce((best, entry) => {
      if (entry.count > best.count) return entry;
      if (entry.count < best.count) return best;
      // Tie on card count: prefer the set whose newest qualifying card is newest.
      return entry.newestCreatedAt > best.newestCreatedAt ? entry : best;
    });
  }, [cards]);

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
            {mostValuableCard ? (
              <Link
                href={`/cards/${mostValuableCard.id}`}
                className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
              >
                <div className="text-xs text-zinc-500">Most Valuable Card</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {mostValuableCard.playerName}
                </div>
                <div className="text-xs text-zinc-500">
                  {[
                    mostValuableCard.year,
                    mostValuableCard.setName,
                    mostValuableCard.cardNumber ? `#${mostValuableCard.cardNumber}` : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {formatCurrency(mostValuableCard.estimatedValue)}
                </div>
              </Link>
            ) : (
              <div className="empty-state">No estimated values available yet.</div>
            )}
            {biggestUnrealizedGain ? (
              <Link
                href={`/cards/${biggestUnrealizedGain.card.id}`}
                className="block rounded-xl border bg-white p-4 hover:bg-zinc-50"
              >
                <div className="text-xs text-zinc-500">Biggest Unrealized Gain</div>
                <div className="mt-1 font-medium text-zinc-900">
                  {biggestUnrealizedGain.card.playerName}
                </div>
                <div className="text-xs text-zinc-500">
                  {[
                    biggestUnrealizedGain.card.year,
                    biggestUnrealizedGain.card.setName,
                    biggestUnrealizedGain.card.cardNumber
                      ? `#${biggestUnrealizedGain.card.cardNumber}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {formatCurrency(biggestUnrealizedGain.gain, { accounting: true })}
                </div>
              </Link>
            ) : (
              <div className="empty-state">No unrealized gains available yet.</div>
            )}
            {mostCollectedPlayer ? (
              <div className="block rounded-xl border bg-white p-4">
                <div className="text-xs text-zinc-500">Most Collected Player</div>
                {mostCollectedPlayer.slug ? (
                  <Link
                    href={`/players/${mostCollectedPlayer.slug}`}
                    className="mt-1 block font-medium text-zinc-900 hover:underline"
                  >
                    {mostCollectedPlayer.name}
                  </Link>
                ) : (
                  <div className="mt-1 font-medium text-zinc-900">{mostCollectedPlayer.name}</div>
                )}
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {mostCollectedPlayer.count} {mostCollectedPlayer.count === 1 ? "card" : "cards"}
                </div>
              </div>
            ) : (
              <div className="empty-state">No player data available yet.</div>
            )}
            {mostCollectedSet ? (
              <div className="block rounded-xl border bg-white p-4">
                <div className="text-xs text-zinc-500">Most Collected Set</div>
                <div className="mt-1 font-medium text-zinc-900">{mostCollectedSet.name}</div>
                <div className="mt-1 text-lg font-semibold text-zinc-900">
                  {mostCollectedSet.count} {mostCollectedSet.count === 1 ? "card" : "cards"}
                </div>
              </div>
            ) : (
              <div className="empty-state">No set data available yet.</div>
            )}
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

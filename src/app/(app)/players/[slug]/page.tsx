"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlayerBySlug, type PlayerWithContext } from "@/lib/repositories/players";
import { listMyCardsForPlayer, type MyCard } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import {
  getPlayerOverview,
  type PlayerOverview,
} from "@/lib/repositories/playerOverview";
import { StatCard } from "@/components/ui/StatCard";
import { PlayerOwnedCardTile } from "@/components/players/PlayerOwnedCardTile";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Same ownership definition PlayerOverview itself uses (HAVE + FOR_SALE,
// excludes WANT/SOLD) -- see playerOverview.ts's isOwnedStatus. Applied here
// as a client-side filter over listMyCardsForPlayer()'s result rather than
// inside that repository function: listMyCardsForPlayer has no status
// filter today and is also used by other current callers that may
// intentionally want every status; changing its own behavior was out of
// scope for this phase (see the Phase 3B report's discrepancy note), so
// "Your Collection" filters the already-fetched result instead of asking
// the repository to filter differently.
function isOwnedForCollectionGrid(card: MyCard): boolean {
  const status = card.status ?? "HAVE";
  return status !== "SOLD" && status !== "WANT";
}

export default function PlayerDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);

  const [loading, setLoading] = useState(true);
  const [player, setPlayer] = useState<PlayerWithContext | null>(null);
  const [missing, setMissing] = useState(false);

  const [overview, setOverview] = useState<PlayerOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(false);

  const [myCards, setMyCards] = useState<MyCard[]>([]);
  const [myCardsLoading, setMyCardsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        const found = await getPlayerBySlug(slug);
        if (!active) return;
        if (!found) {
          setMissing(true);
          return;
        }
        setPlayer(found);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [slug]);

  // Both the overview and the full collection grid are re-fetched fresh on
  // every mount of this page (this component is entirely client-rendered --
  // there is no Next.js server fetch cache in play, and Next 16's default
  // client router-cache staleTime for dynamic routes is 0 with no override
  // in next.config.ts). Returning here after adding a card elsewhere always
  // re-runs this effect from scratch: no manual refresh action, no
  // persisted/cached totals to go stale.
  useEffect(() => {
    if (!player) return;
    let active = true;

    (async () => {
      try {
        setOverviewLoading(true);
        setOverviewError(false);
        const profile = await getCurrentProfile();
        const data = await getPlayerOverview(player.id, profile?.id ?? null);
        if (!active) return;
        if (!data) {
          setOverviewError(true);
          return;
        }
        setOverview(data);
      } catch {
        if (active) setOverviewError(true);
      } finally {
        if (active) setOverviewLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [player]);

  useEffect(() => {
    if (!player) return;
    let active = true;

    (async () => {
      try {
        setMyCardsLoading(true);
        const profile = await getCurrentProfile();
        if (!profile) {
          if (active) setMyCards([]);
          return;
        }
        const found = await listMyCardsForPlayer(profile.id, player.id);
        if (active) setMyCards(found);
      } finally {
        if (active) setMyCardsLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [player]);

  if (missing) {
    notFound();
  }

  if (loading) {
    return <div className="loading-state">Loading player…</div>;
  }

  if (!player) {
    return null;
  }

  const contextParts = [player.team_name, player.league_name, player.sport_name].filter(
    (part): part is string => !!part,
  );

  const ownedCollectionCards = myCards.filter(isOwnedForCollectionGrid);

  return (
    <div className="space-y-6">
      {/* Player header -- identity fields only (name/team/league/sport),
          exactly what PlayerWithContext already carries. No biography,
          career stats, highlights, or photography -- the collection below
          is the hero, per this phase's explicit scope. */}
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{player.full_name}</h1>
        {contextParts.length > 0 ? (
          <p className="text-sm text-zinc-600">{contextParts.join(" • ")}</p>
        ) : null}
      </div>

      {overviewError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          We couldn&apos;t load this player&apos;s collection stats right now. Try again shortly.
        </div>
      ) : overviewLoading || !overview ? (
        <div className="loading-state">Loading collection…</div>
      ) : (
        <>
          {/* Collection summary hero: totalCardsOwned (physical copies) is
              deliberately a separate number from uniqueCatalogCardsOwned
              (what completion is based on) -- shown as this stat's own
              subtitle so duplicate copies are never implied to move
              completion. estimatedValue/completionPercent both render an
              honest unavailable state instead of a misleading $0/0%. */}
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              title="Cards Owned"
              value={overview.collection.totalCardsOwned}
              subtitle={`${overview.collection.uniqueCatalogCardsOwned} unique card${overview.collection.uniqueCatalogCardsOwned === 1 ? "" : "s"}`}
            />
            <StatCard
              title="Estimated Value"
              value={
                overview.collection.estimatedValue != null
                  ? currency(overview.collection.estimatedValue)
                  : "No estimated values yet"
              }
              subtitle={
                overview.collection.estimatedValue != null &&
                overview.collection.unpricedCardCount > 0
                  ? `Based on ${overview.collection.pricedCardCount} of ${
                      overview.collection.pricedCardCount + overview.collection.unpricedCardCount
                    } cards`
                  : undefined
              }
            />
            <StatCard
              title="Catalog Completion"
              value={
                overview.catalog.completionPercent != null
                  ? `${overview.catalog.completionPercent}%`
                  : "Catalog progress unavailable"
              }
              subtitle={
                overview.catalog.totalCatalogCards > 0
                  ? `${overview.catalog.ownedCatalogCards} / ${overview.catalog.totalCatalogCards} unique cards`
                  : undefined
              }
            />
          </div>

          {overview.catalog.completionPercent != null ? (
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between text-sm text-zinc-700">
                <span className="font-medium">Catalog Completion</span>
                <span>{overview.catalog.completionPercent}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-zinc-100">
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${Math.max(0, Math.min(100, overview.catalog.completionPercent))}%`,
                  }}
                />
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {overview.catalog.ownedCatalogCards} / {overview.catalog.totalCatalogCards} unique
                cards
              </div>
            </div>
          ) : null}

          {/* Collection breakdown: plain counts already computed by
              PlayerOverview -- this page classifies nothing itself. */}
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Collection Breakdown</h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              <StatCard title="Graded" value={overview.collection.gradedCount} />
              <StatCard title="Rookies" value={overview.collection.rookieCount} />
              <StatCard title="Autographs" value={overview.collection.autographCount} />
              <StatCard title="Memorabilia" value={overview.collection.memorabiliaCount} />
              <StatCard title="Serial Numbered" value={overview.collection.serialNumberedCount} />
            </div>
          </div>

          {overview.topCards.length > 0 ? (
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Top Cards</h2>
              <div className="mt-2 grid grid-cols-2 gap-4 auto-rows-fr sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {overview.topCards.map((card) => (
                  <PlayerOwnedCardTile key={card.userCardId} card={card} />
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}

      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Your Collection</h2>

        {myCardsLoading ? (
          <div className="loading-state">Loading your cards…</div>
        ) : ownedCollectionCards.length === 0 ? (
          <div className="empty-state">You haven&apos;t added any cards for this player yet.</div>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {ownedCollectionCards.map((card) => {
              const primaryParts = [
                card.year,
                card.setName,
                card.cardNumber ? `#${card.cardNumber}` : null,
                card.insert,
              ].filter(Boolean);
              const secondaryParts = [card.status, card.condition, card.location].filter(Boolean);

              return (
                <li key={card.id}>
                  <Link
                    href={`/cards/${card.id}`}
                    className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <div>{primaryParts.join(" • ")}</div>
                    {secondaryParts.length > 0 ? (
                      <div className="text-xs text-zinc-500">{secondaryParts.join(" • ")}</div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Missing cards: catalog cards this profile doesn't own -- explicitly
          not a wishlist. Read-only in this phase (no Add to Wishlist wiring
          -- see the Phase 3B report). */}
      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight">Missing Cards</h2>
        <p className="text-xs text-zinc-500">Cards you don&apos;t own yet.</p>

        {overviewLoading || !overview ? null : overview.catalog.totalCatalogCards === 0 ? (
          <div className="empty-state">No catalog cards found for this player yet.</div>
        ) : overview.missingCards.length === 0 ? (
          <div className="empty-state">You own every catalog card for this player. Nice.</div>
        ) : (
          <>
            <ul className="divide-y rounded-xl border bg-white">
              {overview.missingCards.map((card) => (
                <li key={card.cardId} className="px-4 py-3 text-sm text-zinc-700">
                  {[
                    card.year,
                    card.setName,
                    card.cardNumber ? `#${card.cardNumber}` : null,
                    card.title,
                  ]
                    .filter(Boolean)
                    .join(" • ")}
                </li>
              ))}
            </ul>
            {overview.catalog.missingCatalogCards > overview.missingCards.length ? (
              <p className="text-xs text-zinc-500">
                Showing {overview.missingCards.length} of {overview.catalog.missingCatalogCards}{" "}
                missing cards.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

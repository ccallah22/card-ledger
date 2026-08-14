"use client";

import { use, useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { getPlayerBySlug, type PlayerWithContext } from "@/lib/repositories/players";
import { listMyCardsForPlayer, type MyCard } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import {
  getPlayerOverview,
  type PlayerOverview,
} from "@/lib/repositories/playerOverview";
import { StatCard } from "@/components/ui/StatCard";
import {
  PlayerOwnedCardTile,
  type PlayerOwnedCardTileCard,
} from "@/components/players/PlayerOwnedCardTile";
import { useUserCardDisplayImages } from "@/hooks/cards/useUserCardDisplayImages";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Same ownership definition PlayerOverview itself uses (HAVE + FOR_SALE,
// excludes WANT/SOLD) -- see playerOverview.ts's isOwnedStatus. Applied here
// as a client-side filter over listMyCardsForPlayer()'s result rather than
// inside that repository function: listMyCardsForPlayer has no status
// filter today and is also used by other current callers that may
// intentionally want every status; changing its own behavior was out of
// scope for Phase 3B/3C (see those reports' discrepancy note), so "Your
// Collection" filters the already-fetched result instead of asking the
// repository to filter differently.
function isOwnedForCollectionGrid(card: MyCard): boolean {
  const status = card.status ?? "HAVE";
  return status !== "SOLD" && status !== "WANT";
}

// MyCard.insert is that same field (see myCards.ts's toMyCard: `insert:
// card?.title ?? undefined`), MyCard.year is a string where
// PlayerOwnedCardSummary.year is a number -- PlayerOwnedCardTileCard.year
// accepts either so this mapping doesn't need to parse/reformat it. No
// PlayerOverview data (value, grading, counts, ranking) is recomputed here
// -- every field below is a direct passthrough of what MyCard/myCards.ts
// already resolved.
function mapMyCardToTileCard(card: MyCard): PlayerOwnedCardTileCard {
  return {
    userCardId: card.id,
    title: card.insert ?? null,
    cardNumber: card.cardNumber ?? "",
    year: card.year || null,
    setName: card.setName || null,
    parallel: card.parallel ?? null,
    grade: card.grade ?? null,
    gradingStatus: card.gradingStatus,
    estimatedValue: card.estimatedValue ?? null,
  };
}

const SUMMARY_SKELETON_KEYS = ["s1", "s2", "s3"];

function StatCardSkeleton() {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="h-3 w-20 animate-pulse rounded bg-zinc-100" />
      <div className="mt-2 h-6 w-16 animate-pulse rounded bg-zinc-100" />
    </div>
  );
}

function TileGridSkeleton({ count }: { count: number }) {
  return (
    <div className="mt-2 grid grid-cols-2 gap-4 auto-rows-fr sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-xl border border-zinc-200 bg-white p-3">
          <div className="aspect-[2.5/3.5] w-full animate-pulse rounded-lg bg-zinc-100" />
          <div className="mt-2 h-3 w-3/4 animate-pulse rounded bg-zinc-100" />
          <div className="mt-1 h-3 w-1/2 animate-pulse rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  );
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

  const ownedCollectionCards = myCards.filter(isOwnedForCollectionGrid);

  // One combined batch resolution for every card image this page displays
  // (Top Cards + Your Collection), called unconditionally (Rules of Hooks)
  // -- an empty/partial array before either source has loaded is fine, the
  // hook just resolves nothing yet. Top Cards' ids are a subset of Your
  // Collection's, but useUserCardDisplayImages/its underlying batch queries
  // already dedupe by id internally, so passing the union here still means
  // exactly one card_media query + one signed-URL request for the whole
  // page, never two separate grids each doing their own batch.
  const topCardUserCardIds = overview?.topCards.map((c) => c.userCardId) ?? [];
  const allDisplayedUserCardIds = [
    ...new Set([...topCardUserCardIds, ...ownedCollectionCards.map((c) => c.id)]),
  ];
  const { imagesByUserCardId, loading: imagesLoading } = useUserCardDisplayImages(
    allDisplayedUserCardIds,
  );

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

  return (
    <div className="space-y-8">
      {/* 1. Player header -- identity fields only (name/team/league/sport),
          exactly what PlayerWithContext already carries. No biography,
          career stats, highlights, or photography -- the collection below
          is the hero, per this phase's explicit scope. */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 break-words sm:text-3xl">
          {player.full_name}
        </h1>
        {contextParts.length > 0 ? (
          <p className="text-sm text-zinc-600">{contextParts.join(" • ")}</p>
        ) : null}
      </div>

      {overviewError ? (
        <div className="error-state">
          We couldn&apos;t load this player&apos;s collection stats right now. Try again shortly.
        </div>
      ) : overviewLoading || !overview ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {SUMMARY_SKELETON_KEYS.map((key) => (
            <StatCardSkeleton key={key} />
          ))}
        </div>
      ) : (
        <>
          {/* 2. Collection summary: totalCardsOwned (physical copies) is
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
                  : "Unavailable"
              }
              subtitle={
                overview.catalog.totalCatalogCards > 0
                  ? `${overview.catalog.ownedCatalogCards} / ${overview.catalog.totalCatalogCards} unique`
                  : undefined
              }
            />
          </div>

          {/* 3. Catalog Completion, expanded into a collecting goal: percent,
              the owned/total unique-card fraction it's built from, and how
              many are left -- all read directly from overview.catalog, no
              new math beyond simple subtraction/clamping for the bar. */}
          {overview.catalog.completionPercent != null ? (
            <div className="rounded-xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900">Catalog Completion</h2>
                <span className="text-2xl font-bold tabular-nums text-zinc-900">
                  {overview.catalog.completionPercent}%
                </span>
              </div>
              <div
                className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-zinc-100"
                role="progressbar"
                aria-valuenow={overview.catalog.completionPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Catalog completion"
              >
                <div
                  className="h-full rounded-full bg-blue-500"
                  style={{
                    width: `${Math.max(0, Math.min(100, overview.catalog.completionPercent))}%`,
                  }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
                <span>
                  {overview.catalog.ownedCatalogCards} of {overview.catalog.totalCatalogCards}{" "}
                  unique cards
                </span>
                <span>
                  {overview.catalog.missingCatalogCards === 0
                    ? "Complete"
                    : `${overview.catalog.missingCatalogCards} remaining`}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border bg-white p-4 text-sm text-zinc-600">
              Catalog progress unavailable -- no catalog cards found for this player yet.
            </div>
          )}

          {/* 4. Top Cards -- the collection's own visual centerpiece. Order
              comes entirely from overview.topCards (value desc, already
              decided by playerOverview.ts); this page only marks index 0 as
              "featured" for a stronger visual treatment, it doesn't re-rank
              anything. */}
          {overview.topCards.length > 0 ? (
            <div>
              <div className="flex items-baseline justify-between">
                <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Top Cards</h2>
                <span className="text-xs text-zinc-500">
                  {overview.topCards.length} of {overview.collection.uniqueCatalogCardsOwned}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-4 auto-rows-fr sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {overview.topCards.map((card, index) => (
                  <PlayerOwnedCardTile
                    key={card.userCardId}
                    card={card}
                    imageUrl={imagesByUserCardId.get(card.userCardId) ?? null}
                    imageLoading={imagesLoading && !imagesByUserCardId.has(card.userCardId)}
                    featured={index === 0}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {/* 5. Collection Breakdown: plain counts already computed by
              PlayerOverview -- this page classifies nothing itself. */}
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
              Collection Breakdown
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
              <StatCard title="Graded" value={overview.collection.gradedCount} />
              <StatCard title="Rookies" value={overview.collection.rookieCount} />
              <StatCard title="Autographs" value={overview.collection.autographCount} />
              <StatCard title="Memorabilia" value={overview.collection.memorabiliaCount} />
              <StatCard title="Serial Numbered" value={overview.collection.serialNumberedCount} />
            </div>
          </div>
        </>
      )}

      {/* 6. Your Collection -- the working area: every owned copy (HAVE +
          FOR_SALE, same semantics as PlayerOverview), image-first via the
          same persisted-media resolver Top Cards uses. */}
      <div>
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Your Collection</h2>
          {!myCardsLoading && ownedCollectionCards.length > 0 ? (
            <span className="text-xs text-zinc-500">
              {ownedCollectionCards.length} card{ownedCollectionCards.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        {myCardsLoading ? (
          <TileGridSkeleton count={5} />
        ) : ownedCollectionCards.length === 0 ? (
          <div className="empty-state mt-2">
            You haven&apos;t added any cards for this player yet.
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-4 auto-rows-fr sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {ownedCollectionCards.map((card) => (
              <PlayerOwnedCardTile
                key={card.id}
                card={mapMyCardToTileCard(card)}
                imageUrl={imagesByUserCardId.get(card.id) ?? null}
                imageLoading={imagesLoading && !imagesByUserCardId.has(card.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 7. Missing from Your Collection: catalog cards this profile doesn't
          own -- explicitly not a wishlist. Deliberately a lighter/subdued
          list (not an image tile grid) so it visually reads as "aspirational
          catalog data," not a second owned-cards surface. Read-only in this
          phase (no Add to Wishlist wiring -- see the Phase 3B report).
          Catalog identity (year/set/#/title) is shown; a rookie marker was
          requested "if available" but PlayerCatalogCardSummary doesn't
          currently carry rookie_card, so it's omitted here rather than
          invented -- see the Phase 3D report. */}
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-zinc-900">
          Missing from Your Collection
        </h2>
        <p className="mt-1 text-xs text-zinc-500">Catalog cards you don&apos;t own yet.</p>

        {overviewLoading || !overview ? (
          <div className="mt-2 loading-state">Loading catalog…</div>
        ) : overview.catalog.totalCatalogCards === 0 ? (
          <div className="empty-state mt-2">No catalog cards found for this player yet.</div>
        ) : overview.missingCards.length === 0 ? (
          <div className="empty-state mt-2">
            You own every catalog card for this player. Nice.
          </div>
        ) : (
          <>
            <ul className="mt-2 divide-y divide-dashed divide-zinc-200 rounded-xl border border-dashed border-zinc-200 bg-zinc-50">
              {overview.missingCards.map((card) => (
                <li key={card.cardId} className="px-4 py-3 text-sm text-zinc-600">
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
              <p className="mt-1 text-xs text-zinc-500">
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

import Link from "next/link";
import type { PlayerOwnedCardTileCard } from "@/components/players/PlayerOwnedCardTile";

// Initial render cap -- "View all N cards" appears below the wall once the
// pool exceeds this, but expansion itself is a future phase (not built
// here). Kept as a named constant, not inlined, so a later "show more"
// feature has one obvious place to change it.
const WALL_LIMIT = 30;

export type PlayerCollectionWallProps = {
  // Already ordered by the caller (newest first, per listMyCardsForPlayer's
  // existing `.order("created_at", { ascending: false })` -- see the Player
  // page's ownedCollectionCards). This component does not re-sort, filter,
  // or paginate beyond its own display cap -- see the "Future extensibility"
  // note below for why.
  cards: PlayerOwnedCardTileCard[];
  imagesByUserCardId: Map<string, string | null>;
  imagesLoading: boolean;
};

/**
 * Collection Wall: a dense, image-first gallery of the user's own card
 * scans -- deliberately NOT another metadata list (the page already has
 * several). Only ever renders an <img> or a placeholder box inside a plain
 * link; no borders, no badges, no price -- the scans themselves carry the
 * visual weight.
 *
 * Reuses the exact same resolved-image map the rest of the page already
 * built via useUserCardDisplayImages (no second media system, no new
 * signed-URL requests of its own) and PlayerOwnedCardTileCard (no second
 * card shape).
 *
 * Future extensibility: `cards` is accepted as a plain ordered array and
 * WALL_LIMIT is the only slicing this component does. A later filter/sort/
 * favorites feature can change what array the caller passes in (or add
 * controls above this component) without this component's own rendering
 * logic changing; a future "fullscreen wall" or "show more" can reuse the
 * same tile markup below rather than inventing a second one.
 */
export function PlayerCollectionWall({
  cards,
  imagesByUserCardId,
  imagesLoading,
}: PlayerCollectionWallProps) {
  if (cards.length === 0) return null;

  const visible = cards.slice(0, WALL_LIMIT);
  const remaining = cards.length - visible.length;

  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Collection Wall</h2>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {visible.map((card) => {
          const imageUrl = imagesByUserCardId.get(card.userCardId) ?? null;
          const loading = imagesLoading && !imagesByUserCardId.has(card.userCardId);
          const label = card.title
            ? `${card.title}${card.cardNumber ? `, card ${card.cardNumber}` : ""}`
            : `Card ${card.cardNumber}`;

          return (
            <Link
              key={card.userCardId}
              href={`/cards/${card.userCardId}`}
              aria-label={label}
              className="group block aspect-[2.5/3.5] overflow-hidden rounded-lg bg-zinc-100 shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2"
            >
              {imageUrl ? (
                // imageUrl is a private, expiring signed Supabase Storage
                // URL (see useUserCardDisplayImages/getCardMediaImageUrls),
                // not a static asset -- next/image would need remote-domain
                // config for a URL that changes per session and per user,
                // which this phase doesn't add. Matches the same intentional
                // <img> choice already made in CardTile.tsx and
                // PlayerOwnedCardTile.tsx for the identical reason.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt={label}
                  className="h-full w-full object-cover transition group-hover:scale-[1.03]"
                  loading="lazy"
                  decoding="async"
                />
              ) : loading ? (
                <div className="h-full w-full animate-pulse bg-zinc-100" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white via-zinc-50 to-zinc-100 text-[9px] text-zinc-400">
                  No image
                </div>
              )}
            </Link>
          );
        })}
      </div>
      {remaining > 0 ? (
        <p className="mt-2 text-xs text-zinc-500">View all {cards.length} cards</p>
      ) : null}
    </div>
  );
}

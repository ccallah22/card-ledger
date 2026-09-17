import Link from "next/link";
import type { PlayerOwnedCardTileCard } from "@/components/players/PlayerOwnedCardTile";
import { FlippableCardImage } from "@/components/cards/FlippableCardImage";

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
  // Binder Card Flip, Phase 1: same shape as imagesByUserCardId, just the
  // user's own persisted back-side card_media, resolved by the caller via
  // useUserCardDisplayImages(ids, "back") -- batched at the page level,
  // never per-tile. A card absent from (or null in) this map is simply not
  // flippable, a normal state, not an error. Optional so a future caller
  // that never wants flipping doesn't have to pass an empty map.
  backImagesByUserCardId?: Map<string, string | null>;
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
  backImagesByUserCardId,
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
          const backUrl = backImagesByUserCardId?.get(card.userCardId) ?? null;
          const label = card.title
            ? `${card.title}${card.cardNumber ? `, card ${card.cardNumber}` : ""}`
            : `Card ${card.cardNumber}`;

          return (
            // Binder Card Flip: previously the whole tile WAS the <a> with
            // the image as its only child. A flip <button> can never
            // validly be a descendant of an <a> (see CardTile.tsx's
            // identical comment), so the <a> is now a separate, invisible,
            // full-tile overlay (z-10) and the visual image lives in a
            // sibling on top of it. `group` moves to this outer wrapper so
            // both the tile hover-lift and the image's own hover-scale
            // (group-hover:scale-[1.03] below) keep working exactly as
            // before -- :hover on an ancestor tracks cursor position within
            // its box regardless of a pointer-events-none descendant.
            <div
              key={card.userCardId}
              className="group relative aspect-[2.5/3.5] overflow-hidden rounded-lg shadow-sm transition duration-150 hover:-translate-y-0.5 hover:shadow-md"
            >
              <Link
                href={`/cards/${card.userCardId}`}
                aria-label={label}
                className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2"
              />
              <div className="pointer-events-none absolute inset-0 bg-zinc-100">
                {imageUrl ? (
                  // imageUrl is a private, expiring signed Supabase Storage
                  // URL (see useUserCardDisplayImages/getCardMediaImageUrls),
                  // not a static asset -- next/image would need remote-domain
                  // config for a URL that changes per session and per user,
                  // which this phase doesn't add. backUrl comes only from
                  // that same resolver's "back" side (see
                  // PlayerCollectionWallProps.backImagesByUserCardId above),
                  // never a community-reference fallback (this wall has
                  // none).
                  // No pointer-events override on the <img> itself:
                  // FlippableCardImage's own flip <button> (rendered only
                  // once backUrl exists) re-enables pointer-events on
                  // itself directly, regardless of this pointer-events-none
                  // ancestor -- see CardTile.tsx's identical comment. With
                  // no back image, the plain <img> must stay click-through
                  // so clicks fall to the stretched Link below.
                  <FlippableCardImage
                    frontUrl={imageUrl}
                    backUrl={backUrl}
                    alt={label}
                    imgClassName="h-full w-full object-cover transition group-hover:scale-[1.03]"
                  />
                ) : loading ? (
                  <div className="h-full w-full animate-pulse bg-zinc-100" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-white via-zinc-50 to-zinc-100 text-[9px] text-zinc-400">
                    No image
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {remaining > 0 ? (
        <p className="mt-2 text-xs text-zinc-500">View all {cards.length} cards</p>
      ) : null}
    </div>
  );
}

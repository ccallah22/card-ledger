"use client";

import { useState } from "react";

export type FlippableCardImageProps = {
  // Already-resolved display URLs only -- this component has no idea where
  // they came from (user_cards/card_media/community-reference/localStorage/
  // etc. are all the caller's concern; see the Binder Card Flip audit).
  // frontUrl is expected whenever this component is rendered at all --
  // every current caller already only renders it once it has a genuine
  // image to show (its own existing "no image yet" placeholder branch stays
  // outside this component). backUrl is null whenever there is genuinely no
  // usable back image (not yet resolved, or the card simply has none) --
  // that is a normal, silent state here, never an error.
  //
  // Caller responsibility, not enforced here: backUrl must come only from
  // the user's own persisted card_media back image, never from a
  // community-reference fallback -- this component has no way to tell the
  // difference and trusts the caller completely.
  frontUrl: string;
  backUrl: string | null;
  alt: string;
  // Applied to the <img> element itself (object-fit, hover-scale
  // transforms, etc. -- every current caller needs a different one). The
  // flip button's own wrapper intentionally has no equivalent prop: its
  // layout is always just "fill the parent," identical across every
  // current caller, so there is nothing caller-specific left for it to
  // accept.
  imgClassName?: string;
};

/**
 * Renders one card's currently-active side (front by default) and, only
 * when a genuine backUrl is supplied, turns the image into an accessible
 * front/back toggle. Presentation + flip state ONLY -- see this component's
 * contract above. It never knows about Supabase, OCR/Vision, catalog
 * candidates, Team, Add Card, community-reference submission, or
 * navigation (it renders a <button>, never a link, and never reads/writes
 * the URL).
 *
 * When backUrl is null, this renders a bare <img> with no wrapper and no
 * click handling at all -- deliberately, so that a caller which places this
 * inside its own click-through/navigation layer (see CardTile.tsx) gets
 * exactly today's "clicking the image navigates, nothing is flippable"
 * behavior for free, with zero navigation-awareness needed here.
 */
export function FlippableCardImage({ frontUrl, backUrl, alt, imgClassName }: FlippableCardImageProps) {
  const [side, setSide] = useState<"front" | "back">("front");

  // If the underlying media identity changes -- a different card's images
  // now occupy this same slot, the back image was removed, a signed URL
  // was re-resolved to something else entirely -- any stale "back"
  // selection is no longer meaningful for whatever is now being displayed.
  // Resetting to front on ANY change to either URL (not just backUrl
  // disappearing) is the simplest rule that can never strand the viewer on
  // an invalid/stale back image, without building a second lifecycle
  // system to track "is this still the same card" itself.
  //
  // Done as a render-time comparison against the previous URLs (React's
  // documented "adjusting state when a prop changes" pattern), not a
  // useEffect + setState: an effect would commit the stale "back" view for
  // one paint before the effect ran and corrected it, and this codebase's
  // own lint rules flag setState-in-an-effect for exactly that cascading-
  // render reason. Comparing during render and calling setState
  // immediately (React discards this render and restarts with the reset
  // state before anything is painted) means the stale view is never shown
  // at all.
  const identityKey = `${frontUrl}|${backUrl ?? ""}`;
  const [lastIdentityKey, setLastIdentityKey] = useState(identityKey);
  if (identityKey !== lastIdentityKey) {
    setLastIdentityKey(identityKey);
    setSide("front");
  }

  if (!backUrl) {
    // src is a signed Supabase Storage URL or a data URL, resolved
    // entirely by the caller; see this file's own doc comment. next/image
    // is intentionally not used here, matching every other card-image
    // rendering in this codebase (CardTile.tsx etc.) for the same reason.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={frontUrl} alt={alt} className={imgClassName} loading="lazy" decoding="async" />
    );
  }

  const activeUrl = side === "back" ? backUrl : frontUrl;

  return (
    <button
      type="button"
      onClick={(e) => {
        // Not strictly required for correctness here -- this button is
        // never a descendant of a caller's navigation <Link> (see
        // CardTile.tsx's stretched-link pattern) -- but kept for
        // consistency with every other on-tile control in this codebase
        // (CardTile's own checkbox/kebab button) and as a defensive
        // backstop against any ancestor click handling a future caller
        // might add.
        e.stopPropagation();
        setSide((prev) => (prev === "front" ? "back" : "front"));
      }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={side === "front" ? `Show back of ${alt}` : `Show front of ${alt}`}
      className="pointer-events-auto block h-full w-full cursor-pointer appearance-none border-0 bg-transparent p-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-accent)] focus-visible:ring-offset-2"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={activeUrl} alt={alt} className={imgClassName} loading="lazy" decoding="async" />
    </button>
  );
}

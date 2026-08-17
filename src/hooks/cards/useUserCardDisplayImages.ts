"use client";

import { useEffect, useState } from "react";
import { listCardMediaForUserCardsBySide } from "@/lib/repositories/cardMedia";
import { getCardMediaImageUrls } from "@/lib/db/cardMediaStorage";
import { loadImageForCard, loadThumbnailForCard } from "@/lib/imageStore";

export type UserCardDisplayImages = {
  // userCardId -> a usable <img src>, or null once resolution has settled
  // and there's genuinely nothing to show (no persisted media, no legacy
  // local image). Absent from the map entirely only before the first
  // resolution pass has run for that id.
  imagesByUserCardId: Map<string, string | null>;
  loading: boolean;
};

/**
 * Batch-resolves one side's display image for a set of owned user_cards:
 * persisted card_media (processed_path, falling back to original_path)
 * outranks the legacy localStorage image (thumbnail, then full) -- the same
 * priority /cards/[id]/edit's existing load effect already established for
 * a single card, just batched here for a grid. Never mutates anything.
 *
 * Not player-specific: takes plain user_card ids, so any owned-card grid
 * (Player Hub's Top Cards/Collection Wall today; Binder/For Sale/Sold/
 * Dashboard/Card Detail's back image later or now) can reuse it as-is.
 * Always batches, even for a single id -- one card_media query plus one
 * signed-URL request for however many ids are passed, never one request per
 * card (see listCardMediaForUserCardsBySide / getCardMediaImageUrls).
 *
 * side defaults to "front" (every existing caller before Card Detail's
 * Phase 2A polish relied on this default and needs no change). Legacy
 * localStorage only ever stored a single, front-only image per card (see
 * imageStore.ts) -- there is no legacy back-image source -- so the
 * synchronous local fallback below only applies when side is "front"; for
 * "back", every id still gets an explicit `null` entry up front so the
 * map's "settled" contract (a present key means resolution has been
 * attempted) holds the same way for both sides.
 */
export function useUserCardDisplayImages(
  userCardIds: string[],
  side: "front" | "back" = "front",
): UserCardDisplayImages {
  const [imagesByUserCardId, setImagesByUserCardId] = useState<Map<string, string | null>>(
    new Map(),
  );
  const [loading, setLoading] = useState(userCardIds.length > 0);
  // Order can vary across renders (filtering/sorting upstream) without the
  // underlying set of ids actually changing -- sorted join avoids
  // re-fetching for a merely-reordered array of the same ids.
  const key = [...userCardIds].sort().join(",");

  useEffect(() => {
    let active = true;
    const ids = key ? key.split(",") : [];

    if (ids.length === 0) {
      setImagesByUserCardId(new Map());
      setLoading(false);
      return;
    }

    setLoading(true);

    const initial = new Map<string, string | null>();
    for (const id of ids) {
      initial.set(id, side === "front" ? loadThumbnailForCard(id) ?? loadImageForCard(id) ?? null : null);
    }
    setImagesByUserCardId(initial);

    (async () => {
      try {
        const media = await listCardMediaForUserCardsBySide(ids, side);
        if (!active) return;

        const pathByUserCardId = new Map<string, string>();
        for (const row of media) {
          const path = row.processedPath ?? row.originalPath;
          if (path) pathByUserCardId.set(row.userCardId, path);
        }

        if (pathByUserCardId.size === 0) return;

        const signedByPath = await getCardMediaImageUrls([...pathByUserCardId.values()]);
        if (!active) return;

        setImagesByUserCardId((prev) => {
          const next = new Map(prev);
          for (const [userCardId, path] of pathByUserCardId) {
            const signedUrl = signedByPath.get(path);
            // A path that failed to sign leaves this id's existing fallback
            // entry (legacy image, or null) untouched rather than clearing it.
            if (signedUrl) next.set(userCardId, signedUrl);
          }
          return next;
        });
      } catch {
        // card_media/storage lookup failed outright -- the synchronous
        // legacy fallback set above is already in state, so the grid still
        // renders usable images/placeholders instead of nothing.
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [key, side]);

  return { imagesByUserCardId, loading };
}

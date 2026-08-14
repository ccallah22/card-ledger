import Link from "next/link";
import { MiniBadge } from "@/components/cards/BinderUi";
import type { GradingStatus } from "@/lib/types";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

// Deliberately its own local shape, not an import of PlayerOverview's
// PlayerOwnedCardSummary: this tile is reused for both Top Cards
// (PlayerOwnedCardSummary, year: number | null) and Your Collection
// (MyCard, year: string) -- see the Player page's mapMyCardToTileCard.
// Coupling this component to one specific caller's type would have forced
// a second near-duplicate tile (or a second media resolver) for the other
// caller, which this phase's instructions explicitly rule out.
export type PlayerOwnedCardTileCard = {
  userCardId: string;
  title: string | null;
  cardNumber: string;
  year: number | string | null;
  setName: string | null;
  parallel: string | null;
  grade: string | null;
  gradingStatus: GradingStatus;
  estimatedValue: number | null;
};

export type PlayerOwnedCardTileProps = {
  card: PlayerOwnedCardTileCard;
  // Resolved by the caller via useUserCardDisplayImages -- this component
  // does not query storage/localStorage itself (see that hook's own
  // comment for the persisted-media-first, legacy-local-fallback priority).
  // null means resolution has settled with nothing to show; imageLoading
  // true means still resolving.
  imageUrl: string | null;
  imageLoading?: boolean;
  // Top Cards' #1 card only -- a visual emphasis (ring + badge), not a new
  // ranking: PlayerOverview.topCards is already ordered value-desc, this
  // just marks the first entry of that existing order.
  featured?: boolean;
};

/**
 * Read-only owned-card tile shared by the Player Collection Hub's Top Cards
 * and Your Collection sections. CardTile (components/cards/CardTile.tsx)
 * doesn't reasonably fit here: it requires a full MyCard plus selection-
 * checkbox/kebab-menu/moderation-report props this read-only context has no
 * use for. This reuses CardTile's actual building block for badges
 * (MiniBadge) instead of reinventing it; image resolution is intentionally
 * NOT this component's job (see PlayerOwnedCardTileProps.imageUrl).
 */
export function PlayerOwnedCardTile({
  card,
  imageUrl,
  imageLoading,
  featured,
}: PlayerOwnedCardTileProps) {
  return (
    <Link
      href={`/cards/${card.userCardId}`}
      className={
        "block h-full rounded-xl border bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md " +
        (featured
          ? "border-[var(--brand-primary)] ring-2 ring-[var(--brand-primary)]/30"
          : "border-zinc-200")
      }
    >
      <div className="relative aspect-[2.5/3.5] w-full overflow-hidden rounded-lg border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 flex items-center justify-center">
        {featured ? (
          <span className="absolute left-1.5 top-1.5 z-10 rounded-full bg-[var(--brand-primary)] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white shadow">
            Top Card
          </span>
        ) : null}
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={
              card.title
                ? `${card.title}${card.cardNumber ? `, card ${card.cardNumber}` : ""}`
                : `Card ${card.cardNumber}`
            }
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
          />
        ) : imageLoading ? (
          <div className="h-full w-full animate-pulse bg-zinc-100" />
        ) : (
          <div className="text-[10px] text-zinc-500 text-center px-2">No image</div>
        )}
      </div>

      <div className="mt-2 space-y-1">
        <div className="text-[10px] uppercase tracking-wide text-zinc-500 break-words">
          {[card.year, card.setName].filter(Boolean).join(" • ")}
        </div>
        <div className="text-[13px] font-semibold leading-snug text-zinc-900 break-words">
          {card.title ?? `Card #${card.cardNumber}`}
        </div>
        {card.cardNumber ? (
          <div className="text-[10px] text-zinc-500">No. {card.cardNumber}</div>
        ) : null}
        <div className="flex flex-wrap gap-1 text-[10px]">
          {card.parallel ? <MiniBadge>{card.parallel}</MiniBadge> : null}
          {card.gradingStatus === "GRADED" ? (
            <MiniBadge tone="green">{card.grade ? `Graded ${card.grade}` : "Graded"}</MiniBadge>
          ) : null}
        </div>
        <div className="text-sm font-semibold tabular-nums text-zinc-900">
          {card.estimatedValue != null ? currency(card.estimatedValue) : "—"}
        </div>
      </div>
    </Link>
  );
}

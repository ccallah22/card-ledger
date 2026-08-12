import Link from "next/link";
import { MiniBadge } from "@/components/cards/BinderUi";
import type { PlayerOwnedCardSummary } from "@/lib/repositories/playerOverview";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export type PlayerOwnedCardTileProps = {
  card: PlayerOwnedCardSummary;
  // Resolved by the caller via useUserCardDisplayImages -- this component
  // does not query storage/localStorage itself (see that hook's own
  // comment for the persisted-media-first, legacy-local-fallback priority).
  // null means resolution has settled with nothing to show; undefined/
  // imageLoading=true means still resolving.
  imageUrl: string | null;
  imageLoading?: boolean;
};

/**
 * Read-only owned-card tile for the Player Collection Hub's Top Cards
 * section. CardTile (components/cards/CardTile.tsx) doesn't reasonably fit
 * here: it requires a full MyCard plus selection-checkbox/kebab-menu/
 * moderation-report props this read-only, summary-shaped context has no use
 * for. This reuses CardTile's actual building block for badges (MiniBadge)
 * instead of reinventing it; image resolution is intentionally NOT this
 * component's job (see PlayerOwnedCardTileProps.imageUrl).
 */
export function PlayerOwnedCardTile({ card, imageUrl, imageLoading }: PlayerOwnedCardTileProps) {
  return (
    <Link
      href={`/cards/${card.userCardId}`}
      className="block h-full rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[2.5/3.5] w-full overflow-hidden rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 flex items-center justify-center">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={card.title ?? `Card ${card.cardNumber}`}
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
        <div className="text-xs tabular-nums text-zinc-600">
          {card.estimatedValue != null ? currency(card.estimatedValue) : "—"}
        </div>
      </div>
    </Link>
  );
}

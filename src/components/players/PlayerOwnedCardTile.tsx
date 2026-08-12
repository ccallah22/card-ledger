import Link from "next/link";
import { MiniBadge } from "@/components/cards/BinderUi";
import { loadImageForCard, loadThumbnailForCard } from "@/lib/imageStore";
import type { PlayerOwnedCardSummary } from "@/lib/repositories/playerOverview";

function currency(n: number) {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

/**
 * Read-only owned-card tile for the Player Collection Hub's Top Cards
 * section. CardTile (components/cards/CardTile.tsx) doesn't reasonably fit
 * here: it requires a full MyCard plus selection-checkbox/kebab-menu/
 * moderation-report props this read-only, summary-shaped context has no use
 * for. This reuses CardTile's actual building blocks instead of reinventing
 * them -- MiniBadge for the same badge styling, and the same
 * loadThumbnailForCard/loadImageForCard(userCardId) localStorage lookup
 * CardTile itself uses for its image (user_cards.image_path/thumb_path are
 * effectively unused by the current Add Card flow, which never sets them --
 * see the Phase 3B report).
 */
export function PlayerOwnedCardTile({ card }: { card: PlayerOwnedCardSummary }) {
  const displayImage =
    loadThumbnailForCard(card.userCardId) ?? loadImageForCard(card.userCardId) ?? "";

  return (
    <Link
      href={`/cards/${card.userCardId}`}
      className="block h-full rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="aspect-[2.5/3.5] w-full overflow-hidden rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 flex items-center justify-center">
        {displayImage ? (
          <img
            src={displayImage}
            alt={card.title ?? `Card ${card.cardNumber}`}
            className="h-full w-full object-contain"
            loading="lazy"
            decoding="async"
          />
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

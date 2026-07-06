import Link from "next/link";
import { IconDots, MiniBadge, type BadgeTone } from "@/components/cards/BinderUi";
import type { MyCard } from "@/lib/repositories/myCards";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";
import { loadImageForCard, loadThumbnailForCard } from "@/lib/imageStore";
import type { SharedImage } from "@/lib/db/sharedImages";

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function currency(n: number) {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, { style: "currency", currency: "USD" });
  return n < 0 ? `-${formatted}` : formatted;
}

function parallelBadgeTone(parallel?: string): BadgeTone | undefined {
  if (!parallel) return undefined;
  const p = parallel.toLowerCase();
  if (p.includes("dots blue")) return "dots-blue";
  if (p.includes("lava")) return "lava";
  if (p.includes("black")) return "black";
  if (p.includes("white")) return "white";
  if (p.includes("silver")) return "silver";
  if (p.includes("gold")) return "gold";
  if (p.includes("red")) return "red";
  if (p.includes("blue")) return "blue";
  if (p.includes("green")) return "green";
  if (p.includes("orange")) return "orange";
  if (p.includes("yellow")) return "yellow";
  if (p.includes("pink")) return "pink";
  if (p.includes("purple")) return "purple";
  if (p.includes("teal")) return "teal";
  return undefined;
}

export type CardTileProps = {
  card: MyCard;
  selected: boolean;
  onToggleSelected: (id: string, checked: boolean) => void;
  sharedImage?: SharedImage | null;
  report?: { reports: number; status?: string };
  onOpenMenu: (e: React.MouseEvent<HTMLButtonElement>, id: string) => void;
};

export function CardTile({
  card: c,
  selected,
  onToggleSelected,
  sharedImage,
  report,
  onOpenMenu,
}: CardTileProps) {
  const status = c.status ?? "HAVE";

  const variation = c.variation;
  const parallel = c.parallel;
  const parallelHasSerial = /\/\d+/.test(parallel ?? "");

  const serialNumber = c.serialNumber;
  const serialTotal = c.serialTotal;

  const serial =
    typeof serialNumber === "number" && typeof serialTotal === "number"
      ? `${serialNumber}/${serialTotal}`
      : typeof serialTotal === "number"
      ? `/${serialTotal}`
      : "";

  const asking = asNumber(c.askingPrice);
  const sold = asNumber(c.soldPrice);

  const insert = (c.insert ?? "").trim();

  const hideImage =
    !!report &&
    (report.status === "blocked" || (report.reports ?? 0) >= REPORT_HIDE_THRESHOLD);

  const storedThumb = loadThumbnailForCard(c.id);
  const storedImage = loadImageForCard(c.id);
  const displayImage = hideImage ? "" : storedThumb ?? storedImage ?? sharedImage?.dataUrl ?? "";

  const rowHref = `/cards/${c.id}`;

  const est = asNumber(c.estimatedValue);
  const priceLabel =
    status === "SOLD" && typeof sold === "number"
      ? currency(sold)
      : status === "FOR_SALE" && typeof asking === "number"
      ? currency(asking)
      : typeof est === "number"
      ? currency(est)
      : "—";

  return (
    <div className="relative">
      <div className="absolute left-2 top-2 z-20">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelected(c.id, e.target.checked)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="h-4 w-4 accent-zinc-900"
        />
      </div>
      <Link
        href={rowHref}
        className="block h-full rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="p-3 h-full flex flex-col">
          <div className="flex flex-1 min-h-0 flex-col gap-2 rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-2 sm:aspect-[2.5/3.5] overflow-hidden">
            <div className="flex-1 min-h-0 w-full rounded-md border border-zinc-200 bg-white/70 flex items-center justify-center overflow-hidden sm:aspect-[2.5/3.5]">
              {displayImage ? (
                <img
                  src={displayImage}
                  alt={`${c.playerName} ${c.cardNumber ?? ""}`.trim()}
                  className="h-full w-full object-contain"
                  loading="lazy"
                  decoding="async"
                />
              ) : hideImage ? (
                <div className="text-[10px] text-zinc-500 text-center px-2">
                  Image hidden (reported)
                </div>
              ) : (
                <div className="text-[10px] text-zinc-500 text-center px-2">No image</div>
              )}
            </div>

            <div className="sm:hidden">
              <div className="truncate text-sm font-semibold text-zinc-900">{c.playerName}</div>
            </div>

            <div className="hidden sm:block space-y-1">
              <div className="text-[10px] uppercase tracking-wide text-zinc-500 break-words">
                {c.year} • {c.setName}
              </div>
              <div className="text-[13px] font-semibold leading-snug text-zinc-900 break-words">
                {c.playerName}
              </div>
              {c.cardNumber ? (
                <div className="text-[10px] text-zinc-500">No. {c.cardNumber}</div>
              ) : null}
              {c.team ? (
                <div className="text-[10px] text-zinc-500 break-words">{c.team}</div>
              ) : null}
              <div className="flex flex-wrap gap-1 text-[10px]">
                {variation ? <MiniBadge>{variation}</MiniBadge> : null}
                {insert ? <MiniBadge>{insert}</MiniBadge> : null}
                {parallel ? (
                  <MiniBadge tone={parallelBadgeTone(parallel)}>{parallel}</MiniBadge>
                ) : null}
                {serial && !parallelHasSerial ? <MiniBadge>#{serial}</MiniBadge> : null}
                {c.isRookie ? (
                  <MiniBadge>
                    <span className="uppercase tracking-wider">Rookie</span>
                  </MiniBadge>
                ) : null}
                {c.isAutograph ? <MiniBadge tone="purple">Auto</MiniBadge> : null}
                {c.isPatch ? <MiniBadge tone="amber">Patch</MiniBadge> : null}
              </div>
            </div>
          </div>

          <div className="mt-2 hidden sm:flex items-center justify-between text-xs">
            <span className="tabular-nums text-zinc-600">{priceLabel}</span>
          </div>
        </div>
      </Link>

      {/* Kebab button (does NOT navigate) */}
      <div className="absolute right-2 top-2 z-20" data-row-menu>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenMenu(e, c.id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="rounded-full bg-white/90 p-2 text-zinc-600 shadow-sm hover:bg-white hover:text-zinc-900"
          aria-label="Row actions"
          title="Actions"
        >
          <IconDots />
        </button>
      </div>
    </div>
  );
}

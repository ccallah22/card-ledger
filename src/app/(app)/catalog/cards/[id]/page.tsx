"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCardWithContext, type CardWithContext } from "@/lib/repositories/cards";
import { listCardVariantsForCard, type CardVariantSummary } from "@/lib/repositories/cardVariants";
import { MiniBadge } from "@/components/cards/BinderUi";

// listCardVariantsForCard's query has no ORDER BY, so its result order is
// not deterministic -- and it's shared with Add Card's variant picker
// (cards/new/page.tsx), so sorting isn't added to the repository query
// itself; that would change Add Card's dropdown order too, out of scope
// for this page. A simple, defensible display order local to this page:
// parallel name (nulls/"Base" first), then print run, then swatch
// descriptor -- no rarity ranking.
function compareVariantsForDisplay(a: CardVariantSummary, b: CardVariantSummary): number {
  const nameCompare = (a.parallelName ?? "").localeCompare(b.parallelName ?? "");
  if (nameCompare !== 0) return nameCompare;
  const runCompare = (a.printRun ?? 0) - (b.printRun ?? 0);
  if (runCompare !== 0) return runCompare;
  return (a.swatchDescriptor ?? "").localeCompare(b.swatchDescriptor ?? "");
}

export default function CatalogCardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [loading, setLoading] = useState(true);
  const [card, setCard] = useState<CardWithContext | null>(null);
  const [missing, setMissing] = useState(false);

  // Kept entirely independent of the base card's own loading/missing state
  // above: variants are a secondary, optional dataset for this page, so a
  // failure here must not take down (or block) the base card detail, which
  // is useful on its own even with no variant information at all.
  const [variants, setVariants] = useState<CardVariantSummary[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(true);
  const [variantsError, setVariantsError] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        setLoading(true);
        const numericId = Number(id);
        const found = Number.isFinite(numericId) ? await getCardWithContext(numericId) : null;
        if (!active) return;
        if (!found) {
          setMissing(true);
          return;
        }
        setCard(found);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!card) return;
    let active = true;

    setVariantsLoading(true);
    setVariantsError(false);
    listCardVariantsForCard(card.id)
      .then((rows) => {
        if (active) setVariants([...rows].sort(compareVariantsForDisplay));
      })
      .catch(() => {
        if (active) setVariantsError(true);
      })
      .finally(() => {
        if (active) setVariantsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [card]);

  if (missing) {
    notFound();
  }

  if (loading) {
    return <div className="loading-state">Loading card…</div>;
  }

  if (!card) {
    return null;
  }

  const subtitleParts = [card.releaseYear, card.setName].filter(Boolean);

  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">
        {card.title || `Card #${card.cardNumber}`}
      </h1>
      {subtitleParts.length > 0 ? (
        <p className="text-sm text-zinc-600">{subtitleParts.join(" • ")}</p>
      ) : null}

      {/* This starts the existing Add Card workflow with catalog identity
          preselected -- it does not create a user_card, mark this catalog
          card owned, wishlist it, or list it for sale. Nothing is written
          until the collector completes and saves the Add Card form
          themselves, exactly as if they'd found this same card by manual
          lookup there. */}
      <div className="mt-4">
        <Link href={`/cards/new?catalogCardId=${card.id}`} className="btn-primary">
          Add to My Collection
        </Link>
      </div>

      <div className="mt-4 space-y-1 text-sm text-zinc-700">
        <div>Card #: {card.cardNumber}</div>
        {card.setBrand ? <div>Brand: {card.setBrand}</div> : null}
        {card.setManufacturer ? <div>Manufacturer: {card.setManufacturer}</div> : null}
        {card.playerNames.length > 0 ? (
          <div>Players: {card.playerNames.join(", ")}</div>
        ) : null}
        {card.rookieCard ? <div>Rookie Card</div> : null}
        {card.isInsert ? <div>Insert</div> : null}
        {card.isAutograph ? <div>Autograph</div> : null}
        {card.isMemorabilia ? <div>Memorabilia</div> : null}
      </div>

      {/* This base card vs. its known variants/parallels -- never a
          collector's owned physical copy. Nothing here implies ownership;
          "Add to My Collection" above (unchanged) is still the only path
          from this page into the collector's own binder, and the variant
          picker there is still where a specific variant gets attached to a
          saved copy. */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold text-zinc-900">Variants / Parallels</h2>
        <p className="mt-0.5 text-xs text-zinc-600">
          {variantsLoading
            ? "Loading variants…"
            : variantsError
            ? "We couldn't load variants for this card right now."
            : variants.length > 0
            ? `${variants.length} known variant${variants.length === 1 ? "" : "s"}`
            : "No variants are currently recorded for this card."}
        </p>

        {!variantsLoading && !variantsError && variants.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {variants.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-zinc-900">{v.parallelName ?? "Base"}</span>
                {v.printRun ? <MiniBadge>/{v.printRun}</MiniBadge> : null}
                {v.swatchDescriptor ? <MiniBadge>{v.swatchDescriptor}</MiniBadge> : null}
                {v.hasAutograph ? (
                  <MiniBadge tone="purple">
                    <span title="Autograph">Auto</span>
                  </MiniBadge>
                ) : null}
                {v.hasMemorabilia ? (
                  <MiniBadge tone="amber">
                    <span title="Memorabilia / relic">Patch</span>
                  </MiniBadge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

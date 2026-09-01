import { useEffect, useMemo, useState } from "react";
import { listCardVariantsForCard, type CardVariantSummary } from "@/lib/repositories/cardVariants";

/**
 * Catalog v2 variant/parallel lookup for the card creation form: loads a
 * card's variants (listCardVariantsForCard) whenever the selected card's id
 * changes, and exposes a query/setQuery pair for filtering that list by
 * parallel name, swatch descriptor, or print run. Selecting a variant only
 * updates local state here -- callers decide whether/how to use it (see
 * cards/new/page.tsx, which fills the existing Parallel/autograph/
 * memorabilia fields from it, but does not otherwise change save logic).
 */
export function useCatalogVariantLookup(cardId: number | null) {
  const [variants, setVariants] = useState<CardVariantSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedVariant, setSelectedVariant] = useState<CardVariantSummary | null>(null);

  // Render-time reset (React's documented "adjusting state when a prop
  // changes" pattern) instead of a synchronous setState-in-effect: the
  // moment cardId changes, the previous card's selected variant, query, and
  // stale variants disappear in the same render pass, before paint -- no
  // flash of a stale/wrong-card list, and no separate effect render just to
  // reset. `loading` is also decided here (true only when there's a new
  // card id to actually fetch) so the effect below never needs a
  // synchronous setState of its own -- only the promise callbacks (already
  // exempt from this lint rule) touch state from inside it.
  const [prevCardId, setPrevCardId] = useState(cardId);
  if (cardId !== prevCardId) {
    setPrevCardId(cardId);
    setSelectedVariant(null);
    setQuery("");
    setVariants([]);
    setLoading(!!cardId);
  }

  useEffect(() => {
    if (!cardId) return;

    let active = true;
    listCardVariantsForCard(cardId)
      .then((rows) => {
        if (active) setVariants(rows);
      })
      .catch(() => {
        if (active) setVariants([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [cardId]);

  const filteredVariants = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return variants;
    return variants.filter(
      (v) =>
        (v.parallelName ?? "").toLowerCase().includes(trimmed) ||
        (v.swatchDescriptor ?? "").toLowerCase().includes(trimmed) ||
        (v.printRun != null && String(v.printRun).includes(trimmed)),
    );
  }, [variants, query]);

  return {
    variants: filteredVariants,
    loading,
    query,
    setQuery,
    selectedVariant,
    setSelectedVariant,
  };
}

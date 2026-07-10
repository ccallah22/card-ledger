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

  useEffect(() => {
    let active = true;
    setSelectedVariant(null);
    setQuery("");

    if (!cardId) {
      setVariants([]);
      return;
    }

    setLoading(true);
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

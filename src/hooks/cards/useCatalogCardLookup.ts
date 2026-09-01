import { useEffect, useMemo, useState } from "react";
import { listCardsForChecklistSection, type CardSummary } from "@/lib/repositories/cards";

/**
 * Catalog v2 card lookup for the card creation form: loads a checklist
 * section's cards (listCardsForChecklistSection) whenever the selected
 * section's id changes, and exposes a query/setQuery pair for filtering
 * that list by card number or title. Selecting a card only updates local
 * state here -- callers decide whether/how to use it (see
 * cards/new/page.tsx, which does not wire this into save behavior yet).
 */
export function useCatalogCardLookup(checklistSectionId: number | null) {
  const [cards, setCards] = useState<CardSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardSummary | null>(null);

  // Render-time reset (React's documented "adjusting state when a prop
  // changes" pattern) instead of a synchronous setState-in-effect: the
  // moment checklistSectionId changes, the previous section's selection,
  // query, and stale cards disappear in the same render pass, before
  // paint -- no flash of a stale/wrong-section list, and no separate effect
  // render just to reset. `loading` is also decided here (true only when
  // there's a new section id to actually fetch) so the effect below never
  // needs a synchronous setState of its own -- only the promise callbacks
  // (already exempt from this lint rule) touch state from inside it.
  const [prevChecklistSectionId, setPrevChecklistSectionId] = useState(checklistSectionId);
  if (checklistSectionId !== prevChecklistSectionId) {
    setPrevChecklistSectionId(checklistSectionId);
    setSelectedCard(null);
    setQuery("");
    setCards([]);
    setLoading(!!checklistSectionId);
  }

  useEffect(() => {
    if (!checklistSectionId) return;

    let active = true;
    listCardsForChecklistSection(checklistSectionId)
      .then((rows) => {
        if (active) setCards(rows);
      })
      .catch(() => {
        if (active) setCards([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [checklistSectionId]);

  const filteredCards = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return cards;
    return cards.filter(
      (c) =>
        c.card_number.toLowerCase().includes(trimmed) ||
        (c.title ?? "").toLowerCase().includes(trimmed),
    );
  }, [cards, query]);

  return {
    cards: filteredCards,
    loading,
    query,
    setQuery,
    selectedCard,
    setSelectedCard,
  };
}

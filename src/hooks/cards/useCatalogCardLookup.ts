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

  useEffect(() => {
    let active = true;
    setSelectedCard(null);
    setQuery("");

    if (!checklistSectionId) {
      setCards([]);
      return;
    }

    setLoading(true);
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

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchCatalog, type CardWithContext } from "@/lib/repositories/cards";

export function CatalogSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [cards, setCards] = useState<CardWithContext[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let active = true;

    (async () => {
      const trimmed = debouncedQuery.trim();
      if (!trimmed) {
        setCards([]);
        setError("");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const data = await searchCatalog(trimmed);
        if (active) setCards(data);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to search cards.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Search Catalog</h2>
        <p className="text-sm text-muted-foreground">
          Search the shared card catalog by title, card number, or set.
        </p>
      </div>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Search catalog cards..."
      />

      <div className="mt-6 space-y-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading cards…</p>
        ) : error ? (
          <p className="text-sm text-red-600">Could not load cards. {error}</p>
        ) : !debouncedQuery.trim() ? (
          <p className="text-sm text-muted-foreground">Start typing to search the catalog.</p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cards found.</p>
        ) : (
          <ul className="divide-y rounded-xl border bg-white">
            {cards.map((card) => {
              const parts = [
                card.releaseYear,
                card.setName,
                card.cardNumber ? `#${card.cardNumber}` : null,
              ].filter(Boolean);

              return (
                <li key={card.id}>
                  <Link
                    href={`/catalog/cards/${card.id}`}
                    className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    <div className="font-medium text-zinc-900">
                      {card.title || `Card #${card.cardNumber}`}
                    </div>
                    {parts.length > 0 ? (
                      <div className="text-xs text-zinc-500">{parts.join(" • ")}</div>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

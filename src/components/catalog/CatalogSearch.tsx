"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchCatalog } from "@/lib/repositories/cards";
import { searchPlayers } from "@/lib/repositories/players";
import { searchSets } from "@/lib/repositories/sets";
import {
  playerToSearchResult,
  setToSearchResult,
  cardToSearchResult,
} from "@/lib/search/toSearchResult";
import { groupSearchResultsByKind, type SearchResult } from "@/lib/search/searchResultTypes";

// Phase 2C.2: small, explicit per-section caps so no one category can push
// the others off the screen. The underlying repositories already cap
// higher (25 each) for their own existing callers (PlayerExplorer, the Add
// Card set-lookup autocomplete) -- these are a stricter, UI-local slice on
// top of that, not a change to any repository's own limit.
const PLAYER_RESULT_CAP = 5;
const SET_RESULT_CAP = 5;
const CARD_RESULT_CAP = 15;

export function CatalogSearch() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  // One settled query drives all three searches together -- Promise.all,
  // not three independent debounce timers. The existing active-flag
  // pattern (unchanged from before this phase) already protects against a
  // slow earlier query overwriting a newer one: a fast second keystroke
  // schedules a new effect run whose cleanup sets the PREVIOUS run's
  // `active` to false before the new run starts, so a stale response
  // arriving late finds `active === false` and is discarded, regardless of
  // which of the three requests inside it was slow.
  //
  // Promise.all also means one category failing fails the whole cycle (no
  // partial results, one error message) -- the simpler of the two options
  // this phase's instructions explicitly allowed, chosen over
  // Promise.allSettled's per-category partial-failure handling to avoid
  // adding complexity this phase doesn't need.
  useEffect(() => {
    let active = true;

    (async () => {
      const trimmed = debouncedQuery.trim();
      if (!trimmed) {
        setResults([]);
        setError("");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError("");
        const [players, sets, cards] = await Promise.all([
          searchPlayers(trimmed),
          searchSets(trimmed),
          searchCatalog(trimmed),
        ]);
        if (!active) return;

        const combined: SearchResult[] = [
          ...players.slice(0, PLAYER_RESULT_CAP).map(playerToSearchResult),
          ...sets.slice(0, SET_RESULT_CAP).map(setToSearchResult),
          ...cards.slice(0, CARD_RESULT_CAP).map(cardToSearchResult),
        ];
        setResults(combined);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Failed to search.");
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [debouncedQuery]);

  // Reuses the shared groupSearchResultsByKind as-is -- no second grouping
  // model, no duplicated adapter logic. Pure/synchronous over at most 25
  // already-fetched results, cheap enough to call directly in render
  // without memoizing.
  const grouped = groupSearchResultsByKind(results);

  return (
    <div className="rounded-lg border bg-card p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Search Catalog</h2>
        <p className="text-sm text-muted-foreground">
          Search players, sets, and cards in the shared catalog.
        </p>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border bg-background px-3 py-2 text-base sm:text-sm"
        placeholder="Search players, sets, or cards..."
        aria-label="Search players, sets, or cards"
      />

      <div className="mt-6 space-y-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading results…</p>
        ) : error ? (
          <p className="text-sm text-red-600">Could not load results. {error}</p>
        ) : !debouncedQuery.trim() ? (
          <p className="text-sm text-muted-foreground">Start typing to search the catalog.</p>
        ) : results.length === 0 ? (
          // Reached only on a genuinely completed, non-empty-query search
          // that matched nothing at all -- loading/error/blank-query each
          // return their own branch above this one, and `results` is the
          // flat combined players+sets+cards array, so even one match in
          // any single category already skips this branch entirely. Not
          // found here doesn't mean the collector did anything wrong, and
          // manual Add Card is a fully supported path, not a last resort --
          // the copy is written to reflect both. Deliberately a plain link
          // to /cards/new with no query string: Add Card has no existing
          // free-text-prefill parameter, and inventing one to carry this
          // query over would mean parsing an arbitrary typed phrase into
          // player/year/set/card-number fields, which is neither tiny nor
          // unambiguous -- a clean direct link is enough for this phase.
          <div className="rounded-xl border bg-white p-4">
            <p className="text-sm text-zinc-700">No catalog matches found.</p>
            <p className="mt-1 text-sm text-zinc-600">
              If this card isn&apos;t in TheBinder yet, you can still add it manually.
            </p>
            <Link href="/cards/new" className="btn-primary mt-3">
              Add Card Manually
            </Link>
          </div>
        ) : (
          <>
            {grouped.player.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Players ({grouped.player.length})
                </h3>
                <ul className="mt-2 divide-y rounded-xl border bg-white">
                  {grouped.player.map((result) => (
                    <li key={result.id}>
                      <Link
                        href={result.href}
                        className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <div className="font-medium text-zinc-900">{result.label}</div>
                        {result.sublabel ? (
                          <div className="text-xs text-zinc-500">{result.sublabel}</div>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {grouped.set.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Sets ({grouped.set.length})
                </h3>
                {/* No set-detail route exists in the app today (confirmed --
                    there is no /catalog/sets/[id] or similar). Rather than
                    link to a route that doesn't meaningfully represent this
                    set, or invent a new one (explicitly out of scope this
                    phase), each set result re-runs this same search using
                    the set's own name as the query -- reusing the existing
                    search pipeline already on this page (searchCatalog
                    already matches set name/text) rather than a dead or
                    misleading link. */}
                <ul className="mt-2 divide-y rounded-xl border bg-white">
                  {grouped.set.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => setQuery(result.label)}
                        className="block w-full px-4 py-3 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <div className="font-medium text-zinc-900">{result.label}</div>
                        {result.sublabel ? (
                          <div className="text-xs text-zinc-500">{result.sublabel}</div>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {grouped.card.length > 0 ? (
              <section>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Cards ({grouped.card.length})
                </h3>
                <ul className="mt-2 divide-y rounded-xl border bg-white">
                  {grouped.card.map((result) => (
                    <li key={result.id}>
                      <Link
                        href={result.href}
                        className="block px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50"
                      >
                        <div className="font-medium text-zinc-900">{result.label}</div>
                        {result.sublabel ? (
                          <div className="text-xs text-zinc-500">{result.sublabel}</div>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { searchSets } from "@/lib/repositories/sets";

export type SetSuggestion = {
  year: string;
  name: string;
  brand?: string;
  sport?: string;
  checklistKey?: string;
};

/**
 * Set search/suggestion state for the card creation form: debounced
 * searchSets(query) lookup, scored/sorted suggestions, and the fill
 * behavior when a suggestion is selected (fills year/setName, updates the
 * query text, and hides the dropdown).
 */
export function useSetLookup({
  setYear,
  setSetName,
}: {
  setYear: (v: string) => void;
  setSetName: (v: string) => void;
}) {
  const [setQuery, setSetQuery] = useState("");
  const [showSetResults, setShowSetResults] = useState(false);
  const [setEntries, setSetEntries] = useState<SetSuggestion[]>([]);

  // Debounce the network lookup so we don't fire a query on every keystroke,
  // matching the pattern already used for player search (PlayerExplorer).
  const [debouncedSetQuery, setDebouncedSetQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSetQuery(setQuery), 150);
    return () => clearTimeout(t);
  }, [setQuery]);

  useEffect(() => {
    let active = true;
    const trimmed = debouncedSetQuery.trim();

    if (!trimmed) {
      setSetEntries([]);
      return;
    }

    searchSets(trimmed)
      .then((sets) => {
        if (!active) return;
        setSetEntries(
          sets.map((s) => ({
            year: s.release_year != null ? String(s.release_year) : "",
            name: s.name,
            brand: s.brand ?? undefined,
          })),
        );
      })
      .catch(() => {
        if (active) setSetEntries([]);
      });

    return () => {
      active = false;
    };
  }, [debouncedSetQuery]);

  const setResults = useMemo(() => {
    const q = setQuery.trim().toLowerCase();
    const list = q
      ? setEntries.filter((s) => {
          const hay = [s.year, s.name, s.brand ?? "", s.sport ?? ""].join(" ").toLowerCase();
          return hay.includes(q);
        })
      : setEntries;
    const scored = list.map((s) => {
      let score = 0;
      if (s.checklistKey) score += 3;
      if (q) {
        const name = s.name.toLowerCase();
        const full = `${s.year} ${s.name}`.toLowerCase();
        if (full === q) score += 5;
        if (name.includes(q)) score += 2;
        if (s.year.toLowerCase().includes(q)) score += 1;
      }
      return { s, score };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.s.name.localeCompare(b.s.name);
    });
    return scored.map((item) => item.s).slice(0, 12);
  }, [setQuery, setEntries]);

  function selectSet(s: SetSuggestion) {
    setYear(s.year);
    setSetName(s.name);
    setSetQuery(`${s.year} ${s.name}`);
    setShowSetResults(false);
  }

  return {
    setQuery,
    setSetQuery,
    showSetResults,
    setShowSetResults,
    setEntries,
    setResults,
    selectSet,
  };
}

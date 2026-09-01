import { useEffect, useMemo, useState } from "react";
import {
  listChecklistSections,
  type ChecklistSectionRow,
} from "@/lib/repositories/checklistSections";

/**
 * Catalog v2 checklist-section lookup for the card creation form: loads a
 * set's sections (listChecklistSections) whenever the selected set's id
 * changes, and exposes a query/setQuery pair for filtering that list by
 * name. Selecting a section only updates local state here -- callers
 * decide whether/how to use it (see cards/new/page.tsx, which does not
 * wire this into save behavior yet).
 */
export function useChecklistSectionLookup(setId: number | null) {
  const [sections, setSections] = useState<ChecklistSectionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedSection, setSelectedSection] = useState<ChecklistSectionRow | null>(null);

  // Render-time reset (React's documented "adjusting state when a prop
  // changes" pattern) instead of a synchronous setState-in-effect: the
  // moment setId changes, the previous set's selected section, query, and
  // stale sections disappear in the same render pass, before paint -- no
  // flash of a stale/wrong-set list, and no separate effect render just to
  // reset. `loading` is also decided here (true only when there's a new set
  // id to actually fetch) so the effect below never needs a synchronous
  // setState of its own -- only the promise callbacks (already exempt from
  // this lint rule) touch state from inside it.
  const [prevSetId, setPrevSetId] = useState(setId);
  if (setId !== prevSetId) {
    setPrevSetId(setId);
    setSelectedSection(null);
    setQuery("");
    setSections([]);
    setLoading(!!setId);
  }

  useEffect(() => {
    if (!setId) return;

    let active = true;
    listChecklistSections(setId)
      .then((rows) => {
        if (active) setSections(rows);
      })
      .catch(() => {
        if (active) setSections([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [setId]);

  const filteredSections = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sections;
    return sections.filter((s) => s.name.toLowerCase().includes(trimmed));
  }, [sections, query]);

  return {
    sections: filteredSections,
    loading,
    query,
    setQuery,
    selectedSection,
    setSelectedSection,
  };
}

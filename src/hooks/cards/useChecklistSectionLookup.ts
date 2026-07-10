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

  useEffect(() => {
    let active = true;
    setSelectedSection(null);
    setQuery("");

    if (!setId) {
      setSections([]);
      return;
    }

    setLoading(true);
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

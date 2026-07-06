import { useEffect, useMemo, useState } from "react";
import * as checklistDb from "@/lib/db/checklists.client";
import type { ChecklistEntry } from "@/lib/db/checklists.client";
import {
  VARIANT_KEYWORDS,
  expandChecklistWithSectionParallels,
  expandScoreChecklist,
  expandPrizmChecklist,
  expandCwcChecklist,
  expandDonrussChecklist,
  sectionTokens,
  sectionNumbers,
  normalizeQueryTokens,
} from "@/lib/checklists/parallelExpansion";
import { checklistGroup } from "@/lib/checklists/autofill";
import type { SetSuggestion } from "@/hooks/cards/useSetLookup";

/**
 * Checklist lookup state for the card creation form: matches the selected
 * set (year/setName) against setEntries to find a static checklistKey
 * (currently always null in production data -- see cards/new refactor
 * audit -- so this whole hook is inert/dead in practice today), loads that
 * checklist's entries/parallels, expands them into the active checklist,
 * and derives the filtered/grouped results the checklist search UI shows.
 * Preserved exactly as-is; not fixed as part of this extraction.
 */
export function useChecklistLookup({
  setEntries,
  year,
  setName,
}: {
  setEntries: SetSuggestion[];
  year: string;
  setName: string;
}) {
  const [checklistQuery, setChecklistQuery] = useState("");
  const [showChecklistResults, setShowChecklistResults] = useState(false);
  const [checklistSection, setChecklistSection] = useState<"ALL" | string>("ALL");

  const checklistKey = useMemo(() => {
    const y = year.trim();
    const name = setName.trim().toLowerCase();
    if (!y || !name) return null;

    const exact = setEntries.find(
      (s) => s.checklistKey && s.year === y && s.name.toLowerCase() === name
    );
    if (exact?.checklistKey) return exact.checklistKey;

    const fuzzy = setEntries.find(
      (s) =>
        s.checklistKey &&
        s.year === y &&
        (name.includes(s.name.toLowerCase()) || s.name.toLowerCase().includes(name))
    );
    return fuzzy?.checklistKey ?? null;
  }, [year, setName, setEntries]);

  const [checklistEntries, setChecklistEntries] = useState<ChecklistEntry[]>([]);
  const [checklistLoading, setChecklistLoading] = useState(false);
  const [checklistSectionParallels, setChecklistSectionParallels] = useState<
    Record<string, string[]>
  >({});

  useEffect(() => {
    if (!checklistKey) {
      setChecklistEntries([]);
      setChecklistSectionParallels({});
      return;
    }

    let active = true;
    setChecklistLoading(true);
    Promise.all([
      checklistDb.dbLoadChecklistEntries(checklistKey),
      checklistDb.dbLoadChecklistSectionParallels(checklistKey),
    ])
      .then(([entries, parallels]) => {
        if (!active) return;
        setChecklistEntries(entries);
        setChecklistSectionParallels(parallels);
      })
      .catch(() => {
        if (!active) return;
        setChecklistEntries([]);
        setChecklistSectionParallels({});
      })
      .finally(() => {
        if (active) setChecklistLoading(false);
      });

    return () => {
      active = false;
    };
  }, [checklistKey]);

  const activeChecklist = useMemo(() => {
    if (!checklistKey) return [];
    if (Object.keys(checklistSectionParallels).length) {
      return expandChecklistWithSectionParallels(checklistEntries, checklistSectionParallels);
    }
    if (checklistKey === "donruss-2025") return expandDonrussChecklist(checklistEntries);
    if (checklistKey === "prizm-cwc-2025") return expandCwcChecklist(checklistEntries);
    if (checklistKey === "prizm-2025") return expandPrizmChecklist(checklistEntries);
    if (checklistKey === "score-2025") return expandScoreChecklist(checklistEntries);
    return checklistEntries;
  }, [checklistKey, checklistEntries, checklistSectionParallels]);

  const checklistResults = useMemo(() => {
    if (!activeChecklist.length) return [];
    const qTokens = normalizeQueryTokens(checklistQuery);
    const list = qTokens.length
      ? activeChecklist.filter((c) => {
          const tokens = sectionTokens(c.section);
          const numbers = sectionNumbers(c.section);
          const hayRaw = [
            c.number,
            c.name,
            c.team ?? "",
            c.section,
            ...tokens,
            ...numbers,
          ]
            .join(" ")
            .toLowerCase();
          const hay = hayRaw.replace(/[^a-z0-9]+/g, " ").trim();
          return qTokens.every((t) => hay.includes(t));
        })
      : activeChecklist;
    const filtered =
      checklistSection === "ALL"
        ? list
        : list.filter((c) => checklistGroup(c.section) === checklistSection);
    const base = filtered.filter((c) => !VARIANT_KEYWORDS.some((k) => c.section.includes(k)));
    const variants = filtered.filter((c) => VARIANT_KEYWORDS.some((k) => c.section.includes(k)));
    return [...base, ...variants].slice(0, 200);
  }, [activeChecklist, checklistQuery, checklistSection]);

  const checklistGroups = useMemo(() => {
    if (!activeChecklist.length) return [];
    const counts = new Map<string, number>();
    for (const c of activeChecklist) {
      const group = checklistGroup(c.section);
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [activeChecklist]);

  return {
    checklistKey,
    checklistEntries,
    checklistSectionParallels,
    checklistLoading,
    checklistQuery,
    setChecklistQuery,
    showChecklistResults,
    setShowChecklistResults,
    checklistSection,
    setChecklistSection,
    activeChecklist,
    checklistResults,
    checklistGroups,
  };
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SummaryChip } from "@/components/ui/SummaryChip";
import { BinderStats } from "@/components/cards/BinderStats";
import { BinderToolbar } from "@/components/cards/BinderToolbar";
import { DeleteCardDialog } from "@/components/cards/DeleteCardDialog";
import { CardRowMenu } from "@/components/cards/CardRowMenu";
import { BinderGrid } from "@/components/cards/BinderGrid";
import { BinderSet } from "@/components/cards/BinderSet";
import { CardTile } from "@/components/cards/CardTile";
import { useUserCardDisplayImages } from "@/hooks/cards/useUserCardDisplayImages";

import {
  type MyCard,
  type MyCardInput,
  listMyCards,
  updateMyCard,
  deleteMyCard,
  deleteMyCards,
} from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { getCollectionSummary, type CollectionSummary } from "@/lib/repositories/collectionSummary";
import { getDataQualitySignals } from "@/lib/repositories/dataQualitySignals";
import { getNextActions } from "@/lib/repositories/nextActions";
import { getCollectionHealthScore } from "@/lib/repositories/collectionHealth";
import { cardsToCsv, downloadCsv } from "@/lib/csv";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { fetchSharedImagesByFingerprints, type SharedImage } from "@/lib/db/sharedImages";
import { startTrace, captureError } from "@/lib/sentry";

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

const STALE_DAYS = 90;

// Module-level (not per-render) so the reference is stable across renders --
// see teamFiltersBySet below, which reads this instead of a fresh {}
// literal so it doesn't defeat the useMemo that depends on it.
const EMPTY_TEAM_FILTERS_BY_SET: Record<string, string> = {};

type SortMode =
  | "PLAYER_ASC"
  | "YEAR_DESC"
  | "SET_ASC"
  | "TEAM_ASC"
  | "EST_VALUE_DESC";

function normalize(s?: string) {
  return (s ?? "").trim().toLowerCase();
}

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

// Duplicates = same Player + Year + Set + Card #
function dupKey(c: MyCard) {
  const player = normalize(c.playerName);
  const year = String(c.year ?? "").trim();
  const set = normalize(c.setName);
  const num = normalize(c.cardNumber ?? "");
  return `${player}__${year}__${set}__${num}`;
}

// Maps the legacy ?needs= URL values to the shared dataQualitySignals.ts
// signal ids they correspond to.
const NEEDS_FILTER_SIGNAL_ID: Record<"photos" | "value" | "location", string> = {
  photos: "missing-photos",
  value: "missing-estimated-value",
  location: "missing-storage-location",
};

type QualityFilterBucket = "ALL" | "NEEDS_ATTENTION" | "HIGH_PRIORITY" | "COMPLETE";
// A DataQualitySignal id (string) is also a valid value, selecting cards
// incomplete for that one specific signal.
type QualityFilterOption = QualityFilterBucket | string;

function qualityFilterLabel(filter: QualityFilterOption) {
  if (filter === "NEEDS_ATTENTION") return "needing attention";
  if (filter === "HIGH_PRIORITY") return "with high-priority issues";
  if (filter === "COMPLETE") return "that are complete";
  const signal = getDataQualitySignals().find((s) => s.id === filter);
  return signal ? signal.label : "matching this filter";
}

// Presentation-only bucket labels for the score returned by
// getCollectionHealthScore -- mirrors the Dashboard's own (page-local,
// unexported) healthLabel(). The score itself is never recomputed here.
function healthScoreLabel(score: number) {
  if (score >= 95) return "Excellent";
  if (score >= 80) return "Great";
  if (score >= 65) return "Good";
  if (score >= 50) return "Needs Attention";
  return "Critical";
}

// Collector helpers
function isAuto(c: MyCard) {
  return !!c.isAutograph;
}
function isPatch(c: MyCard) {
  return !!c.isPatch;
}
function isRookie(c: MyCard) {
  return !!c.isRookie;
}

export default function CardsPage() {
  return (
    <Suspense fallback={<div className="loading-state">Loading your binder…</div>}>
      <CardsPageInner />
    </Suspense>
  );
}

function CardsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cards, setCards] = useState<MyCard[]>([]);
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forSaleMode, setForSaleMode] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<QualityFilterOption>("ALL");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLocationValue, setBulkLocationValue] = useState("");
  const [bulkPurchasePriceValue, setBulkPurchasePriceValue] = useState("");
  const [bulkAskingPriceValue, setBulkAskingPriceValue] = useState("");
  // Mobile-only: whether the location/purchase-price/asking-price bulk
  // fields are expanded below the always-visible status actions. Ignored
  // above the sm breakpoint, where those fields are always shown.
  const [showBulkFields, setShowBulkFields] = useState(false);
  const [sharedImages, setSharedImages] = useState<Record<string, SharedImage>>({});
  const [reportMap, setReportMap] = useState<
    Record<string, { reports: number; status?: string }>
  >({});
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [sportFilter, setSportFilter] = useState<string>("ALL");

  // Filters panel (collapsible)
  const [showFilters, setShowFilters] = useState(false);

  // collector filters
  const [dupOnly, setDupOnly] = useState(false);
  const [parallelKey, setParallelKey] = useState<string>("ALL");
  const [numberedKey, setNumberedKey] = useState<string>("ALL");
  const [autoOnly, setAutoOnly] = useState(false);
  const [patchOnly, setPatchOnly] = useState(false);
  const [rookieOnly, setRookieOnly] = useState(false);

  // Location filter (normalized key)
  const [locationKey, setLocationKey] = useState<string>("ALL");
  const [insertKey, setInsertKey] = useState<string>("ALL");

  const [sortMode, setSortMode] = useState<SortMode>("PLAYER_ASC");
  const [collapsedSets, setCollapsedSets] = useState<Set<string>>(new Set());
  // No setter reaches this anymore now that setTeamFilter (the only caller
  // of the former setTeamFiltersBySet) was removed as dead code -- this can
  // never be anything but {} for the component's lifetime, so it's a plain
  // constant rather than state. Reads the module-level
  // EMPTY_TEAM_FILTERS_BY_SET (not a fresh {} literal here) so the
  // reference stays stable across renders, same as the useMemo below
  // depending on it expects. Every read site is unchanged and behaves
  // identically (teamFiltersBySet[group.key] was already always undefined
  // in practice).
  const teamFiltersBySet = EMPTY_TEAM_FILTERS_BY_SET;

  // ✅ Row actions (kebab menu)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [closingMenuId, setClosingMenuId] = useState<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const prevOpenRef = useRef<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  // ✅ Delete confirmation modal state
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError("");

        const profileId = await requireProfileId();
        const endTrace = startTrace("load-binder-cards");
        const [data, summary] = await Promise.all([
          listMyCards(profileId),
          getCollectionSummary(profileId),
        ]);
        if (endTrace) endTrace();
        if (mounted) {
          setCards(data);
          setCollectionSummary(summary);
        }
      } catch (e) {
        captureError(e, { area: "binder-load" });
        const message = e instanceof Error ? e.message : "Failed to load cards";
        if (mounted) setError(message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const fingerprints = Array.from(
      new Set(
        cards.map((c) =>
          buildCardFingerprint({
            year: c.year,
            setName: c.setName,
            cardNumber: c.cardNumber,
            playerName: c.playerName,
            team: c.team,
            insert: c.insert ?? "",
            variation: c.variation ?? "",
            parallel: c.parallel ?? "",
            serialTotal: c.serialTotal,
          })
        )
      )
    ).filter(Boolean);

    if (!fingerprints.length) {
      setReportMap({});
      setSharedImages({});
      return;
    }

    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data && typeof data === "object") setReportMap(data);
      })
      .catch(() => {
        setReportMap({});
      });

    fetchSharedImagesByFingerprints(fingerprints)
      .then((map) => {
        setSharedImages(map);
      })
      .catch(() => {
        setSharedImages({});
      });
  }, [cards]);

  useEffect(() => {
    const prev = prevOpenRef.current;
    if (prev && openMenuId !== prev) {
      setClosingMenuId(prev);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        setClosingMenuId((current) => (current === prev ? null : current));
      }, 140);
    }
    if (openMenuId) setClosingMenuId(null);
    prevOpenRef.current = openMenuId;
  }, [openMenuId]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!menuAnchor) {
      setMenuPos(null);
      return;
    }

    function updateMenuPos() {
      if (!menuAnchor) return;
      const rect = menuAnchor.getBoundingClientRect();
      const menuWidth = 176;
      const menuHeight = 140;
      const gutter = 8;

      let left = rect.right - menuWidth;
      left = Math.max(gutter, Math.min(left, window.innerWidth - menuWidth - gutter));

      let top = rect.bottom + gutter;
      if (top + menuHeight > window.innerHeight - gutter) {
        top = rect.top - gutter - menuHeight;
      }

      setMenuPos({ top, left });
    }

    updateMenuPos();
    window.addEventListener("resize", updateMenuPos);
    window.addEventListener("scroll", updateMenuPos, true);
    return () => {
      window.removeEventListener("resize", updateMenuPos);
      window.removeEventListener("scroll", updateMenuPos, true);
    };
  }, [menuAnchor]);

  // Close menu when clicking anywhere else
  useEffect(() => {
    function onDocClick(event: MouseEvent) {
      const path = event.composedPath?.() ?? [];
      for (const node of path) {
        if ((node as HTMLElement)?.dataset?.rowMenu !== undefined) return;
      }
      setOpenMenuId(null);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    if (openMenuId === null && closingMenuId === null) {
      setMenuAnchor(null);
    }
  }, [openMenuId, closingMenuId]);

  // Close menu on Escape
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenuId(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadCardsFromDb() {
    try {
      setLoading(true);
      setError("");

      const profileId = await requireProfileId();
      const endTrace = startTrace("refresh-binder-cards");
      const [data, summary] = await Promise.all([
        listMyCards(profileId),
        getCollectionSummary(profileId),
      ]);
      if (endTrace) endTrace();
      setCards(data);
      setCollectionSummary(summary);
    } catch (e) {
      captureError(e, { area: "binder-refresh" });
      const message = e instanceof Error ? e.message : "Failed to load cards";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function refresh() {
    void loadCardsFromDb();
  }

  function exportCsv() {
    const csv = cardsToCsv(cards);
    downloadCsv(`thebinder-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  }

  useEffect(() => {
    function onExport() {
      exportCsv();
    }
    window.addEventListener("cards:export", onExport as EventListener);
    return () => window.removeEventListener("cards:export", onExport as EventListener);
  }, [cards]);

  function clearCollectorFilters() {
    setDupOnly(false);
    setParallelKey("ALL");
    setNumberedKey("ALL");
    setAutoOnly(false);
    setPatchOnly(false);
    setRookieOnly(false);
    setLocationKey("ALL");
    setInsertKey("ALL");
  }

  function setSportAndReset(next: string) {
    setSportFilter(next);
    clearCollectorFilters();
  }

  // Single reset implementation shared by BinderToolbar's "Clear filters"
  // button and the "no cards match your filters" empty state below -- the
  // empty state reuses this exact function rather than a second copy.
  function clearAllFilters() {
    setQ("");
    setSportFilter("ALL");
    clearCollectorFilters();
    setQualityFilter("ALL");
    setShowFilters(false);
    refresh();
  }

  // Sets don't carry a sport yet (no sport/league picker in the add-card
  // form), so the Sport tab is a single "Unknown" bucket until that catalog
  // path exists.
  function resolveSport() {
    return "Unknown";
  }

  // ✅ Hide SOLD and WANT cards in binder view
  const baseList = useMemo(() => {
    return cards.filter((c) => {
      const s = c.status ?? "HAVE";
      return s !== "SOLD" && s !== "WANT";
    });
  }, [cards]);

  // Phase 2B.1: one batched resolution (persisted card_media, falling back
  // to legacy localStorage) for every card that could ever appear in this
  // session -- baseList, not the narrower `filtered` list, so toggling a
  // search/collector/sport/quality filter never re-triggers a new batch
  // fetch, only the initial load or a genuine add/edit/delete/bulk change
  // to `cards` does. Same shared hook Player Hub and Card Detail already
  // use -- no second image resolver.
  const { imagesByUserCardId } = useUserCardDisplayImages(baseList.map((c) => c.id));

  const afterSport = useMemo(() => {
    if (sportFilter === "ALL") return baseList;
    return baseList.filter(() => resolveSport() === sportFilter);
  }, [baseList, sportFilter]);

  // ✅ Data quality filter (driven by the ?needs= query param, e.g.
  // dashboard Next Actions links, and later by in-page filter controls) —
  // narrows to cards matching a data-quality bucket or a specific
  // dataQualitySignals.ts signal.
  const afterQuality = useMemo(() => {
    if (qualityFilter === "ALL") return afterSport;

    const signals = getDataQualitySignals();

    if (qualityFilter === "NEEDS_ATTENTION") {
      return afterSport.filter((c) => signals.some((s) => s.appliesTo(c) && !s.isComplete(c)));
    }
    if (qualityFilter === "HIGH_PRIORITY") {
      return afterSport.filter((c) =>
        signals.some((s) => s.priority === "high" && s.appliesTo(c) && !s.isComplete(c))
      );
    }
    if (qualityFilter === "COMPLETE") {
      return afterSport.filter((c) => signals.every((s) => !s.appliesTo(c) || s.isComplete(c)));
    }

    const signal = signals.find((s) => s.id === qualityFilter);
    if (!signal) return afterSport;
    return afterSport.filter((c) => signal.appliesTo(c) && !signal.isComplete(c));
  }, [afterSport, qualityFilter]);

  // ✅ Data Quality chips source -- one option per shared signal, in the
  // signal's own declared order (not alphabetized like the other groups).
  const qualityOptions = useMemo(() => {
    return getDataQualitySignals().map((signal) => {
      const count = afterSport.filter(
        (c) => signal.appliesTo(c) && !signal.isComplete(c)
      ).length;
      return { key: signal.id, label: signal.label, count };
    });
  }, [afterSport]);

  const sportOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of baseList) {
      void c;
      const sport = resolveSport();
      const key = normalize(sport);
      const prev = map.get(key);
      if (!prev) map.set(key, { label: sport, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [baseList]);

  // ✅ Location chips source
  const locationOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of afterSport) {
      const raw = (c.location ?? "").trim();
      if (!raw) continue;

      const key = normalize(raw);
      const prev = map.get(key);
      if (!prev) map.set(key, { label: raw, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [afterSport]);

  // ✅ Insert chips source
  const insertOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of afterSport) {
      const raw = (c.insert ?? "").trim();
      if (!raw) continue;

      const key = normalize(raw);
      const prev = map.get(key);
      if (!prev) map.set(key, { label: raw, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [afterSport]);

  // ✅ Parallel chips source
  const parallelOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of afterSport) {
      const raw = (c.parallel ?? "").trim();
      if (!raw) continue;

      const key = normalize(raw);
      const prev = map.get(key);
      if (!prev) map.set(key, { label: raw, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [afterSport]);

  // ✅ Numbered chips source (by serial total)
  const numberedOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of afterSport) {
      const total = c.serialTotal;
      if (typeof total !== "number") continue;
      const key = String(total);
      const label = `/${total}`;
      const prev = map.get(key);
      if (!prev) map.set(key, { label, count: 1 });
      else map.set(key, { label: prev.label, count: prev.count + 1 });
    }

    return Array.from(map.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => Number(a.key) - Number(b.key));
  }, [afterSport]);

  // ✅ duplicates info
  const dupInfo = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of afterSport) {
      const key = dupKey(c);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    const dupKeys = new Set<string>();
    let dupCardsCount = 0;
    let dupGroupsCount = 0;

    for (const [key, count] of counts.entries()) {
      if (count > 1) {
        dupKeys.add(key);
        dupCardsCount += count;
        dupGroupsCount += 1;
      }
    }

    return { dupKeys, dupCardsCount, dupGroupsCount };
  }, [afterSport]);

  // ✅ stale filter
  // ✅ duplicates filter
  const afterDup = useMemo(() => {
    if (!dupOnly) return afterQuality;
    return afterQuality.filter((c) => dupInfo.dupKeys.has(dupKey(c)));
  }, [afterQuality, dupOnly, dupInfo.dupKeys]);

  // ✅ collector flag filters
  const afterCollectorFlags = useMemo(() => {
    return afterDup.filter((c) => {
      if (autoOnly && !isAuto(c)) return false;
      if (patchOnly && !isPatch(c)) return false;
      if (rookieOnly && !isRookie(c)) return false;
      return true;
    });
  }, [afterDup, autoOnly, patchOnly, rookieOnly]);

  // ✅ location filter
  const afterLocation = useMemo(() => {
    if (locationKey === "ALL") return afterCollectorFlags;
    return afterCollectorFlags.filter((c) => {
      const loc = (c.location ?? "").trim();
      if (!loc) return false;
      return normalize(loc) === locationKey;
    });
  }, [afterCollectorFlags, locationKey]);

  // ✅ insert filter
  const afterInsert = useMemo(() => {
    if (insertKey === "ALL") return afterLocation;
    return afterLocation.filter((c) => {
      const ins = (c.insert ?? "").trim();
      if (!ins) return false;
      return normalize(ins) === insertKey;
    });
  }, [afterLocation, insertKey]);

  // ✅ parallel filter
  const afterParallel = useMemo(() => {
    if (parallelKey === "ALL") return afterInsert;
    return afterInsert.filter((c) => {
      const raw = (c.parallel ?? "").trim();
      if (!raw) return false;
      return normalize(raw) === parallelKey;
    });
  }, [afterInsert, parallelKey]);

  // ✅ numbered filter
  const afterNumbered = useMemo(() => {
    if (numberedKey === "ALL") return afterParallel;
    return afterParallel.filter((c) => {
      const total = c.serialTotal;
      if (typeof total !== "number") return false;
      return String(total) === numberedKey;
    });
  }, [afterParallel, numberedKey]);

  // ✅ search + status
  const searched = useMemo(() => {
    const query = debouncedQ.trim().toLowerCase();

    return afterNumbered.filter((c) => {
      if (!query) return true;

      const hay = [
        c.playerName,
        c.year,
        c.setName,
        c.cardNumber ?? "",
        c.team ?? "",
        c.location ?? "",
        c.insert ?? "",
        c.grader ?? "",
        c.grade ?? "",
        c.variation ?? "",
        c.parallel ?? "",
        c.serialTotal ? `/${c.serialTotal}` : "",
        c.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(query);
    });
  }, [afterNumbered, debouncedQ]);

  // ✅ sorting
  const filtered = useMemo(() => {
    const list = searched.slice();

    list.sort((a, b) => {
      if (sortMode === "PLAYER_ASC") {
        const ap = normalize(a.playerName);
        const bp = normalize(b.playerName);
        if (ap !== bp) return ap.localeCompare(bp);
        return Number(b.year ?? 0) - Number(a.year ?? 0);
      }

      if (sortMode === "YEAR_DESC") {
        const ay = Number(a.year ?? 0);
        const by = Number(b.year ?? 0);
        if (by !== ay) return by - ay;
        return normalize(a.playerName).localeCompare(normalize(b.playerName));
      }

      if (sortMode === "SET_ASC") {
        const asn = normalize(a.setName);
        const bsn = normalize(b.setName);
        if (asn !== bsn) return asn.localeCompare(bsn);
        return normalize(a.playerName).localeCompare(normalize(b.playerName));
      }

      if (sortMode === "TEAM_ASC") {
        const at = normalize(a.team);
        const bt = normalize(b.team);
        if (at !== bt) return at.localeCompare(bt);
        return normalize(a.playerName).localeCompare(normalize(b.playerName));
      }

      if (sortMode === "EST_VALUE_DESC") {
        const ap = asNumber(a.estimatedValue) ?? -1;
        const bp = asNumber(b.estimatedValue) ?? -1;
        if (bp !== ap) return bp - ap;
        return normalize(a.playerName).localeCompare(normalize(b.playerName));
      }

      return normalize(a.playerName).localeCompare(normalize(b.playerName));
    });

    return list;
  }, [searched, sortMode]);

  const groupedBySet = useMemo(() => {
    const map = new Map<string, { label: string; cards: MyCard[] }>();
    const order: string[] = [];

    for (const c of filtered) {
      const setName = (c.setName ?? "").trim();
      const year = c.year ? String(c.year).trim() : "";
      const label = [year, setName].filter(Boolean).join(" ") || "Unknown Set";
      const key = `${normalize(setName)}__${year}`;

      if (!map.has(key)) {
        map.set(key, { label, cards: [] });
        order.push(key);
      }

      map.get(key)!.cards.push(c);
    }

    return order.map((key) => ({ key, ...map.get(key)! }));
  }, [filtered]);

  const visibleCardIds = useMemo(() => {
    const ids: string[] = [];
    for (const group of groupedBySet) {
      if (collapsedSets.has(group.key)) continue;
      const selectedTeam = teamFiltersBySet[group.key] ?? "ALL";
      const cardsInGroup =
        selectedTeam === "ALL"
          ? group.cards
          : group.cards.filter(
              (c) => normalize(c.team) === normalize(teamFiltersBySet[group.key] ?? "")
            );
      for (const c of cardsInGroup) ids.push(c.id);
    }
    return ids;
  }, [groupedBySet, collapsedSets, teamFiltersBySet]);

  const selectedCount = selectedIds.size;
  const allVisibleSelected =
    visibleCardIds.length > 0 && visibleCardIds.every((id) => selectedIds.has(id));
  const someVisibleSelected = visibleCardIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    // Reads via the reactive useSearchParams() (not a mount-only
    // window.location.search snapshot) so this also re-applies when a
    // same-route Link only changes the query string -- e.g. the Binder
    // page's own Next Actions links -- not just on a fresh navigation.
    setForSaleMode(searchParams.get("forSale") === "1");

    const needs = searchParams.get("needs");
    if (needs === "photos" || needs === "value" || needs === "location") {
      setQualityFilter(NEEDS_FILTER_SIGNAL_ID[needs]);
    }
  }, [searchParams]);

  function toggleSelected(id: string, next?: boolean) {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      const shouldSelect = next ?? !copy.has(id);
      if (shouldSelect) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const copy = new Set(prev);
      if (allVisibleSelected) {
        visibleCardIds.forEach((id) => copy.delete(id));
      } else {
        visibleCardIds.forEach((id) => copy.add(id));
      }
      return copy;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  // Shared by every bulk field-update handler (status, location, and future
  // fields like purchase/asking price). Pass an empty confirmMessage to
  // skip the confirmation step. Returns true only if the update actually
  // ran, so callers can gate their own post-success side effects on it.
  async function applyBulkCardUpdate(
    patch: Partial<MyCardInput>,
    confirmMessage: string,
  ): Promise<boolean> {
    if (!selectedIds.size || bulkBusy) return false;
    if (confirmMessage) {
      const confirmed = window.confirm(confirmMessage);
      if (!confirmed) return false;
    }

    setBulkBusy(true);
    try {
      const profileId = await requireProfileId();
      const ids = Array.from(selectedIds);
      const updated = await Promise.all(
        ids.map((id) => updateMyCard(profileId, id, patch)),
      );
      const byId = new Map(updated.map((c) => [c.id, c]));
      setCards((prev) => prev.map((c) => byId.get(c.id) ?? c));
      // Local mutation outruns the last fetched summary; fall back to
      // recomputing from `cards` until the next full refresh.
      setCollectionSummary(null);
      clearSelection();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      alert(`Bulk update failed: ${message}`);
      return false;
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkStatus(nextStatus: MyCard["status"]) {
    const applied = await applyBulkCardUpdate({ status: nextStatus }, "");
    if (applied && forSaleMode && nextStatus === "FOR_SALE") {
      router.push("/cards/for-sale");
    }
  }

  async function applyBulkLocation() {
    const confirmMessage = bulkLocationValue
      ? `Set location to "${bulkLocationValue}" for ${selectedIds.size} cards?`
      : `Clear location for ${selectedIds.size} cards?`;
    const applied = await applyBulkCardUpdate({ location: bulkLocationValue }, confirmMessage);
    if (applied) setBulkLocationValue("");
  }

  async function applyBulkPurchasePrice() {
    if (!selectedIds.size || bulkBusy) return;

    const trimmed = bulkPurchasePriceValue.trim();
    if (!trimmed) {
      // MyCardInput.purchasePrice is typed as `number | undefined` (no
      // `null`), so updateMyCard has no supported way to clear an existing
      // purchase price -- only to set it to a number. Surface that instead
      // of silently no-op'ing.
      alert("Enter a number to update purchase price. Clearing purchase price isn't supported yet.");
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      alert("Enter a valid number for purchase price.");
      return;
    }

    const confirmMessage = `Set purchase price to ${parsed} for ${selectedIds.size} cards?`;
    const applied = await applyBulkCardUpdate({ purchasePrice: parsed }, confirmMessage);
    if (applied) setBulkPurchasePriceValue("");
  }

  async function applyBulkAskingPrice() {
    if (!selectedIds.size || bulkBusy) return;

    const trimmed = bulkAskingPriceValue.trim();
    if (!trimmed) {
      // MyCardInput.askingPrice is typed as `number | undefined` (no
      // `null`), so updateMyCard has no supported way to clear an existing
      // asking price -- only to set it to a number. Surface that instead
      // of silently no-op'ing.
      alert("Enter a number to update asking price. Clearing asking price isn't supported yet.");
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      alert("Enter a valid number for asking price.");
      return;
    }

    const confirmMessage = `Set asking price to ${parsed} for ${selectedIds.size} cards?`;
    const applied = await applyBulkCardUpdate({ askingPrice: parsed }, confirmMessage);
    if (applied) setBulkAskingPriceValue("");
  }

  async function applyBulkDelete() {
    if (!selectedIds.size || bulkBusy) return;
    const confirmed = window.confirm(`Delete ${selectedIds.size} cards? This cannot be undone.`);
    if (!confirmed) return;

    setBulkBusy(true);
    try {
      await deleteMyCards(Array.from(selectedIds));
      setCards((prev) => prev.filter((c) => !selectedIds.has(c.id)));
      setCollectionSummary(null);
      clearSelection();
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      alert(`Bulk delete failed: ${message}`);
    } finally {
      setBulkBusy(false);
    }
  }

  function toggleSetCollapse(key: string) {
    setCollapsedSets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const activeMenuId = openMenuId ?? closingMenuId;
  const menuCard = activeMenuId ? filtered.find((c) => c.id === activeMenuId) : null;

  // ✅ stats -- Phase 2B.2: totalCards/totalSpent/totalPortfolioValue/
  // totalNetGain (the four numbers BinderStats actually renders) now
  // describe the currently VISIBLE cards -- the same `filtered` list
  // rendered in the grid below -- instead of the whole collection or just
  // the sport-filtered slice, so these numbers always match what's on
  // screen when search/collector/quality filters are active. Reuses
  // `filtered` directly rather than a second filter pass (the previous
  // collectionSummary-based shortcut only ever matched the unfiltered case
  // by coincidence, since it ignored every filter except Sport).
  //
  // The remaining fields below (totalSold, netPosition, forSaleValue,
  // costOfSold, graded, raw, staleCount, ageCount, avgAge, medianAge) are
  // unrelated to this fix -- confirmed unused by any current renderer --
  // and are left exactly as they were (sport-filtered only), out of scope
  // for this phase.
  const totals = useMemo(() => {
    const cardsInSport =
      sportFilter === "ALL" ? cards : cards.filter(() => resolveSport() === sportFilter);

    const totalCards = filtered.length;

    const totalSpent = filtered.reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

    const soldCards = cardsInSport.filter((c) => (c.status ?? "HAVE") === "SOLD");
    const totalSold = soldCards.reduce((sum, c) => sum + (asNumber(c.soldPrice) ?? 0), 0);

    const costOfSold = soldCards.reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

    const forSaleValue = cardsInSport
      .filter((c) => (c.status ?? "HAVE") === "FOR_SALE")
      .reduce((sum, c) => sum + (asNumber(c.askingPrice) ?? 0), 0);

    const netPosition = totalSold - totalSpent;

    const inventory = cardsInSport.filter((c) => {
      const s = c.status ?? "HAVE";
      return s !== "SOLD" && s !== "WANT";
    });

    const totalPortfolioValue = filtered.reduce(
      (sum, c) => sum + (asNumber(c.estimatedValue) ?? 0),
      0,
    );

    const totalNetGain = filtered.reduce((sum, c) => {
      const estimatedValue = asNumber(c.estimatedValue);
      if (typeof estimatedValue !== "number") return sum;
      const paid = asNumber(c.purchasePrice) ?? 0;
      return sum + (estimatedValue - paid);
    }, 0);

    const graded = inventory.filter((c) => c.gradingStatus === "GRADED").length;
    const raw = Math.max(0, inventory.length - graded);

    const ages: number[] = [];
    let staleCount = 0;
    for (const c of inventory) {
      const d = daysSince(c.purchaseDate);
      if (typeof d === "number") {
        ages.push(d);
        if (d >= STALE_DAYS) staleCount += 1;
      }
    }
    ages.sort((a, b) => a - b);

    const ageCount = ages.length;
    const avgAge = ageCount ? ages.reduce((s, v) => s + v, 0) / ageCount : 0;
    const medianAge =
      ageCount === 0
        ? 0
        : ageCount % 2 === 1
        ? ages[(ageCount - 1) / 2]
        : (ages[ageCount / 2 - 1] + ages[ageCount / 2]) / 2;

    return {
      totalCards,
      totalSpent,
      totalSold,
      netPosition,
      totalPortfolioValue,
      totalNetGain,
      forSaleValue,
      costOfSold,
      graded,
      raw,
      staleCount,
      ageCount,
      avgAge,
      medianAge,
    };
  }, [cards, sportFilter, filtered]);

  const netTone =
    totals.totalNetGain > 0 ? "positive" : totals.totalNetGain < 0 ? "negative" : "neutral";

  // ✅ Collection snapshot counts (Owned/Wishlist/For Sale/Sold) for the
  // condensed strip at the top of the page. Same "shared summary when
  // unfiltered by sport" pattern already used by `totals` above -- no new
  // fetch, just reusing collectionSummary/cards that are already loaded.
  const snapshotCounts = useMemo(() => {
    if (sportFilter === "ALL" && collectionSummary) {
      return {
        have: collectionSummary.counts.have,
        wanted: collectionSummary.counts.wanted,
        forSale: collectionSummary.counts.forSale,
        sold: collectionSummary.counts.sold,
      };
    }
    const cardsInSport =
      sportFilter === "ALL" ? cards : cards.filter(() => resolveSport() === sportFilter);
    return {
      have: cardsInSport.filter((c) => (c.status ?? "HAVE") === "HAVE").length,
      wanted: cardsInSport.filter((c) => (c.status ?? "HAVE") === "WANT").length,
      forSale: cardsInSport.filter((c) => (c.status ?? "HAVE") === "FOR_SALE").length,
      sold: cardsInSport.filter((c) => (c.status ?? "HAVE") === "SOLD").length,
    };
  }, [sportFilter, collectionSummary, cards]);

  // ✅ Condensed Collection Health for the top of the Binder page -- reuses
  // the shared collectionHealth engine as-is (no duplicated scoring logic).
  const healthScore = useMemo(() => getCollectionHealthScore(cards), [cards]);

  // ✅ Condensed Next Actions for the top of the Binder page -- reuses the
  // shared nextActions engine as-is (no duplicated completeness/priority
  // logic). Only the top 2 are shown here; the full list still lives on
  // the Dashboard.
  const nextActions = useMemo(() => getNextActions(cards), [cards]);
  const topNextActions = useMemo(() => nextActions.slice(0, 2), [nextActions]);

  const activeFiltersCount =
    (dupOnly ? 1 : 0) +
    (parallelKey !== "ALL" ? 1 : 0) +
    (numberedKey !== "ALL" ? 1 : 0) +
    (autoOnly ? 1 : 0) +
    (patchOnly ? 1 : 0) +
    (rookieOnly ? 1 : 0) +
    (locationKey !== "ALL" ? 1 : 0) +
    (insertKey !== "ALL" ? 1 : 0);

  function labelForCard(c: MyCard) {
    return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
  }

  function confirmDelete(c: MyCard) {
    setOpenMenuId(null);
    setDeleteTarget({ id: c.id, label: labelForCard(c) });
  }

  async function doDelete() {
    if (!deleteTarget) return;

    try {
      await deleteMyCard(deleteTarget.id);
      setCards((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setCollectionSummary(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "unknown error";
      alert(`Delete failed: ${message}`);
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Binder</h1>
          </div>

          {!forSaleMode ? (
            <div className="flex gap-2">
              <Link href="/cards/new" className="btn-primary">
                Add to Binder
              </Link>
            </div>
          ) : (
            <div className="flex gap-2">
              <Link href="/cards/for-sale" className="btn-secondary">
                Return to For Sale
              </Link>
            </div>
          )}
        </div>

        {qualityFilter !== "ALL" ? (
          <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <span>Showing cards {qualityFilterLabel(qualityFilter)}.</span>
            <button
              type="button"
              onClick={() => {
                setQualityFilter("ALL");
                router.replace("/cards");
              }}
              className="btn-link"
            >
              Clear filter
            </button>
          </div>
        ) : null}
      </div>

      {/* Collection snapshot strip */}
      <div className="flex flex-wrap gap-2">
        <SummaryChip label="Owned" value={snapshotCounts.have} />
        <SummaryChip label="Wishlist" value={snapshotCounts.wanted} />
        <SummaryChip label="For Sale" value={snapshotCounts.forSale} />
        <SummaryChip label="Sold" value={snapshotCounts.sold} />
      </div>

      {/* Condensed Collection Health */}
      {healthScore !== null ? (
        <button
          type="button"
          onClick={() => setQualityFilter("NEEDS_ATTENTION")}
          className="block w-full rounded-xl border bg-white p-3 text-left hover:bg-zinc-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-zinc-900">Collection Health</span>
            <span className="text-lg font-semibold text-zinc-900">{healthScore} / 100</span>
          </div>
          <div className="mt-1 text-sm text-zinc-600">{healthScoreLabel(healthScore)}</div>
        </button>
      ) : null}

      {/* Condensed Next Actions */}
      <div className="rounded-xl border bg-white p-3">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">Next Actions</h2>
        {nextActions.length === 0 ? (
          <div className="text-sm text-zinc-600">✓ Your collection looks great.</div>
        ) : (
          <div className="space-y-2">
            {topNextActions.map((action) => {
              const content = (
                <div className="text-sm font-medium text-zinc-900">{action.title}</div>
              );
              return action.href ? (
                <Link
                  key={action.id}
                  href={action.href}
                  className="block rounded-lg border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
                >
                  {content}
                </Link>
              ) : (
                <div key={action.id} className="block rounded-lg border border-zinc-200 px-3 py-2">
                  {content}
                </div>
              );
            })}
            {nextActions.length > 2 ? (
              <Link
                href="/dashboard"
                className="block text-sm font-medium text-blue-700 hover:underline"
              >
                View all ({nextActions.length})
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-700">
            {!forSaleMode ? (
              <>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected;
                    }}
                    onChange={toggleSelectAllVisible}
                  />
                  Select all visible
                </label>
                <span>
                  Selected: <span className="font-semibold">{selectedCount}</span>
                </span>
                <button type="button" onClick={clearSelection} className="btn-link">
                  Clear
                </button>
              </>
            ) : (
              <span>
                Selected: <span className="font-semibold">{selectedCount}</span>
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div className="flex gap-2 sm:contents">
              <button
                type="button"
                onClick={() => applyBulkStatus("FOR_SALE")}
                disabled={bulkBusy}
                className="btn-secondary flex-1 sm:flex-none"
              >
                Mark For Sale
              </button>
              {forSaleMode ? (
                <button
                  type="button"
                  onClick={() => router.push("/cards/for-sale")}
                  className="btn-secondary flex-1 sm:flex-none"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => applyBulkStatus("SOLD")}
                    disabled={bulkBusy}
                    className="btn-secondary flex-1 sm:flex-none"
                  >
                    Mark Sold
                  </button>
                  <button
                    type="button"
                    onClick={applyBulkDelete}
                    disabled={bulkBusy}
                    className="btn-destructive flex-1 sm:flex-none"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowBulkFields((v) => !v)}
              className="btn-link sm:hidden"
            >
              {showBulkFields ? "Hide fields" : "Edit fields (location, price)"}
            </button>

            <div
              className={
                (showBulkFields ? "flex" : "hidden") +
                " flex-col gap-2 sm:contents"
              }
            >
              <div className="flex flex-col gap-2 sm:contents">
                <select
                  value={bulkLocationValue}
                  onChange={(e) => setBulkLocationValue(e.target.value)}
                  className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 sm:w-auto"
                >
                  <option value="">No location</option>
                  {locationOptions.map((opt) => (
                    <option key={opt.key} value={opt.label}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={applyBulkLocation}
                  disabled={bulkBusy}
                  className="btn-secondary w-full sm:w-auto"
                >
                  Apply Location
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:contents">
                <input
                  type="number"
                  inputMode="decimal"
                  value={bulkPurchasePriceValue}
                  onChange={(e) => setBulkPurchasePriceValue(e.target.value)}
                  placeholder="Purchase price"
                  className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 sm:w-32"
                />
                <button
                  type="button"
                  onClick={applyBulkPurchasePrice}
                  disabled={bulkBusy}
                  className="btn-secondary w-full sm:w-auto"
                >
                  Apply Purchase Price
                </button>
              </div>

              <div className="flex flex-col gap-2 sm:contents">
                <input
                  type="number"
                  inputMode="decimal"
                  value={bulkAskingPriceValue}
                  onChange={(e) => setBulkAskingPriceValue(e.target.value)}
                  placeholder="Asking price"
                  className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base sm:text-sm text-zinc-900 sm:w-32"
                />
                <button
                  type="button"
                  onClick={applyBulkAskingPrice}
                  disabled={bulkBusy}
                  className="btn-secondary w-full sm:w-auto"
                >
                  Apply Asking Price
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="error-state">Something went wrong while loading your binder. {error}</div>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          <div className="text-sm text-zinc-600">Loading your collection…</div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`binder-skel-${i}`}
                className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm animate-pulse"
              >
                <div className="flex flex-col gap-2 rounded-md border border-zinc-200 bg-zinc-50 p-2 sm:aspect-[2.5/3.5]">
                  <div className="flex-1 rounded-md border border-zinc-200 bg-zinc-200/70" />
                  <div className="h-3 w-3/4 rounded bg-zinc-200/70" />
                  <div className="h-3 w-1/2 rounded bg-zinc-200/70" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <BinderToolbar
  sportFilter={sportFilter}
  sportOptions={sportOptions}
  q={q}
  sortMode={sortMode}
  showFilters={showFilters}
  activeFiltersCount={activeFiltersCount}
  locationOptions={locationOptions}
  insertOptions={insertOptions}
  parallelOptions={parallelOptions}
  numberedOptions={numberedOptions}
  qualityFilter={qualityFilter}
  qualityOptions={qualityOptions}
  locationKey={locationKey}
  insertKey={insertKey}
  parallelKey={parallelKey}
  numberedKey={numberedKey}
  dupOnly={dupOnly}
  autoOnly={autoOnly}
  patchOnly={patchOnly}
  rookieOnly={rookieOnly}
  dupInfo={dupInfo}
  setSportAndReset={setSportAndReset}
  setQ={setQ}
  setSortMode={setSortMode}
  setShowFilters={setShowFilters}
  setLocationKey={setLocationKey}
  setInsertKey={setInsertKey}
  setParallelKey={setParallelKey}
  setNumberedKey={setNumberedKey}
  setQualityFilter={setQualityFilter}
  setDupOnly={setDupOnly}
  setAutoOnly={setAutoOnly}
  setPatchOnly={setPatchOnly}
  setRookieOnly={setRookieOnly}
  clearCollectorFilters={clearCollectorFilters}
  clearAllFilters={clearAllFilters}
/>

      {/* Stats -- these numbers now describe the currently visible cards
          (totals is sourced from `filtered`, see its own comment above).
          This caption only appears when a filter/search has actually
          narrowed the view, so it doesn't clutter the default (unfiltered)
          state, where the stats already equal the whole HAVE/FOR_SALE
          collection and no clarification is needed. */}
      {filtered.length !== baseList.length ? (
        <p className="text-xs text-zinc-500">
          Showing {filtered.length} of {baseList.length} cards based on your filters.
        </p>
      ) : null}
<BinderStats
  totals={totals}
  netTone={netTone}
/>

      {/* Duplicates info */}
      {dupOnly ? (
        <div className="rounded-xl border bg-white p-4 text-sm text-zinc-700">
          Showing duplicates by <span className="font-medium">Player + Year + Set + Card #</span>.
          <span className="ml-2 text-zinc-500">
            Groups: {dupInfo.dupGroupsCount} • Cards: {dupInfo.dupCardsCount}
          </span>
        </div>
      ) : null}

      {/* Binder -- Phase 2B.2: three distinct states instead of one shared
          "no cards" message. Case A (baseList empty): a truly new/empty
          Binder. Case B (baseList has cards, filtered doesn't): filters or
          search excluded everything -- reuses the same clearAllFilters()
          BinderToolbar's own "Clear filters" button calls, not a second
          reset implementation. Neither case is shown when filtered.length
          > 0, in which case emptyState is undefined and BinderGrid renders
          children (the grouped-set grid) normally. */}
<BinderGrid
  emptyState={
    baseList.length === 0 ? (
      <div className="empty-state space-y-3">
        <div className="text-base font-semibold text-zinc-900">Your Binder is empty.</div>
        <div>Add your first card to begin building your collection.</div>
        <Link href="/cards/new" className="btn-primary">
          Add Card
        </Link>
      </div>
    ) : filtered.length === 0 ? (
      <div className="empty-state space-y-3">
        <div>No cards match your current filters.</div>
        <button type="button" onClick={clearAllFilters} className="btn-primary">
          Clear Filters
        </button>
      </div>
    ) : undefined
  }
>
          <div className="space-y-3">
            {groupedBySet.map((group, index) => {
              const selectedTeam = teamFiltersBySet[group.key] ?? "ALL";
              const teamFilteredCards =
                selectedTeam === "ALL"
                  ? group.cards
                  : group.cards.filter(
                      (c) => normalize(c.team) === normalize(teamFiltersBySet[group.key] ?? "")
                    );
              const countLabel =
                selectedTeam === "ALL"
                  ? `${group.cards.length}`
                  : `${teamFilteredCards.length}/${group.cards.length}`;

              return (
  <BinderSet
    key={group.key}
    groupKey={group.key}
    label={group.label}
    countLabel={countLabel}
    collapsed={collapsedSets.has(group.key)}
    isLast={index === groupedBySet.length - 1}
    onToggle={() => toggleSetCollapse(group.key)}
  >
    <div className="grid grid-cols-2 gap-4 p-4 auto-rows-fr sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {teamFilteredCards.map((c) => {
                      const insert = (c.insert ?? "").trim();
                      const fingerprint = buildCardFingerprint({
                        year: c.year,
                        setName: c.setName,
                        cardNumber: c.cardNumber,
                        playerName: c.playerName,
                        team: c.team,
                        insert,
                        variation: c.variation,
                        parallel: c.parallel,
                        serialTotal: c.serialTotal,
                      });
                      const sharedImage = fingerprint ? sharedImages[fingerprint] : null;
                      const report = fingerprint ? reportMap[fingerprint] : undefined;

                      return (
                        <CardTile
                          key={c.id}
                          card={c}
                          selected={selectedIds.has(c.id)}
                          onToggleSelected={toggleSelected}
                          imageUrl={imagesByUserCardId.get(c.id) ?? null}
                          sharedImage={sharedImage}
                          report={report}
                          isMenuOpen={openMenuId === c.id}
                          onOpenMenu={(e, id) => {
                            setOpenMenuId((prev) => (prev === id ? null : id));
                            if (openMenuId === id) return;
                            setMenuAnchor(e.currentTarget as HTMLButtonElement);
                          }}
                        />
                      );
                    })}
                  </div>
  </BinderSet>
);
            })}
          </div>
      </BinderGrid>

      {menuCard && menuPos && activeMenuId
  ? createPortal(
      <CardRowMenu
        card={menuCard}
        top={menuPos.top}
        left={menuPos.left}
        isOpen={!!openMenuId}
        onEdit={() => {
          setOpenMenuId(null);
          router.push(`/cards/${menuCard.id}/edit`);
        }}
        onMarkSold={() => {
          setOpenMenuId(null);
          router.push(`/cards/${menuCard.id}/sold`);
        }}
        onDelete={() => confirmDelete(menuCard)}
      />,
      document.body
    )
  : null}

      <p className="text-xs text-zinc-500">
        Tip: On mobile, Sport is a dropdown. On desktop, it’s tabs. Use the ⋯ button on a row for
        Edit / Sold / Delete.
      </p>

      {/* ✅ Delete confirmation modal */}
      {deleteTarget ? (
  <DeleteCardDialog
    label={deleteTarget.label}
    onCancel={() => setDeleteTarget(null)}
    onConfirm={doDelete}
  />
) : null}
    </div>
  );
}


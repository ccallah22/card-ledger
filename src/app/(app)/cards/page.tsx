"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Chip } from "@/components/cards/BinderUi";
import { BinderStats } from "@/components/cards/BinderStats";
import { BinderToolbar } from "@/components/cards/BinderToolbar";
import { DeleteCardDialog } from "@/components/cards/DeleteCardDialog";
import { CardRowMenu } from "@/components/cards/CardRowMenu";
import { BinderGrid } from "@/components/cards/BinderGrid";
import { BinderSet } from "@/components/cards/BinderSet";
import { CardTile } from "@/components/cards/CardTile";

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

type SortMode =
  | "PLAYER_ASC"
  | "YEAR_DESC"
  | "SET_ASC"
  | "TEAM_ASC"
  | "EST_VALUE_DESC";

function normalize(s?: string) {
  return (s ?? "").trim().toLowerCase();
}

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function teamSwatchStyle(team: string): CSSProperties {
  const base = hashString(team) % 360;
  const a = `hsl(${base} 70% 45%)`;
  const b = `hsl(${(base + 35) % 360} 70% 32%)`;
  return {
    background: `linear-gradient(135deg, ${a}, ${b})`,
    color: "white",
  };
}

type CwcTeam = {
  abbr: string;
  fullName: string;
  primaryColor: string;
  secondaryColor: string;
  altNames?: string[];
};

const CWC_SET_KEY = `${normalize("Panini Prizm FIFA Club World Cup")}__2025`;

const CWC_TEAMS: CwcTeam[] = [
  { abbr: "ALAH", fullName: "Al Ahly FC", primaryColor: "#E60000", secondaryColor: "#000000" },
  { abbr: "ALAI", fullName: "Al Ain FC", primaryColor: "#5A2A82", secondaryColor: "#F2A900" },
  { abbr: "ALHI", fullName: "Al Hilal", primaryColor: "#0057B8", secondaryColor: "#FFFFFF" },
  {
    abbr: "ATM",
    fullName: "Atletico de Madrid",
    primaryColor: "#E60026",
    secondaryColor: "#FFFFFF",
    altNames: ["Atletico Madrid"],
  },
  {
    abbr: "PSG",
    fullName: "Paris Saint-Germain",
    primaryColor: "#004170",
    secondaryColor: "#DA291C",
    altNames: ["Paris Saint Germain", "Paris SG"],
  },
  { abbr: "AKL", fullName: "Auckland City FC", primaryColor: "#002D62", secondaryColor: "#FFFFFF" },
  { abbr: "BOC", fullName: "Boca Juniors", primaryColor: "#003F79", secondaryColor: "#FFB81C" },
  { abbr: "BVB", fullName: "Borussia Dortmund", primaryColor: "#FDE100", secondaryColor: "#000000" },
  { abbr: "FCB", fullName: "FC Bayern Munchen", primaryColor: "#DC052D", secondaryColor: "#FFFFFF" },
  { abbr: "BOTA", fullName: "Botafogo", primaryColor: "#000000", secondaryColor: "#FFFFFF" },
  { abbr: "MTY", fullName: "CF Monterrey", primaryColor: "#002D62", secondaryColor: "#FFFFFF" },
  { abbr: "CHE", fullName: "Chelsea FC", primaryColor: "#034694", secondaryColor: "#FFFFFF" },
  {
    abbr: "URD",
    fullName: "Urawa Red Diamonds",
    primaryColor: "#E60012",
    secondaryColor: "#000000",
  },
  {
    abbr: "EST",
    fullName: "Esperance Sportive de Tunis",
    primaryColor: "#D50000",
    secondaryColor: "#FFD100",
  },
  {
    abbr: "INT",
    fullName: "FC Internazionale Milano",
    primaryColor: "#0057B8",
    secondaryColor: "#000000",
    altNames: ["Inter", "Inter Milan"],
  },
  { abbr: "POR", fullName: "FC Porto", primaryColor: "#0033A0", secondaryColor: "#FFFFFF" },
  { abbr: "FLA", fullName: "Flamengo", primaryColor: "#C8102E", secondaryColor: "#000000" },
  { abbr: "FLU", fullName: "Fluminense", primaryColor: "#7A263A", secondaryColor: "#006341" },
  { abbr: "JUV", fullName: "Juventus", primaryColor: "#000000", secondaryColor: "#FFFFFF" },
  { abbr: "PAC", fullName: "CF Pachuca", primaryColor: "#0033A0", secondaryColor: "#FFFFFF" },
  { abbr: "PAL", fullName: "Palmeiras", primaryColor: "#006437", secondaryColor: "#FFFFFF" },
  {
    abbr: "MSU",
    fullName: "Mamelodi Sundowns FC",
    primaryColor: "#FFD100",
    secondaryColor: "#0057B8",
  },
  { abbr: "MCI", fullName: "Manchester City", primaryColor: "#6CABDD", secondaryColor: "#FFFFFF" },
  { abbr: "RMA", fullName: "Real Madrid", primaryColor: "#FFFFFF", secondaryColor: "#FEBE10" },
  { abbr: "SAL", fullName: "FC Salzburg", primaryColor: "#ED1C24", secondaryColor: "#FFFFFF" },
  { abbr: "RIV", fullName: "River Plate", primaryColor: "#FFFFFF", secondaryColor: "#D50032" },
  { abbr: "SLB", fullName: "SL Benfica", primaryColor: "#E41B13", secondaryColor: "#FFFFFF" },
  { abbr: "ULS", fullName: "Ulsan HD FC", primaryColor: "#0057B8", secondaryColor: "#FFD100" },
  { abbr: "WAC", fullName: "Wydad AC", primaryColor: "#E30613", secondaryColor: "#FFFFFF" },
  { abbr: "MIA", fullName: "Inter Miami CF", primaryColor: "#F7B5CD", secondaryColor: "#231F20" },
  {
    abbr: "SEA",
    fullName: "Seattle Sounders FC",
    primaryColor: "#1DFF0B",
    secondaryColor: "#00539F",
  },
];

function hexToRgb(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return null;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return { r, g, b };
}

function contrastTextColor(primary: string, secondary: string) {
  const p = hexToRgb(primary);
  const s = hexToRgb(secondary);
  if (!p || !s) return "white";
  const r = (p.r + s.r) / 2;
  const g = (p.g + s.g) / 2;
  const b = (p.b + s.b) / 2;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.6 ? "black" : "white";
}

function resolveCwcTeam(team: string) {
  const value = normalize(team);
  if (!value) return null;
  return CWC_TEAMS.find((t) => normalize(t.fullName) === value) ??
    CWC_TEAMS.find((t) => normalize(t.abbr) === value) ??
    CWC_TEAMS.find((t) => t.altNames?.some((alt) => normalize(alt) === value)) ??
    CWC_TEAMS.find((t) => value.includes(normalize(t.fullName))) ??
    CWC_TEAMS.find((t) => t.altNames?.some((alt) => value.includes(normalize(alt)))) ??
    CWC_TEAMS.find((t) => value.includes(normalize(t.abbr)));
}

function cwcSwatchStyle(team: CwcTeam): CSSProperties {
  return {
    background: `linear-gradient(135deg, ${team.primaryColor}, ${team.secondaryColor})`,
    color: contrastTextColor(team.primaryColor, team.secondaryColor),
  };
}

type NflTeam = {
  id: string;
  abbr: string;
  city: string;
  name: string;
  fullName: string;
  primaryColor: string;
  textColor: string;
};

const NFL_TEAMS: NflTeam[] = [
  { id: "ari", abbr: "ARI", city: "Arizona", name: "Cardinals", fullName: "Arizona Cardinals", primaryColor: "#97233F", textColor: "#FFFFFF" },
  { id: "atl", abbr: "ATL", city: "Atlanta", name: "Falcons", fullName: "Atlanta Falcons", primaryColor: "#A71930", textColor: "#FFFFFF" },
  { id: "bal", abbr: "BAL", city: "Baltimore", name: "Ravens", fullName: "Baltimore Ravens", primaryColor: "#241773", textColor: "#FFFFFF" },
  { id: "buf", abbr: "BUF", city: "Buffalo", name: "Bills", fullName: "Buffalo Bills", primaryColor: "#00338D", textColor: "#FFFFFF" },
  { id: "car", abbr: "CAR", city: "Carolina", name: "Panthers", fullName: "Carolina Panthers", primaryColor: "#0085CA", textColor: "#FFFFFF" },
  { id: "chi", abbr: "CHI", city: "Chicago", name: "Bears", fullName: "Chicago Bears", primaryColor: "#0B162A", textColor: "#FFFFFF" },
  { id: "cin", abbr: "CIN", city: "Cincinnati", name: "Bengals", fullName: "Cincinnati Bengals", primaryColor: "#FB4F14", textColor: "#000000" },
  { id: "cle", abbr: "CLE", city: "Cleveland", name: "Browns", fullName: "Cleveland Browns", primaryColor: "#311D00", textColor: "#FFFFFF" },
  { id: "dal", abbr: "DAL", city: "Dallas", name: "Cowboys", fullName: "Dallas Cowboys", primaryColor: "#041E42", textColor: "#FFFFFF" },
  { id: "den", abbr: "DEN", city: "Denver", name: "Broncos", fullName: "Denver Broncos", primaryColor: "#FB4F14", textColor: "#000000" },
  { id: "det", abbr: "DET", city: "Detroit", name: "Lions", fullName: "Detroit Lions", primaryColor: "#0076B6", textColor: "#FFFFFF" },
  { id: "gb", abbr: "GB", city: "Green Bay", name: "Packers", fullName: "Green Bay Packers", primaryColor: "#203731", textColor: "#FFB612" },
  { id: "hou", abbr: "HOU", city: "Houston", name: "Texans", fullName: "Houston Texans", primaryColor: "#03202F", textColor: "#FFFFFF" },
  { id: "ind", abbr: "IND", city: "Indianapolis", name: "Colts", fullName: "Indianapolis Colts", primaryColor: "#002C5F", textColor: "#FFFFFF" },
  { id: "jax", abbr: "JAX", city: "Jacksonville", name: "Jaguars", fullName: "Jacksonville Jaguars", primaryColor: "#006778", textColor: "#FFFFFF" },
  { id: "kc", abbr: "KC", city: "Kansas City", name: "Chiefs", fullName: "Kansas City Chiefs", primaryColor: "#E31837", textColor: "#FFFFFF" },
  { id: "lv", abbr: "LV", city: "Las Vegas", name: "Raiders", fullName: "Las Vegas Raiders", primaryColor: "#000000", textColor: "#FFFFFF" },
  { id: "lac", abbr: "LAC", city: "Los Angeles", name: "Chargers", fullName: "Los Angeles Chargers", primaryColor: "#0080C6", textColor: "#FFFFFF" },
  { id: "lar", abbr: "LAR", city: "Los Angeles", name: "Rams", fullName: "Los Angeles Rams", primaryColor: "#003594", textColor: "#FFFFFF" },
  { id: "mia", abbr: "MIA", city: "Miami", name: "Dolphins", fullName: "Miami Dolphins", primaryColor: "#008E97", textColor: "#FFFFFF" },
  { id: "min", abbr: "MIN", city: "Minnesota", name: "Vikings", fullName: "Minnesota Vikings", primaryColor: "#4F2683", textColor: "#FFFFFF" },
  { id: "ne", abbr: "NE", city: "New England", name: "Patriots", fullName: "New England Patriots", primaryColor: "#002244", textColor: "#FFFFFF" },
  { id: "no", abbr: "NO", city: "New Orleans", name: "Saints", fullName: "New Orleans Saints", primaryColor: "#D3BC8D", textColor: "#000000" },
  { id: "nyg", abbr: "NYG", city: "New York", name: "Giants", fullName: "New York Giants", primaryColor: "#0B2265", textColor: "#FFFFFF" },
  { id: "nyj", abbr: "NYJ", city: "New York", name: "Jets", fullName: "New York Jets", primaryColor: "#125740", textColor: "#FFFFFF" },
  { id: "phi", abbr: "PHI", city: "Philadelphia", name: "Eagles", fullName: "Philadelphia Eagles", primaryColor: "#004C54", textColor: "#FFFFFF" },
  { id: "pit", abbr: "PIT", city: "Pittsburgh", name: "Steelers", fullName: "Pittsburgh Steelers", primaryColor: "#FFB612", textColor: "#000000" },
  { id: "sea", abbr: "SEA", city: "Seattle", name: "Seahawks", fullName: "Seattle Seahawks", primaryColor: "#002244", textColor: "#69BE28" },
  { id: "sf", abbr: "SF", city: "San Francisco", name: "49ers", fullName: "San Francisco 49ers", primaryColor: "#AA0000", textColor: "#FFFFFF" },
  { id: "tb", abbr: "TB", city: "Tampa Bay", name: "Buccaneers", fullName: "Tampa Bay Buccaneers", primaryColor: "#D50A0A", textColor: "#FFFFFF" },
  { id: "ten", abbr: "TEN", city: "Tennessee", name: "Titans", fullName: "Tennessee Titans", primaryColor: "#0C2340", textColor: "#FFFFFF" },
  { id: "was", abbr: "WAS", city: "Washington", name: "Commanders", fullName: "Washington Commanders", primaryColor: "#5A1414", textColor: "#FFFFFF" },
];

function resolveNflTeam(team: string) {
  const value = normalize(team);
  if (!value) return null;
  return (
    NFL_TEAMS.find((t) => normalize(t.fullName) === value) ??
    NFL_TEAMS.find((t) => normalize(t.name) === value) ??
    NFL_TEAMS.find((t) => normalize(t.city) === value) ??
    NFL_TEAMS.find((t) => normalize(t.abbr) === value) ??
    NFL_TEAMS.find((t) => value.includes(normalize(t.fullName))) ??
    NFL_TEAMS.find((t) => value.includes(normalize(t.name)))
  );
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

const QUALITY_FILTER_BUCKETS = ["ALL", "NEEDS_ATTENTION", "HIGH_PRIORITY", "COMPLETE"] as const;
type QualityFilterBucket = (typeof QUALITY_FILTER_BUCKETS)[number];
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

// Collector helpers
function hasParallel(c: MyCard) {
  const v = normalize(c.variation);
  const p = normalize(c.parallel);
  return !!(v || p);
}
function isNumbered(c: MyCard) {
  const total = c.serialTotal;
  return typeof total === "number" && Number.isFinite(total) && total > 0;
}
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
  const router = useRouter();

  const [cards, setCards] = useState<MyCard[]>([]);
  const [collectionSummary, setCollectionSummary] = useState<CollectionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forSaleMode, setForSaleMode] = useState(false);
  const [qualityFilter, setQualityFilter] = useState<QualityFilterOption>("ALL");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLocationValue, setBulkLocationValue] = useState("");
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
  const [teamFiltersBySet, setTeamFiltersBySet] = useState<Record<string, string>>({});

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
      } catch (e: any) {
        captureError(e, { area: "binder-load" });
        if (mounted) setError(e?.message || "Failed to load cards");
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
    } catch (e: any) {
      captureError(e, { area: "binder-refresh" });
      setError(e?.message || "Failed to load cards");
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

  // Sets don't carry a sport yet (no sport/league picker in the add-card
  // form), so the Sport tab is a single "Unknown" bucket until that catalog
  // path exists.
  function resolveSport(_c: MyCard) {
    return "Unknown";
  }

  // ✅ Hide SOLD and WANT cards in binder view
  const baseList = useMemo(() => {
    return cards.filter((c) => {
      const s = c.status ?? "HAVE";
      return s !== "SOLD" && s !== "WANT";
    });
  }, [cards]);

  const afterSport = useMemo(() => {
    if (sportFilter === "ALL") return baseList;
    return baseList.filter((c) => resolveSport(c) === sportFilter);
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
      const sport = resolveSport(c);
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
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setForSaleMode(params.get("forSale") === "1");

    const needs = params.get("needs");
    if (needs === "photos" || needs === "value" || needs === "location") {
      setQualityFilter(NEEDS_FILTER_SIGNAL_ID[needs]);
    }
  }, []);

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
    } catch (e: any) {
      alert(`Bulk update failed: ${e?.message ?? "unknown error"}`);
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
    } catch (e: any) {
      alert(`Bulk delete failed: ${e?.message ?? "unknown error"}`);
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

  function setTeamFilter(key: string, team: string) {
    setTeamFiltersBySet((prev) => ({ ...prev, [key]: team }));
  }

  const activeMenuId = openMenuId ?? closingMenuId;
  const menuCard = activeMenuId ? filtered.find((c) => c.id === activeMenuId) : null;

  // ✅ stats
  const totals = useMemo(() => {
    const cardsInSport =
      sportFilter === "ALL" ? cards : cards.filter((c) => resolveSport(c) === sportFilter);

    // The shared collection summary has no sport dimension, so it's only a
    // safe substitute for the unfiltered (sportFilter === "ALL") case; a
    // specific sport tab still needs the local, per-sport computation below.
    const useSharedSummary = sportFilter === "ALL" && collectionSummary !== null;

    const totalCards = useSharedSummary
      ? collectionSummary.counts.have + collectionSummary.counts.forSale
      : cardsInSport.filter((c) => {
          const s = c.status ?? "HAVE";
          return s !== "SOLD" && s !== "WANT";
        }).length;

    const totalSpent = useSharedSummary
      ? collectionSummary.financial.totalSpent
      : cardsInSport
          .filter((c) => (c.status ?? "HAVE") !== "WANT")
          .reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

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

    const totalPortfolioValue = useSharedSummary
      ? collectionSummary.financial.portfolioValue
      : inventory.reduce((sum, c) => sum + (asNumber(c.estimatedValue) ?? 0), 0);

    const totalNetGain = useSharedSummary
      ? collectionSummary.financial.unrealizedNetGain
      : inventory.reduce((sum, c) => {
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
  }, [cards, sportFilter, collectionSummary]);

  const netTone =
    totals.totalNetGain > 0 ? "positive" : totals.totalNetGain < 0 ? "negative" : "neutral";

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
    } catch (e: any) {
      alert(`Delete failed: ${e?.message ?? "unknown error"}`);
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

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => applyBulkStatus("FOR_SALE")} disabled={bulkBusy} className="btn-secondary">
              Mark For Sale
            </button>
            {forSaleMode ? (
              <button type="button" onClick={() => router.push("/cards/for-sale")} className="btn-secondary">
                Cancel
              </button>
            ) : (
              <>
                <button type="button" onClick={() => applyBulkStatus("SOLD")} disabled={bulkBusy} className="btn-secondary">
                  Mark Sold
                </button>
                <button type="button" onClick={applyBulkDelete} disabled={bulkBusy} className="btn-destructive">
                  Delete
                </button>
              </>
            )}

            <select
              value={bulkLocationValue}
              onChange={(e) => setBulkLocationValue(e.target.value)}
              className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900"
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
              className="btn-secondary"
            >
              Apply Location
            </button>
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
  clearAllFilters={() => {
    setQ("");
    setSportFilter("ALL");
    clearCollectorFilters();
    setQualityFilter("ALL");
    setShowFilters(false);
    refresh();
  }}
/>

        {/* Search + sort + actions */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search player, set, year, grade..."
              className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-zinc-300 focus:ring-2 sm:w-80"
            />

            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 sm:w-56"
            >
              <option value="PLAYER_ASC">Sort: Player (A→Z)</option>
              <option value="YEAR_DESC">Sort: Year (newest)</option>
              <option value="SET_ASC">Sort: Set (A→Z)</option>
              <option value="TEAM_ASC">Sort: Team (A→Z)</option>
              <option value="EST_VALUE_DESC">Sort: Est. value (high→low)</option>
            </select>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              className="sm:hidden w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 whitespace-nowrap"
            >
              Filters{activeFiltersCount ? ` • ${activeFiltersCount}` : ""}
            </button>
            <button
              onClick={() => {
                setQ("");
                setSportFilter("ALL");
                clearCollectorFilters();
                setQualityFilter("ALL");
                setShowFilters(false);
                refresh();
              }}
              className="w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
            >
              Clear filters
            </button>
          </div>
        </div>

        {/* Filters panel */}
        {showFilters ? (
          <div className="rounded-lg border bg-zinc-50 p-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-zinc-600 mr-1">Location</div>
              <Link href="/cards/locations" className="text-xs text-zinc-300 underline">
                Manage
              </Link>

              {locationOptions.length === 0 ? (
                <div className="text-xs text-zinc-500">
                  No locations yet (edit a card and add Location).
                </div>
              ) : (
                <>
                  <Chip active={locationKey === "ALL"} onClick={() => setLocationKey("ALL")}>
                    All
                  </Chip>
                  {locationOptions.map((opt) => (
                    <Chip
                      key={opt.key}
                      active={locationKey === opt.key}
                      onClick={() => setLocationKey(opt.key)}
                    >
                      {opt.label}
                      {opt.count ? ` • ${opt.count}` : ""}
                    </Chip>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-zinc-600 mr-1">Insert</div>

              {insertOptions.length === 0 ? (
                <div className="text-xs text-zinc-500">No inserts yet.</div>
              ) : (
                <>
                  <Chip active={insertKey === "ALL"} onClick={() => setInsertKey("ALL")}>
                    All
                  </Chip>
                  {insertOptions.map((opt) => (
                    <Chip
                      key={opt.key}
                      active={insertKey === opt.key}
                      onClick={() => setInsertKey(opt.key)}
                    >
                      {opt.label}
                      {opt.count ? ` • ${opt.count}` : ""}
                    </Chip>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Chip active={dupOnly} onClick={() => setDupOnly((v) => !v)}>
                Duplicates{dupInfo.dupCardsCount ? ` • ${dupInfo.dupCardsCount}` : ""}
              </Chip>
              <Chip active={autoOnly} onClick={() => setAutoOnly((v) => !v)}>
                Autograph
              </Chip>
              <Chip active={patchOnly} onClick={() => setPatchOnly((v) => !v)}>
                Patch
              </Chip>
              <Chip active={rookieOnly} onClick={() => setRookieOnly((v) => !v)}>
                Rookie
              </Chip>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-zinc-600 mr-1">Parallel</div>

              {parallelOptions.length === 0 ? (
                <div className="text-xs text-zinc-500">No parallels yet.</div>
              ) : (
                <>
                  <Chip active={parallelKey === "ALL"} onClick={() => setParallelKey("ALL")}>
                    All
                  </Chip>
                  {parallelOptions.map((opt) => (
                    <Chip
                      key={opt.key}
                      active={parallelKey === opt.key}
                      onClick={() => setParallelKey(opt.key)}
                    >
                      {opt.label}
                      {opt.count ? ` • ${opt.count}` : ""}
                    </Chip>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-zinc-600 mr-1">Numbered</div>

              {numberedOptions.length === 0 ? (
                <div className="text-xs text-zinc-500">No numbered cards yet.</div>
              ) : (
                <>
                  <Chip active={numberedKey === "ALL"} onClick={() => setNumberedKey("ALL")}>
                    All
                  </Chip>
                  {numberedOptions.map((opt) => (
                    <Chip
                      key={opt.key}
                      active={numberedKey === opt.key}
                      onClick={() => setNumberedKey(opt.key)}
                    >
                      {opt.label}
                      {opt.count ? ` • ${opt.count}` : ""}
                    </Chip>
                  ))}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs font-medium text-zinc-600 mr-1">Data Quality</div>

              <Chip active={qualityFilter === "ALL"} onClick={() => setQualityFilter("ALL")}>
                All
              </Chip>
              <Chip
                active={qualityFilter === "NEEDS_ATTENTION"}
                onClick={() => setQualityFilter("NEEDS_ATTENTION")}
              >
                Needs Attention
              </Chip>
              <Chip
                active={qualityFilter === "COMPLETE"}
                onClick={() => setQualityFilter("COMPLETE")}
              >
                Complete
              </Chip>
              <Chip
                active={qualityFilter === "HIGH_PRIORITY"}
                onClick={() => setQualityFilter("HIGH_PRIORITY")}
              >
                High Priority
              </Chip>
              {qualityOptions.map((opt) => (
                <Chip
                  key={opt.key}
                  active={qualityFilter === opt.key}
                  onClick={() => setQualityFilter(opt.key)}
                >
                  {opt.label}
                  {opt.count ? ` • ${opt.count}` : ""}
                </Chip>
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  clearCollectorFilters();
                  setQualityFilter("ALL");
                  setShowFilters(false);
                }}
                className="btn-secondary"
              >
                Clear filters
              </button>

              <button
                type="button"
                onClick={() => setShowFilters(false)}
                className="btn-link"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

      {/* Stats */}
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

      {/* Binder */}
<BinderGrid isEmpty={filtered.length === 0}>
        {filtered.length === 0 ? (
          <div className="empty-state space-y-3">
            <div>No cards yet — add your first one to get started.</div>
            <Link href="/cards/new" className="btn-primary">
              Add your first card
            </Link>
          </div>
        ) : (
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
                          sharedImage={sharedImage}
                          report={report}
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
        )}
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


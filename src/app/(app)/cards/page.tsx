"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import type { SportsCard } from "@/lib/types";
import { dbDeleteCard, dbDeleteCards, dbLoadCards, dbUpsertCards } from "@/lib/db/cards";
import { cardsToCsv, downloadCsv } from "@/lib/csv";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { fetchSharedImagesByFingerprints, type SharedImage } from "@/lib/db/sharedImages";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";
import { loadImageForCard } from "@/lib/imageStore";
import { dbLoadSets, type SetEntry } from "@/lib/db/sets";
import { createClient } from "@/lib/supabase/client";

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

function currency(n: number, opts?: { accounting?: boolean }) {
  const accounting = opts?.accounting ?? false;
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString(undefined, { style: "currency", currency: "USD" });
  if (n < 0 && accounting) return `(${formatted})`;
  if (n < 0) return `-${formatted}`;
  return formatted;
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
function dupKey(c: SportsCard) {
  const player = normalize(c.playerName);
  const year = String(c.year ?? "").trim();
  const set = normalize(c.setName);
  const num = normalize(c.cardNumber ?? "");
  return `${player}__${year}__${set}__${num}`;
}

// Collector helpers
function hasParallel(c: SportsCard) {
  const v = normalize((c as any).variation);
  const p = normalize((c as any).parallel);
  return !!(v || p);
}
function isNumbered(c: SportsCard) {
  const total = (c as any).serialTotal;
  return typeof total === "number" && Number.isFinite(total) && total > 0;
}
function isAuto(c: SportsCard) {
  return !!(c as any).isAutograph;
}
function isPatch(c: SportsCard) {
  return !!(c as any).isPatch;
}
function isRookie(c: SportsCard) {
  return !!(c as any).isRookie;
}

export default function CardsPage() {
  const router = useRouter();

  const [cards, setCards] = useState<SportsCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [forSaleMode, setForSaleMode] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sharedImages, setSharedImages] = useState<Record<string, SharedImage>>({});
  const [reportMap, setReportMap] = useState<
    Record<string, { reports: number; status?: string }>
  >({});
  const [q, setQ] = useState("");
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

        // one-time migration removed (Supabase-only)

        const data = await dbLoadCards();
        if (mounted) setCards(data);
      } catch (e: any) {
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
    const fingerprints = Array.from(
      new Set(
        cards.map((c) =>
          buildCardFingerprint({
            year: c.year,
            setName: c.setName,
            cardNumber: c.cardNumber,
            playerName: c.playerName,
            team: c.team,
            insert: (c as any).insert ?? "",
            variation: (c as any).variation ?? "",
            parallel: (c as any).parallel ?? "",
            serialTotal: (c as any).serialTotal,
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

      // one-time migration removed (Supabase-only)

      const data = await dbLoadCards();
      setCards(data);
    } catch (e: any) {
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
    downloadCsv(`thebindr-${new Date().toISOString().slice(0, 10)}.csv`, csv);
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

  const [setEntries, setSetEntries] = useState<SetEntry[]>([]);

  useEffect(() => {
    let active = true;
    dbLoadSets()
      .then((sets) => {
        if (active) setSetEntries(sets);
      })
      .catch(() => {
        if (active) setSetEntries([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const setSportMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of setEntries) {
      if (!entry.sport) continue;
      const key = `${normalize(entry.name)}__${String(entry.year ?? "").trim()}`;
      map.set(key, entry.sport);
    }
    return map;
  }, [setEntries]);

  function resolveSport(c: SportsCard) {
    const year = String(c.year ?? "").trim();
    const setName = String(c.setName ?? "").trim();
    if (!year || !setName) return "Unknown";
    const key = `${normalize(setName)}__${year}`;
    return setSportMap.get(key) ?? "Unknown";
  }

  // ✅ Hide SOLD cards in binder view
  const baseList = useMemo(() => {
    return cards.filter((c) => (c.status ?? "HAVE") !== "SOLD");
  }, [cards]);

  const afterSport = useMemo(() => {
    if (sportFilter === "ALL") return baseList;
    return baseList.filter((c) => resolveSport(c) === sportFilter);
  }, [baseList, sportFilter, setSportMap]);

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
  }, [baseList, setSportMap]);

  // ✅ Location chips source
  const locationOptions = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();

    for (const c of afterSport) {
      const raw = (((c as any).location as string | undefined) ?? "").trim();
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
      const raw = (((c as any).insert as string | undefined) ?? "").trim();
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
      const raw = (((c as any).parallel as string | undefined) ?? "").trim();
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
      const total = (c as any).serialTotal as number | undefined;
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
    if (!dupOnly) return afterSport;
    return afterSport.filter((c) => dupInfo.dupKeys.has(dupKey(c)));
  }, [afterSport, dupOnly, dupInfo.dupKeys]);

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
      const loc = (((c as any).location as string | undefined) ?? "").trim();
      if (!loc) return false;
      return normalize(loc) === locationKey;
    });
  }, [afterCollectorFlags, locationKey]);

  // ✅ insert filter
  const afterInsert = useMemo(() => {
    if (insertKey === "ALL") return afterLocation;
    return afterLocation.filter((c) => {
      const ins = (((c as any).insert as string | undefined) ?? "").trim();
      if (!ins) return false;
      return normalize(ins) === insertKey;
    });
  }, [afterLocation, insertKey]);

  // ✅ parallel filter
  const afterParallel = useMemo(() => {
    if (parallelKey === "ALL") return afterInsert;
    return afterInsert.filter((c) => {
      const raw = (((c as any).parallel as string | undefined) ?? "").trim();
      if (!raw) return false;
      return normalize(raw) === parallelKey;
    });
  }, [afterInsert, parallelKey]);

  // ✅ numbered filter
  const afterNumbered = useMemo(() => {
    if (numberedKey === "ALL") return afterParallel;
    return afterParallel.filter((c) => {
      const total = (c as any).serialTotal as number | undefined;
      if (typeof total !== "number") return false;
      return String(total) === numberedKey;
    });
  }, [afterParallel, numberedKey]);

  // ✅ search + status
  const searched = useMemo(() => {
    const query = q.trim().toLowerCase();

    return afterNumbered.filter((c) => {
      if (!query) return true;

      const hay = [
        c.playerName,
        c.year,
        c.setName,
        c.cardNumber ?? "",
        c.team ?? "",
        (c as any).location ?? "",
        (c as any).insert ?? "",
        c.grader ?? "",
        c.grade ?? "",
        (c as any).variation ?? "",
        (c as any).parallel ?? "",
        (c as any).serialTotal ? `/${(c as any).serialTotal}` : "",
        c.notes ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(query);
    });
  }, [afterNumbered, q]);

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
        const ap = asNumber((a as any).estimatedValue) ?? -1;
        const bp = asNumber((b as any).estimatedValue) ?? -1;
        if (bp !== ap) return bp - ap;
        return normalize(a.playerName).localeCompare(normalize(b.playerName));
      }

      return normalize(a.playerName).localeCompare(normalize(b.playerName));
    });

    return list;
  }, [searched, sortMode]);

  const groupedBySet = useMemo(() => {
    const map = new Map<string, { label: string; cards: SportsCard[] }>();
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

  async function applyBulkStatus(nextStatus: SportsCard["status"]) {
    if (!selectedIds.size || bulkBusy) return;
    const now = new Date().toISOString();
    const selectedCards = cards.filter((c) => selectedIds.has(c.id));
    const updatedCards = selectedCards.map((c) => ({
      ...c,
      status: nextStatus,
      updatedAt: now,
    }));

    setBulkBusy(true);
    try {
      await dbUpsertCards(updatedCards);
      setCards((prev) =>
        prev.map((c) => {
          const updated = selectedIds.has(c.id)
            ? updatedCards.find((u) => u.id === c.id)
            : null;
          return updated ?? c;
        })
      );
      clearSelection();
      if (forSaleMode && nextStatus === "FOR_SALE") {
        router.push("/cards/for-sale");
      }
    } catch (e: any) {
      alert(`Bulk update failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setBulkBusy(false);
    }
  }

  async function applyBulkDelete() {
    if (!selectedIds.size || bulkBusy) return;
    const confirmed = window.confirm(`Delete ${selectedIds.size} cards? This cannot be undone.`);
    if (!confirmed) return;

    setBulkBusy(true);
    try {
      await dbDeleteCards(Array.from(selectedIds));
      setCards((prev) => prev.filter((c) => !selectedIds.has(c.id)));
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

    const totalCards = cardsInSport.filter((c) => (c.status ?? "HAVE") !== "SOLD").length;

    const totalSpent = cardsInSport
      .filter((c) => (c.status ?? "HAVE") !== "WANT")
      .reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

    const soldCards = cardsInSport.filter((c) => (c.status ?? "HAVE") === "SOLD");
    const totalSold = soldCards.reduce((sum, c) => sum + (asNumber((c as any).soldPrice) ?? 0), 0);

    const costOfSold = soldCards.reduce((sum, c) => sum + (asNumber(c.purchasePrice) ?? 0), 0);

    const forSaleValue = cardsInSport
      .filter((c) => (c.status ?? "HAVE") === "FOR_SALE")
      .reduce((sum, c) => sum + (asNumber((c as any).askingPrice) ?? 0), 0);

    const netPosition = totalSold - totalSpent;

    const graded = cardsInSport.filter((c) => c.condition === "GRADED").length;
    const raw = Math.max(0, cardsInSport.length - graded);

    const inventory = cardsInSport.filter((c) => {
      const s = c.status ?? "HAVE";
      return s !== "SOLD" && s !== "WANT";
    });

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
      forSaleValue,
      costOfSold,
      graded,
      raw,
      staleCount,
      ageCount,
      avgAge,
      medianAge,
    };
  }, [cards, sportFilter, setSportMap]);

  const netTone =
    totals.netPosition > 0 ? "positive" : totals.netPosition < 0 ? "negative" : "neutral";

  const activeFiltersCount =
    (dupOnly ? 1 : 0) +
    (parallelKey !== "ALL" ? 1 : 0) +
    (numberedKey !== "ALL" ? 1 : 0) +
    (autoOnly ? 1 : 0) +
    (patchOnly ? 1 : 0) +
    (rookieOnly ? 1 : 0) +
    (locationKey !== "ALL" ? 1 : 0) +
    (insertKey !== "ALL" ? 1 : 0);

  function labelForCard(c: SportsCard) {
    return `${c.playerName} • ${c.year} • ${c.setName}${c.cardNumber ? ` #${c.cardNumber}` : ""}`;
  }

  function confirmDelete(c: SportsCard) {
    setOpenMenuId(null);
    setDeleteTarget({ id: c.id, label: labelForCard(c) });
  }

  async function doDelete() {
    if (!deleteTarget) return;

    try {
      await dbDeleteCard(deleteTarget.id);
      setCards((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch (e: any) {
      alert(`Delete failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Binder</h1>
          </div>

          {!forSaleMode ? (
            <div className="flex gap-2">
              <Link
                href="/cards/new"
                className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
              >
                Add to Binder
              </Link>
            </div>
          ) : (
            <div className="flex gap-2">
              <Link
                href="/cards/for-sale"
                className="rounded-md border bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Return to For Sale
              </Link>
            </div>
          )}
        </div>
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
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-sm text-zinc-500 underline"
                >
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
            <button
              type="button"
              onClick={() => applyBulkStatus("FOR_SALE")}
              disabled={bulkBusy}
              className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
            >
              Mark For Sale
            </button>
            {forSaleMode ? (
              <button
                type="button"
                onClick={() => router.push("/cards/for-sale")}
                className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => applyBulkStatus("SOLD")}
                  disabled={bulkBusy}
                  className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Mark Sold
                </button>
                <button
                  type="button"
                  onClick={applyBulkDelete}
                  disabled={bulkBusy}
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border bg-white p-3 text-sm text-zinc-700">Loading…</div>
      ) : null}

      {/* ✅ Clean control card */}
      <div className="rounded-xl border bg-white p-3 space-y-3">
        {/* Sport row */}
        <div className="flex items-center justify-between gap-2">
          {/* ✅ Mobile: dropdown */}
          <div className="w-full sm:hidden">
            <label className="block text-[11px] font-medium text-zinc-600 mb-1">Sport</label>
            <select
              value={sportFilter}
              onChange={(e) => setSportAndReset(e.target.value)}
              className="w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900"
            >
              <option value="ALL">All</option>
              {sportOptions.map((o) => (
                <option key={o.key} value={o.label}>
                  {o.label}
                  {o.count ? ` (${o.count})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* ✅ Desktop: tabs */}
          <div className="hidden sm:flex gap-2 overflow-x-auto whitespace-nowrap pb-1">
            <Tab active={sportFilter === "ALL"} onClick={() => setSportAndReset("ALL")}>
              All
            </Tab>
            {sportOptions.map((o) => (
              <Tab
                key={o.key}
                active={sportFilter === o.label}
                onClick={() => setSportAndReset(o.label)}
                variant={
                  o.label === "Football" ? "football" : o.label === "Soccer" ? "soccer" : "default"
                }
              >
                {o.label}
                {o.count ? ` • ${o.count}` : ""}
              </Tab>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="hidden sm:inline-flex w-18 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50 whitespace-nowrap"
          >
            Filters{activeFiltersCount ? ` • ${activeFiltersCount}` : ""}
          </button>
        </div>

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

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  clearCollectorFilters();
                  setShowFilters(false);
                }}
                className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50"
              >
                Clear filters
              </button>

              <button
                type="button"
                onClick={() => setShowFilters(false)}
              className="text-sm text-zinc-300 underline"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total cards" value={`${totals.totalCards}`} />
        <Stat label="Total spent" value={currency(totals.totalSpent)} />
        <Stat label="Total sold" value={currency(totals.totalSold)} />
        <Stat
          label="Net position"
          value={currency(totals.netPosition, { accounting: true })}
          tone={netTone}
        />
      </div>

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
      <div className="rounded-xl border border-black bg-zinc-50 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-zinc-600">
            Your Binder is empty. Add your first card.
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
                <div key={group.key}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSetCollapse(group.key)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      toggleSetCollapse(group.key);
                    }
                  }}
                  className={
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-white bg-[#2b323a] cursor-pointer " +
                    (collapsedSets.has(group.key) && index === groupedBySet.length - 1
                      ? "rounded-b-xl"
                      : "")
                  }
                >
                  <div className="inline-flex items-center gap-2 text-left">
                    <span>{collapsedSets.has(group.key) ? "▸" : "▾"}</span>
                    <span>{group.label}</span>
                    <span className="text-[10px] font-medium text-zinc-400">
                      ({countLabel})
                    </span>
                  </div>

                  {group.cards.length ? (
                    <div className="ml-auto flex flex-wrap items-center gap-1 text-[10px]">
                      {/** team swatches */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setTeamFilter(group.key, "ALL");
                        }}
                        className={
                          "rounded-full border border-white/20 px-2 py-0.5 uppercase tracking-wide transition " +
                          ((teamFiltersBySet[group.key] ?? "ALL") === "ALL"
                            ? "bg-white text-zinc-900"
                            : "bg-white/10 text-white hover:bg-white/20")
                        }
                      >
                        All
                      </button>
                      {Array.from(
                        new Set(
                          group.cards
                            .map((c) => (c.team ?? "").trim())
                            .filter((t) => t.length > 0)
                        )
                      )
                        .sort((a, b) => a.localeCompare(b))
                        .map((team) => {
                          const isCwcSet = group.key === CWC_SET_KEY;
                          const selected = (teamFiltersBySet[group.key] ?? "ALL") === team;
                          const resolvedCwc = isCwcSet ? resolveCwcTeam(team) : null;
                          const resolvedNfl = !isCwcSet ? resolveNflTeam(team) : null;
                          const swatchStyle = resolvedCwc
                            ? cwcSwatchStyle(resolvedCwc)
                            : resolvedNfl
                            ? { backgroundColor: resolvedNfl.primaryColor, color: resolvedNfl.textColor }
                            : teamSwatchStyle(team);
                          const label = resolvedCwc?.abbr ?? resolvedNfl?.abbr ?? team;
                          return (
                            <button
                              key={team}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setTeamFilter(group.key, team);
                              }}
                              style={swatchStyle}
                              className={
                                "h-6 w-6 rounded-full text-[9px] font-bold uppercase tracking-wide flex items-center justify-center shadow-sm transition " +
                                (selected ? "ring-2 ring-white/80" : "hover:brightness-110")
                              }
                              title={resolvedCwc?.fullName ?? resolvedNfl?.fullName ?? team}
                            >
                              {label}
                            </button>
                          );
                        })}
                    </div>
                  ) : null}
                </div>
                {!collapsedSets.has(group.key) ? (
                  <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {teamFilteredCards.map((c) => {
                      const status = c.status ?? "HAVE";

                      const variation = (c as any).variation as string | undefined;
                      const parallel = (c as any).parallel as string | undefined;

                      const serialNumber = (c as any).serialNumber as number | undefined;
                      const serialTotal = (c as any).serialTotal as number | undefined;

                      const serial =
                        typeof serialNumber === "number" && typeof serialTotal === "number"
                          ? `${serialNumber}/${serialTotal}`
                          : typeof serialTotal === "number"
                          ? `/${serialTotal}`
                          : "";

                      const asking = asNumber((c as any).askingPrice);
                      const sold = asNumber((c as any).soldPrice);

                      const insert = (((c as any).insert as string | undefined) ?? "").trim();

                      const fingerprint = buildCardFingerprint({
                        year: c.year,
                        setName: c.setName,
                        cardNumber: c.cardNumber,
                        playerName: c.playerName,
                        team: c.team,
                        insert,
                        variation,
                        parallel,
                        serialTotal,
                      });
                      const sharedImage = fingerprint ? sharedImages[fingerprint] : null;
                      const report = fingerprint ? reportMap[fingerprint] : undefined;
                      const hideImage =
                        !!report &&
                        (report.status === "blocked" ||
                          (report.reports ?? 0) >= REPORT_HIDE_THRESHOLD);
                      const storedImage = loadImageForCard(c.id);
                      const thumbUrl = (c as any).thumbUrl as string | undefined;
                      const displayImage = hideImage
                        ? ""
                        : storedImage ??
                          ((c as any).imageUrl as string | undefined) ??
                          sharedImage?.dataUrl ??
                          thumbUrl ??
                          "";

                      const rowHref = `/cards/${c.id}`;

                      const est = asNumber((c as any).estimatedValue);
                      const priceLabel =
                        status === "SOLD" && typeof sold === "number"
                          ? currency(sold)
                          : status === "FOR_SALE" && typeof asking === "number"
                          ? currency(asking)
                          : typeof est === "number"
                          ? currency(est)
                          : "—";

                      return (
                        <div key={c.id} className="relative">
                          <div className="absolute left-2 top-2 z-20">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(c.id)}
                              onChange={(e) => {
                                toggleSelected(c.id, e.target.checked);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="h-4 w-4 accent-zinc-900"
                            />
                          </div>
                          <Link
                            href={rowHref}
                            className="block rounded-lg border border-zinc-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                          >
                            <div className="p-3">
                              <div className="aspect-[2.5/3.5] flex flex-col gap-2 rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-2">
                                <div className="aspect-[2.5/3.5] w-full rounded-md border border-zinc-200 bg-white/70 flex items-center justify-center overflow-hidden">
                                  {displayImage ? (
                                    <img
                                      src={displayImage}
                                      alt={`${c.playerName} ${c.cardNumber ?? ""}`.trim()}
                                      className="h-full w-full object-contain"
                                    />
                                  ) : hideImage ? (
                                    <div className="text-[10px] text-zinc-500 text-center px-2">
                                      Image hidden (reported)
                                    </div>
                                  ) : (
                                    <div className="text-[10px] text-zinc-500 text-center px-2">
                                      No image
                                    </div>
                                  )}
                                </div>

                                <div className="h-[112px] overflow-hidden">
                                  <div className="truncate text-[10px] uppercase tracking-wide text-zinc-500">
                                    {c.year} • {c.setName}
                                  </div>
                                  <div className="mt-1 max-h-[2.6em] overflow-hidden text-sm font-semibold leading-snug text-zinc-900">
                                    {c.playerName}
                                  </div>
                                  {c.cardNumber ? (
                                    <div className="text-[11px] text-zinc-500">
                                      No. {c.cardNumber}
                                    </div>
                                  ) : null}
                                  {c.team ? (
                                    <div className="truncate text-[11px] text-zinc-500">
                                      {c.team}
                                    </div>
                                  ) : null}
                                  <div className="mt-2 max-h-[46px] overflow-hidden flex flex-wrap gap-1 text-[11px]">
                                    {variation ? <MiniBadge>{variation}</MiniBadge> : null}
                                    {insert ? <MiniBadge>{insert}</MiniBadge> : null}
                                    {parallel ? (
                                      <MiniBadge tone={parallelBadgeTone(parallel)}>
                                        {parallel}
                                      </MiniBadge>
                                    ) : null}
                                    {serial ? <MiniBadge>#{serial}</MiniBadge> : null}
                                    {(c as any).isRookie ? (
                                      <MiniBadge>
                                        <span className="uppercase tracking-wider">Rookie</span>
                                      </MiniBadge>
                                    ) : null}
                                    {(c as any).isAutograph ? (
                                      <MiniBadge tone="purple">Auto</MiniBadge>
                                    ) : null}
                                    {(c as any).isPatch ? (
                                      <MiniBadge tone="amber">Patch</MiniBadge>
                                    ) : null}
                                  </div>
                                </div>
                              </div>

                              <div className="mt-2 flex items-center justify-between text-xs">
                                <span className="tabular-nums text-zinc-600">{priceLabel}</span>
                              </div>
                            </div>
                          </Link>

                          {/* ✅ Kebab button (does NOT navigate) */}
                          <div className="absolute right-2 top-2 z-20" data-row-menu>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId((prev) => (prev === c.id ? null : c.id));
                                if (openMenuId === c.id) return;
                                setMenuAnchor(e.currentTarget as HTMLButtonElement);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="rounded-full bg-white/90 p-2 text-zinc-600 shadow-sm hover:bg-white hover:text-zinc-900"
                              aria-label="Row actions"
                              title="Actions"
                            >
                              <IconDots />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {menuCard && menuPos && activeMenuId
        ? createPortal(
            <div
              data-row-menu
              onClick={(e) => e.stopPropagation()}
              className={
                "fixed z-[9999] w-44 overflow-hidden rounded-xl border bg-white shadow-xl " +
                "origin-top-right transition duration-150 " +
                (openMenuId ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-95")
              }
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpenMenuId(null);
                  router.push(`/cards/${menuCard.id}/edit`);
                }}
                className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
              >
                Edit
              </button>

              {(menuCard.status ?? "HAVE") !== "SOLD" ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpenMenuId(null);
                    router.push(`/cards/${menuCard.id}/sold`);
                  }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-50"
                >
                  Mark as Sold
                </button>
              ) : null}

              <button
                type="button"
                onClick={() => confirmDelete(menuCard)}
                className="w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
              >
                Delete…
              </button>
            </div>,
            document.body
          )
        : null}

      <p className="text-xs text-zinc-500">
        Tip: On mobile, Sport is a dropdown. On desktop, it’s tabs. Use the ⋯ button on a row for
        Edit / Sold / Delete.
      </p>

      {/* ✅ Delete confirmation modal */}
      {deleteTarget ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-semibold">Delete card?</div>
            <div className="mt-1 text-sm text-zinc-600">
              This will permanently remove:
              <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
                {deleteTarget.label}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- components ---------- */

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "positive" | "negative";
}) {
  const valueClass =
    tone === "positive"
      ? "text-emerald-700"
      : tone === "negative"
      ? "text-red-700"
      : "text-zinc-900";

  const borderClass =
    tone === "positive"
      ? "border-emerald-200 bg-emerald-50"
      : tone === "negative"
      ? "border-red-200 bg-red-50"
      : "border-zinc-200 bg-white";

  return (
    <div className={`rounded-xl border p-4 ${borderClass}`}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
  variant = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant?: "default" | "football" | "soccer";
}) {
  const base =
    "inline-flex whitespace-nowrap items-center rounded-full px-3 py-2 text-sm font-semibold transition";
  const cls =
    variant === "football"
      ? active
        ? "border border-[#4a2a14] bg-[#7a3f22] text-[#fff3e1] shadow-[0_0_0_1px_rgba(210,164,108,0.55)]"
        : "border border-[#5a2f18] bg-[#8b4a2b] text-[#fff3e1] hover:bg-[#7f4226]"
      : variant === "soccer"
      ? active
        ? "border border-zinc-900 bg-white text-black shadow-[0_0_0_1px_rgba(24,24,27,0.35)]"
        : "border border-zinc-900 bg-white text-black hover:bg-zinc-50"
      : active
      ? "bg-[#2b323a] text-white"
      : "bg-zinc-100 text-zinc-800 hover:bg-zinc-200";

  return (
    <button type="button" onClick={onClick} className={`${base} ${cls}`}>
      {children}
    </button>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex whitespace-nowrap items-center rounded-full border px-3 py-1 text-xs font-medium transition " +
        (active
          ? "border-zinc-900 bg-[#2b323a] text-white"
          : "border-zinc-400 bg-white text-zinc-800 hover:bg-zinc-50")
      }
    >
      {children}
    </button>
  );
}

type BadgeTone =
  | "zinc"
  | "blue"
  | "dots-blue"
  | "purple"
  | "amber"
  | "red"
  | "green"
  | "orange"
  | "yellow"
  | "pink"
  | "teal"
  | "black"
  | "white"
  | "silver"
  | "gold"
  | "lava";

function MiniBadge({
  children,
  tone = "zinc",
}: {
  children: React.ReactNode;
  tone?: BadgeTone;
}) {
  const isDotsBlue = tone === "dots-blue";
  const cls =
    tone === "dots-blue"
      ? "border-blue-200 bg-blue-50 text-blue-700"
      : tone === "blue"
      ? "border-zinc-300 bg-zinc-100 text-zinc-200"
      : tone === "purple"
      ? "border-purple-200 bg-purple-50 text-purple-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "red"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "orange"
      ? "border-orange-200 bg-orange-50 text-orange-700"
      : tone === "yellow"
      ? "border-yellow-200 bg-yellow-50 text-yellow-800"
      : tone === "pink"
      ? "border-pink-200 bg-pink-50 text-pink-700"
      : tone === "teal"
      ? "border-teal-200 bg-teal-50 text-teal-700"
      : tone === "lava"
      ? "border-orange-300 bg-orange-100 text-red-700"
      : tone === "black"
      ? "border-zinc-800 bg-[#2b323a] text-white"
      : tone === "white"
      ? "border-zinc-200 bg-white text-zinc-900"
      : tone === "silver"
      ? "border-zinc-200 bg-zinc-100 text-zinc-800"
      : tone === "gold"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-zinc-200 bg-white text-zinc-700";

  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}
      style={
        isDotsBlue
          ? {
              backgroundImage: "radial-gradient(rgba(59,130,246,0.22) 1px, transparent 1px)",
              backgroundSize: "7px 7px",
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

function parallelBadgeTone(parallel?: string): BadgeTone | undefined {
  if (!parallel) return undefined;
  const p = parallel.toLowerCase();
  if (p.includes("dots blue")) return "dots-blue";
  if (p.includes("lava")) return "lava";
  if (p.includes("black")) return "black";
  if (p.includes("white")) return "white";
  if (p.includes("silver")) return "silver";
  if (p.includes("gold")) return "gold";
  if (p.includes("red")) return "red";
  if (p.includes("blue")) return "blue";
  if (p.includes("green")) return "green";
  if (p.includes("orange")) return "orange";
  if (p.includes("yellow")) return "yellow";
  if (p.includes("pink")) return "pink";
  if (p.includes("purple")) return "purple";
  if (p.includes("teal")) return "teal";
  return undefined;
}

function IconDots() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="6.5" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="17.5" r="1.3" />
    </svg>
  );
}

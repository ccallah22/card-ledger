"use client";

import { useMemo, useState } from "react";

type Entry = {
  number: string;
  name: string;
  team?: string;
  section: string;
};

type ParseResult = {
  entries: Entry[];
  sectionParallels: Record<string, string[]>;
  error?: string;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = false;
        continue;
      }
      cell += ch;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      cell = "";
      if (row.some((v) => v.length)) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\r") {
      continue;
    }
    cell += ch;
  }

  row.push(cell.trim());
  if (row.some((v) => v.length)) rows.push(row);
  return rows;
}

function parsePastedChecklist(text: string): ParseResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: Entry[] = [];
  let currentSection = "Base";
  let collectingParallels = false;
  const sectionParallels = new Map<string, Set<string>>();

  const ignoreExact = new Set(["parallels"]);

  const ignoreStartsWith = [
    "game ticket",
    "opening kickoff ticket",
    "playoff ticket",
    "divisional ticket",
    "conference ticket",
    "ticket stub",
    "midfield ticket",
    "red zone ticket",
    "cracked ice ticket",
    "week",
    "clear ticket",
    "super bowl ticket",
    "printing plates",
    "goal line ticket",
    "fotl",
  ];

  const ignoreContains = [
    "cards",
    "checklist",
    "master card list",
    "here’s the full",
  ];

  const isSectionLine = (line: string) => {
    const lower = line.toLowerCase();
    if (/\d/.test(lower)) return false;
    if (line.includes(",")) return false;
    if (line.length > 80) return false;
    if (lower.includes("/")) return false;
    return true;
  };

  const stripSuffix = (value: string) =>
    value
      .replace(/\s*\(.*\)\s*$/, "")
      .replace(/\s*\/\d+.*$/, "")
      .trim();

  const addParallel = (section: string, line: string) => {
    const cleaned = stripSuffix(line);
    if (!cleaned || cleaned.toLowerCase() === "parallels") return;
    if (!sectionParallels.has(section)) sectionParallels.set(section, new Set());
    sectionParallels.get(section)?.add(cleaned);
  };

  const isParallelLine = (line: string) => {
    const lower = line.toLowerCase();
    if (ignoreExact.has(lower)) return true;
    if (ignoreStartsWith.some((s) => lower.startsWith(s))) return true;
    if (lower.includes("ticket") || lower.includes("zone")) return true;
    if (lower.includes("ice") || lower.includes("foil")) return true;
    if (lower.includes("prizm")) return true;
    if (lower.includes("velo")) return true;
    if (lower.includes("gold") || lower.includes("silver")) return true;
    if (lower.includes("blue") || lower.includes("green") || lower.includes("red")) return true;
    if (lower.includes("orange") || lower.includes("bronze") || lower.includes("black")) return true;
    if (lower.includes("platinum") || lower.includes("teal")) return true;
    if (lower.includes("stub") || lower.includes("clear")) return true;
    if (lower.includes("printing plates") || lower.includes("super bowl")) return true;
    if (lower.includes("week")) return true;
    return false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    if (lower === "parallels") {
      collectingParallels = true;
      continue;
    }

    if (/\s[–-]\s*#\d/.test(line)) {
      continue;
    }

    const entryMatch = line.match(/^(\d{1,4})\s+(.+)$/);
    if (entryMatch) {
      const number = entryMatch[1];
      const rest = entryMatch[2];
      const restLower = rest.toLowerCase();
      if (!rest.includes(",") || restLower.includes("checklist") || restLower.includes("cards")) {
        continue;
      }
      const [nameRaw, teamRaw] = rest.split(",").map((s) => s.trim());
      const name = stripSuffix(nameRaw || "");
      const team = teamRaw ? stripSuffix(teamRaw) : undefined;

      if (number && name) {
        entries.push({
          number,
          name,
          team,
          section: currentSection,
        });
      }
      collectingParallels = false;
      continue;
    }

    if (ignoreExact.has(lower)) continue;
    if (ignoreContains.some((s) => lower.includes(s))) continue;
    if (lower.endsWith("cards.") || lower.endsWith("cards")) continue;

    if (collectingParallels) {
      if (isParallelLine(line)) {
        addParallel(currentSection, line);
        continue;
      }
      if (isSectionLine(line)) {
        const next = lines[i + 1] ?? "";
        const nextIsEntry = /^\d{1,4}\s+.+,/.test(next);
        if (nextIsEntry) {
          currentSection = line;
          collectingParallels = false;
        } else {
          addParallel(currentSection, line);
        }
        continue;
      }
      continue;
    }

    if (isSectionLine(line)) {
      currentSection = line;
      collectingParallels = false;
      continue;
    }

    if (isParallelLine(line)) continue;
  }

  const parallelObj: Record<string, string[]> = {};
  for (const [section, values] of sectionParallels.entries()) {
    if (values.size) parallelObj[section] = Array.from(values.values());
  }

  return { entries, sectionParallels: parallelObj };
}

function parseEntries(raw: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) return { entries: [], sectionParallels: {} };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed))
        return { entries: [], sectionParallels: {}, error: "JSON must be an array." };
      const entries = parsed
        .map((r) => ({
          number: String(r?.number ?? "").trim(),
          name: String(r?.name ?? "").trim(),
          team: r?.team ? String(r.team).trim() : undefined,
          section: String(r?.section ?? "").trim(),
        }))
        .filter((r) => r.number && r.name && r.section);
      return { entries, sectionParallels: {} };
    } catch (e: any) {
      return { entries: [], sectionParallels: {}, error: e?.message || "Invalid JSON." };
    }
  }

  // CSV
  const rows = parseCsv(trimmed);
  if (!rows.length) return { entries: [], sectionParallels: {} };

  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader =
    header.includes("number") &&
    header.includes("name") &&
    header.includes("section");

  let inferredCols: { number: number; name: number; team?: number; section: number } | null = null;

  if (!hasHeader) {
    const counts = rows.map((r) => r.filter((c) => c.length).length);
    const maxCount = Math.max(0, ...counts);
    if (maxCount < 3) return { entries: [], sectionParallels: {} };

    const countByLen = new Map<number, number>();
    for (const c of counts) countByLen.set(c, (countByLen.get(c) ?? 0) + 1);
    const [commonLen] =
      [...countByLen.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

    if (!commonLen || commonLen < 3) return { entries: [], sectionParallels: {} };

    const candidates = rows.filter((r) => r.filter((c) => c.length).length === commonLen);
    const validCandidates = candidates.filter(
      (r) => /^\d+$/.test(String(r[0] ?? "").trim()) && String(r[1] ?? "").trim()
    );
    if (validCandidates.length < 5) return { entries: [], sectionParallels: {} };

    if (commonLen === 3) {
      inferredCols = { number: 0, name: 1, section: 2 };
    } else {
      inferredCols = { number: 0, name: 1, team: 2, section: 3 };
    }
  }

  const start = hasHeader ? 1 : 0;
  const col = (key: string) => (hasHeader ? header.indexOf(key) : -1);

  const numberIdx = hasHeader ? col("number") : inferredCols?.number ?? 0;
  const nameIdx = hasHeader ? col("name") : inferredCols?.name ?? 1;
  const teamIdx = hasHeader ? col("team") : inferredCols?.team ?? -1;
  const sectionIdx = hasHeader ? col("section") : inferredCols?.section ?? 3;

  if (hasHeader && (numberIdx < 0 || nameIdx < 0 || sectionIdx < 0)) {
    return {
      entries: [],
      sectionParallels: {},
      error: "CSV header must include number,name,section.",
    };
  }

  const entries: Entry[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const number = String(r[numberIdx] ?? "").trim();
    const name = String(r[nameIdx] ?? "").trim();
    const section = sectionIdx >= 0 ? String(r[sectionIdx] ?? "").trim() : "";
    const team = teamIdx >= 0 ? String(r[teamIdx] ?? "").trim() : "";
    if (!number || !name || !section) continue;
    entries.push({ number, name, section, team: team || undefined });
  }
  return { entries, sectionParallels: {} };
}

export default function ChecklistAdminPage() {
  const [setKey, setSetKey] = useState("");
  const [setYear, setSetYear] = useState("");
  const [setName, setSetName] = useState("");
  const [setBrand, setSetBrand] = useState("");
  const [setSport, setSetSport] = useState("");
  const [raw, setRaw] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const parsed = useMemo(() => {
    const trimmed = raw.trim();
    if (!trimmed) return { entries: [], sectionParallels: {} };

    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const first = lines[0] ?? "";

    const hasCsvHeader =
      /(^|,)\s*number\s*(,|$)/i.test(first) &&
      /(^|,)\s*name\s*(,|$)/i.test(first) &&
      /(^|,)\s*section\s*(,|$)/i.test(first);

    const sampled = lines.slice(0, 10).join("\n");
    const csvRows = parseCsv(sampled);
    const multiColRows = csvRows.filter((r) => r.filter((c) => c.length).length >= 3).length;
    const looksLikeCsv = hasCsvHeader || multiColRows >= 3;

    if (trimmed.startsWith("[")) return parseEntries(raw);
    if (looksLikeCsv) {
      const csv = parseEntries(raw);
      if (csv.entries.length || csv.error) return csv;
      return parsePastedChecklist(raw);
    }

    const pasted = parsePastedChecklist(raw);
    if (pasted.entries.length || pasted.error) return pasted;
    return parseEntries(raw);
  }, [raw]);
  const entries = parsed.entries;
  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries) {
      counts.set(e.section, (counts.get(e.section) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  async function upload() {
    setError("");
    setStatus("");

    const key = setKey.trim();
    if (!key) {
      setError("Set key is required.");
      return;
    }
    if (parsed.error) {
      setError(parsed.error);
      return;
    }
    if (!entries.length) {
      setError("No valid entries found.");
      return;
    }

    setLoading(true);
    try {
      const chunkSize = 500;
      let inserted = 0;
      let deleted = 0;

      for (let i = 0; i < entries.length; i += chunkSize) {
        const chunk = entries.slice(i, i + chunkSize);
        const res = await fetch("/api/checklists/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setKey: key,
            replace: replaceExisting && i === 0,
            set: {
              year: setYear.trim(),
              name: setName.trim(),
              brand: setBrand.trim(),
              sport: setSport.trim(),
            },
            entries: chunk,
            sectionParallels: replaceExisting && i === 0 ? parsed.sectionParallels : undefined,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.message || "Import failed.");
        }

        inserted += Number(data?.inserted ?? 0);
        deleted += Number(data?.deleted ?? 0);
      }

      setStatus(
        `Imported ${inserted} rows${replaceExisting ? ` (deleted ${deleted} existing)` : ""}.`
      );
    } catch (e: any) {
      setError(e?.message || "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div>
        <h1 className="text-xl font-semibold">Checklist Import</h1>
        <p className="text-sm text-zinc-600">
          Paste CSV or JSON, then import into Supabase.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-700">Set Key</span>
          <input
            value={setKey}
            onChange={(e) => setSetKey(e.target.value)}
            placeholder="score-2025"
            className="rounded-md border bg-white px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={replaceExisting}
            onChange={(e) => setReplaceExisting(e.target.checked)}
          />
          Replace existing rows for this set
        </label>
      </div>

      <div className="rounded-md border bg-white p-3 text-sm text-zinc-700">
        <div className="font-medium">Parsed Preview</div>
        <div>Parsed entries: <b>{entries.length}</b></div>
        {sectionCounts.length ? (
          <div className="mt-2 grid gap-1">
            {sectionCounts.slice(0, 8).map(([section, count]) => (
              <div key={section}>
                {section}: <b>{count}</b>
              </div>
            ))}
            {sectionCounts.length > 8 ? (
              <div>…and {sectionCounts.length - 8} more sections</div>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 text-zinc-500">No sections parsed yet.</div>
        )}
      </div>

      <div className="grid gap-2">
        <label className="text-sm text-zinc-700">Checklist Data (CSV or JSON)</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          rows={10}
          className="w-full rounded-md border bg-white p-3 text-sm"
          placeholder="CSV with headers: number,name,team,section"
        />
      </div>

      {parsed.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {parsed.error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-700">Year</span>
          <input
            value={setYear}
            onChange={(e) => setSetYear(e.target.value)}
            placeholder="2024"
            className="rounded-md border bg-white px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-700">Set Name</span>
          <input
            value={setName}
            onChange={(e) => setSetName(e.target.value)}
            placeholder="Panini Contenders"
            className="rounded-md border bg-white px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-700">Brand (optional)</span>
          <input
            value={setBrand}
            onChange={(e) => setSetBrand(e.target.value)}
            placeholder="Panini"
            className="rounded-md border bg-white px-3 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-zinc-700">Sport (optional)</span>
          <input
            value={setSport}
            onChange={(e) => setSetSport(e.target.value)}
            placeholder="Football"
            className="rounded-md border bg-white px-3 py-2"
          />
        </label>
      </div>

      <div className="text-sm text-zinc-600">
        Parsed entries: <b>{entries.length}</b>
      </div>

      <div className="flex gap-2">
        <button
          onClick={upload}
          disabled={loading}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Importing…" : "Import"}
        </button>
      </div>

      {status ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">
          {status}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}

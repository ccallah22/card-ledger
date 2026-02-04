"use client";

import { useMemo, useState } from "react";

type Entry = {
  number: string;
  name: string;
  team?: string;
  section: string;
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

function parsePastedChecklist(text: string): Entry[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const entries: Entry[] = [];
  let currentSection = "Base";

  const ignoreExact = new Set([
    "base set",
    "parallels",
    "retail",
  ]);

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

  for (const line of lines) {
    const lower = line.toLowerCase();

    const entryMatch = line.match(/^(\d{1,4})\s+(.+)$/);
    if (entryMatch) {
      const number = entryMatch[1];
      const rest = entryMatch[2];
      const [nameRaw, teamRaw] = rest.split(",").map((s) => s.trim());
      const name = (nameRaw || "")
        .replace(/\s*\(.*\)\s*$/, "")
        .trim();
      const team = teamRaw?.replace(/\s*\(.*\)\s*$/, "").trim() || undefined;

      if (number && name) {
        entries.push({
          number,
          name,
          team,
          section: currentSection,
        });
      }
      continue;
    }

    if (ignoreExact.has(lower)) continue;
    if (ignoreContains.some((s) => lower.includes(s))) continue;
    if (ignoreStartsWith.some((s) => lower.startsWith(s))) continue;
    if (lower.endsWith("cards.") || lower.endsWith("cards")) continue;

    // Treat as section header
    currentSection = line;
  }

  return entries;
}

function parseEntries(raw: string): { entries: Entry[]; error?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { entries: [] };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { entries: [], error: "JSON must be an array." };
      const entries = parsed
        .map((r) => ({
          number: String(r?.number ?? "").trim(),
          name: String(r?.name ?? "").trim(),
          team: r?.team ? String(r.team).trim() : undefined,
          section: String(r?.section ?? "").trim(),
        }))
        .filter((r) => r.number && r.name && r.section);
      return { entries };
    } catch (e: any) {
      return { entries: [], error: e?.message || "Invalid JSON." };
    }
  }

  // CSV
  const rows = parseCsv(trimmed);
  if (!rows.length) return { entries: [] };

  const header = rows[0].map((h) => h.toLowerCase());
  const hasHeader =
    header.includes("number") &&
    header.includes("name") &&
    header.includes("section");

  const start = hasHeader ? 1 : 0;
  const col = (key: string) => (hasHeader ? header.indexOf(key) : -1);

  const numberIdx = hasHeader ? col("number") : 0;
  const nameIdx = hasHeader ? col("name") : 1;
  const teamIdx = hasHeader ? col("team") : 2;
  const sectionIdx = hasHeader ? col("section") : 3;

  if (hasHeader && (numberIdx < 0 || nameIdx < 0 || sectionIdx < 0)) {
    return { entries: [], error: "CSV header must include number,name,section." };
  }

  const entries: Entry[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    const number = String(r[numberIdx] ?? "").trim();
    const name = String(r[nameIdx] ?? "").trim();
    const section = String(r[sectionIdx] ?? "").trim();
    const team = teamIdx >= 0 ? String(r[teamIdx] ?? "").trim() : "";
    if (!number || !name || !section) continue;
    entries.push({ number, name, section, team: team || undefined });
  }
  return { entries };
}

export default function ChecklistAdminPage() {
  const [setKey, setSetKey] = useState("");
  const [raw, setRaw] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const parsed = useMemo(() => {
    const base = parseEntries(raw);
    if (base.entries.length || base.error) return base;
    const pasted = parsePastedChecklist(raw);
    return { entries: pasted };
  }, [raw]);
  const entries = parsed.entries;

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
            entries: chunk,
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

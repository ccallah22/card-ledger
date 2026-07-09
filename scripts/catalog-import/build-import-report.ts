import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  mapHeaders,
  normalizeBeckettRows,
  validateNormalizedRows,
  loadChecklistRows,
  isXlsxFile,
  applyXlsxDerivations,
} from "./import-beckett-checklist.ts";
import { buildEntities } from "./build-catalog-entities.ts";
import { buildImportPlan, ENTITY_SECTIONS, type ImportPlan } from "./build-import-plan.ts";

/**
 * Offline-input Import Dry Run Reporter: turns the Import Plan (see
 * build-import-plan.ts) into a single human-readable Markdown report, and
 * saves it to scripts/catalog-import/output/import-report.md.
 *
 * Read-only beyond the plan's own read-only SELECT queries. Never inserts,
 * updates, deletes, upserts, or runs a migration -- this only reads a
 * checklist file, reads the database for comparison, and writes a report
 * file to disk (not to the database).
 *
 * Reuses (does not duplicate):
 *   - parsing/normalization/validation from import-beckett-checklist.ts
 *   - entity building from build-catalog-entities.ts
 *   - DB comparison/natural-key matching from build-import-plan.ts
 *
 * "Rows Valid" mirrors the same skip condition buildEntities() uses
 * internally (set_name, release_year, and card_number all present) --
 * a row missing any of those three can't anchor a Card and is skipped
 * from entity building entirely, not just "warned about".
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const OUTPUT_PATH = "scripts/catalog-import/output/import-report.md";

function buildMarkdownReport(params: {
  sourceFile: string;
  rowsRead: number;
  rowsValid: number;
  rowsWithWarnings: number;
  warningLines: string[];
  plan: ImportPlan;
}): string {
  const { sourceFile, rowsRead, rowsValid, rowsWithWarnings, warningLines, plan } = params;
  const lines: string[] = [];

  lines.push("# THEBINDER IMPORT REPORT", "");
  lines.push(`**Source File:** ${sourceFile}`);
  lines.push(`**Rows Read:** ${rowsRead}`);
  lines.push(`**Rows Valid:** ${rowsValid}`);
  lines.push(`**Rows With Warnings:** ${rowsWithWarnings}`, "");

  lines.push("## Entities", "");
  for (const [key, label] of ENTITY_SECTIONS) {
    const c = plan.counts[key];
    lines.push(`### ${label}`);
    lines.push(`- Existing: ${c.existing}`);
    lines.push(`- Create: ${c.create}`, "");
  }

  lines.push("## Warnings", "");
  if (warningLines.length === 0) {
    lines.push("- (none)");
  } else {
    for (const w of warningLines) lines.push(`- ${w}`);
  }
  lines.push("");

  lines.push("## Conflicts", "");
  if (plan.conflicts.length === 0) {
    lines.push("- (none)");
  } else {
    for (const c of plan.conflicts) {
      lines.push(`- ${c.entityType}: ${c.summary} -- ${c.reason}`);
    }
  }
  lines.push("");

  lines.push("## Summary", "");
  lines.push("### Database Changes", "");
  lines.push(`- Create: ${plan.totals.create}`);
  lines.push(`- Update: ${plan.totals.update}`);
  lines.push(`- Existing: ${plan.totals.existing}`);
  lines.push(`- Conflicts: ${plan.totals.conflict}`, "");

  lines.push(
    "_This was a read-only dry run report. No rows were inserted, updated, deleted, or upserted, " +
      "and no migration was run._"
  );

  return lines.join("\n") + "\n";
}

async function main() {
  console.log("=== Import Dry Run Reporter (offline input, read-only) ===\n");

  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --env-file=.env.local --experimental-strip-types scripts/catalog-import/build-import-report.ts <path-to-file.csv|.tsv|.txt|.xlsx>"
    );
    process.exitCode = 1;
    return;
  }
  if (!SUPABASE_URL) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- no queries were run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. This script reads the full catalog tables " +
        "directly for comparison, which requires the service role key. Aborting -- no queries were " +
        "run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }

  let rows: string[][];
  try {
    rows = (await loadChecklistRows(filePath)).rows;
  } catch (err) {
    console.error(
      `FAILED: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
    return;
  }
  if (rows.length === 0) {
    console.error("FAILED: no rows could be parsed from this file.");
    process.exitCode = 1;
    return;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1);
  const { mapping } = mapHeaders(headers);
  let normalizedRows = normalizeBeckettRows(dataRows, mapping);
  if (isXlsxFile(filePath)) {
    normalizedRows = applyXlsxDerivations(normalizedRows);
  }
  const validation = validateNormalizedRows(normalizedRows, mapping);
  const entities = buildEntities(normalizedRows);

  const rowsWithWarningsCount = new Set(validation.rowWarnings.map((w) => w.rowIndex)).size;
  const rowsValidCount = normalizedRows.filter(
    (r) => r.set_name && r.release_year && r.card_number
  ).length;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const plan = await buildImportPlan(entities, supabase);

  const markdown = buildMarkdownReport({
    sourceFile: filePath,
    rowsRead: dataRows.length,
    rowsValid: rowsValidCount,
    rowsWithWarnings: rowsWithWarningsCount,
    warningLines: validation.summary,
    plan,
  });

  console.log(markdown);

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, markdown, "utf8");
  console.log(`Saved report to ${OUTPUT_PATH}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

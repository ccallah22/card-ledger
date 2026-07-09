import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

/**
 * Offline preview/normalization tool for Beckett.com / Google Sheets
 * checklist exports (CSV, tab-separated text pasted/exported from Sheets,
 * or a real Beckett XLSX checklist export). Reads a file given on the
 * command line, detects its format/delimiter and headers, normalizes
 * recognized column names into a fixed set of internal fields, and prints
 * an inspection report.
 *
 * Does NOT connect to Supabase, does NOT insert/update/delete/upsert
 * anything, and does not assume a final CSV format -- this is purely an
 * inspection/normalization preview ahead of building the real importer.
 *
 * Parsing/normalization/validation are exported as standalone functions
 * (see the `export`s below) so a future Supabase-writing importer can
 * reuse this exact logic without re-implementing it or pulling in the CLI
 * printing/argv handling at the bottom of this file.
 */

export type InternalField =
  | "card_number"
  | "player_name"
  | "team_name"
  | "set_name"
  | "release_year"
  | "subset_or_insert"
  | "parallel_name"
  | "is_rookie"
  | "is_autograph"
  | "is_memorabilia"
  | "print_run"
  | "notes"
  | "sport"
  | "set_manufacturer"
  | "set_brand"
  | "position"
  | "sequence";

export const ALL_FIELDS: InternalField[] = [
  "card_number",
  "player_name",
  "team_name",
  "sport",
  "set_manufacturer",
  "set_brand",
  "set_name",
  "release_year",
  "subset_or_insert",
  "parallel_name",
  "is_rookie",
  "is_autograph",
  "is_memorabilia",
  "print_run",
  "position",
  "sequence",
  "notes",
];

// Fields without which a row can't usefully identify a card.
export const IMPORTANT_FIELDS: InternalField[] = ["card_number", "player_name", "set_name"];

const BOOLEAN_FIELDS: InternalField[] = ["is_rookie", "is_autograph", "is_memorabilia"];

// Known Beckett/Google Sheets header variants, normalized (lowercase,
// trimmed, single-spaced) for exact matching against each source header.
const FIELD_ALIASES: Record<InternalField, string[]> = {
  card_number: ["card number", "card no", "card no.", "card #", "cardnum", "no", "no.", "num", "number", "#"],
  player_name: ["player", "player name", "name", "athlete", "athlete name"],
  team_name: ["team", "team name", "club"],
  set_name: ["set", "set name", "product", "product name"],
  release_year: ["year", "release year", "season", "yr"],
  // "card set" belongs here, not set_name: on Beckett's XLSX "Master
  // Checklist" format, CARD SET names the subset/insert/parallel within a
  // release (e.g. "Rated Rookies"), not the release itself -- the release
  // (the real Set) is synthesized from YEAR+BRAND+PROGRAM+SPORT instead.
  // See deriveReleaseSetName()/applyXlsxDerivations() below.
  subset_or_insert: ["subset", "insert", "insert name", "subset/insert", "subset name", "series", "card set"],
  parallel_name: ["parallel", "parallel name", "variation", "color", "colour"],
  is_rookie: ["rc", "rookie", "is rookie", "rookie card"],
  is_autograph: ["au", "auto", "autograph", "is autograph", "signed"],
  is_memorabilia: ["mem", "relic", "memorabilia", "patch", "jersey", "swatch"],
  print_run: ["print run", "printrun", "serial", "serial number", "serial #", "qty", "quantity", "/"],
  notes: ["notes", "comments", "comment", "description", "note"],
  // Beckett's real "Master Checklist" XLSX exports (see
  // 2025-Select-Football-Checklist.xlsx) carry these five as distinct
  // columns instead of folding them into set_name/notes.
  sport: ["sport"],
  set_manufacturer: ["brand"],
  set_brand: ["program"],
  position: ["position", "pos"],
  sequence: ["sequence", "seq"],
};

/** Result of NormalizedBeckettRow. */
export type NormalizedBeckettRow = Record<InternalField, string | null>;

export type HeaderMapping = Partial<Record<InternalField, number>>;

export type ValidationResult = {
  /** Important fields (see IMPORTANT_FIELDS) with no source column found at all. */
  missingFieldMappings: InternalField[];
  /** Per-row problems for fields that are mapped but empty on a given row. */
  rowWarnings: Array<{ rowIndex: number; field: InternalField; message: string }>;
  /** Human-readable summary lines, in the same shape the CLI prints. */
  summary: string[];
};

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectDelimiter(firstLine: string, filePath: string): "\t" | "," {
  const tabCount = (firstLine.match(/\t/g) ?? []).length;
  const commaCount = (firstLine.match(/,/g) ?? []).length;
  if (tabCount > commaCount) return "\t";
  if (commaCount > tabCount) return ",";
  // Tie (including both zero, e.g. a single-column file) -- fall back to extension.
  return /\.(tsv|txt)$/i.test(filePath) ? "\t" : ",";
}

/**
 * Minimal quote-aware delimited-text parser: handles quoted fields
 * (including embedded delimiters/newlines) and doubled-quote escaping
 * ("" -> "), scanning character-by-character rather than splitting by
 * line first, since a quoted field can legitimately span multiple lines.
 */
export function parseDelimitedText(text: string, delimiter: string): string[][] {
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
    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\r") {
      if (next === "\n") continue; // consume the \n of a \r\n pair on the next iteration
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    if (ch === "\n") {
      row.push(cell);
      cell = "";
      if (row.some((v) => v.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    if (row.some((v) => v.trim().length > 0)) rows.push(row);
  }

  return rows;
}

// Canonical sheet name used by Beckett's real "Master Checklist" XLSX
// checklist exports (e.g. 2025-Select-Football-Checklist.xlsx).
export const MASTER_CHECKLIST_SHEET_NAME = "Master Checklist";

export function isXlsxFile(filePath: string): boolean {
  return /\.xlsx$/i.test(filePath);
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("hyperlink" in value && typeof value.text === "string") return value.text;
    return String(value);
  }
  return String(value);
}

/**
 * Reads a single named sheet from a real XLSX workbook into the same
 * string[][] shape parseDelimitedText() produces (header row first, then
 * data rows), so it can feed the same mapHeaders/normalizeBeckettRows
 * pipeline as CSV/TSV input. Fully empty rows are skipped, matching
 * parseDelimitedText()'s behavior.
 */
export async function parseXlsxSheet(filePath: string, sheetName: string): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.getWorksheet(sheetName);
  if (!worksheet) {
    const available = workbook.worksheets.map((ws) => ws.name).join(", ") || "(no sheets found)";
    throw new Error(`sheet "${sheetName}" was not found in this workbook. Available sheets: ${available}`);
  }

  const rows: string[][] = [];
  const columnCount = worksheet.columnCount;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let col = 1; col <= columnCount; col++) {
      cells.push(cellToString(row.getCell(col).value));
    }
    if (cells.some((v) => v.trim().length > 0)) {
      rows.push(cells);
    }
  });

  return rows;
}

export type LoadedChecklist = { rows: string[][]; formatDescription: string };

/**
 * Loads header+data rows from a checklist file regardless of source format
 * -- CSV, TSV, pasted Sheets text, or a real Beckett XLSX export -- so
 * every script that ingests a checklist can share this one format-decision
 * point instead of re-implementing it. XLSX files are read from
 * `sheetName` (defaulting to Beckett's canonical "Master Checklist");
 * everything else is read as UTF-8 text and delimiter-detected as before.
 */
export async function loadChecklistRows(
  filePath: string,
  options?: { sheetName?: string }
): Promise<LoadedChecklist> {
  if (isXlsxFile(filePath)) {
    const sheetName = options?.sheetName ?? MASTER_CHECKLIST_SHEET_NAME;
    const rows = await parseXlsxSheet(filePath, sheetName);
    return { rows, formatDescription: `XLSX (sheet "${sheetName}")` };
  }

  const raw = stripBom(readFileSync(filePath, "utf8"));
  if (!raw.trim()) {
    throw new Error("file is empty.");
  }
  const firstLine = raw.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine, filePath);
  const rows = parseDelimitedText(raw, delimiter);
  return { rows, formatDescription: delimiter === "\t" ? "tab-delimited text" : "comma-delimited text" };
}

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, " ");
}

export function mapHeaders(headers: string[]): {
  mapping: HeaderMapping;
  unmapped: string[];
} {
  const mapping: HeaderMapping = {};
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    let matchedField: InternalField | null = null;
    for (const field of ALL_FIELDS) {
      if (FIELD_ALIASES[field].includes(normalized)) {
        matchedField = field;
        break;
      }
    }
    if (matchedField && mapping[matchedField] === undefined) {
      mapping[matchedField] = index;
    } else if (matchedField) {
      unmapped.push(`"${header}" (duplicate mapping to ${matchedField}, ignored)`);
    } else if (normalized) {
      unmapped.push(`"${header}"`);
    }
  });

  return { mapping, unmapped };
}

function parseBoolean(value: string | undefined): string {
  if (value === undefined) return "false";
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "false";
  if (["n", "no", "false", "0"].includes(trimmed)) return "false";
  return "true";
}

function extractPrintRun(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  return match ? match[0] : null;
}

function normalizeSingleRow(raw: string[], mapping: HeaderMapping): NormalizedBeckettRow {
  function get(field: InternalField): string | undefined {
    const index = mapping[field];
    return index === undefined ? undefined : raw[index]?.trim();
  }

  const result = {} as NormalizedBeckettRow;
  for (const field of ALL_FIELDS) {
    if (BOOLEAN_FIELDS.includes(field)) {
      result[field] = parseBoolean(get(field));
    } else if (field === "print_run") {
      result[field] = extractPrintRun(get(field));
    } else {
      result[field] = get(field) ?? null;
    }
  }
  return result;
}

/** Normalizes every raw data row (post-header) into NormalizedBeckettRow shape. */
export function normalizeBeckettRows(
  rows: string[][],
  mapping: HeaderMapping
): NormalizedBeckettRow[] {
  return rows.map((row) => normalizeSingleRow(row, mapping));
}

/**
 * Checks IMPORTANT_FIELDS for missing column mappings and per-row empty
 * values. Returns both a human-readable summary (matching the CLI's
 * existing printed text) and structured per-row warnings a future
 * Supabase-writing consumer could use to decide whether to skip a row.
 *
 * A field can end up populated even with no column mapping (e.g. set_name
 * for XLSX input, synthesized by applyXlsxDerivations() from other
 * columns) -- so "no column detected" is only reported when the field is
 * *both* unmapped and actually empty on every row, not from the mapping
 * absence alone.
 */
export function validateNormalizedRows(
  rows: NormalizedBeckettRow[],
  mapping: HeaderMapping
): ValidationResult {
  const missingFieldMappings: InternalField[] = [];
  const rowWarnings: ValidationResult["rowWarnings"] = [];
  const summary: string[] = [];

  for (const field of IMPORTANT_FIELDS) {
    const missingCount = rows.filter((r) => !r[field]).length;

    if (mapping[field] === undefined && missingCount === rows.length) {
      missingFieldMappings.push(field);
      summary.push(
        `WARNING: no column detected for required field "${field}" -- every row will be missing it.`
      );
      continue;
    }

    rows.forEach((row, rowIndex) => {
      if (!row[field]) {
        rowWarnings.push({
          rowIndex,
          field,
          message: `row ${rowIndex + 1} has an empty "${field}" value`,
        });
      }
    });

    if (missingCount > 0) {
      summary.push(`WARNING: ${missingCount} row(s) have an empty "${field}" value.`);
    }
  }

  if (summary.length === 0) {
    summary.push("None -- all required fields are mapped and populated.");
  }

  return { missingFieldMappings, rowWarnings, summary };
}

// CARD SET (now mapped to subset_or_insert) text-inference keywords,
// matching the task's literal spec.
const AUTOGRAPH_PATTERN = /autograph|signature/i;
const MEMORABILIA_PATTERN = /memorabilia|material|patch|relic/i;
const BASE_SET_PATTERN = /^\s*(base(\s*set)?)?\s*$/i;

export type CardSetSignals = {
  isAutograph: boolean;
  isMemorabilia: boolean;
};

/**
 * Derives autograph/memorabilia signals from a CARD SET/subset-style text
 * value (e.g. "Rated Rookies", "Rookie Patch Autographs"). Meant for
 * checklist formats (like Beckett's "Master Checklist" XLSX exports) where
 * this text describes the subset/insert/parallel within a release, not the
 * release's own product name.
 */
export function deriveCardSetSignals(cardSetText: string | null): CardSetSignals {
  const text = (cardSetText ?? "").trim();
  return {
    isAutograph: AUTOGRAPH_PATTERN.test(text),
    isMemorabilia: MEMORABILIA_PATTERN.test(text),
  };
}

/**
 * Synthesizes the real release-level Set name from YEAR + BRAND + PROGRAM +
 * SPORT (e.g. "2025 Panini Select Football"), for checklist formats (like
 * Beckett's XLSX "Master Checklist" exports) where no single column names
 * the release itself -- CARD SET instead names the subset/insert within it
 * (see subset_or_insert). Returns null if none of the four are present.
 */
export function deriveReleaseSetName(row: NormalizedBeckettRow): string | null {
  const parts = [row.release_year, row.set_manufacturer, row.set_brand, row.sport].filter(
    (v): v is string => !!v
  );
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Additive-only XLSX enrichment:
 *  - synthesizes set_name from the release-level columns when no explicit
 *    set_name column was mapped (see deriveReleaseSetName)
 *  - fills is_autograph/is_memorabilia from the subset_or_insert (CARD SET)
 *    text when not already set from an explicit source column
 *  - clears subset_or_insert to null when it's just a literal "Base"/"Base
 *    Set" marker, since that doesn't describe a meaningful subset
 * Never overrides a value a row already has from an explicit source
 * column (e.g. Beckett's older CSV exports with their own RC/AU/MEM/Insert
 * columns).
 */
export function applyXlsxDerivations(rows: NormalizedBeckettRow[]): NormalizedBeckettRow[] {
  return rows.map((row) => {
    const signals = deriveCardSetSignals(row.subset_or_insert);
    const subsetOrInsert =
      row.subset_or_insert && !BASE_SET_PATTERN.test(row.subset_or_insert.trim())
        ? row.subset_or_insert
        : null;
    return {
      ...row,
      set_name: row.set_name || deriveReleaseSetName(row),
      subset_or_insert: subsetOrInsert,
      is_autograph: row.is_autograph === "true" || signals.isAutograph ? "true" : row.is_autograph,
      is_memorabilia:
        row.is_memorabilia === "true" || signals.isMemorabilia ? "true" : row.is_memorabilia,
    };
  });
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/import-beckett-checklist.ts <path-to-file.csv|.tsv|.txt|.xlsx>"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== Beckett/Sheets Checklist Import Preview (offline, no database access) ===\n");

  let rows: string[][];
  try {
    const loaded = await loadChecklistRows(filePath);
    rows = loaded.rows;
    console.log(`Detected input format: ${loaded.formatDescription}`);
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

  console.log(`Detected headers (${headers.length}): ${headers.join(" | ")}`);

  const { mapping, unmapped } = mapHeaders(headers);

  console.log("\nNormalized field mapping:");
  for (const field of ALL_FIELDS) {
    const index = mapping[field];
    console.log(
      `  ${field}: ${index !== undefined ? `"${headers[index]}" (column ${index})` : "NOT FOUND"}`
    );
  }
  if (unmapped.length > 0) {
    console.log(`\nUnmapped/ignored source columns: ${unmapped.join(", ")}`);
  }

  console.log(`\nTotal data rows: ${dataRows.length}`);

  let normalizedRows = normalizeBeckettRows(dataRows, mapping);
  if (isXlsxFile(filePath)) {
    normalizedRows = applyXlsxDerivations(normalizedRows);
  }

  console.log("\n--- First 10 normalized rows ---");
  normalizedRows.slice(0, 10).forEach((row, i) => {
    console.log(`  [${i + 1}]`, JSON.stringify(row));
  });

  console.log("\n--- Validation warnings ---");
  const { summary } = validateNormalizedRows(normalizedRows, mapping);
  for (const line of summary) {
    console.log(`  ${line}`);
  }

  console.log(
    "\nThis was a preview/normalization pass only. No database connection was made, and no data was written anywhere."
  );
}

// Only run the CLI when this file is executed directly (e.g. via `node
// import-beckett-checklist.ts <file>`) -- not when another script imports
// its exported functions, which would otherwise also trigger this CLI's
// own argv parsing/console output as an unwanted side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

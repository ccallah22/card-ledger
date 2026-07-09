import { readFileSync } from "node:fs";

/**
 * Offline preview/normalization tool for Beckett.com / Google Sheets
 * checklist exports (CSV, or tab-separated text pasted/exported from
 * Sheets). Reads a file given on the command line, detects its delimiter
 * and headers, normalizes recognized column names into a fixed set of
 * internal fields, and prints an inspection report.
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
  | "notes";

export const ALL_FIELDS: InternalField[] = [
  "card_number",
  "player_name",
  "team_name",
  "set_name",
  "release_year",
  "subset_or_insert",
  "parallel_name",
  "is_rookie",
  "is_autograph",
  "is_memorabilia",
  "print_run",
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
  subset_or_insert: ["subset", "insert", "insert name", "subset/insert", "subset name", "series"],
  parallel_name: ["parallel", "parallel name", "variation", "color", "colour"],
  is_rookie: ["rc", "rookie", "is rookie", "rookie card"],
  is_autograph: ["au", "auto", "autograph", "is autograph", "signed"],
  is_memorabilia: ["mem", "relic", "memorabilia", "patch", "jersey", "swatch"],
  print_run: ["print run", "printrun", "serial", "serial number", "serial #", "qty", "quantity", "/"],
  notes: ["notes", "comments", "comment", "description", "note"],
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
 */
export function validateNormalizedRows(
  rows: NormalizedBeckettRow[],
  mapping: HeaderMapping
): ValidationResult {
  const missingFieldMappings: InternalField[] = [];
  const rowWarnings: ValidationResult["rowWarnings"] = [];
  const summary: string[] = [];

  for (const field of IMPORTANT_FIELDS) {
    if (mapping[field] === undefined) {
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

    const missingCount = rows.filter((r) => !r[field]).length;
    if (missingCount > 0) {
      summary.push(`WARNING: ${missingCount} row(s) have an empty "${field}" value.`);
    }
  }

  if (summary.length === 0) {
    summary.push("None -- all required fields are mapped and populated.");
  }

  return { missingFieldMappings, rowWarnings, summary };
}

function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/import-beckett-checklist.ts <path-to-file.csv|.tsv|.txt>"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== Beckett/Sheets Checklist Import Preview (offline, no database access) ===\n");

  let raw: string;
  try {
    raw = stripBom(readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(
      `FAILED: could not read file "${filePath}": ${err instanceof Error ? err.message : String(err)}`
    );
    process.exitCode = 1;
    return;
  }

  if (!raw.trim()) {
    console.error("FAILED: file is empty.");
    process.exitCode = 1;
    return;
  }

  const firstLine = raw.split(/\r\n|\r|\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine, filePath);
  console.log(`Detected delimiter: ${delimiter === "\t" ? "tab" : "comma"}`);

  const rows = parseDelimitedText(raw, delimiter);
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

  const normalizedRows = normalizeBeckettRows(dataRows, mapping);

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

main();

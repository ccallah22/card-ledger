import { pathToFileURL } from "node:url";
import { loadChecklistRows, mapHeaders, normalizeBeckettRows } from "./import-beckett-checklist.ts";

/**
 * Offline, read-only analysis of Beckett's CARD SET text (Master Checklist
 * XLSX format) to design a decomposition into:
 *   - checklist section (e.g. "Base Club Level", "Rookie Signatures")
 *   - parallel name (e.g. "Black Prizm", "Tie-Dye Prizm Shock")
 *   - print run (if embedded in the text -- see report, it isn't for this
 *     file; print run lives in the separate SEQUENCE column instead)
 *   - autograph flag
 *   - memorabilia flag
 *   - base vs. insert classification
 *
 * Does NOT connect to Supabase, does NOT change the importer or schema,
 * does NOT insert/update/delete/upsert anything -- this only reads the
 * given file and prints an analysis report.
 *
 * How the section/parallel split works (see splitSectionAndParallel below):
 * CARD SET text in this format is consistently "<section> [<parallel>]",
 * where a parallel -- when present -- is built from a color/effect
 * descriptor immediately followed by a recognized "family" word (Prizm,
 * Prizm Shock, Snakeskin Prizm, Disco Prizm, Dragon Scale Prizm, Pulsar
 * Prizm, Sparkle, Cosmic, Envelope/Envolpe). Rather than hardcoding every
 * observed color name (there are dozens, including two-color "X and Y"
 * combos), the algorithm finds the rightmost family-word match in the
 * string, then walks backward capturing preceding descriptor words until
 * it hits a word from a small "section vocabulary" stop-list (Base, Level,
 * Rookie, Select, Signatures, Memorabilia, Swatch, etc.) -- so it adapts to
 * new color names automatically but still cleanly stops at section
 * boundaries. Text after the matched parallel (e.g. "Brand Logo", "NFL
 * Shield", "Signatures", "Die-Cut" -- jersey-tag/manufacturer-logo swatch
 * descriptors and suffix modifiers observed in the real file) is not
 * separately modeled as its own dimension; it's noted as a "trailing
 * modifier" rather than invented into a 7th axis the task didn't ask for.
 */

// Family words that end a parallel name, longest first so e.g. "Prizm
// Shock" is matched before the bare "Prizm" it contains.
const PARALLEL_FAMILY_SUFFIXES = [
  "Dragon Scale Prizm",
  "Snakeskin Prizm",
  "Disco Prizm",
  "Pulsar Prizm",
  "Prizm Shock",
  "Prizm",
  "Sparkle",
  "Cosmic",
  "Envelope",
  "Envolpe", // real data has this exact misspelling of "Envelope" -- see report
];

// Section-vocabulary words that stop the backward descriptor walk (see
// splitSectionAndParallel). Not a whitelist of every section name -- just
// the words that appear immediately before a parallel in real section
// names, so the walk knows where the section ends and the parallel begins.
const SECTION_STOP_WORDS = new Set(
  [
    "Base", "Club", "Concourse", "Field", "Premier", "Suite", "Level",
    "Alter", "Ego", "Color", "Wheel",
    "Contenders", "Rookie", "Rookies", "Cracked", "Ice", "Ticket", "RPS",
    "Super", "Bowl", "Variation",
    "Draft", "Selections", "Memorabilia",
    "Jumbo", "Signature", "Signatures", "Swatch", "Swatches",
    "Multiverse", "Jerseys", "Icons",
    "On", "Target",
    "Patrick", "Mahomes", "Autograph", "Autographs", "Collection",
    "Phenomenon", "Prime", "Score", "Select", "Throwback",
    "Certified", "Future", "Numbers", "Pairings",
    "Solar", "Eclipse", "Sparks", "Starcade", "Summit", "Platinum",
    "Turbocharged",
    // Jersey-tag/manufacturer-logo descriptors seen trailing a parallel
    // (e.g. "...Black Prizm Brand Logo") -- these stop the walk if a
    // family suffix is ever found again past them, and double as evidence
    // of a "trailing modifier" (see analyzeCardSet).
    "Brand", "Logo", "Laundry", "Nike", "Shield", "NFL", "Tag", "Player's",
    "Number", "Team", "Swoosh",
  ].map((w) => w.toLowerCase())
);

const AUTOGRAPH_KEYWORDS = /autograph|signature/i;
// "Swatch"/"Swatches" is this file's actual memorabilia terminology
// alongside the task's given Jersey/Materials/Patch/Relic list -- see
// report for this extension.
const MEMORABILIA_KEYWORDS = /jersey|materials?|patch|relic|memorabilia|swatch(?:es)?/i;
const PRINT_RUN_PATTERN = /(?:#'?d\s*\/|\/)\s*\d+/;

export type ParsedCardSet = {
  raw: string;
  section: string;
  parallel: string | null;
  trailingModifier: string | null;
  printRun: string | null;
  isAutograph: boolean;
  isMemorabilia: boolean;
  classification: "base" | "insert";
  ambiguous: boolean;
};

/**
 * Finds the rightmost parallel-family match in `text` and splits it into
 * { section, parallel, trailingModifier }. Returns parallel: null (and the
 * whole text as section) when no family word is found at all.
 */
function splitSectionAndParallel(text: string): {
  section: string;
  parallel: string | null;
  trailingModifier: string | null;
} {
  let bestIndex = -1;
  let bestSuffix = "";

  for (const suffix of PARALLEL_FAMILY_SUFFIXES) {
    const re = new RegExp(`\\b${suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > bestIndex) {
        bestIndex = match.index;
        bestSuffix = match[0];
      }
    }
  }

  if (bestIndex === -1) {
    return { section: text.trim(), parallel: null, trailingModifier: null };
  }

  const before = text.slice(0, bestIndex);
  const after = text.slice(bestIndex + bestSuffix.length).trim() || null;

  const beforeWords = before.trim().split(/\s+/).filter(Boolean);
  const descriptorWords: string[] = [];
  const MAX_DESCRIPTOR_WORDS = 5;

  while (beforeWords.length > 0 && descriptorWords.length < MAX_DESCRIPTOR_WORDS) {
    const word = beforeWords[beforeWords.length - 1];
    if (word.toLowerCase() === "and") {
      descriptorWords.unshift(beforeWords.pop() as string);
      continue;
    }
    if (SECTION_STOP_WORDS.has(word.toLowerCase())) break;
    descriptorWords.unshift(beforeWords.pop() as string);
  }

  const section = beforeWords.join(" ").trim();
  const parallel = [...descriptorWords, bestSuffix].join(" ").trim();

  return { section: section || "(none)", parallel, trailingModifier: after };
}

export function analyzeCardSet(raw: string): ParsedCardSet {
  const { section, parallel, trailingModifier } = splitSectionAndParallel(raw);

  const isAutograph = AUTOGRAPH_KEYWORDS.test(raw);
  const isMemorabilia = MEMORABILIA_KEYWORDS.test(raw);
  const printRunMatch = raw.match(PRINT_RUN_PATTERN);

  // Ambiguous: the text still looks like it should have a parallel (a bare
  // "Prizm"/color-family word appears somewhere) but no clean suffix match
  // was found, OR a family suffix was found but nothing recognizable
  // precedes it (a zero-length parallel word) -- both indicate the
  // heuristic couldn't confidently resolve the structure.
  const looksLikeItShouldHaveAParallel = /prizm|sparkle|cosmic|envelope|envolpe/i.test(raw);
  const ambiguous = parallel === null ? looksLikeItShouldHaveAParallel : parallel.trim().length === 0;

  return {
    raw,
    section,
    parallel,
    trailingModifier,
    printRun: printRunMatch ? printRunMatch[0] : null,
    isAutograph,
    isMemorabilia,
    classification: /^base\b/i.test(section) ? "base" : "insert",
    ambiguous,
  };
}

// Effect words that should be reordered to come *after* a leading color
// word (e.g. "Disco Black Prizm" -> "Black Disco Prizm"), matching the
// majority word order observed in the real file. Checked longest-first so
// "Dragon Scale" matches before a bare word would.
const EFFECT_MODIFIERS = ["Dragon Scale", "Snakeskin", "Disco", "Pulsar"];

/**
 * Canonicalizes a parsed parallel name: fixes the one known real-data typo
 * ("Envolpe" -> "Envelope"), collapses whitespace, and reorders "<Effect>
 * <Color...> Prizm[ Shock]" to "<Color...> <Effect> Prizm[ Shock]" when the
 * effect word (Disco/Pulsar/Snakeskin/Dragon Scale) comes first -- the real
 * checklist uses both orders for what's clearly the same parallel (e.g.
 * "Black Disco Prizm" appears 400x vs. "Disco Black Prizm" 46x), so this
 * picks the majority convention as canonical rather than leaving both as
 * distinct parallel identities.
 */
export function normalizeParallelName(parallel: string): string {
  let normalized = parallel.trim().replace(/\s+/g, " ");
  normalized = normalized.replace(/\bEnvolpe\b/gi, "Envelope");

  for (const effect of EFFECT_MODIFIERS) {
    const re = new RegExp(`^(${effect})\\s+(.+?)\\s+(Prizm(?:\\s+Shock)?)$`, "i");
    const match = normalized.match(re);
    if (match) {
      normalized = `${match[2]} ${match[1]} ${match[3]}`;
      break;
    }
  }

  return normalized;
}

function printCountTable(label: string, counts: Map<string, number>, limit = 100): void {
  console.log(`\n${label} (${counts.size} distinct):`);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  sorted.slice(0, limit).forEach(([value, count]) => {
    console.log(`  ${count.toString().padStart(4)}  ${value}`);
  });
  if (sorted.length > limit) {
    console.log(`  ... and ${sorted.length - limit} more`);
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: node --experimental-strip-types scripts/catalog-import/analyze-card-set-patterns.ts <path-to-file.xlsx>"
    );
    process.exitCode = 1;
    return;
  }

  console.log("=== CARD SET Pattern Analysis (offline, no database access) ===\n");

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
  const normalizedRows = normalizeBeckettRows(dataRows, mapping);

  // Frequency per distinct CARD SET (subset_or_insert) value, and the
  // per-value analysis (each distinct value is analyzed once).
  const valueCounts = new Map<string, number>();
  for (const row of normalizedRows) {
    const value = row.subset_or_insert;
    if (!value) continue;
    valueCounts.set(value, (valueCounts.get(value) ?? 0) + 1);
  }

  const analyses = [...valueCounts.keys()].map((raw) => analyzeCardSet(raw));

  const sectionCounts = new Map<string, number>();
  const parallelCounts = new Map<string, number>();
  const ambiguous: ParsedCardSet[] = [];
  let autographCount = 0;
  let memorabiliaCount = 0;
  let printRunCount = 0;
  let baseCount = 0;
  let insertCount = 0;
  let trailingModifierCount = 0;

  for (const a of analyses) {
    const freq = valueCounts.get(a.raw) ?? 0;
    sectionCounts.set(a.section, (sectionCounts.get(a.section) ?? 0) + freq);
    if (a.parallel) parallelCounts.set(a.parallel, (parallelCounts.get(a.parallel) ?? 0) + freq);
    if (a.ambiguous) ambiguous.push(a);
    if (a.isAutograph) autographCount += freq;
    if (a.isMemorabilia) memorabiliaCount += freq;
    if (a.printRun) printRunCount += freq;
    if (a.trailingModifier) trailingModifierCount += freq;
    if (a.classification === "base") baseCount += freq;
    else insertCount += freq;
  }

  console.log(`Total data rows: ${normalizedRows.length}`);
  console.log(`Total distinct CARD SET values: ${valueCounts.size}`);
  console.log(`Proposed checklist sections: ${sectionCounts.size}`);
  console.log(`Proposed parallels: ${parallelCounts.size}`);
  console.log(`Ambiguous CARD SET values: ${ambiguous.length}`);
  console.log(`Rows with a detected print run embedded in CARD SET text: ${printRunCount}`);
  console.log(`Rows with a trailing modifier beyond section+parallel (e.g. "Brand Logo", "Die-Cut"): ${trailingModifierCount}`);
  console.log(`Rows classified autograph: ${autographCount}`);
  console.log(`Rows classified memorabilia: ${memorabiliaCount}`);
  console.log(`Rows classified base: ${baseCount}`);
  console.log(`Rows classified insert: ${insertCount}`);

  console.log("\n--- Ambiguous values (could not be cleanly split) ---");
  if (ambiguous.length === 0) {
    console.log("  (none)");
  } else {
    ambiguous.forEach((a) => {
      console.log(`  "${a.raw}" -> section="${a.section}" parallel=${JSON.stringify(a.parallel)}`);
    });
  }

  console.log("\n--- Top 50 CARD SET values (by row frequency) with parsed fields ---");
  const sortedByFreq = [...valueCounts.entries()].sort((a, b) => b[1] - a[1]);
  sortedByFreq.slice(0, 50).forEach(([raw, freq], i) => {
    const a = analyses.find((x) => x.raw === raw)!;
    console.log(
      `  [${i + 1}] (${freq}x) "${raw}"\n` +
        `        section="${a.section}" parallel=${JSON.stringify(a.parallel)} ` +
        `trailingModifier=${JSON.stringify(a.trailingModifier)} printRun=${JSON.stringify(a.printRun)} ` +
        `autograph=${a.isAutograph} memorabilia=${a.isMemorabilia} class=${a.classification} ` +
        `ambiguous=${a.ambiguous}`
    );
  });

  printCountTable("Counts by proposed section", sectionCounts);
  printCountTable("Counts by proposed parallel", parallelCounts);

  console.log(
    "\nThis was a read-only, offline analysis. No database connection was made, the importer was not " +
      "changed, no schema was changed, and no data was written anywhere."
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("FAILED:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

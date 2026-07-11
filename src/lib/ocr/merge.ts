import type { CardOcrExtractedFields, CardOcrFieldSource, CardOcrResult } from "@/lib/ocr/types";

// Vision Engine V2, Phase 6B: pure, in-memory merge of independent front/back
// CardOcrResults into one normalized card-identification result. This is
// deliberately NOT catalog matching, visual recognition, image
// fingerprinting, or final confidence scoring -- it only reconciles the two
// sides' already-extracted text fields against each other. Nothing here
// mutates frontOcr/backOcr, and nothing here is persisted (no new
// card_media column) -- see the Add/Edit Card pages for how this is
// recomputed from the two already-persisted side results whenever needed.

// Where a field's final value came from. "both" means front and back agreed
// (after normalization) -- not that the two were combined/concatenated.
// This is the exact type scaffolded as CardOcrFieldSource back in Phase 6A
// (src/lib/ocr/types.ts) for this merge phase -- aliased under this
// module's own name rather than duplicated.
export type OcrFieldSource = CardOcrFieldSource;

export type MergedOcrField = {
  value: string | null;
  source: OcrFieldSource;
  frontValue: string | null;
  backValue: string | null;
  conflict: boolean;
};

export type MergedCardOcrResult = {
  fields: {
    playerName: MergedOcrField;
    teamName: MergedOcrField;
    brand: MergedOcrField;
    // Vision Engine V2, Phase 7A correction: the visible product/set name
    // (e.g. "Select", "Prizm") -- distinct from brand/manufacturer, which
    // name the company, not the product line. See CardOcrExtractedFields.
    setName: MergedOcrField;
    year: MergedOcrField;
    cardName: MergedOcrField;
    parallelText: MergedOcrField;
    autographIndicator: MergedOcrField;
    relicIndicator: MergedOcrField;
    cardNumber: MergedOcrField;
    copyrightYear: MergedOcrField;
    manufacturer: MergedOcrField;
    smallPrint: MergedOcrField;
    statisticsText: MergedOcrField;
    checklistText: MergedOcrField;
    serialNumbering: MergedOcrField;
    authenticationText: MergedOcrField;
  };
  frontAvailable: boolean;
  backAvailable: boolean;
  conflictCount: number;
  createdAt: string;
  // Optional, informational only -- never a substitute for the structured
  // fields above. Front text first, back text second, and the whole back
  // block is dropped if it's identical (case-insensitively) to the front
  // block, rather than duplicating it.
  combinedRawText: string;
};

// Trim + collapse internal whitespace + treat "" as missing. Deliberately
// does NOT strip punctuation/symbols -- those can be meaningful in card
// numbers ("#123") and serial numbering ("23/99").
function normalizeValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.trim().replace(/\s+/g, " ");
  return collapsed.length > 0 ? collapsed : null;
}

// Case-insensitive equality over already-normalized (trimmed/collapsed)
// values -- so "Topps" and "topps" are equal, but "Topps" and "Topps " are
// also already equal because both were normalized first.
function normalizedEqual(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return a.toLowerCase() === b.toLowerCase();
}

// Generic per-field merge shared by every field below (including brand and
// the synthesized year field) -- only the `priority` (which side wins a
// genuine conflict) differs per field. `raw*` are the original,
// un-normalized extracted values (kept for display); normalization is only
// used to decide equality/presence, never to alter what's shown.
function mergeField(
  rawFront: string | null | undefined,
  rawBack: string | null | undefined,
  priority: "front" | "back",
): MergedOcrField {
  const front = normalizeValue(rawFront);
  const back = normalizeValue(rawBack);

  if (front === null && back === null) {
    return { value: null, source: "unknown", frontValue: null, backValue: null, conflict: false };
  }
  if (front !== null && back === null) {
    return { value: front, source: "front", frontValue: front, backValue: null, conflict: false };
  }
  if (front === null && back !== null) {
    return { value: back, source: "back", frontValue: null, backValue: back, conflict: false };
  }

  // Both present from here on.
  if (normalizedEqual(front, back)) {
    // Equal (case/whitespace differences aside) -- one clean display value.
    // Front's original form is used by convention, consistent with this
    // module's default tie-breaking toward front when there's no other
    // signal to prefer back.
    return { value: front, source: "both", frontValue: front, backValue: back, conflict: false };
  }

  // Genuine conflict: preserve both, choose the field's priority side.
  const chosen = priority === "front" ? front : back;
  return { value: chosen, source: priority, frontValue: front, backValue: back, conflict: true };
}

// The merged general "year" field is NOT a simple front-vs-back conflict
// over the same underlying property -- it combines two different concepts
// (front's visibleYear, back's copyrightYear) with front preferred when
// both exist and differ, since a card's visible/printed year is not always
// the same as its copyright year (e.g. a rookie card printed the year after
// a copyright date, or a retro/throwback insert). copyrightYear itself is
// preserved separately and unaffected by this -- see mergeCardOcrResults.
function mergeYearField(
  rawVisibleYear: string | null | undefined,
  rawCopyrightYear: string | null | undefined,
): MergedOcrField {
  return mergeField(rawVisibleYear, rawCopyrightYear, "front");
}

function buildCombinedRawText(front: CardOcrResult | null, back: CardOcrResult | null): string {
  const frontText = front?.rawText.trim() ?? "";
  const backText = back?.rawText.trim() ?? "";

  if (frontText && backText) {
    if (frontText.toLowerCase() === backText.toLowerCase()) return frontText;
    return `${frontText}\n${backText}`;
  }
  return frontText || backText;
}

/**
 * Merges independent front/back OCR results into one normalized,
 * field-by-field view -- pure and deterministic, never mutates either
 * input. Works with either side (or neither) missing. Each field states
 * where its value came from, both sides' original values, and whether they
 * genuinely conflicted, so nothing is silently discarded even when a
 * priority rule picks a side.
 */
export function mergeCardOcrResults(
  front: CardOcrResult | null,
  back: CardOcrResult | null,
): MergedCardOcrResult {
  const f: CardOcrExtractedFields = front?.extracted ?? {};
  const b: CardOcrExtractedFields = back?.extracted ?? {};

  const fields: MergedCardOcrResult["fields"] = {
    // Prefer front on conflict.
    playerName: mergeField(f.playerName, b.playerName, "front"),
    teamName: mergeField(f.teamName, b.teamName, "front"),
    // setName prefers BACK on conflict (unlike the other front-priority
    // fields above) -- official checklist/product wording on the back is
    // usually more structured than a front logo/wordmark OCR reading, per
    // this correction's explicit instruction. Both values and any conflict
    // are still preserved exactly like every other field.
    setName: mergeField(f.setName, b.setName, "back"),
    year: mergeYearField(f.visibleYear, b.copyrightYear),
    cardName: mergeField(f.cardName, b.cardName, "front"),
    parallelText: mergeField(f.parallelText, b.parallelText, "front"),
    autographIndicator: mergeField(f.autographIndicator, b.autographIndicator, "front"),
    relicIndicator: mergeField(f.relicIndicator, b.relicIndicator, "front"),

    // Brand: prefer back on conflict -- manufacturer/licensing text on the
    // back is generally more structured than a front logo's OCR reading.
    brand: mergeField(f.brand, b.brand, "back"),

    // Prefer back on conflict.
    cardNumber: mergeField(f.cardNumber, b.cardNumber, "back"),
    copyrightYear: mergeField(f.copyrightYear, b.copyrightYear, "back"),
    manufacturer: mergeField(f.manufacturer, b.manufacturer, "back"),
    smallPrint: mergeField(f.smallPrint, b.smallPrint, "back"),
    statisticsText: mergeField(f.statisticsText, b.statisticsText, "back"),
    checklistText: mergeField(f.checklistText, b.checklistText, "back"),
    serialNumbering: mergeField(f.serialNumbering, b.serialNumbering, "back"),
    authenticationText: mergeField(f.authenticationText, b.authenticationText, "back"),
  };

  const conflictCount = Object.values(fields).filter((field) => field.conflict).length;

  return {
    fields,
    frontAvailable: front !== null,
    backAvailable: back !== null,
    conflictCount,
    createdAt: new Date().toISOString(),
    combinedRawText: buildCombinedRawText(front, back),
  };
}

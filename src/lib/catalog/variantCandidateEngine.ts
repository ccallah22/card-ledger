import type { MergedCardOcrResult } from "@/lib/ocr/merge";
import { listCardVariantsForCard, type CardVariantSummary } from "@/lib/repositories/cardVariants";

// Vision Engine V2, Phase 8A: variant-aware candidate search. Given a card
// candidate's already-fetched catalog variants, ranks them against the
// merged OCR evidence -- a separate, additive concern from candidateEngine
// .ts's card-level score/reasons. Nothing here selects a variant, mutates
// the catalog, or changes the existing card-candidate pipeline; it only
// ranks and explains. Deliberately NOT wired into findCatalogCandidates's
// eager per-candidate loop (that would mean a variants query for every one
// of up to 25 pooled candidates on every search) -- see
// getRankedVariantsForCard below, which callers invoke on demand for just
// the one candidate they're actually displaying.

export type VariantCandidate = {
  variantId: number;
  parallelName: string | null;
  printRun: number | null;
  swatchDescriptor: string | null;
  hasAutograph: boolean;
  hasMemorabilia: boolean;
  rankingScore: number;
  // Human-readable, generated from the exact same per-field assessments
  // that produce rankingScore (see scoreVariant) -- never a separate,
  // independently-maintained explanation.
  reasons: string[];
};

// Points available per field, out of 100 when every field has strong
// supporting evidence. A separate point scale from candidateEngine.ts's
// card-level WEIGHTS -- these are two independent scores by design (a
// card's rankingScore/confidence must never be affected by variant
// evidence, and vice versa). Parallel name is the primary distinguishing
// signal for a variant; print run is strong corroborating evidence;
// autograph/memorabilia are strong binary signals; swatch descriptor is a
// secondary, sparser text signal.
const VARIANT_WEIGHTS = {
  parallel: 40,
  printRun: 25,
  autograph: 15,
  memorabilia: 15,
  swatchDescriptor: 5,
} as const;

// How much a contradiction costs, as a fraction of the field's own weight
// -- always less than the full weight, so one conflicting field can never
// by itself outweigh two or more genuinely matching fields for the same
// variant.
const CONFLICT_FRACTION = 0.5;

type VariantFieldAssessment = {
  // Positive for a match, negative for a contradiction, 0 when there is no
  // usable evidence either way (never counted as a mismatch -- see
  // requirement 5).
  contribution: number;
  // null when there is nothing worth telling the user about this field
  // (no evidence, or a weak/ambiguous text mismatch not worth surfacing as
  // a "conflict").
  reasonText: string | null;
};

function normalizeCase(value: string): string {
  return value.trim().toLowerCase();
}

// Conservative punctuation/whitespace normalization only -- same
// convention as candidateConfidence.ts's card-level assessment (out of
// scope to import from directly here, so this is a small, intentional,
// self-contained duplication of a two-line helper, not of any scoring
// logic).
function normalizePunctuation(value: string): string {
  return value.replace(/[.,\-'’]/g, "").replace(/\s+/g, " ").trim();
}

// exact / normalized / partial / missing / mismatch ladder for a
// short free-text variant field (parallel name, swatch descriptor).
// "missing" (either side has nothing to compare) always contributes 0 and
// is reported distinctly from "mismatch" so callers can decide whether to
// penalize it -- see assessParallel/assessSwatchDescriptor.
type TextQuality = "exact" | "normalized" | "partial" | "missing" | "mismatch";

function classifyText(expected: string | null, actual: string | null): TextQuality {
  if (!expected || !actual) return "missing";
  const eCase = normalizeCase(expected);
  const aCase = normalizeCase(actual);
  if (eCase === aCase) return "exact";
  const eNorm = normalizePunctuation(eCase);
  const aNorm = normalizePunctuation(aCase);
  if (eNorm === aNorm) return "normalized";
  if (eNorm.length > 0 && aNorm.length > 0 && (aNorm.includes(eNorm) || eNorm.includes(aNorm))) {
    return "partial";
  }
  return "mismatch";
}

// Parallel text (OCR) vs. this variant's own parallel name. A mismatch
// here specifically means OCR read a DIFFERENT parallel's name than this
// variant's -- reasonable evidence this particular variant is the wrong
// one, so it's penalized (not just left at 0) per requirement 5's
// "contradictory evidence may reduce the variant score."
function assessParallel(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.parallel;
  const expected = merged.fields.parallelText.value;
  const actual = variant.parallelName;
  const quality = classifyText(expected, actual);

  switch (quality) {
    case "exact":
      return { contribution: weight, reasonText: `Parallel matched exactly: ${actual}` };
    case "normalized":
      return { contribution: weight * 0.95, reasonText: `Parallel matched: ${actual}` };
    case "partial":
      return { contribution: weight * 0.6, reasonText: `Parallel partially matched: ${actual}` };
    case "mismatch":
      return {
        contribution: -weight * CONFLICT_FRACTION,
        reasonText: `Parallel evidence conflicts with this variant (expected "${expected}")`,
      };
    case "missing":
    default:
      return { contribution: 0, reasonText: null };
  }
}

// Swatch descriptor (jersey-tag/manufacturer-logo text) vs. OCR's card/
// subset name -- the weakest, sparsest signal here (misc card-name text
// rarely has anything to do with a swatch descriptor even for the right
// variant), so a text mismatch is left at 0 rather than penalized; only a
// genuine match is rewarded.
function assessSwatchDescriptor(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.swatchDescriptor;
  const expected = merged.fields.cardName.value;
  const actual = variant.swatchDescriptor;
  const quality = classifyText(expected, actual);

  switch (quality) {
    case "exact":
      return { contribution: weight, reasonText: `Swatch descriptor matched exactly: ${actual}` };
    case "normalized":
      return { contribution: weight * 0.95, reasonText: `Swatch descriptor matched: ${actual}` };
    case "partial":
      return { contribution: weight * 0.6, reasonText: `Swatch descriptor partially matched: ${actual}` };
    case "mismatch":
    case "missing":
    default:
      return { contribution: 0, reasonText: null };
  }
}

// Extracts a stated print-run TOTAL (never the individual copy number) from
// free text, normalizing the formats named in the spec: "/25", "25",
// "07/25", "numbered to 25", "print run 25" all resolve to 25. A fraction's
// numerator ("07" in "07/25") is deliberately never returned.
function extractPrintRun(text: string | null): number | null {
  if (!text) return null;
  const trimmed = text.trim();

  const fraction = trimmed.match(/(\d+)\s*\/\s*(\d+)/);
  if (fraction) {
    const total = Number(fraction[2]);
    return Number.isFinite(total) ? total : null;
  }

  const slashOnly = trimmed.match(/\/\s*(\d+)\b/);
  if (slashOnly) {
    const total = Number(slashOnly[1]);
    return Number.isFinite(total) ? total : null;
  }

  const numberedTo = trimmed.match(/number(?:ed)?\s*to\s*(\d+)/i);
  if (numberedTo) {
    const total = Number(numberedTo[1]);
    return Number.isFinite(total) ? total : null;
  }

  const printRunPhrase = trimmed.match(/print\s*run\s*(?:of\s*)?(\d+)/i);
  if (printRunPhrase) {
    const total = Number(printRunPhrase[1]);
    return Number.isFinite(total) ? total : null;
  }

  const bareNumber = trimmed.match(/^(\d+)$/);
  if (bareNumber) {
    const total = Number(bareNumber[1]);
    return Number.isFinite(total) ? total : null;
  }

  return null;
}

// serialNumbering is the dedicated OCR field for this ("23/99"-style
// text); parallelText is a fallback, since a "numbered to 25" style label
// is sometimes the only print-run wording OCR actually captures, and it
// may land in the parallel/subset text rather than a distinct serial
// field.
function extractPrintRunEvidence(merged: MergedCardOcrResult): number | null {
  return extractPrintRun(merged.fields.serialNumbering.value) ?? extractPrintRun(merged.fields.parallelText.value);
}

function assessPrintRun(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.printRun;
  const evidence = extractPrintRunEvidence(merged);
  const actual = variant.printRun;

  if (evidence === null) return { contribution: 0, reasonText: null };
  // This variant simply isn't a numbered one -- absence of a print run on
  // the catalog side isn't a contradiction by itself.
  if (actual === null) return { contribution: 0, reasonText: null };

  if (evidence === actual) {
    return { contribution: weight, reasonText: `Print run matched: /${actual}` };
  }
  return {
    contribution: -weight * CONFLICT_FRACTION,
    reasonText: `Print run conflicts with this variant (expected /${evidence}, this is /${actual})`,
  };
}

// Shared boolean-flag assessor for autograph/memorabilia: positive OCR
// evidence matching a true flag is rewarded; positive evidence against a
// false flag is penalized; absence of OCR evidence never implies false and
// never penalizes either value (requirement 5).
function assessBooleanFlag(
  label: string,
  hasEvidence: boolean,
  flagValue: boolean,
  weight: number,
): VariantFieldAssessment {
  if (!hasEvidence) return { contribution: 0, reasonText: null };
  if (flagValue) return { contribution: weight, reasonText: `${label} evidence matched` };
  return { contribution: -weight * CONFLICT_FRACTION, reasonText: `${label} evidence conflicts with this variant` };
}

function assessAutograph(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantFieldAssessment {
  return assessBooleanFlag(
    "Autograph",
    Boolean(merged.fields.autographIndicator.value),
    variant.hasAutograph,
    VARIANT_WEIGHTS.autograph,
  );
}

function assessMemorabilia(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantFieldAssessment {
  return assessBooleanFlag(
    "Memorabilia",
    Boolean(merged.fields.relicIndicator.value),
    variant.hasMemorabilia,
    VARIANT_WEIGHTS.memorabilia,
  );
}

function scoreVariant(variant: CardVariantSummary, merged: MergedCardOcrResult): VariantCandidate {
  const assessments = [
    assessParallel(variant, merged),
    assessPrintRun(variant, merged),
    assessAutograph(variant, merged),
    assessMemorabilia(variant, merged),
    assessSwatchDescriptor(variant, merged),
  ];

  const rankingScore = assessments.reduce((sum, a) => sum + a.contribution, 0);
  const reasons = assessments
    .map((a) => a.reasonText)
    .filter((reason): reason is string => reason !== null);

  return {
    variantId: variant.id,
    parallelName: variant.parallelName,
    printRun: variant.printRun,
    swatchDescriptor: variant.swatchDescriptor,
    hasAutograph: variant.hasAutograph,
    hasMemorabilia: variant.hasMemorabilia,
    rankingScore,
    reasons,
  };
}

/**
 * Ranks an already-fetched list of a card's catalog variants against the
 * merged OCR evidence -- pure, deterministic, never mutates inputs, never
 * selects a variant. Ordering: higher rankingScore first (variants with no
 * matching evidence score 0 and rank below evidence-supported ones, but
 * remain in the list); ties broken deterministically by parallelName
 * (nulls last, then alphabetical), then by variantId ascending.
 */
export function rankCardVariants(
  variants: CardVariantSummary[],
  merged: MergedCardOcrResult,
): VariantCandidate[] {
  return variants
    .map((variant) => scoreVariant(variant, merged))
    .sort((a, b) => {
      if (b.rankingScore !== a.rankingScore) return b.rankingScore - a.rankingScore;
      const aName = a.parallelName ?? "";
      const bName = b.parallelName ?? "";
      if (aName !== bName) return aName.localeCompare(bName);
      return a.variantId - b.variantId;
    });
}

/**
 * Fetches (via the existing repository function -- no duplicate query)
 * and ranks a single card's variants against the merged OCR evidence.
 * Intended to be called on demand for one candidate at a time (the
 * selected candidate, or the top candidate when nothing is selected) --
 * never in a loop over every pooled search candidate.
 */
export async function getRankedVariantsForCard(
  cardId: number,
  merged: MergedCardOcrResult,
): Promise<VariantCandidate[]> {
  const variants = await listCardVariantsForCard(cardId);
  return rankCardVariants(variants, merged);
}

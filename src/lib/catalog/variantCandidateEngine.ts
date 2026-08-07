import type { EvidenceField, FusedEvidence } from "@/lib/evidence/types";
import { listCardVariantsForCard, type CardVariantSummary } from "@/lib/repositories/cardVariants";

// Vision Engine V2, Phase 8A: variant-aware candidate search. Given a card
// candidate's already-fetched catalog variants, ranks them against the
// fused evidence -- a separate, additive concern from candidateEngine.ts's
// card-level score/reasons. Nothing here selects a variant, mutates the
// catalog, or changes the existing card-candidate pipeline; it only ranks
// and explains. Deliberately NOT wired into findCatalogCandidates's eager
// per-candidate loop (that would mean a variants query for every one of up
// to 25 pooled candidates on every search) -- see getRankedVariantsForCard
// below, which callers invoke on demand for just the one candidate they're
// actually displaying.
//
// Vision Engine V3, Phase V3.2F: migrated from MergedCardOcrResult to
// FusedEvidence, and Vision evidence now participates in variant ranking
// (never card ranking or candidate confidence -- see cards/new/page.tsx,
// which passes this module the FULL fused evidence including Vision, while
// candidateEngine/candidateConfidence continue to receive an OCR-only
// fused evidence). Two different strategies for letting Vision in,
// depending on whether an OCR-driven concept already existed:
//   - autographPresent/memorabiliaPresent: no new weight. assessAutograph/
//     assessMemorabilia now read the FUSED evidence field directly, which
//     already blends OCR text-indicator evidence with Vision's visual
//     observation per FIELD_STRATEGIES (Vision-preferred). When Vision is
//     absent, the fused value reduces exactly to OCR's own truthiness (see
//     Phase V3.2C's golden regression), so this is a genuine byte-identical
//     generalization, not a new scoring dimension.
//   - dominant/border color, serial-area-visible: no OCR-driven equivalent
//     ever existed for these, so they are new, small, purely additive
//     VISION_WEIGHTS dimensions (see below), contributing 0 whenever Vision
//     has no observation for them (which is always true when Vision is
//     absent).
//   - orientation is deliberately NOT scored: a card's rotation in the
//     photo has no defensible mapping to which catalog variant it is (a
//     sideways photo of a base card and a sideways photo of a Gold parallel
//     look equally "sideways"), so inventing a scoring rule for it here
//     would not be a genuine signal.

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

// Points available per OCR-derived field, out of 100 when every field has
// strong supporting evidence -- unchanged from before this phase. A
// separate point scale from candidateEngine.ts's card-level WEIGHTS --
// these are two independent scores by design (a card's rankingScore/
// confidence must never be affected by variant evidence, and vice versa).
// Parallel name is the primary distinguishing signal for a variant; print
// run is strong corroborating evidence; autograph/memorabilia are strong
// binary signals; swatch descriptor is a secondary, sparser text signal.
// See VISION_WEIGHTS below for the separate, smaller, purely additive
// bonuses Vision evidence can contribute on top of this 100-point base.
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
// variant. Shared by both the OCR-derived assessors and the tri-state
// autograph/memorabilia assessor below -- one penalty mechanism, not two.
const CONFLICT_FRACTION = 0.5;

// Vision Engine V3, Phase V3.2F: modest, purely additive bonuses for visual
// evidence with no pre-existing OCR-driven equivalent. Deliberately small
// relative to VARIANT_WEIGHTS' 100-point OCR base (a visual corroboration
// is a nice-to-have nudge, never a primary identifying signal the way
// parallel text or print run are) -- every one of these contributes exactly
// 0 whenever Vision has no observation for the field, which is always true
// when Vision is absent (see the OCR-only golden regression this phase's
// report documents).
const VISION_WEIGHTS = {
  dominantColor: 8,
  borderColor: 5,
  serialArea: 6,
} as const;

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

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
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
function assessParallel(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.parallel;
  const expected = evidence.parallelText.value;
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
function assessSwatchDescriptor(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.swatchDescriptor;
  const expected = evidence.cardName.value;
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

// serialNumberText is the dedicated OCR-derived field for this ("23/99"-
// style text); parallelText is a fallback, since a "numbered to 25" style
// label is sometimes the only print-run wording OCR actually captures, and
// it may land in the parallel/subset text rather than a distinct serial
// field.
function extractPrintRunEvidence(evidence: FusedEvidence): number | null {
  return extractPrintRun(evidence.serialNumberText.value) ?? extractPrintRun(evidence.parallelText.value);
}

function assessPrintRun(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  const weight = VARIANT_WEIGHTS.printRun;
  const extracted = extractPrintRunEvidence(evidence);
  const actual = variant.printRun;

  if (extracted === null) return { contribution: 0, reasonText: null };
  // This variant simply isn't a numbered one -- absence of a print run on
  // the catalog side isn't a contradiction by itself.
  if (actual === null) return { contribution: 0, reasonText: null };

  if (extracted === actual) {
    return { contribution: weight, reasonText: `Print run matched: /${actual}` };
  }
  return {
    contribution: -weight * CONFLICT_FRACTION,
    reasonText: `Print run conflicts with this variant (expected /${extracted}, this is /${actual})`,
  };
}

// Shared tri-state assessor for autograph/memorabilia. `field` is the
// FUSED evidence field (already blending OCR indicator text with Vision's
// visual observation, Vision-preferred, per FIELD_STRATEGIES) -- this
// function itself has no idea which producer supplied the value, only
// whether the CURRENT primarySource happens to be a vision_front/
// vision_back kind, purely to select accurate, non-generic explanation
// wording (never to change the scoring rule itself).
//
// value === null: no usable evidence either way -- never implies false,
//   never penalizes either flag value (requirement 5).
// value === flagValue: matching evidence -- rewarded. This also covers the
//   new case Vision makes possible that OCR alone never could
//   (value === false, flagValue === false: Vision confidently saw no
//   autograph/memorabilia, and this variant agrees) -- confirming evidence
//   for a non-autograph/non-memorabilia variant is rewarded the same way
//   confirming positive evidence always has been.
// value !== flagValue: contradicting evidence -- penalized via the same
//   CONFLICT_FRACTION every other contradiction in this module uses.
//
// When Vision is absent, evidence.autographPresent/memorabiliaPresent can
// only ever be `true` (OCR found indicator text) or `null` (it found
// nothing) -- never `false`, since the OCR adapter never emits a false
// observation for these fields (see Phase V3.2C). That means this
// function's behavior for Vision-absent input is a byte-identical
// generalization of the old `hasEvidence: boolean` version: old
// `Boolean(merged.fields.autographIndicator.value)` is `true` exactly when
// `value === true` here, and `false` (meaning "OCR found nothing") maps
// exactly onto `value === null` here -- both produce contribution 0.
function assessBooleanFlag(
  label: string,
  field: EvidenceField<boolean>,
  flagValue: boolean,
  weight: number,
): VariantFieldAssessment {
  const value = field.value;
  if (value === null) return { contribution: 0, reasonText: null };

  const isVisual = field.primarySource?.kind === "vision_front" || field.primarySource?.kind === "vision_back";
  const lowerLabel = label.toLowerCase();

  if (value === flagValue) {
    if (isVisual) {
      return {
        contribution: weight,
        reasonText: value
          ? `Visual analysis detected ${lowerLabel}.`
          : `Visual analysis found no ${lowerLabel}, consistent with this variant.`,
      };
    }
    return { contribution: weight, reasonText: `${label} evidence matched` };
  }

  if (isVisual) {
    return {
      contribution: -weight * CONFLICT_FRACTION,
      reasonText: value
        ? `Visual analysis detected ${lowerLabel}, conflicting with this variant.`
        : `Visual analysis found no ${lowerLabel}, conflicting with this variant.`,
    };
  }
  return { contribution: -weight * CONFLICT_FRACTION, reasonText: `${label} evidence conflicts with this variant` };
}

function assessAutograph(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  return assessBooleanFlag("Autograph", evidence.autographPresent, variant.hasAutograph, VARIANT_WEIGHTS.autograph);
}

function assessMemorabilia(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  return assessBooleanFlag("Memorabilia", evidence.memorabiliaPresent, variant.hasMemorabilia, VARIANT_WEIGHTS.memorabilia);
}

// True when a variant's parallel name textually references a color family
// (e.g. "Gold Vinyl" / "gold", "Black Prizm" / "black") -- a simple,
// conservative substring check, consistent with this module's existing
// text-matching conservatism (no fuzzy/synonym matching).
function colorNameMatches(parallelName: string, colorFamily: string): boolean {
  return normalizeCase(parallelName).includes(colorFamily);
}

// Vision Engine V3, Phase V3.2F: a small, positive-only corroborating
// signal -- a color MISMATCH is deliberately never penalized (unlike
// parallel TEXT, which directly names the parallel), since a card's
// photographed dominant/border color often reflects the base card design
// rather than the specific parallel treatment, so a non-match is far
// weaker evidence than a text-based parallel disagreement.
function assessVisualDominantColor(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  const parallelName = variant.parallelName;
  const color = evidence.dominantColor.value;
  if (!parallelName || !color || !colorNameMatches(parallelName, color)) return { contribution: 0, reasonText: null };
  return { contribution: VISION_WEIGHTS.dominantColor, reasonText: `Dominant color matches ${capitalize(color)} parallel.` };
}

function assessVisualBorderColor(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  const parallelName = variant.parallelName;
  const color = evidence.borderColor.value;
  if (!parallelName || !color || !colorNameMatches(parallelName, color)) return { contribution: 0, reasonText: null };
  return { contribution: VISION_WEIGHTS.borderColor, reasonText: `Border color matches ${capitalize(color)} parallel.` };
}

// Vision Engine V3, Phase V3.2F: a positive-only signal -- a card simply
// not showing a visible serial-number AREA in the photo (cropped out,
// glare, angle) is common and uninformative, so only a confirmed-visible
// serial area contributes, and only when this variant actually IS a
// numbered one (variant.printRun !== null). No penalty applies when
// serialAreaVisible is false or absent, or the variant isn't numbered --
// absence of visual confirmation is not evidence against a numbered
// variant.
function assessVisualSerialArea(variant: CardVariantSummary, evidence: FusedEvidence): VariantFieldAssessment {
  if (evidence.serialAreaVisible.value !== true) return { contribution: 0, reasonText: null };
  if (variant.printRun === null) return { contribution: 0, reasonText: null };
  return { contribution: VISION_WEIGHTS.serialArea, reasonText: "Visual analysis supports numbered variant." };
}

function scoreVariant(variant: CardVariantSummary, evidence: FusedEvidence): VariantCandidate {
  const assessments = [
    assessParallel(variant, evidence),
    assessPrintRun(variant, evidence),
    assessAutograph(variant, evidence),
    assessMemorabilia(variant, evidence),
    assessSwatchDescriptor(variant, evidence),
    assessVisualDominantColor(variant, evidence),
    assessVisualBorderColor(variant, evidence),
    assessVisualSerialArea(variant, evidence),
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
 * Ranks an already-fetched list of a card's catalog variants against fused
 * evidence -- pure, deterministic, never mutates inputs, never selects a
 * variant. Ordering: higher rankingScore first (variants with no matching
 * evidence score 0 and rank below evidence-supported ones, but remain in
 * the list); ties broken deterministically by parallelName (nulls last,
 * then alphabetical), then by variantId ascending.
 *
 * Callers decide how much of Vision to include -- see cards/new/page.tsx,
 * which passes this function the full fused evidence (OCR + Vision) while
 * candidateEngine/candidateConfidence continue to receive an OCR-only
 * fused evidence, so Vision only ever affects variant ranking.
 */
export function rankCardVariants(
  variants: CardVariantSummary[],
  evidence: FusedEvidence,
): VariantCandidate[] {
  return variants
    .map((variant) => scoreVariant(variant, evidence))
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
 * and ranks a single card's variants against fused evidence. Intended to
 * be called on demand for one candidate at a time (the selected candidate,
 * or the top candidate when nothing is selected) -- never in a loop over
 * every pooled search candidate.
 */
export async function getRankedVariantsForCard(
  cardId: number,
  evidence: FusedEvidence,
): Promise<VariantCandidate[]> {
  const variants = await listCardVariantsForCard(cardId);
  return rankCardVariants(variants, evidence);
}

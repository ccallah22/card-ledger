import type { MergedCardOcrResult, MergedOcrField, OcrFieldSource } from "@/lib/ocr/merge";
import { WEIGHTS, type CandidateMatchReason, type CatalogCandidate } from "@/lib/catalog/candidateEngine";

// Vision Engine V2, Phase 7B: candidate *confidence and explainability*.
// This is deliberately a separate concept from candidateEngine.ts's
// ranking `score` -- score answers "how well does this candidate match,
// relative to other candidates, for search ordering purposes"; confidence
// here answers "how much should a human (or a future auto-preselect
// feature) trust that match, given evidence quality/coverage, front/back
// conflicts, and how clearly this candidate stands out from the rest."
// Nothing here mutates its inputs, selects a candidate, or persists
// anything -- it only produces an advisory, read-only assessment per
// candidate for the UI to display.

export type MatchQuality =
  | "exact"
  | "normalized"
  | "partial"
  | "missing"
  | "conflict"
  | "mismatch";

export type FieldConfidenceAssessment = {
  field: string;
  quality: MatchQuality;
  confidence: number;
  weight: number;
  contribution: number;
  expected: string | null;
  actual: string | null;
  source: OcrFieldSource;
  conflict: boolean;
};

export type CandidateConfidenceAssessment = {
  candidate: CatalogCandidate;
  rankingScore: number;
  confidence: number;
  fieldAssessments: FieldConfidenceAssessment[];
  evidenceCoverage: number;
  conflictPenalty: number;
  ambiguityPenalty: number;
  scoreGapToNext: number | null;
  recommendation: "insufficient_evidence" | "review" | "strong_match" | "safe_to_preselect";
  safeToPreselect: boolean;
};

// Quality -> confidence factor (0-1). "conflict" is intentionally treated
// the same as "mismatch" for the purposes of this per-field contribution --
// an unresolved front/back disagreement gets no positive credit here. Its
// actual confidence *penalty* is applied once, globally, via
// computeConflictPenalty below, per the field spec's explicit instruction
// that "a conflict should not be its own standalone match factor if the
// selected value otherwise matches." A conflicting field whose selected
// value DOES otherwise match keeps its real quality (exact/normalized/
// partial) here -- see classifyField -- and is *only* penalized via
// computeConflictPenalty, not by this factor table.
const QUALITY_FACTORS: Record<MatchQuality, number> = {
  exact: 1.0,
  normalized: 0.95,
  partial: 0.7,
  missing: 0.0,
  mismatch: 0.0,
  conflict: 0.0,
};

// Fields whose evidence must never be matched via substring/fuzzy
// containment -- a card number, year, or serial number that merely
// *contains* another as a substring is not evidence of a match. Their only
// possible qualities are missing / exact / mismatch (the "exact" tier
// already includes safe, field-specific normalization such as stripping a
// leading "#" from a card number -- see classifyExactOnly).
const EXACT_ONLY_FIELDS = new Set(["cardNumber", "year"]);

// Core identity fields -- weighted more heavily both in the conflict
// penalty (a front/back disagreement here is more damaging to trust than
// e.g. a conflicting misc/parallel field) and in the safe-to-preselect
// structural gates below.
const HIGH_VALUE_FIELDS = new Set(["player", "cardNumber", "set", "year"]);

function normalizeCase(value: string): string {
  return value.trim().toLowerCase();
}

// Conservative punctuation/whitespace normalization only -- no synonym or
// abbreviation expansion. Safe for free-text fields (player, set, brand,
// parallel, misc); never applied to the exact-only numeric fields.
function normalizePunctuationAndWhitespace(value: string): string {
  // Strips periods, commas, hyphens, and both straight/curly apostrophes
  // (e.g. "Panini, Inc." -> "panini inc", "O'Brien" == "O'Brien").
  return value.replace(/[.,\-'’]/g, "").replace(/\s+/g, " ").trim();
}

// Card-number-specific "exact" normalization: strips a leading "#" only.
// This mirrors candidateEngine.ts's own cardNumberMatches so this module's
// idea of "exact" for card numbers matches what the ranking engine already
// considers an exact match, not a looser standard.
function normalizeCardNumber(value: string): string {
  return value.trim().replace(/^#/, "").toLowerCase();
}

function toNumberOrNull(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// exact-only fields (cardNumber, year): missing / exact / mismatch. Never
// normalized/partial -- substring or fuzzy matching is explicitly
// disallowed for these per the field's own numeric/identifier nature.
function classifyExactOnly(field: string, expected: string | null, actual: string | null): MatchQuality {
  const e = expected?.trim();
  if (!e) return "missing";
  const a = actual?.trim();
  if (!a) return "missing";

  const eNorm = field === "cardNumber" ? normalizeCardNumber(e) : normalizeCase(e);
  const aNorm = field === "cardNumber" ? normalizeCardNumber(a) : normalizeCase(a);
  if (eNorm === aNorm) return "exact";

  const eNum = toNumberOrNull(eNorm);
  const aNum = toNumberOrNull(aNorm);
  if (eNum !== null && aNum !== null && eNum === aNum) return "exact";

  return "mismatch";
}

// Free-text fields (player, set, brand, parallel, misc): full ladder,
// including a deliberately narrow "partial" tier -- substring containment
// either direction, used only where semantically reasonable (a set name
// inside a longer official title, a player name without a middle initial,
// a short parallel label inside a longer descriptor).
function classifyFreeText(expected: string | null, actual: string | null): MatchQuality {
  const e = expected?.trim();
  if (!e) return "missing";
  const a = actual?.trim();
  if (!a) return "missing";

  const eCase = normalizeCase(e);
  const aCase = normalizeCase(a);
  if (eCase === aCase) return "exact";

  const eNorm = normalizePunctuationAndWhitespace(eCase);
  const aNorm = normalizePunctuationAndWhitespace(aCase);
  if (eNorm === aNorm) return "normalized";

  if (eNorm.length > 0 && aNorm.length > 0 && (aNorm.includes(eNorm) || eNorm.includes(aNorm))) {
    return "partial";
  }

  return "mismatch";
}

function classifyField(field: string, expected: string | null, actual: string | null): MatchQuality {
  return EXACT_ONLY_FIELDS.has(field) ? classifyExactOnly(field, expected, actual) : classifyFreeText(expected, actual);
}

type FieldDefinition = {
  field: string;
  weight: number;
  reasonField: string;
  mergedField: (merged: MergedCardOcrResult) => MergedOcrField;
};

// Exact field-to-candidate mapping (documented per the Phase 7B spec):
//   merged playerName        -> candidate playerName            (reasons "player")
//   merged cardNumber        -> candidate card number evidence   (reasons "cardNumber")
//   merged setName           -> candidate setName                (reasons "set")
//   merged year               -> candidate year                   (reasons "year")
//   merged brand/manufacturer -> candidate brand/manufacturer     (reasons "brand")
//   merged parallelText       -> candidate parallel                (reasons "parallel")
//   merged cardName           -> candidate title/misc              (reasons "misc")
// Structured expected/actual values are read from candidate.reasons (already
// computed by candidateEngine.ts against the real catalog columns) rather
// than re-derived from candidate.cardTitle, which is a display string with
// a fallback chain (card.title || playerName || "Card #N") that is not
// safe to reverse-parse.
const FIELD_DEFINITIONS: FieldDefinition[] = [
  { field: "player", weight: WEIGHTS.player, reasonField: "player", mergedField: (m) => m.fields.playerName },
  { field: "cardNumber", weight: WEIGHTS.cardNumber, reasonField: "cardNumber", mergedField: (m) => m.fields.cardNumber },
  { field: "set", weight: WEIGHTS.set, reasonField: "set", mergedField: (m) => m.fields.setName },
  { field: "year", weight: WEIGHTS.year, reasonField: "year", mergedField: (m) => m.fields.year },
  {
    field: "brand",
    weight: WEIGHTS.brand,
    reasonField: "brand",
    // Same "prefer brand, else manufacturer" precedence candidateEngine.ts's
    // brandOrManufacturerMatches already uses for its `expected` value.
    mergedField: (m) => (m.fields.brand.value ? m.fields.brand : m.fields.manufacturer),
  },
  { field: "parallel", weight: WEIGHTS.parallel, reasonField: "parallel", mergedField: (m) => m.fields.parallelText },
  { field: "misc", weight: WEIGHTS.misc, reasonField: "misc", mergedField: (m) => m.fields.cardName },
];

function findReason(reasons: CandidateMatchReason[], field: string): CandidateMatchReason | undefined {
  return reasons.find((r) => r.field === field);
}

function assessFields(merged: MergedCardOcrResult, candidate: CatalogCandidate): FieldConfidenceAssessment[] {
  return FIELD_DEFINITIONS.map(({ field, weight, reasonField, mergedField }) => {
    const reason = findReason(candidate.reasons, reasonField);
    const expected = reason?.expected ?? null;
    const actual = reason?.actual ?? null;
    const merged_ = mergedField(merged);

    let quality = classifyField(field, expected, actual);
    // A field that genuinely conflicted between front and back, and whose
    // selected value still doesn't match the candidate, is labeled
    // "conflict" rather than a plain "mismatch" -- more informative for
    // explainability (there WAS evidence, it just disagreed). A conflicting
    // field whose selected value DOES match keeps its real exact/
    // normalized/partial quality; the conflict is only reflected via the
    // `conflict` flag and the separate global conflictPenalty, never by
    // downgrading an otherwise-good quality here.
    if (merged_.conflict && quality === "mismatch") {
      quality = "conflict";
    }

    const confidence = QUALITY_FACTORS[quality];
    const contribution = weight * confidence;

    return {
      field,
      quality,
      confidence,
      weight,
      contribution,
      expected,
      actual,
      source: merged_.source,
      conflict: merged_.conflict,
    };
  });
}

// Evidence coverage: proportion (0-1) of total field weight for which
// usable OCR evidence existed at all (quality !== "missing"), regardless of
// whether it matched. A field with no OCR evidence contributes nothing to
// coverage -- it's simply unknown, not counted as a match or a mismatch.
function computeEvidenceCoverage(fields: FieldConfidenceAssessment[]): number {
  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return 0;
  const coveredWeight = fields.filter((f) => f.quality !== "missing").reduce((sum, f) => sum + f.weight, 0);
  return coveredWeight / totalWeight;
}

// Conflict penalty (0-1 scale, consistently -- never mixed with a raw point
// deduction): sum the weights of fields that genuinely conflicted between
// front and back, doubling the weight of high-value identity fields
// (player/cardNumber/set/year), then divide by (totalWeight * 2) -- the
// maximum possible weighted-conflict total if every field conflicted and
// every field were high-value-weighted. This keeps the result in [0, 1]
// while making a conflict on an identity field meaningfully worse than one
// on a low-weight field like parallel/misc.
function computeConflictPenalty(fields: FieldConfidenceAssessment[]): number {
  const conflicting = fields.filter((f) => f.conflict);
  if (conflicting.length === 0) return 0;

  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  if (totalWeight === 0) return 0;

  const weightedConflict = conflicting.reduce((sum, f) => {
    const multiplier = HIGH_VALUE_FIELDS.has(f.field) ? 2 : 1;
    return sum + f.weight * multiplier;
  }, 0);

  return Math.min(1, weightedConflict / (totalWeight * 2));
}

const NEAR_TIE_MARGIN = 5;
const GAP_FOR_ZERO_PENALTY = 25;

// Ambiguity penalty (0-1 scale): how much this candidate's confidence
// should be discounted because it isn't clearly separated from the other
// candidates' ranking scores. Two independent signals, and the penalty is
// the larger of the two (either one alone can justify full caution):
//   - gapComponent: shrinks linearly from 1 (tied or beaten) to 0 once this
//     candidate leads its closest rival by GAP_FOR_ZERO_PENALTY (25) points.
//   - tieComponent: grows with the number of OTHER candidates within
//     NEAR_TIE_MARGIN (5) points of this one's score (0.25 per near-tie,
//     capped at 1) -- a candidate "tied with several alternatives" is
//     penalized even if no single rival is close enough to move
//     gapComponent much.
function computeAmbiguity(
  candidateScore: number,
  otherScores: number[],
): { penalty: number; scoreGapToNext: number | null } {
  if (otherScores.length === 0) {
    return { penalty: 0, scoreGapToNext: null };
  }

  const maxOther = Math.max(...otherScores);
  const scoreGapToNext = candidateScore - maxOther;

  const gapComponent = scoreGapToNext <= 0 ? 1 : Math.max(0, 1 - scoreGapToNext / GAP_FOR_ZERO_PENALTY);
  const nearTieCount = otherScores.filter((s) => Math.abs(candidateScore - s) <= NEAR_TIE_MARGIN).length;
  const tieComponent = Math.min(1, nearTieCount * 0.25);

  return { penalty: Math.min(1, Math.max(gapComponent, tieComponent)), scoreGapToNext };
}

// Coverage adjustment: full credit (1.0 multiplier) once evidence coverage
// reaches 70% of total field weight; below that, credit scales down
// linearly. This is what stops a single strong field match (e.g. player
// alone, 30% coverage) from producing a high confidence just because the
// few fields checked happened to match well -- fewer fields checked means
// less discriminating power, so the result is discounted even though the
// per-field quality contributions already reflect missing fields as 0.
const COVERAGE_FULL_CREDIT = 0.7;
function coverageAdjustment(evidenceCoverage: number): number {
  return Math.min(1, evidenceCoverage / COVERAGE_FULL_CREDIT);
}

// Final confidence formula (documented, 0-100 clamped, no double-counting
// beyond the intentional coverage/missing-evidence double-emphasis noted
// above):
//   weightedEvidenceQuality = sum of all fieldAssessments[].contribution
//   confidence = clamp(0, 100,
//     weightedEvidenceQuality * coverageAdjustment(evidenceCoverage)
//     - conflictPenalty * 100
//     - ambiguityPenalty * 100
//   )
function computeConfidence(
  fields: FieldConfidenceAssessment[],
  evidenceCoverage: number,
  conflictPenalty: number,
  ambiguityPenalty: number,
): number {
  const weightedEvidenceQuality = fields.reduce((sum, f) => sum + f.contribution, 0);
  const raw = weightedEvidenceQuality * coverageAdjustment(evidenceCoverage) - conflictPenalty * 100 - ambiguityPenalty * 100;
  return Math.max(0, Math.min(100, raw));
}

const SAFE_TO_PRESELECT_CONFIDENCE = 92;
const SAFE_TO_PRESELECT_MIN_COVERAGE = 0.7;
const SAFE_TO_PRESELECT_MIN_GAP = 15;
const STRONG_MATCH_CONFIDENCE = 70;
const STRONG_MATCH_MIN_COVERAGE = 0.5;
const REVIEW_MIN_COVERAGE = 0.2;

// Recommendation gates. safeToPreselect requires satisfying EVERY structural
// gate below, not just a numeric confidence threshold -- a candidate must
// have sufficient confidence AND coverage AND no unresolved high-weight
// mismatch/conflict on a core identity field AND a meaningful lead over the
// next candidate AND the minimum required identity evidence (player +
// card number). This phase only exposes the signal: safeToPreselect being
// true never causes any automatic selection.
function computeRecommendation(
  fields: FieldConfidenceAssessment[],
  confidence: number,
  evidenceCoverage: number,
  scoreGapToNext: number | null,
): { recommendation: CandidateConfidenceAssessment["recommendation"]; safeToPreselect: boolean } {
  const playerField = fields.find((f) => f.field === "player");
  const cardNumberField = fields.find((f) => f.field === "cardNumber");

  const hasUnresolvedCoreMismatch = fields.some(
    (f) => HIGH_VALUE_FIELDS.has(f.field) && (f.quality === "mismatch" || f.quality === "conflict"),
  );
  const hasSevereIdentityConflict = Boolean(playerField?.conflict || cardNumberField?.conflict);
  const hasRequiredIdentityEvidence =
    playerField?.quality !== "missing" && cardNumberField?.quality !== "missing";
  const hasMeaningfulLead = scoreGapToNext !== null && scoreGapToNext >= SAFE_TO_PRESELECT_MIN_GAP;

  const safeToPreselect =
    confidence >= SAFE_TO_PRESELECT_CONFIDENCE &&
    evidenceCoverage >= SAFE_TO_PRESELECT_MIN_COVERAGE &&
    !hasUnresolvedCoreMismatch &&
    !hasSevereIdentityConflict &&
    hasMeaningfulLead &&
    hasRequiredIdentityEvidence;

  if (safeToPreselect) {
    return { recommendation: "safe_to_preselect", safeToPreselect: true };
  }

  if (confidence >= STRONG_MATCH_CONFIDENCE && evidenceCoverage >= STRONG_MATCH_MIN_COVERAGE && !hasUnresolvedCoreMismatch) {
    return { recommendation: "strong_match", safeToPreselect: false };
  }

  if (evidenceCoverage >= REVIEW_MIN_COVERAGE) {
    return { recommendation: "review", safeToPreselect: false };
  }

  return { recommendation: "insufficient_evidence", safeToPreselect: false };
}

/**
 * Produces an independent confidence/explainability assessment for every
 * candidate, given the merged OCR result they were scored against. Pure and
 * read-only: never mutates mergedOcr/candidates, never selects a candidate,
 * never touches the catalog or persistence. Preserves candidate ordering
 * (the array is assessed in place, not re-sorted).
 */
export function assessCandidateConfidence(
  mergedOcr: MergedCardOcrResult,
  candidates: CatalogCandidate[],
): CandidateConfidenceAssessment[] {
  if (candidates.length === 0) return [];

  const scores = candidates.map((c) => c.score);

  return candidates.map((candidate, index) => {
    const fieldAssessments = assessFields(mergedOcr, candidate);
    const evidenceCoverage = computeEvidenceCoverage(fieldAssessments);
    const conflictPenalty = computeConflictPenalty(fieldAssessments);

    const otherScores = scores.filter((_, i) => i !== index);
    const { penalty: ambiguityPenalty, scoreGapToNext } = computeAmbiguity(candidate.score, otherScores);

    const confidence = computeConfidence(fieldAssessments, evidenceCoverage, conflictPenalty, ambiguityPenalty);
    const { recommendation, safeToPreselect } = computeRecommendation(
      fieldAssessments,
      confidence,
      evidenceCoverage,
      scoreGapToNext,
    );

    return {
      candidate,
      rankingScore: candidate.score,
      confidence,
      fieldAssessments,
      evidenceCoverage,
      conflictPenalty,
      ambiguityPenalty,
      scoreGapToNext,
      recommendation,
      safeToPreselect,
    };
  });
}

/** Convenience accessor -- ordering is already preserved, so this is just index 0. */
export function getTopConfidenceAssessment(
  assessments: CandidateConfidenceAssessment[],
): CandidateConfidenceAssessment | null {
  return assessments[0] ?? null;
}

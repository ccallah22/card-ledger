// Vision Engine V3, Phase V3.2B: pure Evidence Fusion algorithm.
//
// fuseEvidence() takes already-normalized EvidenceObservation inputs (no
// OCR/Vision adapters exist yet -- that is a later phase) and produces a
// FusedEvidence bundle, using FIELD_STRATEGIES as policy. It is a pure,
// synchronous, side-effect-free function: no network calls, no database
// calls, no environment variable reads, no mutation of its input.
//
// fuseEvidence() has no production caller yet. This phase only establishes
// the algorithm.
//
// Trust boundary: fuseEvidence is the boundary between adapters (which are
// expected to produce well-typed observations, but may still be wrong --
// a buggy adapter, a partially-failed provider response, or a future
// producer that isn't fully trusted yet) and consumers (which must be able
// to rely on every EvidenceField they read being internally consistent).
// Section "Usable observation rules" below documents exactly what gets
// silently dropped at that boundary and why -- bad values are discarded,
// never coerced into something a consumer would mistake for real evidence.
//
// Dependency hygiene: this module imports only from ./types and
// ./fieldStrategies. It must never import candidateEngine,
// candidateConfidence, variantCandidateEngine, any repository, Supabase,
// React, or any OCR/Vision adapter code.

import type {
  EvidenceConflict,
  EvidenceField,
  EvidenceFieldName,
  EvidenceObservation,
  EvidenceSourceKind,
  EvidenceState,
  EvidenceValueForField,
  FusedEvidence,
} from "./types";
import { FIELD_STRATEGIES, type FieldStrategy } from "./fieldStrategies";

/**
 * Fusion input: zero or more observations per field. A missing key and an
 * empty array both mean exactly the same thing -- no evidence for that
 * field -- so callers never need to special-case which form they pass.
 * Derived from EvidenceFieldName/EvidenceValueForField rather than a second,
 * independently-maintained field registry, so it can never drift out of
 * sync with FusedEvidence's own shape.
 */
export type EvidenceObservationsByField = {
  [K in EvidenceFieldName]?: EvidenceObservation<EvidenceValueForField<K>>[];
};

type ConflictSeverity = EvidenceConflict<unknown>["severity"];

// ---------------------------------------------------------------------------
// Constants (all documented -- see individual comments for the reasoning).
// ---------------------------------------------------------------------------

const MISSING_EXPLANATION = "No usable evidence.";

// Corroboration bonus per additional independent agreeing source kind, and
// the confidence floor a field must clear (with no conflict) to count as
// "confirmed" rather than merely "supported". Matches the Evidence Fusion
// Engine design doc's recommended formula and threshold exactly.
const CORROBORATION_BONUS_PER_SOURCE = 0.05;
const CONFIRMED_CONFIDENCE_THRESHOLD = 0.75;

// Conflict severity thresholds. `equalConfidenceIsSevere` (from
// FIELD_STRATEGIES) is the *only* signal fusion uses to know a field is
// high-value -- this module deliberately never imports HIGH_VALUE_FIELDS or
// any other catalog-owned concept, per the dependency-hygiene requirement.
// A conflict is only ever "severe" on a field whose strategy already marks
// equal-confidence disagreement as severe; near-equal or mutually
// high-confidence disagreement on such a field is the two ways that
// manifests. Every other genuine (non-trivial) disagreement is "moderate";
// a disagreement whose strongest opposing evidence is weak is
// "informational" -- worth surfacing, not worth treating as a real fight.
const NEAR_EQUAL_CONFIDENCE_EPSILON = 0.05;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const LOW_CONFIDENCE_THRESHOLD = 0.4;

// Applied once per field (fusion emits at most one grouped EvidenceConflict
// per field -- see buildConflict), never once per disagreeing observation.
// Bounded, auditable, and deliberately simple: a fixed deduction per
// severity tier, clamped to [0, 1] afterward.
const CONFLICT_CONFIDENCE_PENALTY: Record<ConflictSeverity, number> = {
  informational: 0.05,
  moderate: 0.15,
  severe: 0.3,
};

// Canonical, stable ordering used as the final tie-break when confidence,
// preferred-source rank, and observedAt are all equal, and to produce a
// deterministic contributingProducers list regardless of input order.
const CANONICAL_SOURCE_ORDER: EvidenceSourceKind[] = [
  "ocr_front",
  "ocr_back",
  "vision_front",
  "vision_back",
  "user",
  "manual_override",
  "catalog",
  "grading_label_ocr",
  "serial_ocr",
  "barcode",
  "marketplace",
];

// Human-readable, provider-neutral source labels for explanation text.
// Never derived from producerMetadata -- see EvidenceSource's own
// documentation on why that field must stay display-only and out of any
// decision path, including this one.
const SOURCE_LABEL: Record<EvidenceSourceKind, string> = {
  ocr_front: "OCR front",
  ocr_back: "OCR back",
  vision_front: "Vision front",
  vision_back: "Vision back",
  user: "User-provided evidence",
  manual_override: "Manual override",
  catalog: "Catalog",
  grading_label_ocr: "Grading-label OCR",
  serial_ocr: "Serial-number OCR",
  barcode: "Barcode/QR",
  marketplace: "Marketplace metadata",
};

const SOURCE_COARSE_LABEL: Record<EvidenceSourceKind, string> = {
  ocr_front: "OCR",
  ocr_back: "OCR",
  vision_front: "Vision",
  vision_back: "Vision",
  user: "User-provided",
  manual_override: "Manual override",
  catalog: "Catalog",
  grading_label_ocr: "Grading-label OCR",
  serial_ocr: "Serial-number OCR",
  barcode: "Barcode/QR",
  marketplace: "Marketplace",
};

const FIELD_NAMES = Object.keys(FIELD_STRATEGIES) as EvidenceFieldName[];

// ---------------------------------------------------------------------------
// Usable-observation rules (runtime defensive boundary -- see module comment).
// ---------------------------------------------------------------------------

function isFiniteConfidence(confidence: number): boolean {
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function hasValidObservedAt(observedAt: string): boolean {
  return typeof observedAt === "string" && observedAt.trim().length > 0 && !Number.isNaN(Date.parse(observedAt));
}

/**
 * Confidence out of [0,1], a parseable non-empty observedAt, and (for
 * string-valued fields, including the string-literal ColorFamily/Orientation
 * vocabularies) a non-blank trimmed value are the only things fusion checks
 * itself. ColorFamily/Orientation vocabulary membership is intentionally
 * *not* re-validated here -- that is the adapter's responsibility (the type
 * system already guarantees it structurally at every call site fusion has
 * today); duplicating a vocabulary check here would just be a second,
 * driftable copy of validateVisionAnalysis.ts's existing one.
 */
function isUsableObservation(observation: EvidenceObservation<unknown>): boolean {
  if (!isFiniteConfidence(observation.confidence)) return false;
  if (!hasValidObservedAt(observation.observedAt)) return false;
  if (typeof observation.value === "string" && observation.value.trim().length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Value equality (requirement: fusion determines agreement, not catalog match).
// ---------------------------------------------------------------------------

function normalizeForComparison(value: unknown): unknown {
  if (typeof value === "string") {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }
  return value;
}

/**
 * Centralized, field-agnostic agreement check. Strings (including the
 * ColorFamily/Orientation closed vocabularies, which are string subtypes)
 * are trimmed, case-folded, and whitespace-collapsed before comparison;
 * booleans compare by strict equality via the same fallback path. Never
 * substring or fuzzy matching -- "Mike" and "Mike Trout" disagree, exactly
 * as two genuinely different values should. Catalog-specific matching
 * (fuzzy text, numeric tolerance, etc.) belongs to candidateEngine, not here.
 */
function valuesAgree(a: unknown, b: unknown): boolean {
  return normalizeForComparison(a) === normalizeForComparison(b);
}

// ---------------------------------------------------------------------------
// Deterministic ordering.
// ---------------------------------------------------------------------------

/**
 * Strongest-first comparator: confidence descending, then (when
 * `preferredOrder` is non-empty) preferred-source rank ascending, then
 * observedAt newest-first, then a stable canonical source-kind order. Used
 * everywhere fusion needs to pick or order observations, so selection never
 * depends on incoming array order.
 */
function compareObservations<T>(
  a: EvidenceObservation<T>,
  b: EvidenceObservation<T>,
  preferredOrder: EvidenceSourceKind[],
): number {
  if (a.confidence !== b.confidence) return b.confidence - a.confidence;

  if (preferredOrder.length > 0) {
    const aRank = preferredOrder.indexOf(a.source.kind);
    const bRank = preferredOrder.indexOf(b.source.kind);
    const aRankOrInfinity = aRank === -1 ? Number.POSITIVE_INFINITY : aRank;
    const bRankOrInfinity = bRank === -1 ? Number.POSITIVE_INFINITY : bRank;
    if (aRankOrInfinity !== bRankOrInfinity) return aRankOrInfinity - bRankOrInfinity;
  }

  const aTime = Date.parse(a.observedAt);
  const bTime = Date.parse(b.observedAt);
  if (aTime !== bTime) return bTime - aTime;

  return CANONICAL_SOURCE_ORDER.indexOf(a.source.kind) - CANONICAL_SOURCE_ORDER.indexOf(b.source.kind);
}

function sortStrongestFirst<T>(
  observations: EvidenceObservation<T>[],
  preferredOrder: EvidenceSourceKind[],
): EvidenceObservation<T>[] {
  return [...observations].sort((a, b) => compareObservations(a, b, preferredOrder));
}

// ---------------------------------------------------------------------------
// Conflict severity + penalty.
// ---------------------------------------------------------------------------

function classifySeverity(
  selectedConfidence: number,
  strongestDisagreeingConfidence: number,
  equalConfidenceIsSevere: boolean,
): ConflictSeverity {
  const bothHighConfidence =
    selectedConfidence >= HIGH_CONFIDENCE_THRESHOLD && strongestDisagreeingConfidence >= HIGH_CONFIDENCE_THRESHOLD;
  const nearEqualConfidence =
    Math.abs(selectedConfidence - strongestDisagreeingConfidence) <= NEAR_EQUAL_CONFIDENCE_EPSILON;

  if (equalConfidenceIsSevere && (nearEqualConfidence || bothHighConfidence)) return "severe";
  if (strongestDisagreeingConfidence < LOW_CONFIDENCE_THRESHOLD) return "informational";
  return "moderate";
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Explanation generation (single source of truth -- see module comment).
// ---------------------------------------------------------------------------

const AGREEING_COUNT_WORD: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five" };

function agreeingCountWord(count: number): string {
  return AGREEING_COUNT_WORD[count] ?? String(count);
}

function buildFieldExplanation(
  state: EvidenceState,
  primarySourceKind: EvidenceSourceKind | null,
  independentAgreeingCount: number,
  disagreeingSourceKindCount: number,
): string {
  switch (state) {
    case "missing":
      return MISSING_EXPLANATION;
    case "user_overridden":
      return primarySourceKind === "manual_override"
        ? "Manual override evidence overrides automated observations."
        : "User-provided evidence overrides automated observations.";
    case "confirmed":
      return `${agreeingCountWord(independentAgreeingCount)} independent evidence sources agree.`;
    case "conflicted": {
      const label = primarySourceKind ? SOURCE_COARSE_LABEL[primarySourceKind] : "Retained";
      return disagreeingSourceKindCount > 1
        ? `${label} evidence was retained, but other sources disagree.`
        : `${label} evidence was retained, but another source disagrees.`;
    }
    case "supported":
    default:
      return primarySourceKind
        ? `${SOURCE_LABEL[primarySourceKind]} provided the strongest usable evidence.`
        : MISSING_EXPLANATION;
  }
}

function buildResolutionReason<T>(strategy: FieldStrategy, selected: EvidenceObservation<T>): string {
  if (strategy.ownershipMode === "no_fixed_owner") {
    return "No fixed source preference for this field; highest-confidence evidence was selected.";
  }
  return strategy.preferred.includes(selected.source.kind)
    ? "Preferred source retained because competing evidence did not exceed the configured override margin."
    : "Higher-confidence evidence exceeded the configured source-priority margin.";
}

/**
 * Builds the single grouped EvidenceConflict for a field, when at least one
 * usable observation disagrees with the selected value. `resolutionReason`
 * is supplied by the caller so the override path (whose reason is about
 * authority, not source-priority margins) and the normal selection path can
 * each provide accurate, provider-neutral wording without this function
 * needing to know which case it's in.
 */
function buildConflict<T>(
  field: EvidenceFieldName,
  selected: EvidenceObservation<T>,
  disagreeing: EvidenceObservation<T>[],
  equalConfidenceIsSevere: boolean,
  resolutionReason: string,
  preferredOrder: EvidenceSourceKind[],
): EvidenceConflict<T> {
  const strongestDisagreeing = sortStrongestFirst(disagreeing, [])[0];
  const severity = classifySeverity(selected.confidence, strongestDisagreeing.confidence, equalConfidenceIsSevere);
  const involved = sortStrongestFirst([selected, ...disagreeing], preferredOrder);

  return {
    field,
    observations: involved,
    severity,
    suggestedResolution: selected.value,
    suggestedResolutionReason: resolutionReason,
  };
}

// ---------------------------------------------------------------------------
// Per-field fusion.
// ---------------------------------------------------------------------------

function missingField<T>(): EvidenceField<T> {
  return {
    value: null,
    confidence: 0,
    state: "missing",
    primarySource: null,
    supportingObservations: [],
    conflicts: [],
    explanation: MISSING_EXPLANATION,
  };
}

function fuseField<T>(
  field: EvidenceFieldName,
  usable: EvidenceObservation<T>[],
  strategy: FieldStrategy,
): EvidenceField<T> {
  if (usable.length === 0) return missingField<T>();

  const supportingObservations = sortStrongestFirst(usable, strategy.preferred);

  // --- User / manual override: authoritative regardless of confidence. ---
  if (strategy.userOverrideWins) {
    const manualOverrideObservations = usable.filter((o) => o.source.kind === "manual_override");
    const userObservations = usable.filter((o) => o.source.kind === "user");
    const authorityPool = manualOverrideObservations.length > 0 ? manualOverrideObservations : userObservations;

    if (authorityPool.length > 0) {
      const winner = sortStrongestFirst(authorityPool, [])[0];
      const disagreeing = usable.filter((o) => !valuesAgree(o.value, winner.value));
      const conflicts =
        disagreeing.length > 0
          ? [
              buildConflict(
                field,
                winner,
                disagreeing,
                strategy.equalConfidenceIsSevere,
                "User/manual-provided evidence takes precedence over automated observations.",
                strategy.preferred,
              ),
            ]
          : [];

      return {
        value: winner.value,
        // Authoritative override: confidence is 1.0 regardless of the
        // supplied observation's own confidence and regardless of any
        // conflicting evidence -- the conflict penalty (see below) is
        // deliberately never applied on this path.
        confidence: 1,
        state: "user_overridden",
        primarySource: winner.source,
        supportingObservations,
        conflicts,
        explanation: buildFieldExplanation("user_overridden", winner.source.kind, 0, disagreeing.length),
      };
    }
  }

  // --- Primary-source selection (no override in effect). ---
  let selected: EvidenceObservation<T>;
  if (strategy.ownershipMode === "single_owner") {
    const preferredPool = usable.filter((o) => strategy.preferred.includes(o.source.kind));
    const nonPreferredPool = usable.filter((o) => !strategy.preferred.includes(o.source.kind));
    const bestPreferred = preferredPool.length > 0 ? sortStrongestFirst(preferredPool, strategy.preferred)[0] : null;
    const bestNonPreferred = nonPreferredPool.length > 0 ? sortStrongestFirst(nonPreferredPool, [])[0] : null;

    if (bestPreferred && bestNonPreferred) {
      const marginExceeded = bestNonPreferred.confidence - bestPreferred.confidence >= strategy.confidenceOverrideMargin;
      selected = marginExceeded ? bestNonPreferred : bestPreferred;
    } else {
      selected = (bestPreferred ?? bestNonPreferred) as EvidenceObservation<T>;
    }
  } else {
    // no_fixed_owner: highest confidence wins regardless of source kind.
    // supportingObservations is already sorted with an empty preferred
    // order for this strategy (strategy.preferred is [] here), so it is
    // already the correct selection order to reuse.
    selected = supportingObservations[0];
  }

  const agreeing = usable.filter((o) => valuesAgree(o.value, selected.value));
  const disagreeing = usable.filter((o) => !valuesAgree(o.value, selected.value));
  const independentAgreeingKinds = new Set(agreeing.map((o) => o.source.kind));
  const maxAgreeingConfidence = Math.max(...agreeing.map((o) => o.confidence));
  const corroboratedConfidence = Math.min(
    1,
    maxAgreeingConfidence + CORROBORATION_BONUS_PER_SOURCE * (independentAgreeingKinds.size - 1),
  );

  let conflicts: EvidenceConflict<T>[] = [];
  let confidence = corroboratedConfidence;
  let state: EvidenceState;

  if (disagreeing.length > 0) {
    const conflict = buildConflict(
      field,
      selected,
      disagreeing,
      strategy.equalConfidenceIsSevere,
      buildResolutionReason(strategy, selected),
      strategy.preferred,
    );
    conflicts = [conflict];
    confidence = clamp01(corroboratedConfidence - CONFLICT_CONFIDENCE_PENALTY[conflict.severity]);
    state = "conflicted";
  } else if (independentAgreeingKinds.size >= 2 && corroboratedConfidence >= CONFIRMED_CONFIDENCE_THRESHOLD) {
    state = "confirmed";
  } else {
    state = "supported";
  }

  const disagreeingKindCount = new Set(disagreeing.map((o) => o.source.kind)).size;

  return {
    value: selected.value,
    confidence,
    state,
    primarySource: selected.source,
    supportingObservations,
    conflicts,
    explanation: buildFieldExplanation(state, selected.source.kind, independentAgreeingKinds.size, disagreeingKindCount),
  };
}

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------

/**
 * Pure, synchronous fusion of already-normalized evidence observations into
 * one FusedEvidence bundle. No network/database calls, no environment
 * variable reads, and no mutation of `input` (every array is copied before
 * sorting/filtering; observation objects themselves are never written to).
 *
 * `now` defaults to the current time but can be supplied explicitly for
 * deterministic tests.
 */
export function fuseEvidence(input: EvidenceObservationsByField, now: string = new Date().toISOString()): FusedEvidence {
  const contributingKinds = new Set<EvidenceSourceKind>();
  const fused = {} as Record<EvidenceFieldName, EvidenceField<unknown>>;

  for (const field of FIELD_NAMES) {
    const strategy = FIELD_STRATEGIES[field];
    // `input[field]` cannot be correlated back to `field`'s specific value
    // type inside a runtime loop over a mapped type's keys -- TypeScript has
    // no way to prove the correlation here even though it genuinely holds at
    // every real call site. This is the one narrow, documented cast in this
    // module; every external caller of fuseEvidence still gets full
    // per-field type safety from EvidenceObservationsByField/FusedEvidence.
    const observations = (input[field] ?? []) as EvidenceObservation<unknown>[];
    const usable = observations.filter(isUsableObservation);
    for (const observation of usable) contributingKinds.add(observation.source.kind);
    fused[field] = fuseField(field, usable, strategy);
  }

  return {
    ...fused,
    fusedAt: now,
    contributingProducers: CANONICAL_SOURCE_ORDER.filter((kind) => contributingKinds.has(kind)),
  } as FusedEvidence;
}

// Vision Engine V3, Phase V3.2A: provider-neutral Evidence Fusion type
// system.
//
// This module defines the canonical contracts that will eventually let
// OCR, Vision, user corrections, and future producers (grading-label OCR,
// serial OCR, barcode/QR, marketplace metadata) all feed one shared,
// strongly-typed evidence shape -- and let candidateEngine,
// candidateConfidence, variantCandidateEngine, and future consumers read
// that one shape without ever knowing which producer supplied it.
//
// This phase defines types only. No fusion logic, no adapters, no wiring
// into OCR/Vision/candidate modules, no runtime validation.
//
// Dependency hygiene (see also fieldStrategies.ts): this module must not
// import candidateEngine, candidateConfidence, variantCandidateEngine, any
// repository, Supabase, React, or any API route. The only permitted import
// is the type-only Vision value vocabulary below, reused rather than
// duplicated. Dependency direction is meant to stay
// OCR/Vision adapters -> Evidence -> Catalog consumers, never the reverse.

import type { ColorFamily, Orientation } from "@/lib/vision/types";

export type { ColorFamily, Orientation };

/**
 * Closed set of producer categories an observation can come from. Front and
 * back OCR/Vision are kept distinct (not merged into one "ocr"/"vision"
 * kind) because they already carry different per-field reliability, the
 * same distinction src/lib/ocr/merge.ts's per-field priority rules already
 * rely on.
 *
 * Deliberately excludes provider/model identity (e.g. "openai",
 * "gpt-4.1-mini") -- that belongs in EvidenceSource.producerMetadata only.
 * A new producer category is added here as a new literal; see
 * fieldStrategies.ts and the Evidence Fusion Engine design doc's "Risks"
 * section for the accepted tradeoff this implies.
 */
export type EvidenceSourceKind =
  | "ocr_front"
  | "ocr_back"
  | "vision_front"
  | "vision_back"
  | "user"
  | "manual_override"
  | "catalog"
  | "grading_label_ocr"
  | "serial_ocr"
  | "barcode"
  | "marketplace";

/**
 * Identifies which kind of producer supplied an observation.
 * `producerMetadata` is free-form, opaque-to-fusion debugging/display data
 * (e.g. a vision producer's {provider, model, promptVersion}, an OCR
 * producer's {engine}) -- it exists so a UI can eventually show "why" in
 * more detail, but no catalog consumer may branch on it. Every decision
 * (ownership, conflict severity, overrides) must be made using `kind`
 * alone; reading `producerMetadata` for anything but display would quietly
 * reintroduce the provider coupling this type system exists to remove.
 */
export type EvidenceSource = {
  kind: EvidenceSourceKind;
  producerMetadata?: Record<string, string>;
};

/**
 * One producer's claim about one field's value, at the moment it was
 * produced. The atomic, provenance-bearing unit fusion will operate on --
 * every existing OCR/Vision result is expected to become a small adapter
 * that emits EvidenceObservation<T> values, rather than fusion re-parsing
 * per-producer shapes itself.
 *
 * `confidence` stays on the same 0-1 scale as every existing confidence
 * value in this codebase (OCR's heuristic, Vision's native scale,
 * candidateConfidence's internal QUALITY_FACTORS before its own separate
 * 0-100 rescale) -- the evidence layer never rescales, so a value read
 * here always means the same thing regardless of which layer looks at it.
 */
export type EvidenceObservation<T> = {
  value: T;
  /** 0-1. See module comment: the evidence layer never uses any other scale. */
  confidence: number;
  source: EvidenceSource;
  explanation: string;
  /** ISO timestamp of when this specific observation was produced. */
  observedAt: string;
};

/**
 * The fused status of one field, independent of its specific value.
 * Consumers should treat this as the authoritative summary of "how much do
 * we trust this field," and must not invent their own parallel meaning for
 * these five states -- if a consumer needs a distinction this doesn't
 * capture, that is a reason to extend EvidenceState itself, not to
 * reinterpret it locally.
 *
 *   missing         - no usable observation exists for this field at all.
 *   supported       - exactly one usable observation, or weak/partial
 *                      corroboration; not yet strong enough to call confirmed.
 *   confirmed       - strong corroborating evidence (agreeing observations,
 *                      or one high-confidence observation) with no
 *                      unresolved conflict.
 *   conflicted      - two or more observations meaningfully disagree; see
 *                      EvidenceField.conflicts for the detail.
 *   user_overridden - an explicit user or manual-override observation is
 *                      authoritative for this field, regardless of what any
 *                      other producer reported.
 */
export type EvidenceState = "missing" | "supported" | "confirmed" | "conflicted" | "user_overridden";

/**
 * A specific, explicit disagreement between two or more observations of the
 * same field. `suggestedResolution` is fusion's own best guess and is
 * strictly advisory -- its presence must never be read as fusion having
 * already resolved the disagreement. A conflict existing does not block
 * EvidenceField.value from holding fusion's current best single answer;
 * see EvidenceField below for how the two coexist.
 */
export type EvidenceConflict<T> = {
  field: string;
  /** Every disagreeing observation (2 or more). */
  observations: EvidenceObservation<T>[];
  severity: "informational" | "moderate" | "severe";
  /** Fusion's best guess at how this conflict should be resolved. Advisory
   * only -- never auto-applied. A consumer or user must act on it explicitly. */
  suggestedResolution: T | null;
  suggestedResolutionReason: string | null;
};

/**
 * One fused, consumer-facing field: fusion's current single answer for
 * "what do we believe field X is," while never discarding what it was
 * built from.
 *
 * Invariants (documented, not yet enforced by this phase -- enforcement is
 * fusion-implementation scope, not type-definition scope):
 *   - state === "missing"         => value, primarySource are null;
 *                                     confidence is 0; supportingObservations
 *                                     and conflicts are both empty.
 *   - state === "user_overridden" => primarySource is non-null and
 *                                     primarySource.kind is "user" or
 *                                     "manual_override".
 */
export type EvidenceField<T> = {
  /** null means no usable observation -- never a guessed default. */
  value: T | null;
  /** Fused confidence for the field as a whole; distinct from any single
   * observation's own confidence. 0-1, per the module comment above. */
  confidence: number;
  state: EvidenceState;
  primarySource: EvidenceSource | null;
  supportingObservations: EvidenceObservation<T>[];
  /** Empty array (never omitted) when there is no disagreement. */
  conflicts: EvidenceConflict<T>[];
  /** One human-readable sentence explaining value/confidence/state,
   * generated once by fusion. No consumer should generate its own
   * competing explanation for the same field. */
  explanation: string;
};

/**
 * The identity and variant/physical fields FusedEvidence carries. Split out
 * from FusedEvidence itself so EvidenceFieldName/EvidenceValueForField below
 * can be derived purely from the evidence fields, excluding the metadata
 * properties (fusedAt, contributingProducers) that are not per-field
 * evidence at all.
 */
type FusedEvidenceFields = {
  // Identity fields
  playerName: EvidenceField<string>;
  teamName: EvidenceField<string>;
  setName: EvidenceField<string>;
  brand: EvidenceField<string>;
  manufacturer: EvidenceField<string>;
  year: EvidenceField<string>;
  cardNumber: EvidenceField<string>;
  cardName: EvidenceField<string>;
  parallelText: EvidenceField<string>;

  // Variant / physical fields
  autographPresent: EvidenceField<boolean>;
  memorabiliaPresent: EvidenceField<boolean>;
  serialNumberText: EvidenceField<string>;
  serialAreaVisible: EvidenceField<boolean>;
  dominantColor: EvidenceField<ColorFamily>;
  borderColor: EvidenceField<ColorFamily>;
  orientation: EvidenceField<Orientation>;
};

/**
 * The full, provider-neutral evidence bundle consumers will eventually
 * receive. Deliberately a fixed, strongly-typed shape -- not
 * Record<string, EvidenceField<unknown>> -- so a consumer reading
 * evidence.playerName gets compile-time safety identical to what
 * MergedCardOcrResult's consumers already have today, and a typo'd field
 * name is a compile error rather than a silent undefined. New fields (e.g.
 * a future gradeText) are added additively without breaking existing
 * consumers; nothing about this shape requires them to be anticipated now.
 */
export type FusedEvidence = FusedEvidenceFields & {
  fusedAt: string;
  contributingProducers: EvidenceSourceKind[];
};

/** The set of actual evidence field names on FusedEvidence, excluding the
 * fusedAt/contributingProducers metadata properties. */
export type EvidenceFieldName = keyof FusedEvidenceFields;

/** Resolves the value type (T) carried by a given FusedEvidence field, e.g.
 * EvidenceValueForField<"orientation"> is Orientation. */
export type EvidenceValueForField<K extends EvidenceFieldName> =
  FusedEvidenceFields[K] extends EvidenceField<infer V> ? V : never;

// Vision Engine V3, Phase V3.2C: OCR -> Evidence adapter.
//
// Pure, synchronous, network/DB-free conversion of already-computed OCR
// results into fuseEvidence()'s EvidenceObservationsByField input. Never
// re-runs OCR, never queries the catalog, never performs candidate
// matching -- this module only reshapes data that already exists.
//
// Built directly on top of mergeCardOcrResults()'s own per-field
// frontValue/backValue -- not on CardOcrResult.extracted's raw property
// names -- so this adapter automatically inherits merge.ts's existing
// normalization (trim, whitespace-collapse, empty-string-to-null) and its
// visibleYear/copyrightYear "year" synthesis, without duplicating either
// rule here. This is also what makes the front/back distinction
// merge.ts already computes carry through as two separate
// EvidenceObservations instead of being flattened into one generic "ocr"
// source -- fuseEvidence (not this adapter) is what re-derives
// agreement/conflict from those two observations.
//
// Dependency hygiene: imports only OCR types/merge output and evidence
// types. Never imports candidateEngine, candidateConfidence,
// variantCandidateEngine, any repository, Supabase, React, or an API route.

import type { CardOcrResult } from "@/lib/ocr/types";
import type { MergedCardOcrResult } from "@/lib/ocr/merge";
import type { EvidenceFieldName, EvidenceObservation, EvidenceValueForField } from "./types";
import type { EvidenceObservationsByField } from "./fuseEvidence";

function isUsableTimestamp(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

// The `as Record<...>` bridge is the same narrow, documented cast used in
// fuseEvidence.ts's own entry loop: TypeScript cannot prove
// EvidenceObservationsByField[K] accepts EvidenceObservation<EvidenceValueForField<K>>[]
// for a generic K, even though the correlation is exactly right at every
// real call site (K is always bound to a single literal field name here).
function setObservations<K extends EvidenceFieldName>(
  result: EvidenceObservationsByField,
  field: K,
  observations: EvidenceObservation<EvidenceValueForField<K>>[],
): void {
  if (observations.length > 0) {
    (result as Record<EvidenceFieldName, EvidenceObservation<unknown>[]>)[field] = observations;
  }
}

type StringFieldName =
  | "playerName"
  | "teamName"
  | "setName"
  | "brand"
  | "manufacturer"
  | "year"
  | "cardNumber"
  | "cardName"
  | "parallelText"
  | "serialNumberText";

// Every plain-text field OCR currently knows about, mapped from
// mergeCardOcrResults's own field name to this adapter's FusedEvidence
// target. `year` here reads merged.fields.year.frontValue/backValue, which
// mergeYearField already populates from front's visibleYear and back's
// copyrightYear respectively (see merge.ts) -- this adapter does not need
// to know about that pairing itself, it inherits it for free.
//
// Not mapped (no FusedEvidence target, and unused by candidateEngine/
// candidateConfidence/variantCandidateEngine today): merged.fields.
// copyrightYear (as its own field, distinct from the synthesized "year"),
// smallPrint, statisticsText, checklistText, authenticationText.
const STRING_FIELD_MAPPINGS: { merged: keyof MergedCardOcrResult["fields"]; fused: StringFieldName; label: string }[] = [
  { merged: "playerName", fused: "playerName", label: "player name" },
  { merged: "teamName", fused: "teamName", label: "team name" },
  { merged: "setName", fused: "setName", label: "set name" },
  { merged: "brand", fused: "brand", label: "brand" },
  { merged: "manufacturer", fused: "manufacturer", label: "manufacturer" },
  { merged: "year", fused: "year", label: "year" },
  { merged: "cardNumber", fused: "cardNumber", label: "card number" },
  { merged: "cardName", fused: "cardName", label: "card name" },
  { merged: "parallelText", fused: "parallelText", label: "parallel text" },
  { merged: "serialNumbering", fused: "serialNumberText", label: "serial numbering" },
];

type BooleanIndicatorFieldName = "autographPresent" | "memorabiliaPresent";

/**
 * Boolean conversion rule (conservative, matches today's only actual
 * consumer of these two OCR fields -- variantCandidateEngine.ts's
 * assessAutograph/assessMemorabilia, which already read
 * Boolean(merged.fields.autographIndicator.value) /
 * Boolean(merged.fields.relicIndicator.value)): OCR's autographIndicator/
 * relicIndicator are themselves already positive-indicator text fields (the
 * OCR prompt only ever asks the model to report indicator wording when it
 * believes one is present) -- so any non-empty extracted text is emitted
 * here as a `true` observation, exactly mirroring the truthiness check that
 * downstream code already performs today. Per requirement, missing/empty
 * indicator text never manufactures a `false` observation -- OCR's
 * extraction contract has no explicit "no autograph" negative field, so
 * absence here stays absence (EvidenceState "missing"), not a coerced
 * false. This differs slightly from today's Boolean(mergedValue) idiom,
 * which collapses absence to `false` -- see the golden regression report's
 * "intentional differences" section for why that is a deliberate,
 * non-regressive improvement rather than a bug.
 */
const BOOLEAN_INDICATOR_MAPPINGS: {
  merged: "autographIndicator" | "relicIndicator";
  fused: BooleanIndicatorFieldName;
  label: string;
}[] = [
  { merged: "autographIndicator", fused: "autographPresent", label: "an autograph" },
  { merged: "relicIndicator", fused: "memorabiliaPresent", label: "a relic" },
];

/**
 * Converts already-computed OCR results (front/back raw results plus their
 * existing merge) into fuseEvidence()'s observation input. Confidence for
 * every field emitted from a side uses that side's own top-level
 * CardOcrResult.confidence unmodified -- current OCR confidence has no
 * finer per-field precision to draw on, and merge having chosen a side
 * (front/back priority) is never treated as a confidence boost; any
 * corroboration credit for two sides agreeing is fuseEvidence's job, not
 * this adapter's. `observedAt` uses the side's own CardOcrResult.createdAt;
 * if a side's createdAt is unusable, that side's observations are omitted
 * entirely rather than stamping the adapter's own execution time -- there
 * is no established fallback-timestamp convention to invent one from.
 */
export function fromOcr(input: {
  front: CardOcrResult | null;
  back: CardOcrResult | null;
  merged: MergedCardOcrResult;
}): EvidenceObservationsByField {
  const { front, back, merged } = input;
  const result: EvidenceObservationsByField = {};

  const frontConfidence = front && isUsableTimestamp(front.createdAt) ? front.confidence : null;
  const backConfidence = back && isUsableTimestamp(back.createdAt) ? back.confidence : null;
  const frontObservedAt = front && isUsableTimestamp(front.createdAt) ? front.createdAt : null;
  const backObservedAt = back && isUsableTimestamp(back.createdAt) ? back.createdAt : null;

  for (const mapping of STRING_FIELD_MAPPINGS) {
    const mergedField = merged.fields[mapping.merged];
    const observations: EvidenceObservation<string>[] = [];

    if (mergedField.frontValue !== null && frontConfidence !== null && frontObservedAt !== null) {
      observations.push({
        value: mergedField.frontValue,
        confidence: frontConfidence,
        source: { kind: "ocr_front" },
        explanation: `Front OCR extracted ${mapping.label}.`,
        observedAt: frontObservedAt,
      });
    }
    if (mergedField.backValue !== null && backConfidence !== null && backObservedAt !== null) {
      observations.push({
        value: mergedField.backValue,
        confidence: backConfidence,
        source: { kind: "ocr_back" },
        explanation: `Back OCR extracted ${mapping.label}.`,
        observedAt: backObservedAt,
      });
    }

    setObservations(result, mapping.fused, observations);
  }

  for (const mapping of BOOLEAN_INDICATOR_MAPPINGS) {
    const mergedField = merged.fields[mapping.merged];
    const observations: EvidenceObservation<boolean>[] = [];

    if (mergedField.frontValue !== null && frontConfidence !== null && frontObservedAt !== null) {
      observations.push({
        value: true,
        confidence: frontConfidence,
        source: { kind: "ocr_front" },
        explanation: `Front OCR indicated ${mapping.label}.`,
        observedAt: frontObservedAt,
      });
    }
    if (mergedField.backValue !== null && backConfidence !== null && backObservedAt !== null) {
      observations.push({
        value: true,
        confidence: backConfidence,
        source: { kind: "ocr_back" },
        explanation: `Back OCR indicated ${mapping.label}.`,
        observedAt: backObservedAt,
      });
    }

    setObservations(result, mapping.fused, observations);
  }

  return result;
}

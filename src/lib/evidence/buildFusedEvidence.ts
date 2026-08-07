// Vision Engine V3, Phase V3.2C: tiny orchestration helper tying the OCR
// and Vision adapters to fuseEvidence(). Deliberately no business logic
// beyond calling the two adapters, merging their observation arrays
// per-field (without pre-resolving or mutating anything), and calling
// fuseEvidence() -- source-preference/conflict/confidence decisions all
// stay inside fuseEvidence()+FIELD_STRATEGIES, not here.
//
// Has no production caller in this phase.

import type { CardOcrResult } from "@/lib/ocr/types";
import type { MergedCardOcrResult } from "@/lib/ocr/merge";
import type { CardVisionAnalysis } from "@/lib/vision/types";
import type { EvidenceFieldName, EvidenceObservation, FusedEvidence } from "./types";
import { fuseEvidence, type EvidenceObservationsByField } from "./fuseEvidence";
import { fromOcr } from "./fromOcr";
import { fromVision } from "./fromVision";

/**
 * Concatenates two observation-by-field maps without pre-resolving any
 * disagreement -- both OCR's and Vision's observations for a shared field
 * (e.g. autographPresent, memorabiliaPresent) are preserved side by side so
 * fuseEvidence can apply FIELD_STRATEGIES itself. Never mutates either
 * input map or the observation objects within them.
 */
function mergeObservationsByField(
  a: EvidenceObservationsByField,
  b: EvidenceObservationsByField,
): EvidenceObservationsByField {
  const result: EvidenceObservationsByField = {};
  const fieldNames = new Set<EvidenceFieldName>([
    ...(Object.keys(a) as EvidenceFieldName[]),
    ...(Object.keys(b) as EvidenceFieldName[]),
  ]);

  for (const field of fieldNames) {
    // Same documented, narrow bridge cast as fuseEvidence.ts's own entry
    // loop -- TypeScript cannot correlate a mapped type's per-key value
    // type back to a runtime-iterated key, even though the correlation
    // holds at every real call site (both maps were built by adapters
    // targeting the same EvidenceObservationsByField contract).
    const aObservations = (a[field] ?? []) as EvidenceObservation<unknown>[];
    const bObservations = (b[field] ?? []) as EvidenceObservation<unknown>[];
    if (aObservations.length === 0 && bObservations.length === 0) continue;
    (result as Record<EvidenceFieldName, EvidenceObservation<unknown>[]>)[field] = [
      ...aObservations,
      ...bObservations,
    ];
  }

  return result;
}

export function buildFusedEvidence(input: {
  frontOcr: CardOcrResult | null;
  backOcr: CardOcrResult | null;
  mergedOcr: MergedCardOcrResult;
  frontVision: CardVisionAnalysis | null;
  backVision: CardVisionAnalysis | null;
  now?: string;
}): FusedEvidence {
  const ocrObservations = fromOcr({ front: input.frontOcr, back: input.backOcr, merged: input.mergedOcr });
  const visionObservations = fromVision({ frontVision: input.frontVision, backVision: input.backVision });
  const combined = mergeObservationsByField(ocrObservations, visionObservations);
  return input.now === undefined ? fuseEvidence(combined) : fuseEvidence(combined, input.now);
}

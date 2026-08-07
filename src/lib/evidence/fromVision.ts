// Vision Engine V3, Phase V3.2C: Vision -> Evidence adapter.
//
// Pure, synchronous, network-free conversion of already-computed
// CardVisionAnalysis results into fuseEvidence()'s EvidenceObservationsByField
// input. Never calls /api/vision, never performs fusion itself.
//
// Dependency hygiene: imports only Vision types and evidence types. Never
// imports candidateEngine, candidateConfidence, variantCandidateEngine, any
// repository, Supabase, React, or an API route.

import type {
  BooleanObservation,
  CardVisionAnalysis,
  VisionEvidenceSource,
  VisionImageSide,
} from "@/lib/vision/types";
import type { EvidenceFieldName, EvidenceObservation, EvidenceSource, EvidenceValueForField } from "./types";
import type { EvidenceObservationsByField } from "./fuseEvidence";

function isUsableTimestamp(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function sideLabel(side: VisionImageSide): string {
  return side === "front" ? "Front" : "Back";
}

function visionSource(side: VisionImageSide, analysisSource: VisionEvidenceSource): EvidenceSource {
  return {
    kind: side === "front" ? "vision_front" : "vision_back",
    // Provider/model/promptVersion are display-only metadata here, exactly
    // as VisionEvidenceSource already documents -- nothing in this adapter
    // or in fuseEvidence branches on these strings.
    producerMetadata: {
      provider: analysisSource.provider,
      model: analysisSource.model,
      promptVersion: analysisSource.promptVersion,
    },
  };
}

// Vision's own observation.explanation is already sanitized/length-capped
// (see validateVisionAnalysis.ts) and is preferred whenever present; this
// fallback only covers the (expected-rare) case of an empty explanation
// string, so a fused field's explanation is never blank.
function pickExplanation(raw: string, fallback: string): string {
  return raw.trim().length > 0 ? raw : fallback;
}

function fallbackExplanation(side: VisionImageSide, phrase: string): string {
  return `${sideLabel(side)} visual analysis ${phrase}.`;
}

// The `as Record<...>` bridge below is the same narrow, documented cast
// used in fuseEvidence.ts's own entry loop and buildFusedEvidence.ts's
// merge helper: TypeScript cannot prove EvidenceObservationsByField[K]
// accepts EvidenceObservation<EvidenceValueForField<K>>[] for a generic K,
// even though the correlation is exactly right at every real call site
// (K is always bound to a single literal field name when this is called).
function appendObservation<K extends EvidenceFieldName>(
  result: EvidenceObservationsByField,
  field: K,
  observation: EvidenceObservation<EvidenceValueForField<K>>,
): void {
  const bag = result as Record<EvidenceFieldName, EvidenceObservation<unknown>[] | undefined>;
  bag[field] = [...(bag[field] ?? []), observation];
}

type CategoricalFieldName = "dominantColor" | "borderColor" | "orientation";

// A generic helper (rather than a shared mapping array like the boolean
// fields above) is needed here because dominantColor/borderColor
// (ColorFamily) and orientation (Orientation) are different literal-union
// value types -- binding K from a literal `field` argument at each call
// site (see fromVision below) lets EvidenceValueForField<K> resolve to the
// exact right vocabulary per call, instead of a shared array widening every
// pick function's return type to a single (incorrect) common type.
// Accepts a plain duck-typed shape (not CategoricalObservation<T> itself)
// because CategoricalObservation<T> requires `T extends string` as a
// generic constraint, which TypeScript cannot verify for a generic
// EvidenceValueForField<K> -- even though ColorFamily/Orientation (the only
// two real callers) both genuinely satisfy it.
function appendCategoricalIfKnown<K extends CategoricalFieldName>(
  result: EvidenceObservationsByField,
  field: K,
  side: VisionImageSide,
  source: EvidenceSource,
  createdAt: string,
  observation: { value: EvidenceValueForField<K>; confidence: number; explanation: string },
  fallbackPhrase: string,
): void {
  // Absence must remain absence -- an "uncertain" categorical value is
  // never emitted as an observation (requirement 11).
  if ((observation.value as string) === "uncertain") return;
  appendObservation(result, field, {
    value: observation.value,
    confidence: observation.confidence,
    source,
    explanation: pickExplanation(observation.explanation, fallbackExplanation(side, fallbackPhrase)),
    observedAt: createdAt,
  });
}

type BooleanFieldName = "autographPresent" | "memorabiliaPresent" | "serialAreaVisible";

/**
 * Both `true` and `false` visual observations are emitted -- per this
 * phase's explicit requirement, a confidently observed `false` (e.g. "no
 * autograph visible") is real, usable evidence that can legitimately
 * conflict with OCR indicator text, even though the V3.1C UI only ever
 * *displays* positive findings (buildObservationList's pushIfPositive).
 * Evidence semantics and UI presentation are deliberately separate
 * concerns -- see formatObservations.ts, which is unaffected by this file.
 */
const BOOLEAN_FIELD_MAPPINGS: {
  fused: BooleanFieldName;
  trueFallback: string;
  falseFallback: string;
  pick: (analysis: CardVisionAnalysis) => BooleanObservation;
}[] = [
  {
    fused: "autographPresent",
    trueFallback: "detected an autograph",
    falseFallback: "found no visible autograph",
    pick: (a) => a.observations.autographVisible,
  },
  {
    fused: "memorabiliaPresent",
    trueFallback: "detected a memorabilia window",
    falseFallback: "found no visible memorabilia window",
    pick: (a) => a.observations.memorabiliaWindowVisible,
  },
  {
    fused: "serialAreaVisible",
    trueFallback: "detected a visible serial-number area",
    falseFallback: "found no visible serial-number area",
    pick: (a) => a.observations.serialNumberAreaVisible,
  },
];

/**
 * Converts already-computed front/back CardVisionAnalysis results into
 * fuseEvidence()'s observation input. `foilOrReflective` and every
 * imageQuality signal (fullCardVisible, sharpEnough, glare, lighting,
 * usableForAnalysis) are deliberately not mapped -- FusedEvidence (V3.2A)
 * intentionally has no identity/variant field for them yet; foil in
 * particular is a candidate for a future additive FusedEvidence field, not
 * something to force into this phase's fixed shape.
 */
export function fromVision(input: {
  frontVision: CardVisionAnalysis | null;
  backVision: CardVisionAnalysis | null;
}): EvidenceObservationsByField {
  const result: EvidenceObservationsByField = {};
  const sides: [VisionImageSide, CardVisionAnalysis | null][] = [
    ["front", input.frontVision],
    ["back", input.backVision],
  ];

  for (const [side, analysis] of sides) {
    if (!analysis || !isUsableTimestamp(analysis.createdAt)) continue;
    const source = visionSource(side, analysis.source);

    for (const mapping of BOOLEAN_FIELD_MAPPINGS) {
      const observation = mapping.pick(analysis);
      const fallback = fallbackExplanation(side, observation.value ? mapping.trueFallback : mapping.falseFallback);
      appendObservation(result, mapping.fused, {
        value: observation.value,
        confidence: observation.confidence,
        source,
        explanation: pickExplanation(observation.explanation, fallback),
        observedAt: analysis.createdAt,
      });
    }

    appendCategoricalIfKnown(
      result,
      "dominantColor",
      side,
      source,
      analysis.createdAt,
      analysis.observations.dominantColor,
      "identified the dominant color",
    );
    appendCategoricalIfKnown(
      result,
      "borderColor",
      side,
      source,
      analysis.createdAt,
      analysis.observations.borderColor,
      "identified the border color",
    );
    appendCategoricalIfKnown(
      result,
      "orientation",
      side,
      source,
      analysis.createdAt,
      analysis.imageQuality.orientation,
      "assessed the card's orientation",
    );
  }

  return result;
}

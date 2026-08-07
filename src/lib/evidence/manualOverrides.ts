// Vision Engine V3, Phase V3.3B: local-only manual evidence overrides.
//
// No database, no persistence, no save-payload changes, no API, no schema,
// no RLS -- this is purely an in-memory FusedEvidence transform, kept
// entirely inside cards/new/page.tsx's own component state (manualOverrides).
// A manual override never mutates or replaces existing OCR/Vision
// observations; it adds ONE additional manual_override observation per
// overridden field and lets fuseEvidence() -- unchanged, never duplicated
// here -- decide the outcome via its own existing user/manual-override-wins
// rule (every field strategy already has userOverrideWins: true, see
// fieldStrategies.ts), so this requires no fusion-engine changes at all.

import type {
  EvidenceFieldName,
  EvidenceObservation,
  EvidenceValueForField,
  FusedEvidence,
} from "./types";
import { fuseEvidence, type EvidenceObservationsByField } from "./fuseEvidence";

/**
 * One user-entered override for a single field. `confidence` (always 1.0)
 * and `source.kind` (always "manual_override") are intentionally not
 * stored here -- they aren't user choices, they're fixed by definition
 * (see buildOverrideObservation below), so storing them per-override would
 * only invite drift.
 */
export type ManualOverride<T> = {
  value: T;
  createdAt: string;
  explanation: string;
};

export type ManualOverridesByField = {
  [K in EvidenceFieldName]?: ManualOverride<EvidenceValueForField<K>>;
};

function buildOverrideObservation(override: ManualOverride<unknown>): EvidenceObservation<unknown> {
  return {
    value: override.value,
    confidence: 1,
    source: { kind: "manual_override" },
    explanation: override.explanation,
    observedAt: override.createdAt,
  };
}

const FUSED_EVIDENCE_METADATA_KEYS = new Set(["fusedAt", "contributingProducers"]);

/**
 * Returns a NEW FusedEvidence reflecting `manualOverrides` on top of
 * `fusedEvidence` -- never mutates `fusedEvidence` or any of its nested
 * arrays/objects. For every field, the complete original observation set
 * is recovered from that field's own supportingObservations (already the
 * full usable-observation list fuseEvidence itself produced for it), and
 * the override observation -- when present for that field -- is prepended
 * to it; every field is then re-fused via fuseEvidence() itself, never a
 * re-implementation of its selection/conflict logic. A field with no
 * override reproduces byte-identical output, since its observation set is
 * unchanged; removing an override (by omitting it from `manualOverrides`)
 * therefore restores the original evidence immediately, for the same
 * reason.
 */
export function applyManualOverrides(
  fusedEvidence: FusedEvidence,
  manualOverrides: ManualOverridesByField,
  now: string = new Date().toISOString(),
): FusedEvidence {
  const fieldNames = (Object.keys(fusedEvidence) as (keyof FusedEvidence)[]).filter(
    (key): key is EvidenceFieldName => !FUSED_EVIDENCE_METADATA_KEYS.has(key),
  );

  // Same narrow, documented bridge cast used throughout src/lib/evidence/*
  // (fuseEvidence.ts's entry loop, fromOcr.ts/fromVision.ts's setters,
  // buildFusedEvidence.ts's merge helper): TypeScript cannot correlate a
  // mapped type's per-key value type back to a runtime-iterated key, even
  // though the correlation holds at every real call site.
  const overridesBag = manualOverrides as Record<EvidenceFieldName, ManualOverride<unknown> | undefined>;
  const observationsByField: EvidenceObservationsByField = {};
  const observationsBag = observationsByField as Record<EvidenceFieldName, EvidenceObservation<unknown>[]>;

  for (const field of fieldNames) {
    const existing = fusedEvidence[field].supportingObservations as EvidenceObservation<unknown>[];
    const override = overridesBag[field];
    const observations = override ? [buildOverrideObservation(override), ...existing] : existing;
    if (observations.length > 0) observationsBag[field] = observations;
  }

  return fuseEvidence(observationsByField, now);
}

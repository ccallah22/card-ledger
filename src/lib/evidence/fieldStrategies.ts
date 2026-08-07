// Vision Engine V3, Phase V3.2A: field-source strategy configuration.
//
// This module describes ownership *policy* per FusedEvidence field -- it
// does not execute fusion. A future fusion engine (V3.2B) reads this table
// so that "which producer should this field prefer" lives in one
// declarative place, instead of being hardcoded per-field throughout
// fusion logic (or, worse, re-implemented independently by each consumer,
// which is exactly the triplication the Evidence Fusion Engine design doc
// identified across candidateEngine/candidateConfidence/
// variantCandidateEngine's current OCR field-reading code).
//
// Dependency hygiene: same as types.ts -- no imports from candidateEngine,
// candidateConfidence, variantCandidateEngine, any repository, Supabase,
// React, or any API route.

import type { EvidenceFieldName, EvidenceSourceKind } from "./types";

/**
 * Declarative ownership policy for one FusedEvidence field. A future fusion
 * engine is expected to read this, not branch on field names directly.
 *
 *   preferred                - ordered list of source kinds fusion should
 *                               prefer for this field, most-preferred
 *                               first. An empty list means the field has no
 *                               fixed single owner -- see ownershipMode.
 *   ownershipMode             - "single_owner": pick the first `preferred`
 *                               kind with an observation as primarySource,
 *                               unless a non-preferred observation's
 *                               confidence exceeds it by more than
 *                               confidenceOverrideMargin.
 *                               "no_fixed_owner": no producer is
 *                               structurally preferred for this field;
 *                               resolution is confidence-only among
 *                               whatever observations exist.
 *   confidenceOverrideMargin - 0-1. How much a non-preferred observation's
 *                               confidence must exceed the preferred
 *                               observation's confidence by before it wins
 *                               anyway. Only meaningful when ownershipMode
 *                               is "single_owner".
 *   equalConfidenceIsSevere  - whether two disagreeing observations at
 *                               (near-)equal confidence should be treated
 *                               as a severe conflict rather than moderate.
 *                               True for high-value identity fields, where
 *                               an unresolved tie is genuinely risky.
 *   userOverrideWins         - whether a "user" or "manual_override"
 *                               observation always becomes primarySource
 *                               for this field regardless of every other
 *                               rule above. Always true today -- see
 *                               requirement that user/manual override has
 *                               the highest authority for every field --
 *                               but kept as an explicit, per-field flag
 *                               rather than a blanket assumption baked into
 *                               fusion logic, so a future field could
 *                               deliberately opt out if a real need for
 *                               that ever arises.
 */
export type FieldStrategy<K extends EvidenceFieldName = EvidenceFieldName> = {
  field: K;
  preferred: EvidenceSourceKind[];
  ownershipMode: "single_owner" | "no_fixed_owner";
  confidenceOverrideMargin: number;
  equalConfidenceIsSevere: boolean;
  userOverrideWins: boolean;
};

// Uniform override margin across every field for this phase -- matches the
// Evidence Fusion Engine design doc's playerName example (0.15) and applies
// it consistently rather than inventing per-field tuning with no data to
// justify it yet (see that doc's "Blockers" -- thresholds are provisional
// until real producer accuracy is measured).
const DEFAULT_CONFIDENCE_OVERRIDE_MARGIN = 0.15;

// High-value identity fields where an unresolved equal-confidence
// disagreement is treated as severe, not moderate -- mirrors
// candidateConfidence.ts's existing HIGH_VALUE_FIELDS concept (player,
// cardNumber, set, year), generalized to the evidence layer without
// importing from candidateConfidence itself.
const HIGH_VALUE_FIELDS: ReadonlySet<EvidenceFieldName> = new Set([
  "playerName",
  "cardNumber",
  "setName",
  "year",
]);

function singleOwnerStrategy<K extends EvidenceFieldName>(
  field: K,
  preferred: EvidenceSourceKind[],
): FieldStrategy<K> {
  return {
    field,
    preferred,
    ownershipMode: "single_owner",
    confidenceOverrideMargin: DEFAULT_CONFIDENCE_OVERRIDE_MARGIN,
    equalConfidenceIsSevere: HIGH_VALUE_FIELDS.has(field),
    userOverrideWins: true,
  };
}

const OCR_PREFERRED: EvidenceSourceKind[] = ["ocr_front", "ocr_back"];
// Vision Engine V3, Phase V3.2C addition: src/lib/ocr/merge.ts's own
// mergeField() calls do not use one uniform front-priority rule for every
// OCR field -- setName/brand/manufacturer/cardNumber/serialNumbering are
// each explicitly merged with priority "back" (structured checklist/
// product wording on the back is more reliable for these than a front
// logo/wordmark reading). Discovered via V3.2C's golden-regression
// comparison against mergeCardOcrResults: without this, every one of these
// fields (three of which are candidate-driving) would silently prefer
// front on a genuine conflict, diverging from today's behavior whenever
// front/back OCR confidence happens to be equal. Listed back-first so
// single_owner's confidence-tempered selection defaults to back, while
// still letting front win when its confidence exceeds back's by more than
// confidenceOverrideMargin -- see V3.2C's report for why this
// confidence-aware behavior is an intentional, reported improvement over
// merge.ts's confidence-blind, hardcoded priority rather than a literal
// reproduction of it.
const OCR_PREFERRED_BACK_FIRST: EvidenceSourceKind[] = ["ocr_back", "ocr_front"];
const VISION_PREFERRED: EvidenceSourceKind[] = ["vision_front", "vision_back"];

/**
 * One strategy entry per FusedEvidence field (identity + variant/physical
 * fields only -- fusedAt/contributingProducers are metadata, not evidence,
 * and deliberately have no entry here). The `{ [K in EvidenceFieldName]: ... }`
 * mapped type makes a missing or extra field a compile error, so this table
 * cannot silently drift out of sync with FusedEvidence's shape.
 */
export const FIELD_STRATEGIES: { [K in EvidenceFieldName]: FieldStrategy<K> } = {
  // OCR-first, front-priority (matches merge.ts's mergeField(..., "front")
  // for these fields): printed, unambiguous text; Vision was never asked to
  // read these (out of scope per the original V3 design audit).
  playerName: singleOwnerStrategy("playerName", OCR_PREFERRED),
  teamName: singleOwnerStrategy("teamName", OCR_PREFERRED),
  year: singleOwnerStrategy("year", OCR_PREFERRED),
  cardName: singleOwnerStrategy("cardName", OCR_PREFERRED),
  // V3.2F pre-commit fix: parallelText was originally modeled as
  // "no_fixed_owner" (multiple future free-text producers, resolved by
  // confidence alone -- see the Evidence Fusion Engine design doc §7/§8).
  // But merge.ts's mergeField(f.parallelText, b.parallelText, "front") IS a
  // fixed front-priority rule today, same as playerName/teamName/year/
  // cardName above -- the "no fixed owner" framing was never actually true
  // of parallelText's only real producer (OCR) and was discovered to
  // silently diverge from legacy behavior during V3.2F's variant-engine
  // regression testing (a genuine front/back conflict, at equal OCR
  // confidence, let the newer back observation win a tie that legacy
  // mergeCardOcrResults always gives to front). Reclassified as
  // single_owner/front-priority, exactly like the other four front-priority
  // OCR fields -- Vision has no producer for this field at all (see
  // requirement 2 below), so this only ever adjudicates between ocr_front
  // and ocr_back, same as before.
  parallelText: singleOwnerStrategy("parallelText", OCR_PREFERRED),

  // OCR-first, back-priority (matches merge.ts's mergeField(..., "back")
  // for these fields) -- see OCR_PREFERRED_BACK_FIRST above.
  setName: singleOwnerStrategy("setName", OCR_PREFERRED_BACK_FIRST),
  brand: singleOwnerStrategy("brand", OCR_PREFERRED_BACK_FIRST),
  manufacturer: singleOwnerStrategy("manufacturer", OCR_PREFERRED_BACK_FIRST),
  cardNumber: singleOwnerStrategy("cardNumber", OCR_PREFERRED_BACK_FIRST),
  serialNumberText: singleOwnerStrategy("serialNumberText", OCR_PREFERRED_BACK_FIRST),

  // Vision-first: OCR's text-based indicators describe the product line
  // (e.g. "AUTOGRAPH EDITION"), not necessarily this specific photographed
  // card; Vision answers the semantically correct question directly.
  autographPresent: singleOwnerStrategy("autographPresent", VISION_PREFERRED),
  memorabiliaPresent: singleOwnerStrategy("memorabiliaPresent", VISION_PREFERRED),
  serialAreaVisible: singleOwnerStrategy("serialAreaVisible", VISION_PREFERRED),
  dominantColor: singleOwnerStrategy("dominantColor", VISION_PREFERRED),
  borderColor: singleOwnerStrategy("borderColor", VISION_PREFERRED),
  orientation: singleOwnerStrategy("orientation", VISION_PREFERRED),
};

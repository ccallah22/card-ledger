// Vision Engine V3, Phase V3.1C: pure, presentation-only formatting helpers
// for CardVisionAnalysis. Read-only -- never touches ranking, confidence,
// variant scoring, mergedOcr, or persistence. Every function here is a
// plain, side-effect-free transform from already-validated vision data to
// display strings, kept separate from cards/new/page.tsx so it's directly
// testable without rendering React (matching resolveVisionResultForSave's
// pattern in that file).

import type {
  BooleanObservation,
  CardVisionAnalysis,
  ColorFamily,
  GlareSeverity,
  LightingQuality,
  Orientation,
  VisionImageQuality,
} from "./types";

export type ConfidenceBucket = "high" | "medium" | "low";

// 0-1 scale in, bucketed out -- a raw number or percentage never reaches
// the UI (see cards/new/page.tsx's VisualAnalysisSide, which only ever
// renders the strings this module produces).
export function confidenceBucket(confidence: number): ConfidenceBucket {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

// Default visible UI shows High and Medium observations; Low observations
// are omitted entirely from the primary list in this phase.
export function isVisibleConfidence(confidence: number): boolean {
  return confidenceBucket(confidence) !== "low";
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// "uncertain" is never shown as a positive observation -- returns null so
// callers omit the bullet entirely rather than rendering the literal word
// "Uncertain" as if it were a finding.
export function formatColorLabel(value: ColorFamily): string | null {
  return value === "uncertain" ? null : capitalize(value);
}

const ORIENTATION_LABELS: Partial<Record<Orientation, string>> = {
  rotated_90: "Rotated 90°",
  rotated_180: "Rotated 180°",
  rotated_270: "Rotated 270°",
};

// "upright" (the unremarkable default) and "uncertain" both render nothing
// -- only a genuine rotation is worth surfacing as a collector-facing note.
export function formatOrientationLabel(value: Orientation): string | null {
  return ORIENTATION_LABELS[value] ?? null;
}

const GLARE_LABELS: Partial<Record<GlareSeverity, string>> = {
  mild: "Mild glare",
  moderate: "Moderate glare",
  severe: "Severe glare",
};

// "none" (nothing wrong) and "uncertain" both render nothing -- glare is
// only worth mentioning when actually present, the same treatment as a
// false card-level boolean (e.g. no autograph) below.
export function formatGlareLabel(value: GlareSeverity): string | null {
  return GLARE_LABELS[value] ?? null;
}

const LIGHTING_LABELS: Record<Exclude<LightingQuality, "uncertain">, string> = {
  good: "Good lighting",
  acceptable: "Acceptable lighting",
  poor: "Poor lighting",
};

// Unlike glare, lighting's good/acceptable case IS shown -- lighting
// quality directly informs how much to trust every other observation, the
// same reasoning that keeps fullCardVisible/sharpEnough shown both ways in
// buildObservationList below. Only "uncertain" is hidden.
export function formatLightingLabel(value: LightingQuality): string | null {
  return value === "uncertain" ? null : LIGHTING_LABELS[value];
}

export type QualitySummary = "good" | "usable" | "retake";

/**
 * Derived only from imageQuality's raw boolean/categorical values,
 * unconditionally -- unlike buildObservationList below, this holistic
 * one-line judgment is not confidence-gated, and it never blocks or
 * influences save on its own; it is purely informational.
 *
 *   "good"   -- usableForAnalysis, fullCardVisible, and sharpEnough are all
 *               true, and glare is none/mild and lighting is good/acceptable.
 *   "usable" -- usableForAnalysis is true but one or more of the above
 *               non-critical issues exist.
 *   "retake" -- usableForAnalysis is false.
 */
export function summarizeImageQuality(quality: VisionImageQuality): QualitySummary {
  if (!quality.usableForAnalysis.value) return "retake";

  const looksGood =
    quality.fullCardVisible.value &&
    quality.sharpEnough.value &&
    (quality.glare.value === "none" || quality.glare.value === "mild") &&
    (quality.lighting.value === "good" || quality.lighting.value === "acceptable");

  return looksGood ? "good" : "usable";
}

export function qualitySummaryLabel(summary: QualitySummary): string {
  if (summary === "good") return "Image quality looks good";
  if (summary === "usable") return "Image quality is usable";
  return "Image may need retaking";
}

// Card-level boolean observations: shown ONLY when true. A false/absent
// finding (e.g. no autograph) is never rendered, matching "do not show
// negative findings such as 'No autograph'". Confidence-gated like every
// other item in the list.
function pushIfPositive(items: string[], observation: BooleanObservation, label: string): void {
  if (observation.value && isVisibleConfidence(observation.confidence)) {
    items.push(label);
  }
}

/**
 * Builds the ordered list of collector-friendly observation strings for one
 * side's analysis -- pure, deterministic, never mutates its input, never
 * calls the vision endpoint, never touches any other state. Low-confidence
 * observations are omitted per isVisibleConfidence above. Never includes a
 * raw field name, a confidence number, or JSON.
 */
export function buildObservationList(analysis: CardVisionAnalysis): string[] {
  const items: string[] = [];
  const o = analysis.observations;
  const q = analysis.imageQuality;

  pushIfPositive(items, o.autographVisible, "Autograph visible");
  pushIfPositive(items, o.memorabiliaWindowVisible, "Memorabilia window visible");
  pushIfPositive(items, o.foilOrReflective, "Foil or reflective finish");
  pushIfPositive(items, o.serialNumberAreaVisible, "Serial-number area visible");

  if (isVisibleConfidence(o.dominantColor.confidence)) {
    const label = formatColorLabel(o.dominantColor.value);
    if (label) items.push(`Dominant color: ${label}`);
  }
  if (isVisibleConfidence(o.borderColor.confidence)) {
    const label = formatColorLabel(o.borderColor.value);
    if (label) items.push(`Border color: ${label}`);
  }

  // Quality booleans: shown both ways (true/false use different wording) --
  // these directly inform whether to trust the photo at all, unlike the
  // card-level booleans above, which are only worth mentioning when true.
  if (isVisibleConfidence(q.fullCardVisible.confidence)) {
    items.push(q.fullCardVisible.value ? "Full card visible" : "Card not fully visible");
  }
  if (isVisibleConfidence(q.sharpEnough.confidence)) {
    items.push(q.sharpEnough.value ? "Image sharp" : "Image not sharp enough");
  }
  if (!q.usableForAnalysis.value && isVisibleConfidence(q.usableForAnalysis.confidence)) {
    items.push("Image not usable for analysis");
  }

  if (isVisibleConfidence(q.glare.confidence)) {
    const label = formatGlareLabel(q.glare.value);
    if (label) items.push(label);
  }
  if (isVisibleConfidence(q.lighting.confidence)) {
    const label = formatLightingLabel(q.lighting.value);
    if (label) items.push(label);
  }
  if (isVisibleConfidence(q.orientation.confidence)) {
    const label = formatOrientationLabel(q.orientation.value);
    if (label) items.push(label);
  }

  return items;
}

// True only when a genuine majority of the categorical fields came back
// "uncertain" -- a single uncertain field is normal noise (already simply
// omitted from the list above) and not worth a separate note; this is
// reserved for when the analysis as a whole was meaningfully limited.
const UNCERTAINTY_NOTE_THRESHOLD = 3; // of 5 categorical fields

export function hasSignificantUncertainty(analysis: CardVisionAnalysis): boolean {
  const categoricals: { value: string }[] = [
    analysis.imageQuality.orientation,
    analysis.imageQuality.glare,
    analysis.imageQuality.lighting,
    analysis.observations.dominantColor,
    analysis.observations.borderColor,
  ];
  const uncertainCount = categoricals.filter((c) => c.value === "uncertain").length;
  return uncertainCount >= UNCERTAINTY_NOTE_THRESHOLD;
}

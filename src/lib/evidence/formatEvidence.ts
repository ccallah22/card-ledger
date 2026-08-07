// Vision Engine V3, Phase V3.3A: pure, read-only presentation helpers for
// rendering FusedEvidence in the Evidence Inspector UI
// (src/components/evidence/*). Never touches fusion logic, confidence
// scoring, candidate/variant ranking, or persistence -- every function here
// takes already-computed evidence data and returns a short display string.

import type { EvidenceSourceKind, EvidenceState } from "./types";

export type ConfidenceBucket = "high" | "medium" | "low";

// Same bucketing scheme already established for 0-1 evidence-shaped
// confidence values in src/lib/vision/formatObservations.ts's own
// confidenceBucket -- reproduced here (not imported) since this module
// lives in the provider-neutral evidence layer, which must not import from
// @/lib/vision.
export function confidenceBucket(confidence: number): ConfidenceBucket {
  if (confidence >= 0.8) return "high";
  if (confidence >= 0.6) return "medium";
  return "low";
}

const CONFIDENCE_BUCKET_LABELS: Record<ConfidenceBucket, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Deliberately a label only -- never a percentage or raw number, per the
// Evidence Inspector's "never show percentages" requirement.
export function confidenceBucketLabel(bucket: ConfidenceBucket): string {
  return CONFIDENCE_BUCKET_LABELS[bucket];
}

const EVIDENCE_STATE_LABELS: Record<EvidenceState, string> = {
  missing: "Missing",
  supported: "Supported",
  confirmed: "Confirmed",
  conflicted: "Conflicted",
  user_overridden: "User Overridden",
};

export function formatEvidenceStateLabel(state: EvidenceState): string {
  return EVIDENCE_STATE_LABELS[state];
}

// Never exposes provider/model identity -- only the coarse, stable
// producer category, matching EvidenceSource's own documented display
// rules (producerMetadata is display/debug data, never surfaced here).
const SOURCE_KIND_LABELS: Record<EvidenceSourceKind, string> = {
  ocr_front: "OCR Front",
  ocr_back: "OCR Back",
  vision_front: "Vision Front",
  vision_back: "Vision Back",
  user: "User",
  manual_override: "Manual Override",
  catalog: "Catalog",
  grading_label_ocr: "Grading Label",
  serial_ocr: "Serial OCR",
  barcode: "Barcode",
  marketplace: "Marketplace",
};

export function formatSourceKindLabel(kind: EvidenceSourceKind): string {
  return SOURCE_KIND_LABELS[kind];
}

export const NULL_VALUE_DISPLAY = "—";

// Plain free-text fields (player, set, card number, year, parallel).
export function formatStringValue(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : NULL_VALUE_DISPLAY;
}

// autographPresent / memorabiliaPresent.
export function formatPresenceValue(value: unknown): string {
  if (value === true) return "Present";
  if (value === false) return "Not Present";
  return NULL_VALUE_DISPLAY;
}

// serialAreaVisible -- deliberately distinct wording from
// formatPresenceValue per the Inspector's own formatting rules.
export function formatSerialAreaValue(value: unknown): string {
  if (value === true) return "Visible";
  if (value === false) return "Not Visible";
  return NULL_VALUE_DISPLAY;
}

function titleCase(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

// dominantColor / borderColor (ColorFamily values -- single lowercase
// words, e.g. "gold", "multicolor").
export function formatColorValue(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? titleCase(value) : NULL_VALUE_DISPLAY;
}

const ORIENTATION_LABELS: Record<string, string> = {
  upright: "Upright",
  rotated_90: "Rotated 90°",
  rotated_180: "Rotated 180°",
  rotated_270: "Rotated 270°",
  uncertain: "Uncertain",
};

// Not wired into the initial Evidence Inspector field set (orientation
// isn't one of the ten fields rendered in this phase), included for
// completeness/reuse alongside the other formatters above.
export function formatOrientationValue(value: unknown): string {
  if (typeof value !== "string") return NULL_VALUE_DISPLAY;
  return ORIENTATION_LABELS[value] ?? titleCase(value);
}

// Vision Engine V3, Phase V3.3C: compact local time for one timeline
// event's observedAt -- deliberately never an ISO string. Includes seconds
// (e.g. "10:42:13 AM") since two observations for the same field can
// genuinely land within the same minute (front/back OCR of one upload).
// Uses the browser's default locale/timezone (this only ever runs
// client-side, inside the Evidence Inspector).
export function formatObservedAtTime(observedAt: string): string {
  const date = new Date(observedAt);
  if (Number.isNaN(date.getTime())) return NULL_VALUE_DISPLAY;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

// Timeline event badge labels -- centralized here alongside this module's
// other display strings rather than inlined in the component.
export const CURRENT_EVIDENCE_LABEL = "✓ Current Evidence";
export const MANUAL_OVERRIDE_LABEL = "★ Manual Override";
export const CONFLICTED_LABEL = "Conflicted";

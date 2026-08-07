// Vision Engine V3, Phase V3.1A: provider-neutral visual-evidence types.
//
// Nothing here is wired into candidate ranking, candidate confidence,
// variant ranking, automatic selection, persistence, or the UI yet -- this
// is the type foundation only. No consumer-facing type below contains an
// OpenAI-specific field; provider/model identity lives exclusively in
// VisionEvidenceSource, so a future specialized/deterministic analyzer
// (e.g. a dedicated blur or color-histogram detector) can populate the same
// CardVisionAnalysis shape without any consumer changing.

export type VisionImageSide = "front" | "back";

/** Contract-shape version, independent of prompt wording (see route.ts's VISION_PROMPT_VERSION). */
export const VISION_ANALYSIS_VERSION = "v3.1a";

/**
 * Provenance for one analysis (or, later, one observation -- see
 * ObservationBase.source). `provider` is a short lowercase identifier
 * ("openai" today; a future deterministic analyzer might use "internal-cv"),
 * never an SDK/client class name. `model` is the specific model used, if
 * any (a deterministic analyzer may have no model and can use a stable
 * placeholder like "n/a"). `promptVersion` is empty/"n/a" for a
 * non-prompt-based analyzer.
 */
export type VisionEvidenceSource = {
  provider: string;
  model: string;
  promptVersion: string;
};

type ObservationBase = {
  side: VisionImageSide;
  /** 0-1 scale, matching every existing confidence convention in this codebase. */
  confidence: number;
  /** Per-observation provenance -- mirrors the top-level analysis source today, but kept
   * per-field so a future hybrid analysis (some fields from OpenAI, some from a
   * specialized detector) can report accurately without a type change. */
  source: VisionEvidenceSource;
  /** Short, human-readable rationale grounded in visible image evidence. Never raw model
   * chain-of-thought -- see validateVisionAnalysis.ts's length cap. */
  explanation: string;
};

export type BooleanObservation = ObservationBase & {
  kind: "boolean";
  value: boolean;
};

export type CategoricalObservation<T extends string> = ObservationBase & {
  kind: "categorical";
  value: T;
};

export const ORIENTATIONS = [
  "upright",
  "rotated_90",
  "rotated_180",
  "rotated_270",
  "uncertain",
] as const;
export type Orientation = (typeof ORIENTATIONS)[number];

export const GLARE_SEVERITIES = ["none", "mild", "moderate", "severe", "uncertain"] as const;
export type GlareSeverity = (typeof GLARE_SEVERITIES)[number];

export const LIGHTING_QUALITIES = ["good", "acceptable", "poor", "uncertain"] as const;
export type LightingQuality = (typeof LIGHTING_QUALITIES)[number];

// Named color families only -- never a raw hex/RGB value. Naming a family is
// enough for the (future) variant-hint use case this evidence is intended
// for; raw colorimetry has no consumer and would only add noise here.
export const COLOR_FAMILIES = [
  "red",
  "blue",
  "green",
  "gold",
  "silver",
  "black",
  "white",
  "purple",
  "orange",
  "pink",
  "yellow",
  "brown",
  "rainbow",
  "multicolor",
  "uncertain",
] as const;
export type ColorFamily = (typeof COLOR_FAMILIES)[number];

export type ColorObservation = CategoricalObservation<ColorFamily>;

/**
 * Whole-image usability signals for one side's photo. Informational/UX
 * evidence only -- see the V3 design audit's explicit finding that
 * image-quality signals must never feed candidate/variant scoring.
 */
export type VisionImageQuality = {
  side: VisionImageSide;
  orientation: CategoricalObservation<Orientation>;
  fullCardVisible: BooleanObservation;
  sharpEnough: BooleanObservation;
  glare: CategoricalObservation<GlareSeverity>;
  lighting: CategoricalObservation<LightingQuality>;
  /** False when the photo is too unreliable to trust the other observations on this side
   * (severe blur, major crop, extreme glare, very poor lighting, or the card not
   * meaningfully visible) -- see route.ts's prompt for the exact bar. A merely imperfect
   * (e.g. sideways but otherwise clear) photo should still be usable=true. */
  usableForAnalysis: BooleanObservation;
};

/**
 * V3.1 card-level visual observations. Deliberately excludes exact parallel
 * name, sticker-vs-on-card autograph, patterned-parallel name, die-cut
 * classification, chrome-vs-paper classification, exact print run, and any
 * card-identity field (set/player/year/card number) -- those are either
 * catalog-identification decisions (never this module's job) or too
 * unreliable for a first version, per the V3 design audit.
 */
export type CardVisualObservations = {
  autographVisible: BooleanObservation;
  memorabiliaWindowVisible: BooleanObservation;
  dominantColor: ColorObservation;
  borderColor: ColorObservation;
  foilOrReflective: BooleanObservation;
  serialNumberAreaVisible: BooleanObservation;
};

/**
 * Full result of analyzing one side of a card image. `side` here (not just
 * on each observation) is the authoritative value for the whole analysis;
 * every nested observation's own `side` must match it -- enforced by
 * validateVisionAnalysis.ts, which stamps both from the same request value
 * rather than trusting either from the model.
 */
export type CardVisionAnalysis = {
  side: VisionImageSide;
  observations: CardVisualObservations;
  imageQuality: VisionImageQuality;
  source: VisionEvidenceSource;
  createdAt: string;
  analysisVersion: string;
  /** Non-fatal issues worth surfacing (e.g. "model omitted an optional field, defaulted").
   * Absent or empty when there is nothing to report. */
  warnings?: string[];
};

import {
  COLOR_FAMILIES,
  GLARE_SEVERITIES,
  LIGHTING_QUALITIES,
  ORIENTATIONS,
  VISION_ANALYSIS_VERSION,
  type BooleanObservation,
  type CardVisionAnalysis,
  type CardVisualObservations,
  type CategoricalObservation,
  type VisionEvidenceSource,
  type VisionImageQuality,
  type VisionImageSide,
} from "./types";

// Vision Engine V3, Phase V3.1A: strict runtime validation for untrusted
// data crossing two boundaries:
//   1. parseCardVisionAnalysis -- the raw JSON a model provider returns,
//      never cast directly to CardVisionAnalysis. Only used server-side
//      (src/app/api/vision/route.ts).
//   2. isCardVisionAnalysis -- a lighter structural re-check of an
//      already-validated CardVisionAnalysis crossing the network again (our
//      own route's response, re-checked at the client boundary --
//      src/lib/vision/index.ts). Mirrors the defensive-re-validation
//      pattern src/lib/ocr/index.ts's isRawOcrResponse already uses for the
//      OCR route's response.
//
// Neither function ever passes raw provider/response data through
// unchecked: every value is read through a specific typed parser, so
// arbitrary nesting or unexpected fields can never reach the typed result.
// Unsupported/unknown JSON keys are silently ignored (never read, never
// copied into the result) -- documented per field-group below, not
// rejected outright, since a provider adding a harmless extra field
// (e.g. a debug id) shouldn't fail an otherwise-valid analysis.

const MAX_EXPLANATION_LENGTH = 300;

export type VisionValidationResult =
  | { ok: true; analysis: CardVisionAnalysis; warnings: string[] }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfidence(raw: unknown, path: string, errors: string[]): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) {
    errors.push(`${path}.confidence must be a finite number between 0 and 1`);
    return null;
  }
  return raw;
}

// Explanations are capped, never rejected outright for being long -- an
// overlong-but-otherwise-valid explanation is truncated (with a warning),
// since the rest of the observation (value/confidence) is still fully
// usable evidence. Truncation never happens mid-escape-sequence risk here
// since this is plain text, not re-serialized JSON.
function parseExplanation(
  raw: unknown,
  path: string,
  errors: string[],
  warnings: string[],
): string | null {
  if (typeof raw !== "string") {
    errors.push(`${path}.explanation must be a string`);
    return null;
  }
  if (raw.length > MAX_EXPLANATION_LENGTH) {
    warnings.push(`${path}.explanation exceeded ${MAX_EXPLANATION_LENGTH} characters and was truncated`);
    return raw.slice(0, MAX_EXPLANATION_LENGTH);
  }
  return raw;
}

function parseBooleanField(
  raw: unknown,
  path: string,
  side: VisionImageSide,
  source: VisionEvidenceSource,
  errors: string[],
  warnings: string[],
): BooleanObservation | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  // Only value/confidence/explanation are ever read from `raw` -- any other
  // key the model included is silently ignored, per this module's
  // documented unsupported-field rule.
  if (typeof raw.value !== "boolean") {
    errors.push(`${path}.value must be a boolean`);
    return null;
  }
  const confidence = parseConfidence(raw.confidence, path, errors);
  const explanation = parseExplanation(raw.explanation, path, errors, warnings);
  if (confidence === null || explanation === null) return null;

  return { kind: "boolean", value: raw.value, confidence, side, source, explanation };
}

function parseCategoricalField<T extends string>(
  raw: unknown,
  path: string,
  allowed: readonly T[],
  side: VisionImageSide,
  source: VisionEvidenceSource,
  errors: string[],
  warnings: string[],
): CategoricalObservation<T> | null {
  if (!isRecord(raw)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  if (typeof raw.value !== "string" || !(allowed as readonly string[]).includes(raw.value)) {
    errors.push(`${path}.value must be one of: ${allowed.join(", ")}`);
    return null;
  }
  const confidence = parseConfidence(raw.confidence, path, errors);
  const explanation = parseExplanation(raw.explanation, path, errors, warnings);
  if (confidence === null || explanation === null) return null;

  return { kind: "categorical", value: raw.value as T, confidence, side, source, explanation };
}

/**
 * Parses a provider's raw JSON response into a validated CardVisionAnalysis.
 * `side`/`source`/`createdAt` are never read from the model's JSON -- they
 * are supplied by the caller (the route, which knows the request's actual
 * side and its own provider/model/promptVersion) and stamped onto every
 * observation uniformly, so the model can never misreport its own
 * provenance or claim the wrong side. Rejects (returns `ok: false`) if any
 * required field is missing or the wrong shape; the whole response is
 * all-or-nothing, matching this repo's existing isRawOcrResponse
 * convention for provider-response validation.
 */
export function parseCardVisionAnalysis(
  rawResponse: unknown,
  context: { side: VisionImageSide; source: VisionEvidenceSource; createdAt: string },
): VisionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(rawResponse)) {
    return { ok: false, errors: ["response must be a JSON object"] };
  }

  const rawQuality = rawResponse.imageQuality;
  const rawObservations = rawResponse.observations;

  if (!isRecord(rawQuality)) errors.push("imageQuality must be an object");
  if (!isRecord(rawObservations)) errors.push("observations must be an object");
  if (errors.length > 0) return { ok: false, errors };

  const { side, source, createdAt } = context;
  const q = rawQuality as Record<string, unknown>;
  const o = rawObservations as Record<string, unknown>;

  const orientation = parseCategoricalField(
    q.orientation, "imageQuality.orientation", ORIENTATIONS, side, source, errors, warnings,
  );
  const fullCardVisible = parseBooleanField(
    q.fullCardVisible, "imageQuality.fullCardVisible", side, source, errors, warnings,
  );
  const sharpEnough = parseBooleanField(
    q.sharpEnough, "imageQuality.sharpEnough", side, source, errors, warnings,
  );
  const glare = parseCategoricalField(
    q.glare, "imageQuality.glare", GLARE_SEVERITIES, side, source, errors, warnings,
  );
  const lighting = parseCategoricalField(
    q.lighting, "imageQuality.lighting", LIGHTING_QUALITIES, side, source, errors, warnings,
  );
  const usableForAnalysis = parseBooleanField(
    q.usableForAnalysis, "imageQuality.usableForAnalysis", side, source, errors, warnings,
  );

  const autographVisible = parseBooleanField(
    o.autographVisible, "observations.autographVisible", side, source, errors, warnings,
  );
  const memorabiliaWindowVisible = parseBooleanField(
    o.memorabiliaWindowVisible, "observations.memorabiliaWindowVisible", side, source, errors, warnings,
  );
  const dominantColor = parseCategoricalField(
    o.dominantColor, "observations.dominantColor", COLOR_FAMILIES, side, source, errors, warnings,
  );
  const borderColor = parseCategoricalField(
    o.borderColor, "observations.borderColor", COLOR_FAMILIES, side, source, errors, warnings,
  );
  const foilOrReflective = parseBooleanField(
    o.foilOrReflective, "observations.foilOrReflective", side, source, errors, warnings,
  );
  const serialNumberAreaVisible = parseBooleanField(
    o.serialNumberAreaVisible, "observations.serialNumberAreaVisible", side, source, errors, warnings,
  );

  if (
    !orientation || !fullCardVisible || !sharpEnough || !glare || !lighting || !usableForAnalysis ||
    !autographVisible || !memorabiliaWindowVisible || !dominantColor || !borderColor ||
    !foilOrReflective || !serialNumberAreaVisible
  ) {
    return { ok: false, errors };
  }

  const imageQuality: VisionImageQuality = {
    side, orientation, fullCardVisible, sharpEnough, glare, lighting, usableForAnalysis,
  };
  const observations: CardVisualObservations = {
    autographVisible, memorabiliaWindowVisible, dominantColor, borderColor,
    foilOrReflective, serialNumberAreaVisible,
  };

  const analysis: CardVisionAnalysis = {
    side,
    observations,
    imageQuality,
    source,
    createdAt,
    analysisVersion: VISION_ANALYSIS_VERSION,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  return { ok: true, analysis, warnings };
}

function isValidSource(value: unknown): value is VisionEvidenceSource {
  return (
    isRecord(value) &&
    typeof value.provider === "string" &&
    typeof value.model === "string" &&
    typeof value.promptVersion === "string"
  );
}

function isValidObservationBase(value: Record<string, unknown>, side: VisionImageSide): boolean {
  return (
    value.side === side &&
    typeof value.confidence === "number" &&
    Number.isFinite(value.confidence) &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isValidSource(value.source) &&
    typeof value.explanation === "string"
  );
}

function isValidBooleanObservation(value: unknown, side: VisionImageSide): value is BooleanObservation {
  return (
    isRecord(value) &&
    value.kind === "boolean" &&
    typeof value.value === "boolean" &&
    isValidObservationBase(value, side)
  );
}

function isValidCategoricalObservation<T extends string>(
  value: unknown,
  allowed: readonly T[],
  side: VisionImageSide,
): value is CategoricalObservation<T> {
  return (
    isRecord(value) &&
    value.kind === "categorical" &&
    typeof value.value === "string" &&
    (allowed as readonly string[]).includes(value.value) &&
    isValidObservationBase(value, side)
  );
}

/**
 * Lightweight structural re-check of an already-validated CardVisionAnalysis
 * crossing the network again -- intended for the client boundary
 * (src/lib/vision/index.ts), re-checking /api/vision's own JSON response
 * the same way isRawOcrResponse re-checks /api/ocr's. Returns a boolean
 * type guard rather than collecting field-level errors, since by this point
 * the shape is either intact (our own route produced it) or something is
 * genuinely wrong end-to-end.
 */
export function isCardVisionAnalysis(
  value: unknown,
  expectedSide: VisionImageSide,
): value is CardVisionAnalysis {
  if (!isRecord(value)) return false;
  if (value.side !== expectedSide) return false;
  if (typeof value.createdAt !== "string") return false;
  if (typeof value.analysisVersion !== "string") return false;
  if (!isValidSource(value.source)) return false;

  const q = value.imageQuality;
  const o = value.observations;
  if (!isRecord(q) || !isRecord(o)) return false;

  const qualityValid =
    isValidCategoricalObservation(q.orientation, ORIENTATIONS, expectedSide) &&
    isValidBooleanObservation(q.fullCardVisible, expectedSide) &&
    isValidBooleanObservation(q.sharpEnough, expectedSide) &&
    isValidCategoricalObservation(q.glare, GLARE_SEVERITIES, expectedSide) &&
    isValidCategoricalObservation(q.lighting, LIGHTING_QUALITIES, expectedSide) &&
    isValidBooleanObservation(q.usableForAnalysis, expectedSide);

  const observationsValid =
    isValidBooleanObservation(o.autographVisible, expectedSide) &&
    isValidBooleanObservation(o.memorabiliaWindowVisible, expectedSide) &&
    isValidCategoricalObservation(o.dominantColor, COLOR_FAMILIES, expectedSide) &&
    isValidCategoricalObservation(o.borderColor, COLOR_FAMILIES, expectedSide) &&
    isValidBooleanObservation(o.foilOrReflective, expectedSide) &&
    isValidBooleanObservation(o.serialNumberAreaVisible, expectedSide);

  return qualityValid && observationsValid;
}

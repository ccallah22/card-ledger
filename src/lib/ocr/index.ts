import type { CardOcrExtractedFields, CardOcrResult, OCRResult, OcrImageSide } from "@/lib/ocr/types";

export type { OCRResult, OCRTextLine, OcrEngine, CardOcrResult, CardOcrExtractedFields, OcrImageSide, CardOcrFieldSource } from "@/lib/ocr/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

// Defensive re-validation of our own /api/ocr response shape -- cheap
// insurance even though the client is talking to a route this app controls,
// not directly to the model.
function normalizeExtracted(raw: unknown): CardOcrExtractedFields {
  if (!isRecord(raw)) return {};
  return {
    playerName: toNullableString(raw.playerName),
    teamName: toNullableString(raw.teamName),
    brand: toNullableString(raw.brand),
    visibleYear: toNullableString(raw.visibleYear),
    cardName: toNullableString(raw.cardName),
    parallelText: toNullableString(raw.parallelText),
    autographIndicator: toNullableString(raw.autographIndicator),
    relicIndicator: toNullableString(raw.relicIndicator),

    cardNumber: toNullableString(raw.cardNumber),
    copyrightYear: toNullableString(raw.copyrightYear),
    manufacturer: toNullableString(raw.manufacturer),
    smallPrint: toNullableString(raw.smallPrint),
    statisticsText: toNullableString(raw.statisticsText),
    checklistText: toNullableString(raw.checklistText),
    serialNumbering: toNullableString(raw.serialNumbering),
    authenticationText: toNullableString(raw.authenticationText),

    setName: toNullableString(raw.setName),
  };
}

type RawOcrResponse = {
  side: OcrImageSide;
  engine: string;
  confidence: number;
  rawText: string;
  lines: string[];
  extracted: Record<string, unknown>;
  createdAt: string;
};

// Strict shape validation of the route's JSON response. A response that
// fails this check is treated as an actual failure (runOcr throws) --
// distinct from a *valid* response that simply carries empty
// lines/rawText/extracted, which is a legitimate successful result (the
// model looked and found nothing, which is not the same as us not being
// able to trust what we got back).
function isRawOcrResponse(value: unknown, side: OcrImageSide): value is RawOcrResponse {
  if (!isRecord(value)) return false;
  return (
    value.side === side &&
    typeof value.engine === "string" &&
    typeof value.confidence === "number" &&
    typeof value.rawText === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every((line): line is string => typeof line === "string") &&
    isRecord(value.extracted) &&
    typeof value.createdAt === "string"
  );
}

/**
 * Calls the server-side /api/ocr route (OpenAI Vision) so OPENAI_API_KEY
 * stays server-side, for exactly one side of the card at a time.
 *
 * Resolves to a CardOcrResult for every valid API success -- including a
 * result with zero detected lines/empty rawText/all-null extracted fields,
 * which is a legitimate completed outcome, not a failure. Throws a
 * descriptive Error for an actual failure: a network error, a non-2xx
 * response, or a response whose shape doesn't match what this route is
 * supposed to return (including a response for the wrong side). Callers
 * that want a completed-but-empty result to read differently from a thrown
 * failure must check for both explicitly -- this function no longer
 * converts a real failure into a fake empty success.
 */
export async function runOcr(imageDataUrl: string, side: OcrImageSide): Promise<CardOcrResult> {
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageDataUrl, side }),
  });

  if (!res.ok) {
    throw new Error(`OCR request failed for ${side} (HTTP ${res.status}).`);
  }

  const data: unknown = await res.json();
  if (!isRawOcrResponse(data, side)) {
    throw new Error(`OCR response for ${side} had an unexpected shape.`);
  }

  return {
    side,
    engine: data.engine,
    confidence: data.confidence,
    rawText: data.rawText,
    lines: data.lines,
    extracted: normalizeExtracted(data.extracted),
    createdAt: data.createdAt,
  };
}

// Adapts a CardOcrResult into the legacy OCRResult shape that
// buildCatalogQuery() (src/lib/catalog/queryBuilder.ts, out of scope for
// this phase) still expects -- catalog matching is not being changed here,
// so its input shape isn't either.
export function toLegacyOcrResult(result: CardOcrResult): OCRResult {
  return {
    lines: result.lines.map((text) => ({ text, confidence: result.confidence })),
    rawText: result.rawText,
    confidence: result.confidence,
    engine: result.engine,
  };
}

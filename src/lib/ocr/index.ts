import type { OCRResult } from "@/lib/ocr/types";

export type { OCRResult, OCRTextLine, OcrEngine } from "@/lib/ocr/types";

const EMPTY_RESULT: OCRResult = {
  lines: [],
  rawText: "",
  confidence: 0,
  engine: "openai",
};

/**
 * Calls the server-side /api/ocr route (OpenAI Vision) so OPENAI_API_KEY
 * stays server-side. Never throws/rejects -- any failure (network error,
 * non-ok response, malformed JSON) resolves to a safe empty result so
 * callers can always .then()/.finally() without a .catch().
 */
export async function runOcr(imageDataUrl: string): Promise<OCRResult> {
  try {
    const res = await fetch("/api/ocr", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl }),
    });

    if (!res.ok) return EMPTY_RESULT;

    const data = await res.json();
    if (!data || typeof data.rawText !== "string" || !Array.isArray(data.lines)) {
      return EMPTY_RESULT;
    }

    return {
      lines: data.lines,
      rawText: data.rawText,
      confidence: typeof data.confidence === "number" ? data.confidence : 0,
      engine: typeof data.engine === "string" ? data.engine : "openai",
    };
  } catch {
    return EMPTY_RESULT;
  }
}

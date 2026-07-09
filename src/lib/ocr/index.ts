import type { OCRResult } from "@/lib/ocr/types";

export type { OCRResult, OCRTextLine, OcrEngine } from "@/lib/ocr/types";

/**
 * Stub engine: no provider, no API call, no real recognition yet. Always
 * resolves with empty text so callers can build and verify the full
 * crop -> OCR -> catalog-match pipeline before a real engine is chosen.
 */
export async function runOcr(imageDataUrl: string): Promise<OCRResult> {
  return {
    lines: [],
    rawText: "",
    confidence: 0,
    engine: "stub",
  };
}

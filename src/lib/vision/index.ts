import { isCardVisionAnalysis } from "./validateVisionAnalysis";
import type { CardVisionAnalysis, VisionImageSide } from "./types";

export type {
  VisionImageSide,
  VisionEvidenceSource,
  BooleanObservation,
  CategoricalObservation,
  ColorObservation,
  ColorFamily,
  Orientation,
  GlareSeverity,
  LightingQuality,
  VisionImageQuality,
  CardVisualObservations,
  CardVisionAnalysis,
} from "./types";

// Vision Engine V3, Phase V3.1A: browser-side client helper for
// POST /api/vision, mirroring src/lib/ocr/index.ts's runOcr in shape and
// contract exactly (same fetch/error/re-validation pattern) so the two stay
// easy to reason about side by side. Not called from cards/new/page.tsx (or
// anywhere else) yet -- this phase only establishes the helper.

/**
 * Calls the server-side /api/vision route (OpenAI Vision today; a future
 * specialized analyzer could sit behind the same route without this
 * function changing) so OPENAI_API_KEY stays server-side, for exactly one
 * side of the card at a time.
 *
 * Throws a safe, generic Error for any failure: a network error, a non-2xx
 * response (401/400/502/500 from the route are never exposed beyond a
 * short, safe message), or a response whose shape doesn't pass
 * isCardVisionAnalysis's re-validation. Never returns a partially-typed or
 * unvalidated result.
 */
export async function runVisionAnalysis(
  imageDataUrl: string,
  side: VisionImageSide,
): Promise<CardVisionAnalysis> {
  let res: Response;
  try {
    res = await fetch("/api/vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl, side }),
    });
  } catch {
    throw new Error(`Vision analysis request failed for ${side} (network error).`);
  }

  if (!res.ok) {
    throw new Error(`Vision analysis failed for ${side} (HTTP ${res.status}).`);
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Vision analysis response for ${side} was not valid JSON.`);
  }

  if (!isCardVisionAnalysis(data, side)) {
    throw new Error(`Vision analysis response for ${side} had an unexpected shape.`);
  }

  return data;
}

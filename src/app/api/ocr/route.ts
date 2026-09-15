import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { IMAGE_RULES } from "@/lib/image";
import { checkAiRateLimit } from "@/lib/aiRateLimit";

const REQUEST_TIMEOUT_MS = 15000;

// Mirrors src/app/api/vision/route.ts's own image validation exactly --
// deliberately duplicated (not extracted into a shared module) so this
// phase does not touch Vision's existing, already-correct implementation
// at all, per this task's explicit scope. IMAGE_RULES itself (the actual
// limits) is still the single shared source of truth, reused from
// src/lib/image.ts rather than re-declared.
const ALLOWED_MIME_TYPES = new Set(IMAGE_RULES.allowedTypes);
const MAX_IMAGE_BYTES = IMAGE_RULES.maxBytes;
// Base64 inflates raw bytes by ~4/3, plus data-URL prefix/JSON overhead --
// intentionally generous so it can be checked from Content-Length alone,
// before the body is parsed. The authoritative decoded-byte check is
// validateImageDataUrl below.
const MAX_REQUEST_BODY_BYTES = Math.ceil(MAX_IMAGE_BYTES * 1.4) + 2048;

function validateImageDataUrl(
  imageDataUrl: string,
): { ok: true; approxBytes: number } | { ok: false; reason: string; status: 400 | 413 } {
  const match = imageDataUrl.match(/^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) {
    return { ok: false, reason: "imageDataUrl must be a base64 data URL.", status: 400 };
  }
  const [, mime, base64Data] = match;
  if (!ALLOWED_MIME_TYPES.has(mime.toLowerCase())) {
    return { ok: false, reason: `Unsupported image MIME type "${mime}".`, status: 400 };
  }

  // Decoded byte length from a base64 string, without allocating the
  // actual bytes -- padding-aware, exact.
  const len = base64Data.length;
  const padding = base64Data.endsWith("==") ? 2 : base64Data.endsWith("=") ? 1 : 0;
  const approxBytes = Math.floor((len * 3) / 4) - padding;

  if (approxBytes > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "Image exceeds the maximum allowed size.", status: 413 };
  }

  return { ok: true, approxBytes };
}

const RATE_LIMIT_MESSAGE =
  "You've reached the scanning limit for now. You can still add this card manually, or try scanning again shortly.";

type OcrSide = "front" | "back";

// Field lists per side -- kept in sync with CardOcrExtractedFields in
// src/lib/ocr/types.ts. Each side's model prompt only ever asks about its
// own list, so a field the model was never asked about is simply absent
// from the response rather than a misleading forced null.
const FRONT_FIELDS = [
  "playerName",
  "teamName",
  "brand",
  "setName",
  "visibleYear",
  "cardName",
  "parallelText",
  "autographIndicator",
  "relicIndicator",
] as const;

const BACK_FIELDS = [
  "cardNumber",
  "copyrightYear",
  "manufacturer",
  "setName",
  "smallPrint",
  "statisticsText",
  "checklistText",
  "serialNumbering",
  "authenticationText",
] as const;

function buildPrompt(side: OcrSide): string {
  const fields = side === "front" ? FRONT_FIELDS : BACK_FIELDS;
  const sideLabel = side === "front" ? "FRONT" : "BACK";
  const priorityHint =
    side === "front"
      ? "player identity, team, brand/manufacturer, the visible product/set name (e.g. \"Select\", \"Prizm\", \"Donruss Optic\" -- the product line, NOT the manufacturer), year, card/subset name, parallel/color name, and any autograph or relic/memorabilia wording"
      : "card number, copyright year, manufacturer, the official checklist/product/set wording (the product line name, distinct from the manufacturer), small print, statistics, checklist references, serial numbering, and any grading/authentication wording";

  return [
    `This image is the ${sideLabel} of a sports trading card. Prioritize ${priorityHint}.`,
    "Respond with ONLY a single JSON object, no commentary and no markdown fences, matching exactly this shape:",
    `{"lines": string[], "extracted": {${fields.map((f) => `"${f}": string | null`).join(", ")}}}`,
    "\"lines\" is every distinct piece of text visible on the card, one item per string, in the order it appears.",
    "For each field in \"extracted\", use the visible value if present, or null if that field is not visible or not applicable to this side. Do not guess or invent a value that is not actually visible.",
  ].join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// The OpenAI Responses API payload shape is not something this route
// controls or wants to fully model -- narrow just enough, via unknown +
// type guards, to safely reach the one string field this app actually
// reads out of it.
function extractText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text;

  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const c of content) {
      if (isRecord(c) && c.type === "output_text" && typeof c.text === "string") {
        return c.text;
      }
    }
  }
  return "";
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Defensive normalization of the model's JSON -- it is never trusted as-is:
// wrong types, missing keys, extra keys, or a completely non-JSON response
// (e.g. the model added prose despite instructions) all degrade to empty
// values rather than propagating an unexpected shape to the client.
function parseModelJson(rawOutput: string, side: OcrSide) {
  const fields = side === "front" ? FRONT_FIELDS : BACK_FIELDS;
  const empty = {
    lines: [] as string[],
    extracted: {} as Record<string, string | null>,
  };

  let parsed: unknown;
  try {
    // The model may still wrap JSON in a code fence despite instructions
    // not to; strip a leading/trailing ``` fence defensively before parsing.
    const cleaned = rawOutput.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("[ocr] stage=parse failed", { side, rawLength: rawOutput.length });
    return empty;
  }

  if (!parsed || typeof parsed !== "object") return empty;
  const obj = parsed as Record<string, unknown>;

  const lines = Array.isArray(obj.lines)
    ? obj.lines.filter((l): l is string => typeof l === "string" && l.trim().length > 0)
    : [];

  const rawExtracted =
    obj.extracted && typeof obj.extracted === "object"
      ? (obj.extracted as Record<string, unknown>)
      : {};

  const extracted: Record<string, string | null> = {};
  for (const field of fields) {
    extracted[field] = toNullableString(rawExtracted[field]);
  }

  return { lines, extracted };
}

export async function POST(req: Request) {
  // TEMPORARY DIAGNOSTIC (see aiRateLimit.ts/image-check/vision routes for
  // matching instrumentation) -- stage-tracking console output only, no
  // behavior change. Safe to remove once the production 500s are diagnosed.
  console.log("[ocr] request received");

  // Authentication first, before body parsing or anything else -- an
  // unauthenticated caller must never reach OCR, let alone OpenAI.
  const supabase = await createServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (authError || !user) {
    console.error("[ocr] stage=auth failed", { reason: authError?.message ?? "no user" });
    return NextResponse.json({ message: "Not authenticated." }, { status: 401 });
  }
  console.log("[ocr] stage=auth ok", { userId: user.id });

  // Reject an oversized body before it is even parsed, when the client
  // reports Content-Length (not authoritative alone -- the decoded-byte
  // check in validateImageDataUrl below is the real limit -- but this
  // avoids buffering a grossly oversized body into memory/JSON.parse at
  // all when the client is honest about its size).
  const contentLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    console.error("[ocr] stage=validation failed", { reason: "content-length", contentLength });
    return NextResponse.json({ message: "Request payload too large." }, { status: 413 });
  }

  try {
    const body: unknown = await req.json();
    const imageDataUrl = isRecord(body) ? body.imageDataUrl : undefined;
    const side = isRecord(body) ? body.side : undefined;

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      console.error("[ocr] stage=validation failed", { reason: "missing imageDataUrl" });
      return NextResponse.json({ message: "Missing image data." }, { status: 400 });
    }
    if (side !== "front" && side !== "back") {
      console.error("[ocr] stage=validation failed", { reason: "missing or invalid side" });
      return NextResponse.json(
        { message: "Missing or invalid side; expected \"front\" or \"back\"." },
        { status: 400 },
      );
    }

    const imageCheck = validateImageDataUrl(imageDataUrl);
    if (!imageCheck.ok) {
      console.error("[ocr] stage=validation failed", {
        side,
        reason: imageCheck.reason,
        status: imageCheck.status,
      });
      return NextResponse.json({ message: imageCheck.reason }, { status: imageCheck.status });
    }
    console.log("[ocr] stage=validation ok", { side, approxBytes: imageCheck.approxBytes });

    // Rate limit last, after every input check has already passed -- no
    // point consuming a unit of quota for a request that was going to be
    // rejected anyway, and this keeps the quota measuring genuine attempts
    // to reach OpenAI, not malformed noise.
    const rateLimit = await checkAiRateLimit(supabase);
    if (!rateLimit.allowed) {
      if (rateLimit.reason === "error") {
        console.error("[ocr] stage=rate-limit RPC error", { side });
        return NextResponse.json({ message: "OCR failed." }, { status: 500 });
      }
      console.error("[ocr] stage=rate-limit rejected", {
        side,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
      return NextResponse.json(
        { message: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
    console.log("[ocr] stage=rate-limit ok", { side });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[ocr] stage=config failed", { reason: "missing OPENAI_API_KEY" });
      return NextResponse.json({ message: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let json: unknown;
    try {
      console.log("[ocr] stage=provider request start", { side, model: "gpt-4.1-mini" });
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          max_output_tokens: 700,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: buildPrompt(side) },
                { type: "input_image", image_url: imageDataUrl },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        console.error("[ocr] stage=provider non-2xx", {
          side,
          model: "gpt-4.1-mini",
          status: res.status,
          statusText: res.statusText,
        });
      } else {
        console.log("[ocr] stage=provider response ok", { side, status: res.status });
      }
      json = await res.json();
    } catch (fetchErr) {
      console.error("[ocr] stage=provider fetch error", {
        side,
        name: fetchErr instanceof Error ? fetchErr.name : "unknown",
        isAbort: fetchErr instanceof Error && fetchErr.name === "AbortError",
      });
      throw fetchErr;
    } finally {
      clearTimeout(timeout);
    }

    const rawOutput = extractText(json);
    const { lines, extracted } = parseModelJson(rawOutput, side);
    const rawText = lines.join("\n");

    // OpenAI's Responses API doesn't return per-line/character OCR
    // confidence the way purpose-built OCR APIs do. This is a fixed
    // heuristic ("got plausible text" vs. "got nothing"), not a calibrated
    // measurement -- unchanged from before this phase. A confidence of 0
    // here describes a *successful* request that found no text -- it is
    // not, by itself, a failure signal (see src/lib/ocr/index.ts's runOcr).
    const confidence = rawText ? 0.8 : 0;

    return NextResponse.json({
      side,
      lines,
      rawText,
      confidence,
      engine: "openai",
      extracted,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[ocr] stage=unhandled error", {
      name: err instanceof Error ? err.name : "unknown",
      isAbort: err instanceof Error && err.name === "AbortError",
    });
    return NextResponse.json({ message: "OCR failed." }, { status: 500 });
  }
}

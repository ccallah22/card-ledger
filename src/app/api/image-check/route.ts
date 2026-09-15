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

// Small helper so each of the two sequential provider calls below gets its
// own independent timeout budget, rather than sharing one controller --
// this means a slow (but not timed-out) moderation call never eats into
// the classification call's own budget, and a fetch that actually throws
// (including via abort) always propagates out of this helper so the
// caller can stop before ever starting the next call.
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

type CheckResult = {
  decision: "accept" | "review" | "block";
  label: string;
  confidence: number;
  flagged?: boolean;
  categories?: Record<string, boolean>;
  message?: string;
};

const CARD_CONFIDENCE = {
  accept: 0.75,
  review: 0.55,
  blockNonCard: 0.6,
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// Smallest local shape covering only the fields this route reads from an
// OpenAI Responses-API result -- not a model of the full response schema.
// Leaves are `unknown` and every access below stays behind the same
// typeof/Array.isArray runtime guards the code already had; this type only
// replaces `any` for property-access safety.
type ResponsesApiContentItem = {
  type?: unknown;
  text?: unknown;
};

type ResponsesApiOutputItem = {
  content?: unknown;
};

type ResponsesApiPayload = {
  output_text?: unknown;
  output?: unknown;
};

function extractText(payload: ResponsesApiPayload | null | undefined) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? (payload.output as ResponsesApiOutputItem[]) : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? (item.content as ResponsesApiContentItem[]) : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") return c.text;
    }
  }
  return "";
}

export async function POST(req: Request) {
  // TEMPORARY DIAGNOSTIC (see ocr/vision routes for matching
  // instrumentation) -- stage-tracking console output only, no behavior
  // change. Safe to remove once the production 500s are diagnosed.
  console.log("[image-check] request received");

  // Authentication first, before body parsing or anything else -- an
  // unauthenticated caller must never reach either provider call.
  const supabase = await createServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (authError || !user) {
    console.error("[image-check] stage=auth failed", { reason: authError?.message ?? "no user" });
    return NextResponse.json({ message: "Not authenticated." }, { status: 401 });
  }
  console.log("[image-check] stage=auth ok", { userId: user.id });

  // Reject an oversized body before it is even parsed, when the client
  // reports Content-Length (not authoritative alone -- the decoded-byte
  // check in validateImageDataUrl below is the real limit -- but this
  // avoids buffering a grossly oversized body into memory/JSON.parse at
  // all when the client is honest about its size).
  const contentLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    console.error("[image-check] stage=validation failed", { reason: "content-length", contentLength });
    return NextResponse.json({ message: "Request payload too large." }, { status: 413 });
  }

  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      console.error("[image-check] stage=validation failed", { reason: "missing imageDataUrl" });
      return NextResponse.json({ message: "Missing image data." }, { status: 400 });
    }

    const imageCheck = validateImageDataUrl(imageDataUrl);
    if (!imageCheck.ok) {
      console.error("[image-check] stage=validation failed", {
        reason: imageCheck.reason,
        status: imageCheck.status,
      });
      return NextResponse.json({ message: imageCheck.reason }, { status: imageCheck.status });
    }
    console.log("[image-check] stage=validation ok", { approxBytes: imageCheck.approxBytes });

    // Rate limit last, after every input check has already passed -- this
    // one HTTP request consumes exactly ONE unit of the combined AI
    // budget, even though it can make up to two provider calls below (the
    // quota measures requests to this route, not individual provider
    // calls).
    const rateLimit = await checkAiRateLimit(supabase);
    if (!rateLimit.allowed) {
      if (rateLimit.reason === "error") {
        console.error("[image-check] stage=rate-limit RPC error");
        return NextResponse.json({ message: "Image check failed." }, { status: 500 });
      }
      console.error("[image-check] stage=rate-limit rejected", {
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      });
      return NextResponse.json(
        { message: RATE_LIMIT_MESSAGE },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }
    console.log("[image-check] stage=rate-limit ok");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[image-check] stage=config failed", { reason: "missing OPENAI_API_KEY" });
      return NextResponse.json({ message: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    // 1) Safety moderation (block explicit content, offensive, etc.). Its
    // own timeout; if this throws (including via abort), the catch block
    // below returns immediately and the classification call never runs.
    console.log("[image-check] stage=moderation request start");
    let modRes: Response;
    try {
      modRes = await fetchWithTimeout("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: [
            {
              type: "image_url",
              image_url: { url: imageDataUrl },
            },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error("[image-check] stage=moderation fetch error", {
        name: fetchErr instanceof Error ? fetchErr.name : "unknown",
        isAbort: fetchErr instanceof Error && fetchErr.name === "AbortError",
      });
      throw fetchErr;
    }
    if (!modRes.ok) {
      console.error("[image-check] stage=moderation non-2xx", {
        status: modRes.status,
        statusText: modRes.statusText,
      });
    } else {
      console.log("[image-check] stage=moderation response ok", { status: modRes.status });
    }

    const modJson = await modRes.json();
    const modResult = modJson?.results?.[0];
    if (modResult?.flagged) {
      const result: CheckResult = {
        decision: "block",
        label: "unsafe",
        confidence: 1,
        flagged: true,
        categories: modResult?.categories ?? {},
        message: "This image appears to violate content safety rules.",
      };
      return NextResponse.json(result);
    }

    // 2) Card vs non-card classification -- only reached once the
    // moderation call above has actually completed successfully.
    console.log("[image-check] stage=classify request start");
    let classifyRes: Response;
    try {
      classifyRes = await fetchWithTimeout("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          max_output_tokens: 200,
          input: [
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: [
                    "Classify whether this image is a sports trading card (or a photo of one).",
                    "Return ONLY JSON: {\"label\":\"card|screenshot|meme|selfie|random_object|other\",\"confidence\":0-1}.",
                    "If it's a screenshot of an online listing, label 'screenshot'.",
                  ].join("\n"),
                },
                { type: "input_image", image_url: imageDataUrl },
              ],
            },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error("[image-check] stage=classify fetch error", {
        name: fetchErr instanceof Error ? fetchErr.name : "unknown",
        isAbort: fetchErr instanceof Error && fetchErr.name === "AbortError",
      });
      throw fetchErr;
    }
    if (!classifyRes.ok) {
      console.error("[image-check] stage=classify non-2xx", {
        status: classifyRes.status,
        statusText: classifyRes.statusText,
      });
    } else {
      console.log("[image-check] stage=classify response ok", { status: classifyRes.status });
    }

    const classifyJson = await classifyRes.json();
    const rawText = extractText(classifyJson);

    let label = "other";
    let confidence = 0.5;
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed?.label === "string") label = parsed.label;
      if (typeof parsed?.confidence === "number") confidence = parsed.confidence;
    } catch {
      console.error("[image-check] stage=classify parse failed", { rawLength: rawText.length });
      // fall back to conservative review
    }

    confidence = clamp(confidence, 0, 1);

    let decision: CheckResult["decision"] = "review";
    if (label === "card" && confidence >= CARD_CONFIDENCE.accept) decision = "accept";
    else if (label === "card" && confidence >= CARD_CONFIDENCE.review) decision = "review";
    else if (label !== "card" && confidence >= CARD_CONFIDENCE.blockNonCard) decision = "block";

    const result: CheckResult = {
      decision,
      label,
      confidence,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("[image-check] stage=unhandled error", {
      name: err instanceof Error ? err.name : "unknown",
      isAbort: err instanceof Error && err.name === "AbortError",
    });
    return NextResponse.json({ message: "Image check failed." }, { status: 500 });
  }
}

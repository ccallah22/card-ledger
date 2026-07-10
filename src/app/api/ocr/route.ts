import { NextResponse } from "next/server";

const REQUEST_TIMEOUT_MS = 15000;

type OcrSide = "front" | "back";

// Field lists per side -- kept in sync with CardOcrExtractedFields in
// src/lib/ocr/types.ts. Each side's model prompt only ever asks about its
// own list, so a field the model was never asked about is simply absent
// from the response rather than a misleading forced null.
const FRONT_FIELDS = [
  "playerName",
  "teamName",
  "brand",
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
      ? "player identity, team, brand, year, card/subset name, parallel/color name, and any autograph or relic/memorabilia wording"
      : "card number, copyright year, manufacturer, small print, statistics, checklist references, serial numbering, and any grading/authentication wording";

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
  try {
    const body: unknown = await req.json();
    const imageDataUrl = isRecord(body) ? body.imageDataUrl : undefined;
    const side = isRecord(body) ? body.side : undefined;

    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return NextResponse.json({ message: "Missing image data." }, { status: 400 });
    }
    if (side !== "front" && side !== "back") {
      return NextResponse.json(
        { message: "Missing or invalid side; expected \"front\" or \"back\"." },
        { status: 400 },
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let json: unknown;
    try {
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
      json = await res.json();
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
  } catch {
    return NextResponse.json({ message: "OCR failed." }, { status: 500 });
  }
}

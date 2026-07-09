import { NextResponse } from "next/server";

const REQUEST_TIMEOUT_MS = 15000;

const OCR_PROMPT =
  "This is a photo of a sports trading card (front or back). List every distinct piece of text visible on the card, one item per line, in the order it appears. Include player names, team names, set or brand names, card numbers, serial numbers, and any other printed text. Output only the raw text lines — no commentary, no labels, no formatting, no markdown. If no text is legible, output nothing.";

function extractText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") return c.text;
    }
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const { imageDataUrl } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return NextResponse.json({ message: "Missing image data." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ message: "Missing OPENAI_API_KEY." }, { status: 500 });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let json: any;
    try {
      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          max_output_tokens: 500,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: OCR_PROMPT },
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
    const lineTexts = rawOutput
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    const rawText = lineTexts.join("\n");

    // OpenAI's Responses API doesn't return per-line/character OCR
    // confidence the way purpose-built OCR APIs do. This is a fixed
    // heuristic ("got plausible text" vs. "got nothing"), not a calibrated
    // measurement.
    const confidence = rawText ? 0.8 : 0;

    return NextResponse.json({
      lines: lineTexts.map((text: string) => ({ text, confidence })),
      rawText,
      confidence,
      engine: "openai",
    });
  } catch (err) {
    return NextResponse.json({ message: "OCR failed." }, { status: 500 });
  }
}

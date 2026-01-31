import { NextResponse } from "next/server";

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

    // 1) Safety moderation (block explicit content, offensive, etc.)
    const modRes = await fetch("https://api.openai.com/v1/moderations", {
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

    // 2) Card vs non-card classification
    const classifyRes = await fetch("https://api.openai.com/v1/responses", {
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

    const classifyJson = await classifyRes.json();
    const rawText = extractText(classifyJson);

    let label = "other";
    let confidence = 0.5;
    try {
      const parsed = JSON.parse(rawText);
      if (typeof parsed?.label === "string") label = parsed.label;
      if (typeof parsed?.confidence === "number") confidence = parsed.confidence;
    } catch {
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
    return NextResponse.json({ message: "Image check failed." }, { status: 500 });
  }
}

export type OCRTextLine = {
  text: string;
  confidence: number;
};

// Kept exactly as-is: src/lib/catalog/queryBuilder.ts's buildCatalogQuery()
// depends on this shape (lines[].text) and is out of scope for this phase
// ("do not modify catalog matching"). CardOcrResult below is the new,
// side-aware structured shape actually returned by runOcr() now -- callers
// that still need an OCRResult (i.e. buildCatalogQuery) get one built from
// a CardOcrResult at the call site, not from a change here.
export type OCRResult = {
  lines: OCRTextLine[];
  rawText: string;
  confidence: number;
  engine: string;
};

export interface OcrEngine {
  recognize(imageDataUrl: string): Promise<OCRResult>;
}

// Vision Engine V2, Phase 6A: side-aware OCR.
export type OcrImageSide = "front" | "back";

// Which side (or combination) a given extracted field's value actually came
// from. Not yet consumed by anything in this phase -- catalog matching,
// confidence aggregation, and merging front/back results are explicitly
// out of scope here. Included now so a later merge phase has a stable type
// to attach provenance to each field without another type-layer change.
export type CardOcrFieldSource = "front" | "back" | "combined" | "unknown";

// Every field is optional/nullable: a given side only ever asks the model
// about the fields relevant to that side (see the front/back prompts in
// src/app/api/ocr/route.ts), and "not visible on the card" is a normal,
// expected outcome, not a failure.
export type CardOcrExtractedFields = {
  // Front-priority fields.
  playerName?: string | null;
  teamName?: string | null;
  brand?: string | null;
  visibleYear?: string | null;
  cardName?: string | null;
  parallelText?: string | null;
  autographIndicator?: string | null;
  relicIndicator?: string | null;

  // Back-priority fields.
  cardNumber?: string | null;
  copyrightYear?: string | null;
  manufacturer?: string | null;
  smallPrint?: string | null;
  statisticsText?: string | null;
  checklistText?: string | null;
  serialNumbering?: string | null;
  authenticationText?: string | null;
};

// The structured, JSON-safe, side-aware OCR result. Written directly into
// card_media.ocr_output (via an explicit cast at the call site -- see
// src/app/(app)/cards/new/page.tsx -- since TypeScript doesn't structurally
// unify a named object type with the JsonValue index-signature type without
// one, even though every member here is plain JSON-safe data).
export type CardOcrResult = {
  side: OcrImageSide;
  engine: string;
  confidence: number;
  rawText: string;
  lines: string[];
  extracted: CardOcrExtractedFields;
  createdAt: string;
};

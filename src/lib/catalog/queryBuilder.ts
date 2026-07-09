import type { OCRResult } from "@/lib/ocr";

// Common legal/boilerplate phrases that show up on card backs (copyright
// lines, licensing disclaimers) but never match anything in the cards/sets/
// players catalog. searchCatalog() requires every token in the query to
// match something (it intersects per-token results), so a single leftover
// boilerplate token can zero out an otherwise-correct match -- removing
// these phrases first is the main value of this Phase 1 pass.
const BOILERPLATE_PHRASES = [
  "all rights reserved",
  "officially licensed product",
  "officially licensed",
  "printed in u.s.a.",
  "printed in usa",
  "not for resale",
  "trading card",
  "copyright",
  "©",
  "(c)",
];

function stripBoilerplate(text: string): string {
  let result = text;
  for (const phrase of BOILERPLATE_PHRASES) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "gi"), " ");
  }
  return result;
}

// Punctuation that never carries useful search signal but commonly rides
// along with real words in OCR text (e.g. "America," or "(Rookie)").
// searchCatalog() interpolates each token directly into a PostgREST
// `.or()` filter without escaping, so a literal comma/parenthesis/etc. in
// a token corrupts the query and Supabase returns 400 -- stripping these
// before the query ever reaches searchCatalog() prevents that. #, /, and -
// are deliberately preserved since they carry real meaning in card numbers
// and serials (e.g. "#123", "23/99", "Pink-Wave").
const UNSAFE_TOKEN_PUNCTUATION = /[,.;:()[\]]/g;

function stripUnsafePunctuation(token: string): string {
  return token.replace(UNSAFE_TOKEN_PUNCTUATION, "");
}

function dedupeTokensPreservingOrder(tokens: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result;
}

/**
 * Converts raw OCR output into a cleaner searchCatalog() query: strips
 * common legal/boilerplate phrases, collapses whitespace, strips unsafe
 * punctuation from tokens, and removes case-insensitive duplicate tokens
 * while preserving first-seen order. Deterministic, no AI. Does not yet do
 * card-number normalization or brand-vocabulary handling -- later phases.
 */
export function buildCatalogQuery(ocr: OCRResult): string {
  const sourceLines =
    ocr.lines.length > 0 ? ocr.lines.map((l) => l.text) : ocr.rawText.split("\n");

  const cleanedText = sourceLines.map(stripBoilerplate).join(" ");
  const collapsed = cleanedText.replace(/\s+/g, " ").trim();
  if (!collapsed) return "";

  const rawTokens = collapsed.split(" ").filter(Boolean);
  const sanitizedTokens = rawTokens.map(stripUnsafePunctuation).filter(Boolean);
  return dedupeTokensPreservingOrder(sanitizedTokens).join(" ");
}

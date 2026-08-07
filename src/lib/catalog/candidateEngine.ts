import type { FusedEvidence } from "@/lib/evidence/types";
import {
  searchCandidateCards,
  type CardWithContext,
} from "@/lib/repositories/cards";
import {
  listCardVariantsForCard,
  type CardVariantSummary,
} from "@/lib/repositories/cardVariants";

// Vision Engine V2, Phase 7A: catalog candidate engine. Given fused
// evidence, searches the normalized catalog and produces a ranked, scored
// list of plausible candidates -- it does NOT decide a winner. No
// automatic selection, no catalog mutation, no confidence engine, no
// visual/fingerprint matching. All of that is explicitly out of scope
// here; this only narrows and scores.
//
// Vision Engine V3, Phase V3.2D: migrated from MergedCardOcrResult to
// FusedEvidence -- this module has no knowledge of OCR or Vision anymore,
// only of the evidence layer's provider-neutral shape. It reads exactly the
// same seven conceptual fields it always has
// (playerName/cardNumber/setName/year/brand/manufacturer/parallelText/
// cardName) via evidence.<field>.value; it does not yet read confidence,
// state, conflicts, or supportingObservations, and it does not read any
// visual-only field (dominantColor/borderColor/orientation/
// serialAreaVisible/autographPresent/memorabiliaPresent) -- those remain
// out of scope for CARD candidate ranking in this phase. Callers are
// responsible for what evidence they pass in; see cards/new/page.tsx's
// deliberately OCR-only FusedEvidence built for this call (Vision inputs
// omitted) so visual evidence cannot yet influence card search.

export type CandidateMatchReason = {
  field: string;
  matched: boolean;
  expected: string | null;
  actual: string | null;
  weight: number;
};

export type CatalogCandidate = {
  cardId: number;
  variantId: number | null;

  score: number;

  reasons: CandidateMatchReason[];

  cardTitle: string;

  playerName: string | null;
  setName: string | null;
  year: string | null;
  // Vision Engine V2, Phase 7B: additive field for the confidence layer
  // (src/lib/catalog/candidateConfidence.ts) and UI display -- cardTitle's
  // fallback chain (card.title || player || "Card #N") means the card
  // number is often entirely absent from any existing candidate field
  // once a title or player name exists, and it's genuinely needed both to
  // display (e.g. "Barry Sanders #3") and to re-assess match quality
  // without parsing it back out of a display string. Always the real
  // catalog value (cards.card_number is NOT NULL), never a display guess.
  cardNumber: string;

  parallel: string | null;
};

const MAX_CANDIDATES = 25;

// Score contribution per matched field, out of 100 total when every field
// matches. This is a candidate *search* score only -- not the confidence
// layer (src/lib/catalog/candidateConfidence.ts), which independently
// re-assesses evidence quality/coverage/conflicts/ambiguity using these
// same conceptual weights -- never simply rescales this score. Exported so
// the confidence module reuses the identical weights rather than
// duplicating/drifting from them.
export const WEIGHTS = {
  player: 30,
  cardNumber: 25,
  set: 15,
  year: 10,
  brand: 5,
  parallel: 10,
  misc: 5,
} as const;

function normalizeText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Deliberately permissive (substring either direction, case-insensitive)
// rather than exact-match or fuzzy string-distance: OCR text is often a
// partial or slightly-extended read of the catalog's stored text (e.g.
// "Mayfield" vs "Baker Mayfield"), and this phase does not attempt a fuzzy-
// matching algorithm. Both sides missing/empty never counts as a match.
// Used only for free-text-ish fields (player, set name, brand/
// manufacturer, misc) -- never for card numbers, which use exact/numeric
// comparison below so a broad substring never counts as an exact match.
function textMatches(expected: string | null, actual: string | null): boolean {
  const e = normalizeText(expected);
  const a = normalizeText(actual);
  if (!e || !a) return false;
  return a.includes(e) || e.includes(a);
}

// Exact (post-normalization) or numeric equality only -- never substring.
// Shared by card-number and year comparisons; card numbers additionally
// strip a single leading "#" first (see cardNumberMatches) so "#123" and
// "123" compare equal, without stripping meaningful prefixes/suffixes like
// "RC-12", and without ever treating "12" as equal to "112".
function exactOrNumericMatches(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  if (expected === actual) return true;
  const e = Number(expected);
  const a = Number(actual);
  return Number.isFinite(e) && Number.isFinite(a) && e === a;
}

function cardNumberMatches(expected: string | null, actual: string | null): boolean {
  const e = normalizeText(expected).replace(/^#/, "");
  const a = normalizeText(actual).replace(/^#/, "");
  return exactOrNumericMatches(e, a);
}

function yearMatches(expected: string | null, actual: string | null): boolean {
  return exactOrNumericMatches(normalizeText(expected), normalizeText(actual));
}

function toYearNumber(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d{4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

// Phase 7A correction: text used for the "set" *search-narrowing* stage
// only (never for the "set" SCORE -- see scoreCandidate, which always
// scores set evidence against setName alone). Genuine setName evidence is
// preferred; brand/manufacturer is used here purely as a last-resort
// narrowing fallback when OCR gave no set evidence at all, so the search
// doesn't under-narrow just because the model only found a manufacturer
// logo. This fallback is documented here and nowhere near scoring.
function resolveSetSearchText(evidence: FusedEvidence): string | null {
  if (evidence.setName.value) return evidence.setName.value;
  return evidence.brand.value ?? evidence.manufacturer.value ?? null;
}

// Brand/manufacturer evidence is genuinely two OCR fields (brand,
// manufacturer) and two catalog columns (CardWithContext.setBrand ->
// sets.brand, CardWithContext.setManufacturer -> sets.manufacturer).
// Matched if ANY of the four OCR-field x catalog-column combinations
// agree -- still exactly one combined reason/weight, never double-scored,
// and NEVER compared against setName (that was the bug this corrects).
function brandOrManufacturerMatches(
  evidence: FusedEvidence,
  card: CardWithContext,
): { matched: boolean; expected: string | null; actual: string | null } {
  const ocrBrand = evidence.brand.value;
  const ocrManufacturer = evidence.manufacturer.value;
  const catalogBrand = card.setBrand;
  const catalogManufacturer = card.setManufacturer;

  const matched =
    textMatches(ocrBrand, catalogBrand) ||
    textMatches(ocrBrand, catalogManufacturer) ||
    textMatches(ocrManufacturer, catalogBrand) ||
    textMatches(ocrManufacturer, catalogManufacturer);

  return {
    matched,
    expected: ocrBrand ?? ocrManufacturer,
    actual: catalogBrand ?? catalogManufacturer,
  };
}

function pickBestVariant(
  variants: CardVariantSummary[],
  parallelText: string | null,
): { variant: CardVariantSummary | null; matched: boolean } {
  if (parallelText) {
    const match = variants.find(
      (v) => textMatches(parallelText, v.parallelName) || textMatches(parallelText, v.swatchDescriptor),
    );
    if (match) return { variant: match, matched: true };
  }
  // No parallel text from OCR, or nothing matched -- never reject the
  // candidate over this. Fall back to the card's "base" variant (no
  // parallel/swatch) if it has one, purely for a sensible default
  // variantId/parallel display value, still scored 0 for this field.
  const base = variants.find((v) => !v.parallelName && !v.swatchDescriptor);
  return { variant: base ?? null, matched: false };
}

async function scoreCandidate(
  card: CardWithContext,
  evidence: FusedEvidence,
): Promise<CatalogCandidate> {
  const reasons: CandidateMatchReason[] = [];

  const playerExpected = evidence.playerName.value;
  const playerActual = card.playerNames.length > 0 ? card.playerNames.join(" / ") : null;
  const playerMatched = playerExpected
    ? card.playerNames.some((name) => textMatches(playerExpected, name))
    : false;
  reasons.push({
    field: "player",
    matched: playerMatched,
    expected: playerExpected,
    actual: playerActual,
    weight: playerMatched ? WEIGHTS.player : 0,
  });

  const cardNumberExpected = evidence.cardNumber.value;
  const cardNumberMatched = cardNumberMatches(cardNumberExpected, card.cardNumber);
  reasons.push({
    field: "cardNumber",
    matched: cardNumberMatched,
    expected: cardNumberExpected,
    actual: card.cardNumber,
    weight: cardNumberMatched ? WEIGHTS.cardNumber : 0,
  });

  // Phase 7A correction: "set" now compares ONLY genuine set-name evidence
  // (evidence.setName, e.g. "Select") against the candidate's actual
  // set name (CardWithContext.setName, e.g. "2025 Panini Select
  // Football") -- brand/manufacturer text is never used to satisfy this
  // field, so a card whose set name merely happens to contain the
  // manufacturer's name can no longer score a false "set" match from
  // brand text alone.
  const setExpected = evidence.setName.value;
  const setMatched = textMatches(setExpected, card.setName);
  reasons.push({
    field: "set",
    matched: setMatched,
    expected: setExpected,
    actual: card.setName,
    weight: setMatched ? WEIGHTS.set : 0,
  });

  const yearExpected = evidence.year.value;
  const yearActual = card.releaseYear !== null ? String(card.releaseYear) : null;
  const yearMatched = yearMatches(yearExpected, yearActual);
  reasons.push({
    field: "year",
    matched: yearMatched,
    expected: yearExpected,
    actual: yearActual,
    weight: yearMatched ? WEIGHTS.year : 0,
  });

  // Phase 7A correction: "brand" now compares ONLY brand/manufacturer
  // evidence (evidence.brand and/or evidence.manufacturer) against the
  // candidate's brand/manufacturer columns (CardWithContext.setBrand ->
  // sets.brand, CardWithContext.setManufacturer -> sets.manufacturer) --
  // never against setName. One OCR value can now satisfy at most one of
  // "set"/"brand", never both, since the two reasons draw from disjoint
  // evidence fields and disjoint catalog columns.
  const brandResult = brandOrManufacturerMatches(evidence, card);
  reasons.push({
    field: "brand",
    matched: brandResult.matched,
    expected: brandResult.expected,
    actual: brandResult.actual,
    weight: brandResult.matched ? WEIGHTS.brand : 0,
  });

  // Parallel: needs this card's variants, which CardWithContext doesn't
  // carry. A lookup failure here must never take down the whole candidate
  // -- it just scores 0 and leaves variantId/parallel null.
  let variantId: number | null = null;
  let parallel: string | null = null;
  let parallelMatched = false;
  try {
    const variants = await listCardVariantsForCard(card.id);
    const picked = pickBestVariant(variants, evidence.parallelText.value);
    variantId = picked.variant?.id ?? null;
    parallel = picked.matched ? picked.variant?.parallelName ?? picked.variant?.swatchDescriptor ?? null : null;
    parallelMatched = picked.matched;
  } catch {
    // Leave variantId/parallel null, parallelMatched false -- see above.
  }
  reasons.push({
    field: "parallel",
    matched: parallelMatched,
    expected: evidence.parallelText.value,
    actual: parallel,
    weight: parallelMatched ? WEIGHTS.parallel : 0,
  });

  // Misc: this phase's only auxiliary, lower-confidence signal -- OCR's
  // card/subset name (cardName) against the catalog card's own title (e.g.
  // an insert/subset name). Everything else useful (autograph/relic
  // wording, etc.) is already reflected structurally on card_variants and
  // isn't compared here to avoid inventing additional ad hoc rules.
  const miscExpected = evidence.cardName.value;
  const miscMatched = textMatches(miscExpected, card.title);
  reasons.push({
    field: "misc",
    matched: miscMatched,
    expected: miscExpected,
    actual: card.title,
    weight: miscMatched ? WEIGHTS.misc : 0,
  });

  const score = reasons.reduce((total, reason) => total + reason.weight, 0);

  return {
    cardId: card.id,
    variantId,
    score,
    reasons,
    cardTitle: card.title || playerActual || `Card #${card.cardNumber}`,
    playerName: playerActual,
    setName: card.setName,
    year: yearActual,
    cardNumber: card.cardNumber,
    parallel,
  };
}

/**
 * Searches the normalized catalog for plausible candidates matching fused
 * evidence, and returns them ranked highest-score-first (stable ordering
 * for ties). Never mutates the catalog, never picks a single "winner" --
 * callers decide what (if anything) to do with the ranked list. Returns an
 * empty array if the evidence had nothing usable to search with, or if
 * nothing in the catalog matched at all.
 *
 * Reads only evidence.<field>.value for the same seven candidate-driving
 * fields it always has -- never evidence confidence/state/conflicts/
 * supportingObservations, and never a visual-only field. Card candidate
 * ranking stays OCR-only for as long as callers only ever pass
 * OCR-sourced evidence in; this function itself has no way to tell (or
 * care) which producer supplied a given field's value.
 */
export async function findCatalogCandidates(
  evidence: FusedEvidence,
): Promise<CatalogCandidate[]> {
  const playerName = evidence.playerName.value;
  const year = toYearNumber(evidence.year.value);
  const setName = resolveSetSearchText(evidence);
  const cardNumber = evidence.cardNumber.value;

  const pool = await searchCandidateCards({ playerName, year, setName, cardNumber });
  if (pool.length === 0) return [];

  const scored = await Promise.all(pool.map((card) => scoreCandidate(card, evidence)));

  // Array.prototype.sort is stable (ES2019+), so equal scores keep the
  // pool's original (deterministic, id-ordered) relative order.
  return scored.sort((a, b) => b.score - a.score).slice(0, MAX_CANDIDATES);
}

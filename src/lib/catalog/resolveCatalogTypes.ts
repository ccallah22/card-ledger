/**
 * Pure types shared by the /api/catalog/resolve-card route and its future
 * client caller. Deliberately has no runtime code and no "server-only"
 * import, so a client component can safely `import type` from this file
 * without pulling in anything server-only.
 *
 * CatalogResolutionInput is a narrow subset of MyCardInput
 * (src/lib/repositories/myCards.ts): only the fields resolveCatalogIds
 * actually reads today. It intentionally does NOT include manufacturer/
 * brand -- MyCardInput has no such fields, so the live "add missing card"
 * flow never populates them either, even though findOrCreateSet supports
 * resolving them when present (only the bulk catalog importer passes
 * them). Adding them here would widen the contract beyond what "the actual
 * fields needed by the current catalog resolution logic" covers.
 */
export type CatalogResolutionInput = {
  playerName: string;
  setName: string;
  year?: string | null;
  cardNumber?: string | null;

  // "Search -> Add to Collection" / manual catalog lookup: when the
  // collector explicitly selected a catalog card (selectedCard.id in
  // cards/new/page.tsx -- either via manual Set/Section/Card lookup or via
  // ?catalogCardId= URL preselection), this is that exact cards.id. It is
  // authoritative: when present, resolution uses this id directly instead
  // of re-deriving a card from playerName/setName/cardNumber, so stale or
  // guessed free-text fields can never redirect the save to a different
  // card than the one the collector explicitly picked. Absent for every
  // caller that has never made an explicit selection -- resolution then
  // runs exactly as it always has.
  catalogCardId?: number | null;

  checklistSectionId?: number | null;
  swatchDescriptor?: string | null;

  insert?: string | null;
  parallel?: string | null;
  variation?: string | null;

  serialTotal?: number | null;

  isRookie?: boolean;
  isAutograph?: boolean;
  isPatch?: boolean;

  location?: string | null;
  grader?: string | null;
};

/** Exactly the shape resolveCatalogIds already returns today -- unchanged. */
export type CatalogResolutionResult = {
  cardId: number;
  cardVariantId: number;
  locationId: number | null;
  gradingCompanyId: number | null;
};

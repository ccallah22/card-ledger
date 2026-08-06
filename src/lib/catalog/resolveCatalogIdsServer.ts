import "server-only";
import { resolveCatalogIds, type MyCardInput } from "@/lib/repositories/myCards";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { CatalogResolutionInput, CatalogResolutionResult } from "./resolveCatalogTypes";

/**
 * Server-only entry point for trusted catalog writes. Reuses
 * resolveCatalogIds (src/lib/repositories/myCards.ts) as-is -- the exact
 * same manufacturer/brand/set ordering, player resolution, card-number
 * collision handling, checklist-section-aware card resolution,
 * card_players linking, parallel-type resolution, card-variant resolution
 * (including swatch-descriptor identity), and find-before-create
 * normalization the browser flow already uses -- just with a service-role
 * client instead of the browser's anon-key client. No catalog identity or
 * collision logic is duplicated here.
 *
 * Resolves only shared catalog/lookup ids. Never touches user_cards, never
 * performs a save submission, never writes image/media rows -- callers
 * still own that step exactly as createMyCard does today.
 */
export async function resolveCatalogIdsServer(
  profileId: string,
  input: CatalogResolutionInput,
): Promise<CatalogResolutionResult> {
  const client = createServiceRoleClient();

  const mappedInput: MyCardInput = {
    playerName: input.playerName,
    setName: input.setName,
    year: input.year ?? undefined,
    cardNumber: input.cardNumber ?? undefined,
    checklistSectionId: input.checklistSectionId ?? undefined,
    swatchDescriptor: input.swatchDescriptor ?? undefined,
    insert: input.insert ?? undefined,
    parallel: input.parallel ?? undefined,
    variation: input.variation ?? undefined,
    serialTotal: input.serialTotal ?? undefined,
    isRookie: input.isRookie,
    isAutograph: input.isAutograph,
    isPatch: input.isPatch,
    location: input.location ?? undefined,
    grader: input.grader ?? undefined,
  };

  return resolveCatalogIds(profileId, mappedInput, client);
}

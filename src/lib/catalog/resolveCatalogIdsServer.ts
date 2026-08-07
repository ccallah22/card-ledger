import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findOrCreateSet } from "@/lib/repositories/sets";
import { findOrCreatePlayer } from "@/lib/repositories/players";
import {
  findCardBySetAndNumber,
  createCard,
  findOrCreateCardV2,
  type CardRow,
} from "@/lib/repositories/cards";
import { findOrCreateCardPlayer, listCardPlayers } from "@/lib/repositories/cardPlayers";
import { findOrCreateParallelType } from "@/lib/repositories/parallelTypes";
import {
  findOrCreateCardVariant,
  findOrCreateCardVariantV2,
} from "@/lib/repositories/cardVariants";
import { findOrCreateGradingCompany } from "@/lib/repositories/gradingCompanies";
import { findOrCreateLocation } from "@/lib/repositories/locations";
import type { MyCardInput } from "@/lib/repositories/myCards";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import type { CatalogResolutionInput, CatalogResolutionResult } from "./resolveCatalogTypes";

/**
 * Phase 2 correction: resolveCatalogIds/resolveCardForPlayer used to live in
 * src/lib/repositories/myCards.ts (imported from here with the browser
 * client as their default parameter). That worked functionally, but a
 * production build showed the catalog write calls (cards/sets/players/
 * card_variants/card_players/parallel_types/manufacturers/brands .insert(...))
 * still shipped in the /cards/new client bundle -- because these functions
 * stayed *exported* from a module the client also imports (for createMyCard),
 * webpack/Turbopack's tree-shaking didn't eliminate them just because
 * nothing in the client's call graph invoked them anymore. Moving the
 * actual implementations into this server-only file (`import "server-only"`)
 * means the client bundle's source graph can never contain them at all --
 * not "unreachable at runtime", physically absent. myCards.ts now only
 * calls the HTTP endpoint (resolveCatalogIdsViaApi) and no longer imports
 * any of the catalog findOrCreate* functions.
 *
 * The logic itself is unchanged from Phase 1/the original browser
 * implementation -- same manufacturer/brand/set ordering, player
 * resolution, card-number collision handling, checklist-section-aware card
 * resolution, card_players linking, parallel-type resolution, card-variant
 * resolution (including swatch-descriptor identity), and find-before-create
 * normalization. `client` is now a required parameter (no default) since
 * this file is only ever called with a service-role client.
 */

/**
 * (set_id, card_number) is unique at the database level, so a card number
 * can only ever point at one catalog `cards` row. If that row already has a
 * different player attached, we must not silently attach ours to it too
 * (that would misattribute the card for every existing owner). Instead we
 * walk forward to a disambiguated card_number ("1", "1~2", "1~3", ...) until
 * we land on a slot that's either free, or already scoped to this same
 * player -- reusing that slot for legitimate duplicate copies.
 */
async function resolveCardForPlayer(
  setId: number,
  cardNumber: string,
  playerId: number | null,
  cardFields: { title: string | null; rookie_card: boolean; is_insert: boolean },
  client: SupabaseClient,
): Promise<CardRow> {
  let candidateNumber = cardNumber;
  let attempt = 1;

  while (true) {
    const existing = await findCardBySetAndNumber(setId, candidateNumber, client);

    if (!existing) {
      return createCard(
        {
          set_id: setId,
          card_number: candidateNumber,
          ...cardFields,
        },
        client,
      );
    }

    if (playerId === null) {
      // No player being attached, so there's nothing to conflict with.
      return existing;
    }

    const links = await listCardPlayers(existing.id, client);
    if (links.length === 0 || links.some((l) => l.player_id === playerId)) {
      return existing;
    }

    attempt += 1;
    candidateNumber = `${cardNumber}~${attempt}`;
  }
}

async function resolveCatalogIds(profileId: string, input: MyCardInput, client: SupabaseClient) {
  const releaseYear = input.year ? Number.parseInt(input.year, 10) : NaN;

  const set = await findOrCreateSet(
    {
      name: input.setName,
      release_year: Number.isFinite(releaseYear) ? releaseYear : null,
    },
    client,
  );

  const trimmedPlayerName = input.playerName.trim();
  const player = trimmedPlayerName
    ? await findOrCreatePlayer({ full_name: trimmedPlayerName }, client)
    : null;

  // Catalog v2: when a checklist section is given, resolve the card through
  // the section-scoped identity instead of the v1 set-scoped
  // resolveCardForPlayer path. Omitted (the case for every existing caller
  // today) falls through to the exact existing Catalog v1 behavior.
  const card = input.checklistSectionId
    ? await findOrCreateCardV2(
        {
          checklistSectionId: input.checklistSectionId,
          setId: set.id,
          cardNumber: input.cardNumber ?? "",
          title: input.insert ?? null,
          isInsert: !!input.insert,
        },
        client,
      )
    : await resolveCardForPlayer(
        set.id,
        input.cardNumber ?? "",
        player?.id ?? null,
        {
          title: input.insert ?? null,
          rookie_card: input.isRookie ?? false,
          is_insert: !!input.insert,
        },
        client,
      );

  if (player) {
    await findOrCreateCardPlayer(card.id, player.id, "primary", client);
  }

  let parallelTypeId: number | null = null;
  if (input.parallel?.trim()) {
    const parallelType = await findOrCreateParallelType(input.parallel.trim(), client);
    parallelTypeId = parallelType.id;
  }

  // Catalog v2: when a swatch descriptor is given, resolve the variant
  // through the wider (card, parallel, print run, swatch descriptor)
  // identity instead of the v1 (card, parallel, print run) lookup. Omitted
  // falls through to the exact existing Catalog v1 behavior.
  const variant = input.swatchDescriptor
    ? await findOrCreateCardVariantV2(
        {
          cardId: card.id,
          parallelTypeId,
          printRun: input.serialTotal ?? null,
          swatchDescriptor: input.swatchDescriptor,
          isAutograph: input.isAutograph ?? false,
          isMemorabilia: input.isPatch ?? false,
        },
        client,
      )
    : await findOrCreateCardVariant(
        {
          card_id: card.id,
          parallel_type_id: parallelTypeId,
          print_run: input.serialTotal ?? null,
          name_override: input.variation ?? null,
          serial_numbered: !!input.serialTotal,
          has_autograph: input.isAutograph ?? false,
          has_memorabilia: input.isPatch ?? false,
        },
        client,
      );

  let locationId: number | null = null;
  if (input.location?.trim()) {
    const location = await findOrCreateLocation(profileId, input.location.trim(), client);
    locationId = location.id;
  }

  let gradingCompanyId: number | null = null;
  if (input.grader?.trim()) {
    const company = await findOrCreateGradingCompany(input.grader.trim(), client);
    gradingCompanyId = company.id;
  }

  return { cardId: card.id, cardVariantId: variant.id, locationId, gradingCompanyId };
}

/**
 * Server-only entry point for trusted catalog writes. Resolves only shared
 * catalog/lookup ids. Never touches user_cards, never performs a save
 * submission, never writes image/media rows -- callers still own that step
 * exactly as createMyCard does today.
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

import { supabase } from "@/lib/supabaseClient";
import type { CardCondition, CardComp, CardStatus, GradingStatus, ImageType } from "@/lib/types";
import { findOrCreateSet, getSet, type SetRow } from "@/lib/repositories/sets";
import { findOrCreatePlayer, type PlayerRow } from "@/lib/repositories/players";
import { findCardBySetAndNumber, createCard, getCard, type CardRow } from "@/lib/repositories/cards";
import { findOrCreateCardPlayer, listCardPlayers } from "@/lib/repositories/cardPlayers";
import { findOrCreateParallelType, type ParallelTypeRow } from "@/lib/repositories/parallelTypes";
import { findOrCreateCardVariant, type CardVariantRow } from "@/lib/repositories/cardVariants";
import { findOrCreateGradingCompany, type GradingCompanyRow } from "@/lib/repositories/gradingCompanies";
import { findOrCreateLocation, type LocationRow } from "@/lib/repositories/locations";
import {
  createUserCard,
  updateUserCard,
  deleteUserCard,
  deleteUserCards,
  getUserCard,
  type UserCardRow,
} from "@/lib/repositories/userCards";

/**
 * MyCard is the direct replacement for the legacy flat `SportsCard` type: a
 * UI-ready shape composed by joining a profile's `user_cards` row against the
 * shared catalog (cards -> sets, card_players -> players, card_variants ->
 * parallel_types) plus the profile's own locations/grading_companies.
 */
export type MyCard = {
  id: string;
  playerName: string;
  year: string;
  setName: string;
  cardNumber?: string;
  team?: string;

  location?: string;

  gradingStatus: GradingStatus;
  condition?: CardCondition;
  grader?: string;
  grade?: string;
  certNumber?: string;

  status: CardStatus;

  purchasePrice?: number;
  estimatedValue?: number;
  purchaseDate?: string;

  notes?: string;

  askingPrice?: number;
  soldPrice?: number;
  soldDate?: string;
  soldFees?: number;
  soldNotes?: string;

  variation?: string;
  insert?: string;
  parallel?: string;
  serialNumber?: number;
  serialTotal?: number;

  isRookie?: boolean;
  isAutograph?: boolean;
  isPatch?: boolean;

  comps?: CardComp[];

  imagePath?: string | null;
  imageShared?: boolean;
  imageType?: ImageType;
  thumbPath?: string | null;

  createdAt?: string;
  updatedAt?: string;
};

export type MyCardInput = {
  playerName: string;
  year?: string;
  setName: string;
  cardNumber?: string;
  team?: string;

  location?: string;

  gradingStatus?: GradingStatus;
  condition?: CardCondition;
  grader?: string;
  grade?: string;
  certNumber?: string;

  status?: CardStatus;

  purchasePrice?: number;
  estimatedValue?: number;
  purchaseDate?: string;

  notes?: string;

  askingPrice?: number;
  soldPrice?: number;
  soldDate?: string;
  soldFees?: number;
  soldNotes?: string;

  variation?: string;
  insert?: string;
  parallel?: string;
  serialNumber?: number;
  serialTotal?: number;

  isRookie?: boolean;
  isAutograph?: boolean;
  isPatch?: boolean;

  comps?: CardComp[];

  imagePath?: string | null;
  imageShared?: boolean;
  imageType?: ImageType;
  thumbPath?: string | null;
};

const SELECT = `
  *,
  cards!inner(*, sets(*), card_players(players(*))),
  card_variants(*, parallel_types(*)),
  locations(*),
  grading_companies(*)
`;

type UserCardJoined = UserCardRow & {
  cards:
    | (CardRow & {
        sets: SetRow | null;
        card_players: { players: PlayerRow | null }[] | null;
      })
    | null;
  card_variants: (CardVariantRow & { parallel_types: ParallelTypeRow | null }) | null;
  locations: LocationRow | null;
  grading_companies: GradingCompanyRow | null;
};

function toMyCard(row: UserCardJoined): MyCard {
  const card = row.cards;
  const set = card?.sets ?? null;
  const variant = row.card_variants ?? null;
  const parallelType = variant?.parallel_types ?? null;
  // A catalog card can legitimately have more than one linked player (dual
  // autos, team cards). Show all of them rather than blindly trusting
  // index 0, which would silently hide/misattribute a card's other player(s).
  const playerNames = (card?.card_players ?? [])
    .map((cp) => cp.players?.full_name)
    .filter((name): name is string => !!name);

  return {
    id: row.id,
    playerName: playerNames.join(" / "),
    year: set?.release_year != null ? String(set.release_year) : "",
    setName: set?.name ?? "",
    cardNumber: card?.card_number ?? undefined,
    team: row.team_name ?? undefined,

    location: row.locations?.name ?? undefined,

    gradingStatus: (row.grading_status as GradingStatus) ?? "RAW",
    condition: (row.condition as CardCondition) ?? undefined,
    grader: row.grading_companies?.name ?? undefined,
    grade: row.grade ?? undefined,
    certNumber: row.cert_number ?? undefined,

    status: (row.status as CardStatus) ?? "HAVE",

    purchasePrice: row.purchase_price ?? undefined,
    estimatedValue: row.estimated_value ?? undefined,
    purchaseDate: row.purchase_date ?? undefined,

    notes: row.notes ?? undefined,

    askingPrice: row.asking_price ?? undefined,
    soldPrice: row.sold_price ?? undefined,
    soldDate: row.sold_date ?? undefined,
    soldFees: row.sold_fees ?? undefined,
    soldNotes: row.sold_notes ?? undefined,

    variation: variant?.name_override ?? undefined,
    insert: card?.title ?? undefined,
    parallel: parallelType?.name ?? undefined,
    serialNumber: row.serial_number ?? undefined,
    serialTotal: variant?.print_run ?? undefined,

    isRookie: card?.rookie_card ?? undefined,
    isAutograph: variant?.has_autograph ?? undefined,
    isPatch: variant?.has_memorabilia ?? undefined,

    comps: row.comps ?? [],

    imagePath: row.image_path,
    imageShared: row.image_shared,
    imageType: (row.image_type as ImageType) ?? undefined,
    thumbPath: row.thumb_path,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMyCards(profileId: string): Promise<MyCard[]> {
  const { data, error } = await supabase
    .from("user_cards")
    .select(SELECT)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return ((data ?? []) as unknown as UserCardJoined[]).map(toMyCard);
}

export async function getMyCard(id: string): Promise<MyCard | null> {
  const { data, error } = await supabase
    .from("user_cards")
    .select(SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return toMyCard(data as unknown as UserCardJoined);
}

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
): Promise<CardRow> {
  let candidateNumber = cardNumber;
  let attempt = 1;

  while (true) {
    const existing = await findCardBySetAndNumber(setId, candidateNumber);

    if (!existing) {
      return createCard({
        set_id: setId,
        card_number: candidateNumber,
        ...cardFields,
      });
    }

    if (playerId === null) {
      // No player being attached, so there's nothing to conflict with.
      return existing;
    }

    const links = await listCardPlayers(existing.id);
    if (links.length === 0 || links.some((l) => l.player_id === playerId)) {
      return existing;
    }

    attempt += 1;
    candidateNumber = `${cardNumber}~${attempt}`;
  }
}

async function resolveCatalogIds(profileId: string, input: MyCardInput) {
  const releaseYear = input.year ? Number.parseInt(input.year, 10) : NaN;

  const set = await findOrCreateSet({
    name: input.setName,
    release_year: Number.isFinite(releaseYear) ? releaseYear : null,
  });

  const trimmedPlayerName = input.playerName.trim();
  const player = trimmedPlayerName
    ? await findOrCreatePlayer({ full_name: trimmedPlayerName })
    : null;

  const card = await resolveCardForPlayer(set.id, input.cardNumber ?? "", player?.id ?? null, {
    title: input.insert ?? null,
    rookie_card: input.isRookie ?? false,
    is_insert: !!input.insert,
  });

  if (player) {
    await findOrCreateCardPlayer(card.id, player.id);
  }

  let parallelTypeId: number | null = null;
  if (input.parallel?.trim()) {
    const parallelType = await findOrCreateParallelType(input.parallel.trim());
    parallelTypeId = parallelType.id;
  }

  const variant = await findOrCreateCardVariant({
    card_id: card.id,
    parallel_type_id: parallelTypeId,
    print_run: input.serialTotal ?? null,
    name_override: input.variation ?? null,
    serial_numbered: !!input.serialTotal,
    has_autograph: input.isAutograph ?? false,
    has_memorabilia: input.isPatch ?? false,
  });

  let locationId: number | null = null;
  if (input.location?.trim()) {
    const location = await findOrCreateLocation(profileId, input.location.trim());
    locationId = location.id;
  }

  let gradingCompanyId: number | null = null;
  if (input.grader?.trim()) {
    const company = await findOrCreateGradingCompany(input.grader.trim());
    gradingCompanyId = company.id;
  }

  return { cardId: card.id, cardVariantId: variant.id, locationId, gradingCompanyId };
}

export async function createMyCard(profileId: string, input: MyCardInput): Promise<MyCard> {
  const { cardId, cardVariantId, locationId, gradingCompanyId } = await resolveCatalogIds(
    profileId,
    input,
  );

  const row = await createUserCard({
    profile_id: profileId,
    card_id: cardId,
    card_variant_id: cardVariantId,
    location_id: locationId,
    team_name: input.team ?? null,
    serial_number: input.serialNumber ?? null,
    grading_status: input.gradingStatus ?? "RAW",
    condition: input.condition ?? null,
    grading_company_id: gradingCompanyId,
    grade: input.grade ?? null,
    cert_number: input.certNumber ?? null,
    status: input.status ?? "HAVE",
    purchase_price: input.purchasePrice ?? null,
    purchase_date: input.purchaseDate ?? null,
    purchase_source: null,
    estimated_value: input.estimatedValue ?? null,
    asking_price: input.askingPrice ?? null,
    sold_price: input.soldPrice ?? null,
    sold_date: input.soldDate ?? null,
    sold_fees: input.soldFees ?? null,
    sold_notes: input.soldNotes ?? null,
    quantity: 1,
    notes: input.notes ?? null,
    comps: input.comps ?? [],
    image_path: input.imagePath ?? null,
    thumb_path: input.thumbPath ?? null,
    image_shared: input.imageShared ?? false,
    image_type: input.imageType ?? null,
  });

  const full = await getMyCard(row.id);
  if (!full) throw new Error("Failed to load created card");
  return full;
}

const CATALOG_FIELDS = [
  "setName",
  "cardNumber",
  "playerName",
  "parallel",
  "variation",
  "serialTotal",
  "isAutograph",
  "isPatch",
  "year",
  "insert",
  "isRookie",
] as const;

export async function updateMyCard(
  profileId: string,
  id: string,
  input: Partial<MyCardInput>,
): Promise<MyCard> {
  const patch: Partial<UserCardRow> = {};

  const needsCatalogResolve = CATALOG_FIELDS.some((field) => input[field] !== undefined);

  if (needsCatalogResolve) {
    const existing = await getUserCard(id);
    if (!existing) throw new Error("Card not found");

    const existingCard = await getCard(existing.card_id);
    const existingSet = existingCard ? await getSet(existingCard.set_id) : null;

    const merged: MyCardInput = {
      playerName: input.playerName ?? "",
      year:
        input.year ??
        (existingSet?.release_year != null ? String(existingSet.release_year) : undefined),
      setName: input.setName ?? existingSet?.name ?? "",
      cardNumber: input.cardNumber ?? existingCard?.card_number ?? undefined,
      parallel: input.parallel,
      variation: input.variation,
      serialTotal: input.serialTotal,
      isAutograph: input.isAutograph,
      isPatch: input.isPatch,
      isRookie: input.isRookie,
      insert: input.insert,
    };

    const { cardId, cardVariantId } = await resolveCatalogIds(profileId, merged);
    patch.card_id = cardId;
    patch.card_variant_id = cardVariantId;
  }

  if (input.location !== undefined) {
    patch.location_id = input.location
      ? (await findOrCreateLocation(profileId, input.location)).id
      : null;
  }
  if (input.grader !== undefined) {
    patch.grading_company_id = input.grader
      ? (await findOrCreateGradingCompany(input.grader)).id
      : null;
  }

  if (input.team !== undefined) patch.team_name = input.team ?? null;
  if (input.serialNumber !== undefined) patch.serial_number = input.serialNumber ?? null;
  if (input.gradingStatus !== undefined) patch.grading_status = input.gradingStatus;
  if (input.condition !== undefined) patch.condition = input.condition ?? null;
  if (input.grade !== undefined) patch.grade = input.grade ?? null;
  if (input.certNumber !== undefined) patch.cert_number = input.certNumber ?? null;
  if (input.status !== undefined) patch.status = input.status;
  if (input.purchasePrice !== undefined) patch.purchase_price = input.purchasePrice ?? null;
  if (input.purchaseDate !== undefined) patch.purchase_date = input.purchaseDate ?? null;
  if (input.estimatedValue !== undefined) patch.estimated_value = input.estimatedValue ?? null;
  if (input.askingPrice !== undefined) patch.asking_price = input.askingPrice ?? null;
  if (input.soldPrice !== undefined) patch.sold_price = input.soldPrice ?? null;
  if (input.soldDate !== undefined) patch.sold_date = input.soldDate ?? null;
  if (input.soldFees !== undefined) patch.sold_fees = input.soldFees ?? null;
  if (input.soldNotes !== undefined) patch.sold_notes = input.soldNotes ?? null;
  if (input.notes !== undefined) patch.notes = input.notes ?? null;
  if (input.comps !== undefined) patch.comps = input.comps;
  if (input.imagePath !== undefined) patch.image_path = input.imagePath;
  if (input.thumbPath !== undefined) patch.thumb_path = input.thumbPath;
  if (input.imageShared !== undefined) patch.image_shared = input.imageShared;
  if (input.imageType !== undefined) patch.image_type = input.imageType ?? null;

  await updateUserCard(id, patch);

  const full = await getMyCard(id);
  if (!full) throw new Error("Card not found after update");
  return full;
}

export async function deleteMyCard(id: string): Promise<void> {
  await deleteUserCard(id);
}

export async function deleteMyCards(ids: string[]): Promise<void> {
  await deleteUserCards(ids);
}

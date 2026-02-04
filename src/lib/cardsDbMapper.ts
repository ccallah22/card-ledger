// src/lib/cardsDbMapper.ts
import type { SportsCard } from "@/lib/types";

// DB row shape (snake_case)
export type CardsV1Row = {
  id: string;
  user_id: string;

  player_name: string;
  year: string;
  set_name: string;
  card_number: string | null;
  team: string | null;

  location: string | null;

  condition: string;
  grader: string | null;
  grade: string | null;

  status: string;

  purchase_price: number | null;
  purchase_date: string | null; // YYYY-MM-DD

  variation: string | null;
  insert_name: string | null;
  parallel: string | null;

  serial_number: number | null;
  serial_total: number | null;

  is_rookie: boolean | null;
  is_autograph: boolean | null;
  is_patch: boolean | null;

  notes: string | null;

  image_path: string | null;
  image_shared: boolean | null;
  image_is_front: boolean | null;
  image_is_slabbed: boolean | null;
  image_type: string | null;

  created_at: string;
  updated_at: string;
};

// SportsCard -> DB insert/upsert object
export function toCardsV1Insert(card: SportsCard, userId: string): Partial<CardsV1Row> {
  return {
    id: String(card.id),
    user_id: userId,

    player_name: card.playerName,
    year: String(card.year),
    set_name: card.setName,
    card_number: card.cardNumber ?? null,
    team: card.team ?? null,

    location: (card as any).location ?? null,

    condition: card.condition ?? "RAW",
    grader: card.grader ?? null,
    grade: card.grade ?? null,

    status: card.status ?? "HAVE",

    purchase_price: card.purchasePrice ?? null,
    purchase_date: card.purchaseDate ?? null,

    variation: card.variation ?? null,
    insert_name: card.insert ?? null,
    parallel: card.parallel ?? null,

    serial_number: card.serialNumber ?? null,
    serial_total: card.serialTotal ?? null,

    is_rookie: card.isRookie ?? null,
    is_autograph: card.isAutograph ?? null,
    is_patch: (card as any).isPatch ?? null,

    notes: card.notes ?? null,

    // images later (keep null for now)
    image_path: null,
    image_shared: (card as any).imageShared ?? null,
    image_is_front: (card as any).imageIsFront ?? null,
    image_is_slabbed: (card as any).imageIsSlabbed ?? null,
    image_type: (card as any).imageType ?? null,
  };
}

// DB row -> SportsCard
export function fromCardsV1Row(row: CardsV1Row): SportsCard {
  return {
    id: row.id,
    playerName: row.player_name,
    year: row.year,
    setName: row.set_name,
    cardNumber: row.card_number ?? undefined,
    team: row.team ?? undefined,

    location: row.location ?? undefined,

    condition: (row.condition as any) ?? "RAW",
    grader: row.grader ?? undefined,
    grade: row.grade ?? undefined,

    status: (row.status as any) ?? "HAVE",

    purchasePrice: row.purchase_price ?? undefined,
    purchaseDate: row.purchase_date ?? undefined,

    variation: row.variation ?? undefined,
    insert: row.insert_name ?? undefined,
    parallel: row.parallel ?? undefined,

    serialNumber: row.serial_number ?? undefined,
    serialTotal: row.serial_total ?? undefined,

    isRookie: row.is_rookie ?? undefined,
    isAutograph: row.is_autograph ?? undefined,
    isPatch: row.is_patch ?? undefined,

    notes: row.notes ?? undefined,

    // images later
    imageShared: row.image_shared ?? undefined,
    imageIsFront: row.image_is_front ?? undefined,
    imageIsSlabbed: row.image_is_slabbed ?? undefined,
    imageType: row.image_type ?? undefined,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as SportsCard;
}

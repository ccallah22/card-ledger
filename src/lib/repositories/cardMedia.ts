import { supabase } from "@/lib/supabaseClient";

// Vision Engine V2, Phase 2: repository for the additive `card_media` table
// (see 202607100002_vision_engine_v2_card_media.sql). Nothing in the app
// reads or writes this table yet -- these functions are unused foundation,
// following the same "modify only the minimum files necessary" discipline
// used for the earlier Catalog v2 lookup foundations.

export type CardMediaSide = "front" | "back" | "none";
export type CardMediaType = "image";
export type CardMediaProcessingStatus =
  | "uploaded"
  | "cropped"
  | "ocr_complete"
  | "vision_complete"
  | "catalog_matched"
  | "verified"
  | "failed";

// A side value that actually identifies a single row (the unique
// (user_card_id, media_type, side) index only applies when side <> 'none').
// Functions that operate on exactly one record are typed to this narrower
// union so passing "none" is a compile-time error, not just a runtime one.
type SidedCardMediaSide = Exclude<CardMediaSide, "none">;

// Minimal safe JSON type for ocr_output/vision_output -- avoids `any` while
// still accepting whatever JSON-shaped result those future features produce.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type CardMediaRow = {
  id: number;
  user_card_id: string;
  media_type: CardMediaType;
  side: CardMediaSide;
  is_slabbed: boolean;

  original_path: string | null;
  processed_path: string | null;
  thumbnail_path: string | null;

  ocr_output: JsonValue | null;
  vision_output: JsonValue | null;

  catalog_match_id: number | null;
  confidence_score: number | null;

  image_content_hash: string | null;
  processing_status: CardMediaProcessingStatus;

  created_at: string;
  updated_at: string;
};

export type CardMedia = {
  id: number;
  userCardId: string;
  mediaType: CardMediaType;
  side: CardMediaSide;
  isSlabbed: boolean;

  originalPath: string | null;
  processedPath: string | null;
  thumbnailPath: string | null;

  ocrOutput: JsonValue | null;
  visionOutput: JsonValue | null;

  catalogMatchId: number | null;
  confidenceScore: number | null;

  imageContentHash: string | null;
  processingStatus: CardMediaProcessingStatus;

  createdAt: string;
  updatedAt: string;
};

export type CreateCardMediaInput = {
  userCardId: string;
  mediaType?: CardMediaType;
  side?: CardMediaSide;
  isSlabbed?: boolean;

  originalPath?: string | null;
  processedPath?: string | null;
  thumbnailPath?: string | null;

  ocrOutput?: JsonValue | null;
  visionOutput?: JsonValue | null;

  catalogMatchId?: number | null;
  confidenceScore?: number | null;

  imageContentHash?: string | null;
  processingStatus?: CardMediaProcessingStatus;
};

export type UpdateCardMediaInput = Partial<{
  mediaType: CardMediaType;
  side: CardMediaSide;
  isSlabbed: boolean;

  originalPath: string | null;
  processedPath: string | null;
  thumbnailPath: string | null;

  ocrOutput: JsonValue | null;
  visionOutput: JsonValue | null;

  catalogMatchId: number | null;
  confidenceScore: number | null;

  imageContentHash: string | null;
  processingStatus: CardMediaProcessingStatus;
}>;

export type UpsertCardMediaBySideInput = Omit<CreateCardMediaInput, "side"> & {
  side: SidedCardMediaSide;
};

function mapCardMediaRow(row: CardMediaRow): CardMedia {
  return {
    id: row.id,
    userCardId: row.user_card_id,
    mediaType: row.media_type,
    side: row.side,
    isSlabbed: row.is_slabbed,

    originalPath: row.original_path,
    processedPath: row.processed_path,
    thumbnailPath: row.thumbnail_path,

    ocrOutput: row.ocr_output,
    visionOutput: row.vision_output,

    catalogMatchId: row.catalog_match_id,
    confidenceScore: row.confidence_score,

    imageContentHash: row.image_content_hash,
    processingStatus: row.processing_status,

    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function assertValidConfidence(value: number | null | undefined): void {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `card_media confidenceScore must be between 0 and 1 (received ${value}).`,
    );
  }
}

// The unique (user_card_id, media_type, side) index only covers side <>
// 'none' -- 'none' intentionally allows multiple rows per card, so there is
// no single record for a by-side lookup/update/delete to target.
function assertSidedSide(side: CardMediaSide): asserts side is SidedCardMediaSide {
  if (side !== "front" && side !== "back") {
    throw new Error(
      `card_media side "${side}" is not supported by this operation -- "none" permits multiple rows per user card, so there is no single record to target. Use listCardMediaForUserCard instead.`,
    );
  }
}

function toInsertRow(input: CreateCardMediaInput) {
  assertValidConfidence(input.confidenceScore ?? null);

  return {
    user_card_id: input.userCardId,
    media_type: input.mediaType ?? "image",
    side: input.side ?? "none",
    is_slabbed: input.isSlabbed ?? false,

    original_path: input.originalPath ?? null,
    processed_path: input.processedPath ?? null,
    thumbnail_path: input.thumbnailPath ?? null,

    ocr_output: input.ocrOutput ?? null,
    vision_output: input.visionOutput ?? null,

    catalog_match_id: input.catalogMatchId ?? null,
    confidence_score: input.confidenceScore ?? null,

    image_content_hash: input.imageContentHash ?? null,
    processing_status: input.processingStatus ?? "uploaded",
  };
}

// Only includes keys the caller actually provided, so omitted fields are
// left untouched by Postgres rather than being reset to null/default.
function toUpdatePatch(input: UpdateCardMediaInput) {
  if (input.confidenceScore !== undefined) assertValidConfidence(input.confidenceScore);

  const patch: Record<string, unknown> = {};

  if (input.mediaType !== undefined) patch.media_type = input.mediaType;
  if (input.side !== undefined) patch.side = input.side;
  if (input.isSlabbed !== undefined) patch.is_slabbed = input.isSlabbed;

  if (input.originalPath !== undefined) patch.original_path = input.originalPath;
  if (input.processedPath !== undefined) patch.processed_path = input.processedPath;
  if (input.thumbnailPath !== undefined) patch.thumbnail_path = input.thumbnailPath;

  if (input.ocrOutput !== undefined) patch.ocr_output = input.ocrOutput;
  if (input.visionOutput !== undefined) patch.vision_output = input.visionOutput;

  if (input.catalogMatchId !== undefined) patch.catalog_match_id = input.catalogMatchId;
  if (input.confidenceScore !== undefined) patch.confidence_score = input.confidenceScore;

  if (input.imageContentHash !== undefined) patch.image_content_hash = input.imageContentHash;
  if (input.processingStatus !== undefined) patch.processing_status = input.processingStatus;

  return patch;
}

const SIDE_SORT_ORDER: Record<CardMediaSide, number> = { front: 0, back: 1, none: 2 };

export async function listCardMediaForUserCard(userCardId: string): Promise<CardMedia[]> {
  const { data, error } = await supabase
    .from("card_media")
    .select("*")
    .eq("user_card_id", userCardId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const rows = (data ?? []) as CardMediaRow[];

  return rows
    .slice()
    .sort(
      (a, b) =>
        SIDE_SORT_ORDER[a.side] - SIDE_SORT_ORDER[b.side] ||
        a.created_at.localeCompare(b.created_at),
    )
    .map(mapCardMediaRow);
}

export async function getCardMediaBySide(
  userCardId: string,
  side: SidedCardMediaSide,
): Promise<CardMedia | null> {
  assertSidedSide(side);

  const { data, error } = await supabase
    .from("card_media")
    .select("*")
    .eq("user_card_id", userCardId)
    .eq("media_type", "image")
    .eq("side", side)
    .maybeSingle();

  if (error) throw error;

  return data ? mapCardMediaRow(data as CardMediaRow) : null;
}

export async function createCardMedia(input: CreateCardMediaInput): Promise<CardMedia> {
  const { data, error } = await supabase
    .from("card_media")
    .insert(toInsertRow(input))
    .select("*")
    .single();

  if (error) throw error;

  return mapCardMediaRow(data as CardMediaRow);
}

export async function updateCardMedia(
  id: number,
  input: UpdateCardMediaInput,
): Promise<CardMedia> {
  const { data, error } = await supabase
    .from("card_media")
    .update(toUpdatePatch(input))
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;

  return mapCardMediaRow(data as CardMediaRow);
}

// Finds the existing front/back row for this user card and updates it, or
// creates one if none exists yet. This is a find-then-write upsert (the
// same idiom already used by findOrCreateCardVariantV2 etc. in
// cardVariants.ts), not a single atomic `ON CONFLICT` upsert: the
// uniqueness guarantee lives on a *partial* unique index (`where side <>
// 'none'`), and Supabase/PostgREST's upsert conflict-target option can't
// express that partial predicate. The database constraint still backstops
// this against a genuine race -- a duplicate insert surfaces as a thrown
// Postgres unique-violation error rather than silently corrupting data.
export async function upsertCardMediaBySide(
  input: UpsertCardMediaBySideInput,
): Promise<CardMedia> {
  assertSidedSide(input.side);
  assertValidConfidence(input.confidenceScore ?? null);

  const existing = await getCardMediaBySide(input.userCardId, input.side);

  if (existing) {
    return updateCardMedia(existing.id, {
      isSlabbed: input.isSlabbed,
      originalPath: input.originalPath,
      processedPath: input.processedPath,
      thumbnailPath: input.thumbnailPath,
      ocrOutput: input.ocrOutput,
      visionOutput: input.visionOutput,
      catalogMatchId: input.catalogMatchId,
      confidenceScore: input.confidenceScore,
      imageContentHash: input.imageContentHash,
      processingStatus: input.processingStatus,
    });
  }

  return createCardMedia(input);
}

export async function deleteCardMedia(id: number): Promise<void> {
  const { error } = await supabase.from("card_media").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteCardMediaBySide(
  userCardId: string,
  side: SidedCardMediaSide,
): Promise<void> {
  assertSidedSide(side);

  const { error } = await supabase
    .from("card_media")
    .delete()
    .eq("user_card_id", userCardId)
    .eq("media_type", "image")
    .eq("side", side);

  if (error) throw error;
}

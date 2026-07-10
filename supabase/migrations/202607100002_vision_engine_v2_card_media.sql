-- Vision Engine V2, Phase 1: additive media schema.
--
-- Introduces card_media, the future home for independently-stored front/back
-- card images (and later video/document media), each with its own upload,
-- crop, OCR, vision, and catalog-match results. See the Vision Engine V2
-- design doc (four-phase architecture review) for the full rationale.
--
-- This migration ONLY adds capability. It does not remove or modify
-- anything that already exists:
--   - user_cards.image_path/thumb_path/image_shared/image_type are
--     untouched. The existing single-image upload/display flow keeps
--     working exactly as it does today; nothing yet reads from or writes to
--     card_media.
--   - No backfill of existing images into card_media happens here -- that
--     is a later, separate phase once the UI and repositories exist.
--
-- Naming note: image_content_hash is a future per-image perceptual/pixel
-- fingerprint of one specific photo. It is intentionally distinct from the
-- existing card-identity fingerprint built by src/lib/fingerprint.ts
-- (year/set/card#/player/etc.), which is not renamed or touched here.

begin;

create table public.card_media (
  id bigserial primary key,
  user_card_id uuid not null references public.user_cards(id) on delete cascade,

  -- 'image' is the only supported value today. Kept as a checked text
  -- column (matching the project's existing grading_status/status
  -- convention) rather than a Postgres enum, so a later additive migration
  -- can widen the check constraint to add 'video'/'document' without a
  -- column type change.
  media_type text not null default 'image',

  -- 'none' is for future non-sided media (e.g. a document) and is exempt
  -- from the one-row-per-side uniqueness rule below.
  side text not null default 'none',
  is_slabbed boolean not null default false,

  original_path text,
  processed_path text,
  thumbnail_path text,

  ocr_output jsonb,
  vision_output jsonb,

  -- Exact catalog identity match. card_variants is the most granular
  -- existing catalog entity (card_id + parallel_type_id + print_run +
  -- swatch_descriptor), so it's the correct target for "this photo matches
  -- this exact catalog variant." on delete set null mirrors
  -- user_cards.card_variant_id's existing behavior: if a catalog variant is
  -- ever removed/restructured, the media row survives with its match
  -- cleared rather than being deleted.
  catalog_match_id bigint references public.card_variants(id) on delete set null,

  -- 0-1 scale: matches the existing convention already used by the OCR and
  -- image-check API routes (src/app/api/image-check/route.ts's
  -- CARD_CONFIDENCE thresholds of 0.75/0.55/0.6, and the OCR route's
  -- 0.8/0 heuristic), not 0-100.
  confidence_score numeric,

  image_content_hash text,
  processing_status text not null default 'uploaded',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint card_media_media_type_check check (media_type in ('image')),
  constraint card_media_side_check check (side in ('front', 'back', 'none')),
  constraint card_media_processing_status_check check (
    processing_status in (
      'uploaded', 'cropped', 'ocr_complete', 'vision_complete',
      'catalog_matched', 'verified', 'failed'
    )
  ),
  constraint card_media_confidence_score_check check (
    confidence_score is null or (confidence_score >= 0 and confidence_score <= 1)
  )
);

create index card_media_user_card_id_idx on public.card_media (user_card_id);
create index card_media_catalog_match_id_idx on public.card_media (catalog_match_id);

-- One active image per side per user card. A slabbed front photo and a raw
-- front photo are alternate states of the same "front" slot (mirroring the
-- current app's mutually-exclusive front/back/slab_front/slab_back radio
-- group), not two independent slots -- so is_slabbed is intentionally left
-- out of this key. side = 'none' rows are exempt via the partial index
-- predicate, since future non-sided media isn't limited to one per card.
create unique index card_media_user_card_media_type_side_key
  on public.card_media (user_card_id, media_type, side)
  where side <> 'none';

-- No updated_at trigger function exists anywhere in this project's
-- migrations (every table relies on the default now() at insert time and
-- leaves updates to application code) -- so this table follows that same
-- existing convention rather than introducing a new one.

alter table public.card_media enable row level security;

-- Ownership is indirect (card_media -> user_cards -> profile_id), following
-- the exact pattern already established by card_value_snapshots in
-- 202607050001_user_collections.sql.
create policy "read own card media" on public.card_media
  for select using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_media.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "insert own card media" on public.card_media
  for insert with check (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_media.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "update own card media" on public.card_media
  for update using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_media.user_card_id and uc.profile_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_media.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "delete own card media" on public.card_media
  for delete using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_media.user_card_id and uc.profile_id = auth.uid()
    )
  );

commit;

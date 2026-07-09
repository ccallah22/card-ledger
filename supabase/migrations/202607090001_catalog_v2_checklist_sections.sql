-- Catalog v2, Phase 1B: additive-only migration.
--
-- Introduces checklist_sections (the level between sets and cards that the
-- real 2025 Select Football checklist proved is required -- one release is
-- one Set, but its 44 checklist sections each restart card numbering from
-- 1, which the old (set_id, card_number) identity can't represent) and the
-- new (checklist_section_id, card_number) card identity, plus
-- swatch_descriptor and the widened card_variants identity it needs.
--
-- This migration ONLY adds capability. It does not remove or modify
-- anything that already exists:
--   - cards.checklist_section_id is nullable here (no backfill in this
--     migration), so any existing cards rows simply have it unset. Multiple
--     rows with a null checklist_section_id do not violate the new unique
--     constraint below -- Postgres does not treat NULL as equal to NULL for
--     uniqueness purposes, so this is safe even before a backfill happens.
--   - cards.set_id, cards.is_insert, and the original
--     cards_set_id_card_number_key constraint all remain exactly as they
--     are.
--   - card_variants.swatch_descriptor is nullable, and the original
--     card_variants_card_id_parallel_type_id_print_run_key constraint
--     remains exactly as it is.
--
-- A later migration will backfill checklist_section_id for any existing
-- rows, make it not null, and retire the old constraints/is_insert once
-- every application reader has moved onto the new shape -- see
-- docs/database/catalog-v2-migration-plan.md for that full sequence.
--
-- See also docs/architecture/catalog-v2-spec.md and
-- docs/architecture/catalog-v2-erd.md for the design this implements.

begin;

create table public.checklist_sections (
  id bigserial primary key,
  set_id bigint not null references public.sets(id) on delete restrict,

  name text not null,
  slug text not null,
  section_category text not null,

  sort_order integer,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint checklist_sections_set_id_slug_key unique (set_id, slug)
);

alter table public.cards
  add column checklist_section_id bigint references public.checklist_sections(id) on delete restrict;

alter table public.cards
  add constraint cards_checklist_section_id_card_number_key
  unique (checklist_section_id, card_number);

alter table public.card_variants
  add column swatch_descriptor text;

alter table public.card_variants
  add constraint card_variants_uniqueness_key
  unique (card_id, parallel_type_id, print_run, swatch_descriptor);

commit;

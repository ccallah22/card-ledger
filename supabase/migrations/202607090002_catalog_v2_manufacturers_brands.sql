-- Catalog v2, Phase 3C: additive-only migration.
--
-- Introduces manufacturers/brands as first-class tables, closing the open
-- question from docs/architecture/catalog-v2-erd.md (the importer already
-- builds Manufacturer/Brand as their own deduplicated entities; the
-- database had no destination table for them). See
-- docs/database/manufacturer-brand-normalization-plan.md for the full
-- design and rationale.
--
-- This migration ONLY adds capability. It does not remove or modify
-- anything that already exists:
--   - sets.manufacturer_id/brand_id are nullable here, with no backfill --
--     any existing sets rows simply have them unset. Multiple rows with a
--     null manufacturer_id/brand_id do not violate anything, since neither
--     column has a uniqueness constraint of its own (Postgres also would
--     not treat two NULLs as equal even if it did).
--   - sets.manufacturer and sets.brand (the existing free-text columns)
--     remain exactly as they are -- not touched, not deprecated in schema,
--     still fully readable/writable by existing code.
--
-- A later migration will backfill manufacturer_id/brand_id from the
-- existing free-text values, make the new columns not null, and retire
-- sets.manufacturer/sets.brand once every application reader has moved
-- onto the normalized tables -- see
-- docs/database/manufacturer-brand-normalization-plan.md's migration order
-- for that full sequence. Repository changes are explicitly out of scope
-- for this migration.

begin;

create table public.manufacturers (
  id bigserial primary key,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint manufacturers_name_key unique (name),
  constraint manufacturers_slug_key unique (slug)
);

create table public.brands (
  id bigserial primary key,
  manufacturer_id bigint not null references public.manufacturers(id) on delete restrict,

  name text not null,
  slug text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint brands_manufacturer_id_slug_key unique (manufacturer_id, slug)
);

alter table public.sets
  add column manufacturer_id bigint references public.manufacturers(id) on delete restrict;

alter table public.sets
  add column brand_id bigint references public.brands(id) on delete restrict;

commit;

# Manufacturer/Brand Normalization Plan

Phase 3B of [catalog-v2-implementation.md](../roadmap/catalog-v2-implementation.md). Answers the open question first raised in [catalog-v2-erd.md](../architecture/catalog-v2-erd.md)'s risks section: should `manufacturers`/`brands` become real tables, or stay as free text on `sets`? This document decides it, ahead of the first real import (2025 Select Football). No migration is created and no code is changed here.

## 1. Current schema state

Confirmed directly against `supabase/migrations/202607040001_thebinder_database_v1.sql`:

```
sets.manufacturer   text   (nullable, free text, no constraint)
sets.brand          text   (nullable, free text, no constraint)
```

No `manufacturers` or `brands` table exists anywhere in the migration history. `docs/architecture/database.md`'s aspirational design already lists `manufacturers`/`brands` as top-level catalog tables, but that was never actually migrated — this plan closes that gap.

The importer already disagrees with the database on this point: `build-catalog-entities.ts` builds `Manufacturer`/`Brand` as their own deduplicated in-memory entity collections (confirmed: exactly 1 manufacturer, 1 brand for the real 2025 Select Football file), and `write-catalog-v2.ts`'s dependency order already lists `manufacturers`/`brands` ahead of `sets` — but its own shaping functions currently print an explicit caveat that no destination table exists yet, because none does.

## 2. Proposed schema

```sql
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

alter table public.sets add column manufacturer_id bigint references public.manufacturers(id) on delete restrict;
alter table public.sets add column brand_id bigint references public.brands(id) on delete restrict;
```

`manufacturers.name` is globally unique (manufacturers are a small, genuinely global vocabulary — "Panini" means the same thing everywhere). `brands` is scoped per-manufacturer, not globally unique — a brand name is only guaranteed distinct within its own manufacturer (mirrors exactly how `checklist_sections` is scoped per-`set_id` rather than globally, for the same reason: the narrower entity's name only has to be unique within its parent).

## 3. Keep old text columns temporarily?

**Yes.** `sets.manufacturer`/`sets.brand` stay exactly as they are in this migration — nullable, unconstrained, untouched. `sets.manufacturer_id`/`sets.brand_id` are added as new, nullable columns alongside them. This mirrors the exact pattern already used successfully for `checklist_sections`/`cards.checklist_section_id` in the Phase 1B migration: add the new capability without removing the old one, so nothing breaks for readers that haven't been updated yet. The old text columns are dropped in a later, separate migration once every reader (`cards.ts`'s `CARD_CONTEXT_SELECT`, `useSetLookup.ts`, the orphaned checklists admin feature) has moved onto the FK-based fields — not in the same migration that introduces them.

## 4. Unique constraints

| Constraint | Scope |
|---|---|
| `manufacturers_name_key` unique `(name)` | Global — manufacturers are a small, shared vocabulary |
| `manufacturers_slug_key` unique `(slug)` | Global |
| `brands_manufacturer_id_slug_key` unique `(manufacturer_id, slug)` | Per-manufacturer — a brand name is only unique within its own manufacturer |

No change to any existing constraint on `sets` (`sets_slug_key` stays exactly as is).

## 5. Foreign keys

| FK | Delete behavior |
|---|---|
| `brands.manufacturer_id → manufacturers(id)` | `restrict` |
| `sets.manufacturer_id → manufacturers(id)` | `restrict` |
| `sets.brand_id → brands(id)` | `restrict` |

`restrict` matches every other catalog FK in this schema — a manufacturer/brand can't be deleted while a set still references it.

## 6. Migration order

1. `create table manufacturers` (new, no dependents — zero risk).
2. `create table brands` (depends on `manufacturers`, still new — zero risk).
3. `alter table sets add column manufacturer_id` — nullable, no backfill in this migration.
4. `alter table sets add column brand_id` — nullable, no backfill in this migration.
5. **(Separate, later migration.)** Backfill `sets.manufacturer_id`/`brand_id` from the existing `sets.manufacturer`/`sets.brand` text values (resolving or creating the matching `manufacturers`/`brands` rows for each distinct value), then make both columns `not null`, then drop `sets.manufacturer`/`sets.brand` — only once every reader has migrated off the text columns. This exactly mirrors the deferred backfill/not-null/drop sequence already planned (and executed in its first slice) for `checklist_sections`/`cards.checklist_section_id`.

Steps 1–4 are the only ones recommended for the next migration. They're purely additive — same shape as the Phase 1B migration that already shipped cleanly.

## 7. Repository changes needed

- **New `src/lib/repositories/manufacturers.ts`**: `ManufacturerRow`, `listManufacturers`, `findManufacturerByName` (or slug), `createManufacturer`, `findOrCreateManufacturer` — same shape as `parallelTypes.ts` (a small global lookup).
- **New `src/lib/repositories/brands.ts`**: `BrandRow`, `findBrandBySlug(manufacturerId, slug)`, `createBrand`, `findOrCreateBrand` — same shape as `checklistSections.ts` (scoped-by-parent lookup).
- **`sets.ts`**: `SetRow` gains `manufacturer_id: number | null` and `brand_id: number | null`. `CreateSetInput`/`createSet`/`findOrCreateSet` need a decision: either (a) keep accepting `manufacturer`/`brand` as plain strings and resolve them to ids internally via `findOrCreateManufacturer`/`findOrCreateBrand` before inserting (preserves the existing call-site shape everywhere `findOrCreateSet` is already called, e.g. `myCards.ts`), or (b) require callers to resolve and pass `manufacturer_id`/`brand_id` directly. **Recommend (a)** — it's the same "resolve inside the repository function" pattern `myCards.ts`'s `resolveCatalogIds` already uses for players/locations/grading companies, and it means zero existing caller needs to change at all.

## 8. Import writer changes needed

- **`write-catalog-v2.ts`**: `shapeManufacturer`/`shapeBrand` lose their "no dedicated table" caveat and become real, unconditional planned inserts. `shapeSet` changes from embedding `manufacturer`/`brand` as inline text (read off the in-memory `Manufacturer`/`Brand` entities purely for display) to instead emitting `manufacturer_ref`/`brand_ref` placeholders — following the exact same `*_ref`-placeholder convention every other FK in that file already uses. No change to `build-catalog-entities.ts` itself — it already builds `Manufacturer`/`Brand` as first-class entities; this migration just gives the writer a real table to eventually target.

## 9. UI/search impact

- **`cards.ts`**: `CARD_CONTEXT_SELECT` currently reads `sets(name, release_year, brand, manufacturer)` directly off the text columns. Once normalized, it should join `sets(name, release_year, brands(name), manufacturers(name))` (or keep reading the text columns during the transition window described in §3, then switch once the backfill lands). `CardWithContext.setBrand`/`setManufacturer` stay the same shape (plain strings) either way — this is an internal query change, not a type change, so `catalog/cards/[id]/page.tsx` (which displays `card.setBrand`/`card.setManufacturer`) needs no change at all.
- **`useSetLookup.ts`**: reads `s.brand` directly off `SetRow` for the Add Card page's set-search autocomplete scoring. This is the one real UI-adjacent consumer that reads the text column directly rather than through a display-shaped type — it should be revisited once `sets.brand` text is retired (not urgent now, since §3 keeps the text column alive during the transition).
- **`rankingEngine.ts`**: does not currently score brand/manufacturer at all (already noted in its own comments as a "later phase") — unaffected either way.
- The orphaned checklists admin feature (`src/app/admin/checklists/page.tsx`, `src/app/api/checklists/import/route.ts`) also writes to `sets.brand` as free text, but it's already disconnected from the real catalog tables (targets tables that don't exist) — out of scope here, consistent with how it's been treated throughout this initiative.

## 10. Risks and recommendation

**Risk level: Low-Medium.** Lower than the `checklist_sections` migration, for two reasons: (1) `manufacturers`/`brands` are small, low-cardinality, low-churn lookup tables (1 manufacturer, 1 brand for the entire real Select Football file) — there's very little room for a modeling mistake to cause real damage; (2) the phased approach in §3/§6 (additive first, backfill/drop deferred) is now a proven pattern from Phase 1B, not a first attempt.

**Recommendation: normalize now, before the first real import.** The importer (`build-catalog-entities.ts`) already treats manufacturer/brand as first-class entities, and the writer (`write-catalog-v2.ts`) is already structured to insert them in the correct dependency order — the only missing piece is the destination table. Doing this now means the 2025 Select Football import writes directly into the correct normalized shape from the start, rather than importing into text columns and needing a backfill/migration later against real, already-imported data. This is a "do it before, not after" case: the cost of normalizing now (two new small tables, two new nullable columns) is low, and the cost of normalizing later (after real rows exist referencing free-text values) is strictly higher.

---

No migrations were created, no application code was changed, no database connection was made, and nothing was committed as part of this document.

# Catalog v2 Database Migration Plan

Phase 1A of [catalog-v2-implementation.md](../roadmap/catalog-v2-implementation.md). This document specifies the exact migration to be implemented in Phase 1 — no SQL is written here, no migration file exists yet, and no schema/code has changed. See [catalog-v2-spec.md](../architecture/catalog-v2-spec.md) and [catalog-v2-erd.md](../architecture/catalog-v2-erd.md) for the design rationale behind these choices.

## 1. Current schema

Exact column lists as defined in `supabase/migrations/202607040001_thebinder_database_v1.sql` and `202607050001_user_collections.sql` (re-verified against the migration files directly, not from memory).

**`sets`**
```
id               bigserial primary key
sport_id         bigint references sports(id) on delete restrict   (nullable)
league_id        bigint references leagues(id) on delete restrict  (nullable)
name             text not null
manufacturer     text                                              (nullable, free text)
brand            text                                              (nullable, free text)
release_year     integer
season           text
slug             text not null
search_text      text
created_at       timestamptz not null default now()
updated_at       timestamptz not null default now()

unique (slug)                                    -- sets_slug_key
```

**`cards`**
```
id               bigserial primary key
set_id           bigint not null references sets(id) on delete restrict
card_number      text not null
title            text
rookie_card      boolean not null default false
printed_year     integer
release_year     integer
is_insert        boolean not null default false
is_autograph     boolean not null default false
is_memorabilia   boolean not null default false
search_text      text
created_at       timestamptz not null default now()
updated_at       timestamptz not null default now()

unique (set_id, card_number)                     -- cards_set_id_card_number_key
```

**`card_variants`**
```
id               bigserial primary key
card_id          bigint not null references cards(id) on delete cascade
parallel_type_id bigint references parallel_types(id) on delete restrict  (nullable)
name_override    text
serial_numbered  boolean not null default false
print_run        integer
has_autograph    boolean not null default false
has_memorabilia  boolean not null default false
is_refractor     boolean not null default false
is_die_cut       boolean not null default false
is_short_print   boolean not null default false
notes            text
created_at       timestamptz not null default now()
updated_at       timestamptz not null default now()

unique (card_id, parallel_type_id, print_run)    -- card_variants_card_id_parallel_type_id_print_run_key
```

**`user_cards`** (from `202607050001_user_collections.sql`)
```
id                   uuid primary key default gen_random_uuid()
profile_id           uuid not null references profiles(id) on delete cascade
card_id              bigint not null references cards(id) on delete restrict
card_variant_id      bigint references card_variants(id) on delete set null   (nullable)
location_id          bigint references locations(id) on delete set null
team_name            text
serial_number        integer
grading_status       text not null default 'RAW'
condition            text
grading_company_id   bigint references grading_companies(id) on delete set null
grade                text
cert_number          text
status               text not null default 'HAVE'
purchase_price/date/source, estimated_value, asking_price, sold_price/date/fees/notes,
quantity, notes, comps (jsonb), image_path/thumb_path/image_shared/image_type,
created_at, updated_at

index (profile_id), index (card_id), index (profile_id, status)
```

Neither `cards` nor `card_variants` has any index beyond what its primary key and unique constraint already create implicitly. Neither table has row-level security enabled (confirmed: no `alter table ... enable row level security` targets any catalog table in the base migration) — both are fully open, publicly readable/writable-by-key tables.

## 2. Target schema

**`checklist_sections`** (new)
```
id                bigserial primary key
set_id            bigint not null references sets(id) on delete restrict
name              text not null
slug              text not null
section_category  text not null       -- replaces is_insert/is_autograph/is_memorabilia as one decision
sort_order         integer
created_at        timestamptz not null default now()
updated_at        timestamptz not null default now()

unique (set_id, slug)
```

**`cards`** (updated)
```
id                    bigserial primary key
set_id                bigint not null references sets(id) on delete restrict   -- kept, denormalized (see §3)
checklist_section_id  bigint not null references checklist_sections(id) on delete restrict   -- new
card_number           text not null
title                 text
rookie_card           boolean not null default false
printed_year          integer
release_year          integer
-- is_insert REMOVED (redundant with checklist_sections.section_category)
is_autograph          boolean not null default false
is_memorabilia        boolean not null default false
search_text           text
created_at            timestamptz not null default now()
updated_at            timestamptz not null default now()

unique (checklist_section_id, card_number)     -- replaces (set_id, card_number)
```

**`card_variants`** (updated)
```
id                 bigserial primary key
card_id            bigint not null references cards(id) on delete cascade
parallel_type_id   bigint references parallel_types(id) on delete restrict
name_override      text
serial_numbered    boolean not null default false
print_run          integer
swatch_descriptor  text          -- new: "Brand Logo", "NFL Shield", "Laundry Nike", "Die-Cut", etc.
has_autograph      boolean not null default false
has_memorabilia    boolean not null default false
is_refractor       boolean not null default false
is_die_cut         boolean not null default false
is_short_print     boolean not null default false
notes              text
created_at         timestamptz not null default now()
updated_at         timestamptz not null default now()

unique (card_id, parallel_type_id, print_run, swatch_descriptor)   -- replaces (card_id, parallel_type_id, print_run)
```

`user_cards` is **not part of the target-schema changes** — it needs no column, constraint, or FK changes. It already references `cards`/`card_variants` by id, which is unaffected by how those tables reach their identity.

## 3. Every column to add/remove/change

| Table | Column | Change |
|---|---|---|
| `checklist_sections` | (all) | **Add** — entire new table |
| `cards` | `checklist_section_id` | **Add** (nullable initially, `not null` after backfill — see §8) |
| `cards` | `is_insert` | **Remove** (after all readers are migrated to `checklist_sections.section_category` — see §7 dependency ordering, not dropped in the same migration as the add) |
| `cards` | `set_id` | **Unchanged, kept.** Still present as a denormalized convenience column (avoids a join for "all cards in this set"); no longer part of any uniqueness constraint. |
| `card_variants` | `swatch_descriptor` | **Add** (nullable — genuinely optional, no backfill needed) |
| `sets`, `card_players`, `parallel_types`, `user_cards` | — | **No column changes.** |

## 4. Every index to add/remove/change

| Index | Change |
|---|---|
| `checklist_sections` primary key index (on `id`) | **Add** (implicit from `bigserial primary key`) |
| Implicit unique index backing `checklist_sections_set_id_slug_key` | **Add** |
| Implicit unique index backing the new `cards` constraint | **Add** (replaces the one backing the dropped constraint — see §5) |
| Implicit unique index backing the new `card_variants` constraint | **Add** (replaces the one backing the dropped constraint) |
| Everything on `sets`, `card_players`, `parallel_types`, `user_cards` | **Unchanged.** |

No explicit (non-constraint-backed) index is added in this migration. Whether `cards.checklist_section_id` needs its own non-unique index for join performance (beyond what the composite unique constraint already provides) is a judgment call best deferred until real query patterns exist against real data — not something to speculate into this migration.

## 5. Every unique constraint to add/remove/change

| Constraint | Change |
|---|---|
| `checklist_sections_set_id_slug_key` unique `(set_id, slug)` | **Add** |
| `cards_set_id_card_number_key` unique `(set_id, card_number)` | **Remove** |
| `cards_checklist_section_id_card_number_key` unique `(checklist_section_id, card_number)` | **Add** |
| `card_variants_card_id_parallel_type_id_print_run_key` unique `(card_id, parallel_type_id, print_run)` | **Remove** |
| `card_variants_uniqueness_key` unique `(card_id, parallel_type_id, print_run, swatch_descriptor)` | **Add** |

Everything on `sets`, `card_players`, `parallel_types`, `user_cards` (including `sets_slug_key`, `card_players` primary key, `parallel_types` name/slug uniques) is **unchanged**.

## 6. Every foreign key to add/remove/change

| Foreign key | Change |
|---|---|
| `checklist_sections.set_id → sets(id) on delete restrict` | **Add** |
| `cards.checklist_section_id → checklist_sections(id) on delete restrict` | **Add** |
| `cards.set_id → sets(id) on delete restrict` | **Unchanged** (kept) |
| `card_variants.card_id → cards(id) on delete cascade` | **Unchanged** |
| `card_variants.parallel_type_id → parallel_types(id) on delete restrict` | **Unchanged** |
| `user_cards.card_id → cards(id) on delete restrict` | **Unchanged** |
| `user_cards.card_variant_id → card_variants(id) on delete set null` | **Unchanged** |

`on delete restrict` is used consistently for every new/changed FK, matching the existing convention throughout this schema (catalog rows are never silently cascade-deleted out from under something that references them) — the one exception already in the schema is `card_variants.card_id`/`card_players.card_id`, which cascade specifically because they're compositional parts of a card, not independent references to it. `checklist_sections`/`cards` follow the same logic: a `checklist_sections` row shouldn't be deletable while `cards` still reference it (`restrict`), consistent with how `cards.set_id` already behaves today.

## 7. Exact migration order

1. `create table checklist_sections` (new table, no dependents yet — zero risk, fully additive).
2. `alter table cards add column checklist_section_id bigint references checklist_sections(id) on delete restrict` — **nullable** at this step. Cannot be `not null` yet because existing rows (if any) have no value to put there.
3. **Backfill** `cards.checklist_section_id` for any existing rows (see §8) — this step is a no-op if the table is empty.
4. `alter table cards alter column checklist_section_id set not null`.
5. `alter table cards add constraint cards_checklist_section_id_card_number_key unique (checklist_section_id, card_number)`.
6. `alter table cards drop constraint cards_set_id_card_number_key`.
7. `alter table card_variants add column swatch_descriptor text` — nullable, no backfill required (genuinely optional data; existing variants simply have no descriptor).
8. `alter table card_variants add constraint card_variants_uniqueness_key unique (card_id, parallel_type_id, print_run, swatch_descriptor)`.
9. `alter table card_variants drop constraint card_variants_card_id_parallel_type_id_print_run_key`.
10. **(Separate, later migration — not this one.)** `alter table cards drop column is_insert`, only after every application reader (`cards.ts`, `myCards.ts`, `catalog/cards/[id]/page.tsx`) has been switched to `checklist_sections.section_category`. Dropping it in the same migration as steps 1–9 risks a window where a deployed-but-not-yet-updated app instance reads a suddenly-missing column.

Steps 2–6 must happen in that exact order (add nullable → backfill → set not null → add new constraint → drop old constraint) specifically so there is never a moment where `cards` has neither a valid `checklist_section_id` nor the old constraint protecting it. Steps 7–9 follow the identical pattern for `card_variants`, except no backfill step is needed since `swatch_descriptor` stays nullable.

## 8. Backfill strategy

**This plan's correctness depends on knowing which case applies — confirm the real `cards` row count with the service-role key before running this migration for real.** No confirmation has been possible in this environment all session (no service-role key has been available), so both cases are specified.

**Empty database (expected case):** Given the standing catalog cleanup earlier this session and that every import task since has been strictly read-only/offline, `cards` and `card_variants` are expected to currently have zero rows. If confirmed empty, step 3 (backfill) is a no-op — proceed directly from step 2 to step 4.

**Populated database (defensive case, if the assumption above is wrong):** Every existing `cards` row needs a `checklist_sections` row resolved or created before `checklist_section_id` can be set:
1. For each distinct existing `(set_id, title, is_insert)` combination in `cards`, create one `checklist_sections` row — `title` (the current de facto insert-name field) becomes `checklist_sections.name`; `is_insert` becomes the seed for `section_category` (`'insert'` if true, `'base'` if false — an approximation, since the current schema has no real category beyond that one boolean).
2. `update cards set checklist_section_id = <resolved section id> where set_id = ... and title = ... and is_insert = ...` for each combination.
3. Verify zero rows remain with a null `checklist_section_id` before proceeding to step 4 of the migration order (the `not null` constraint will fail loudly if any remain, which is the correct fail-safe outcome — better a rejected migration than a silently incomplete one).

No backfill is needed for `card_variants.swatch_descriptor` in either case — it's nullable and existing variants legitimately have no descriptor.

## 9. Rollback strategy

Each step in §7 has a direct inverse, so rollback is a mirror of the forward migration rather than a separate restore-from-backup operation (appropriate given the additive/reversible nature of every step except the constraint swaps, which are also reversible as long as no data was written that only satisfies the *new* constraint):

1. Re-add `card_variants_card_id_parallel_type_id_print_run_key` unique `(card_id, parallel_type_id, print_run)` — **will fail if any real data now has two variants differing only by `swatch_descriptor`** (i.e., real use of the new capability). This is the actual point of no return: rollback is clean right up until the new constraint's extra flexibility has actually been used for real.
2. Drop `card_variants_uniqueness_key`.
3. Drop `card_variants.swatch_descriptor` (safe — nullable, no other object depends on it).
4. Re-add `cards_set_id_card_number_key` unique `(set_id, card_number)` — **will fail if any two real cards in different sections of the same set now share a card number** (i.e., real use of the new capability — the exact scenario the confirmed real 2025 Select Football checklist proved happens constantly). This is the same kind of one-way door as step 1.
5. Drop `cards_checklist_section_id_card_number_key`.
6. Drop `cards.checklist_section_id`.
7. Drop `checklist_sections` (only safe once nothing references it — i.e., after step 6).

**Practical implication:** rollback is only truly clean if attempted *before* any real Catalog v2 data has been imported (i.e., during Phase 1–3 of the implementation roadmap, before Phase 4/5's writer and real import). Once the 2025 Select Football import actually happens and uses cross-section number reuse or swatch-descriptor differentiation for real, rolling back the schema requires first deciding how to collapse that now-meaningful distinction back into the old, coarser identity — which is a data decision, not just a schema reversal.

## 10. Validation checklist after migration

- [ ] `checklist_sections` exists with the exact column list in §2 and its unique constraint enforced
- [ ] `cards.checklist_section_id` is `not null`, correctly typed, and its FK to `checklist_sections` is valid
- [ ] `cards_checklist_section_id_card_number_key` exists; `cards_set_id_card_number_key` no longer exists
- [ ] `card_variants.swatch_descriptor` exists (nullable) and its new unique constraint is active; the old three-column constraint no longer exists
- [ ] Zero rows in `cards` have a null `checklist_section_id` (should be structurally impossible post-migration, but worth confirming directly against the live table, not just trusting the `not null` constraint held during the migration)
- [ ] `cards.is_insert` still exists and is unchanged (not dropped in this migration — confirms step 10 of §7 was correctly deferred)
- [ ] `user_cards` reads/writes are unaffected — spot-check that an existing `user_cards` row (if any) still resolves its `cards`/`card_variants` join correctly
- [ ] The app still runs unmodified against the new schema (Phase 1 explicitly precedes any repository/code change — nothing should be broken by the migration alone)
- [ ] No RLS policy was accidentally introduced or removed on any catalog table (this migration doesn't touch RLS at all; catalog tables remain open by design)

---

No SQL was written, no migration file was created, no application code was changed, no database connection was made, and nothing was committed as part of this document.

# Catalog v2 Implementation Roadmap

Breaks the Catalog v2 migration (see [catalog-v2-spec.md](../architecture/catalog-v2-spec.md) and [catalog-v2-erd.md](../architecture/catalog-v2-erd.md)) into small, independently reviewable phases. Each phase should land as its own pass — do not skip ahead to a later phase before the current one's completion criteria are met, since every phase depends on the one before it (schema before repositories, repositories before search/ranking, all of the above before a writer exists, a writer before the first real import).

Status of this document: **planning only**. No phase below has been started. No migration exists yet, no application code has changed, and no data has been written to Supabase for this initiative.

---

## Phase 1 — Database migration

**Objective:** Introduce `checklist_sections` as a first-class table and change `cards`/`card_variants` identity to match, without touching any application code yet.

**Files affected:**
- New migration file under `supabase/migrations/` (not yet created)
- `checklist_sections` (new table)
- `cards` (add `checklist_section_id`; drop `is_insert`; swap unique constraint)
- `card_variants` (add `swatch_descriptor`; swap unique constraint)

**Estimated risk: Medium.** The SQL itself is simple (new table, nullable column, constraint swap), but the risk isn't syntax — it's sequencing. Confirm current `cards`/`card_variants` row counts before writing this migration: if either table already has real rows (unconfirmed all session — no service-role key has been available in this environment), a backfill step is required before `checklist_section_id` can be made `not null`. If both tables are empty (expected, given the standing cleanup earlier this session and that every import task since has been read-only), this phase is low-risk in practice.

**Testing checklist:**
- [ ] Confirm `cards`/`card_variants` row counts before writing the migration
- [ ] Migration applies cleanly to a fresh/staging database
- [ ] `checklist_sections_set_id_slug_key` unique constraint enforced
- [ ] Old `cards_set_id_card_number_key` constraint dropped; new `cards_checklist_section_id_card_number_key` enforced
- [ ] `card_variants` accepts a null `swatch_descriptor` (existing variants without one aren't broken)
- [ ] No orphaned rows: every existing `cards` row (if any) has a valid `checklist_section_id` before the column is made `not null`

**Completion criteria:** `checklist_sections` exists; `cards.checklist_section_id` is `not null` with its new unique constraint live; `card_variants.swatch_descriptor` exists with its new unique constraint live; the old `(set_id, card_number)` constraint no longer exists. No application code depends on any of this yet — the app should still run unmodified against the new schema (extra columns/tables it doesn't use yet).

---

## Phase 2 — Repository layer

**Objective:** Give the application code a way to read/write the new schema, without yet changing search, ranking, or any UI page's behavior.

**Files affected:**
- New `src/lib/repositories/checklistSections.ts` (`listChecklistSections`, `findChecklistSectionBySlug`, `createChecklistSection`, `findOrCreateChecklistSection`)
- `src/lib/repositories/cards.ts` (`CardRow`/`CreateCardInput`/`CardWithContext` gain `checklist_section_id`/`checklistSectionId`, drop `is_insert`; `findCardBySetAndNumber` → `findCardBySectionAndNumber`; `CARD_CONTEXT_SELECT` joins `checklist_sections`; search `.or()` clauses gain a section-name branch)
- `src/lib/repositories/cardVariants.ts` (`CardVariantRow`/`CreateCardVariantInput` gain `swatch_descriptor`; `findCardVariant` gains the new lookup dimensions)
- `src/lib/repositories/myCards.ts` (`resolveCatalogIds` resolves a checklist section before resolving a card; `resolveCardForPlayer`'s existing disambiguation hack narrows in scope but stays; the "Insert" input field's meaning shifts to section)
- Search updates confined to the repository layer only in this phase (see Phase 3 for the UI/ranking-facing search work)

**Estimated risk: Medium-High.** `myCards.ts`'s `resolveCatalogIds`/`resolveCardForPlayer` is the highest-stakes file in the whole roadmap — it's what prevents a user's card from being silently attached to the wrong existing catalog row. A mistake here doesn't fail loudly; it misattributes data.

**Testing checklist:**
- [ ] `findOrCreateChecklistSection` correctly finds an existing section by `(set_id, slug)` before creating a duplicate
- [ ] `findCardBySectionAndNumber` returns the correct row and no longer accepts a bare `set_id`-only lookup
- [ ] Creating a card via `myCards.ts` for a brand-new section works end to end
- [ ] Creating a second card in the *same* section with the *same* card number but a *different* player still triggers the `~2`/`~3` disambiguation path correctly (regression check on the existing hack)
- [ ] Creating a card in a *different* section with the *same* card number as an existing card in another section does **not** trigger disambiguation at all (this collision no longer exists once section is part of the key — confirms the actual bug this whole redesign exists to fix)
- [ ] `CardWithContext`/search queries return `sectionName` without breaking existing callers that don't use it yet

**Completion criteria:** Every repository function that reads or writes `cards`/`card_variants` is section-aware. `myCards.ts`'s add/edit/update paths work end to end against a real (staging) database. No UI page has been changed yet — this phase is repository-only.

---

## Phase 3 — Catalog services

**Objective:** Make search, ranking, OCR-driven matching, and the two detail pages that display card identity actually use section context, so results stay disambiguated once real bulk data (44+ sections per set) is live.

**Files affected:**
- `src/lib/repositories/cards.ts` (`searchCatalog`/`matchingCardIdsForToken` — new `cardIdsMatchingSectionText` lookup)
- `src/lib/catalog/rankingEngine.ts` (new section-match scoring signal; exact-card-number's standalone 100-point weight needs to stop being sufficient on its own)
- `src/lib/ocr/*` — expected **no change** (confirmed no coupling to card/set/schema structure; all real impact is downstream in the two files above)
- `src/app/(app)/catalog/cards/[id]/page.tsx` (display `sectionName` instead of/alongside the now-ambiguous `title`)
- `src/app/(app)/players/[slug]/page.tsx` (same display change for each listed card)
- `src/app/(app)/cards/new/page.tsx` (the "Insert" field becomes a "Section" field, ideally an autocomplete against `listChecklistSections(setId)`)

**Estimated risk: Medium.** Not individually risky changes, but this is the phase where a gap becomes *user-visible* if missed — search quality regressing is the kind of bug that's easy to ship unnoticed until a real multi-section checklist is imported and users start getting confusing results.

**Testing checklist:**
- [ ] Searching by a section-only term (e.g. "Rated Rookies") returns matching cards
- [ ] Searching by a bare card number that exists in multiple sections of the same set returns results from all matching sections, ranked sensibly (not just whichever the DB happens to return first)
- [ ] Ranking engine's scoring changes don't regress any existing single-section-set test cases (the original Prizm fixture, still only 6 sets/no section collisions)
- [ ] Catalog card detail page shows section name correctly for both base and insert cards
- [ ] Player detail page's card list shows section name correctly
- [ ] Add Card page's section field successfully finds-or-creates a `checklist_sections` row

**Completion criteria:** A search for a card number that exists in two different sections of the same set returns and correctly ranks results from both, distinguishable by section in the UI. No behavior regression for existing single-section data.

---

## Phase 4 — Import pipeline

**Objective:** Bring the offline import-analysis pipeline (already validated against the real file) up to date with the real schema, and build the first real (Supabase-writing) importer.

**Files affected:**
- `scripts/catalog-import/build-import-plan.ts` (natural-key comparison rebuilt around `checklist_sections`/`swatch_descriptor` instead of the pre-v2 `(set, card_number)` shape — this is a known, already-flagged gap from the offline entity-builder work)
- `scripts/catalog-import/build-import-report.ts` (inherits the plan fix automatically; add a "ChecklistSections" line to the Markdown template)
- New writer script (does not exist yet — everything to date has been read-only/preview-only)
- Dry run verification harness/checklist for the writer

**Estimated risk: High.** This is the first point in the whole roadmap where a script is allowed to write to Supabase. Everything before this phase has been offline-only by design; this phase is where that guarantee ends, so it needs the most deliberate guardrails (explicit confirmation env vars, dry-run mode as the default, clear before/after row counts) — following the same safety pattern already established by this project's existing destructive scripts (e.g. `cleanup-sample-catalog.ts`'s `CONFIRM` env var gate).

**Testing checklist:**
- [ ] `build-import-plan.ts` correctly reports existing/create/conflict counts against a real (staging) database that already has some Catalog v2 data
- [ ] Writer inserts in correct dependency order: `sets` → `checklist_sections` → `players`/`teams` → `cards` → `card_players` → `parallel_types` → `card_variants`
- [ ] Writer is idempotent — running it twice against the same input does not create duplicates (relies on the same find-or-create pattern already used everywhere else in the repository layer)
- [ ] Writer respects an explicit confirmation gate and defaults to dry-run/no-op without it
- [ ] Dry run against a staging database matches the offline entity builder's counts exactly (1 Set / 44 sections / 1,721 cards / 27,870 variants / 593 players / 138 teams) before the writer is trusted for the real import

**Completion criteria:** A dry run against a staging (not production) database produces exactly the expected counts with zero unexpected conflicts, and the writer's insert order and idempotency have been verified by running it twice.

---

## Phase 5 — First production import

**Objective:** Import 2025 Select Football for real — the actual goal of the entire Catalog v2 initiative.

**Files affected:** None (this phase is an operation, not a code change) — it's the first time the writer built in Phase 4 runs against production.

**Estimated risk: High.** This is a real, production write to the shared catalog. Even with everything above verified, this is the step with genuine, hard-to-reverse consequences if something is wrong (bad data written to a shared, publicly-readable table with no RLS, referenced by `user_cards` once real users start adding these cards).

**Verification checklist (before considering the import "done"):**
- [ ] Row counts match exactly: 1 Set, 44 Checklist Sections, 1,721 Cards, 27,870 Variants, 593 Players, 138 Teams
- [ ] Spot-check a known tricky row (e.g. a swatch-descriptor variant like "Jumbo Rookie Signature Swatch Black Prizm Brand Logo") resolves to the correct section + parallel + swatch descriptor in the live database
- [ ] Catalog search finds the new cards correctly, disambiguated by section
- [ ] No duplicate `checklist_sections`, `cards`, or `card_variants` rows were created (idempotency check against the actual production data, not just the dry run)
- [ ] `user_cards` still functions correctly for any existing user-owned cards unrelated to this import (regression check — this import should be additive-only)

**Rollback checklist (if verification fails):**
- [ ] Do not attempt a partial manual fix under time pressure — diagnose first (mirrors this project's established incident pattern from the original sample-data cleanup work)
- [ ] Confirm whether any `user_cards` rows have already been created against the newly-imported data before removing anything (a hasty rollback must not orphan a real user's collection)
- [ ] Prefer deleting only the specific rows proven wrong over deleting the entire import, if the error is scoped (e.g. one bad section) rather than systemic
- [ ] Re-run the Phase 4 dry run against staging with the fix applied before attempting the real import again
- [ ] Document what went wrong before retrying — this phase should not be repeated blind

**Completion criteria:** All verification checklist items pass against production. The 2025 Select Football checklist is live in the real catalog, correctly structured under Catalog v2, with zero data-integrity regressions to existing user data.

---

No migrations were created, no application code was changed, no database connection was made, and nothing was committed as part of this document.

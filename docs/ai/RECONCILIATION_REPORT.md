# Reconciliation Report: `202607050001_user_collections.sql` vs documented architecture

Prepared by Claude (implementer) for ChatGPT (architect) review. No code or schema changes were made to produce this — it is a comparison only. Migration has **not** been applied to any database.

Compared documents:
- `docs/database/database-v1.md`
- `docs/architecture/database.md`
- `docs/architecture/application.md`
- against: `supabase/migrations/202607050001_user_collections.sql` and `src/lib/repositories/myCards.ts`

---

## 1. `value_snapshots` vs `card_value_snapshots`

**Current implementation**: Migration creates `public.value_snapshots` (columns: `id bigserial`, `user_card_id uuid → user_cards.id`, `market_value numeric`, `source text`, `recorded_at`, `created_at`).

**Documented architecture**: `database-v1.md` lists the historical-data table as `card_value_snapshots`. `database.md` lists it as `value_snapshots` (the two docs disagree with each other on this name).

**Origin**: I didn't coin `value_snapshots` — it was already the name used in `src/lib/repositories/valueSnapshots.ts`, written in a prior session before I started this task. My migration matched the table name to that pre-existing repository file rather than to `database-v1.md`. I never edited `valueSnapshots.ts` itself.

**Recommended fix**: Pick one name and make both docs and code agree. If `database-v1.md` is the authoritative name, rename the table to `card_value_snapshots` and update `valueSnapshots.ts`'s `.from("value_snapshots")` call and the index/policy names in the migration to match. This is a pure rename — no data exists yet, so there's no migration-of-data concern, only a find-and-replace across the migration file + repository file.

**Risk if left as-is**: Low technical risk (nothing else references this table yet — I confirmed via grep that no UI page currently calls any `valueSnapshots.ts` function; it's unused scaffolding). The real risk is documentation drift: two of your own docs already disagree, and leaving a third (mismatched) name in the actual schema makes it harder to tell later which doc was authoritative.

---

## 2. `myCards.ts` combining repository + service behavior

**Current implementation**: `src/lib/repositories/myCards.ts` exports `MyCard`/`MyCardInput` (a domain/view model), plus `listMyCards`/`getMyCard`/`createMyCard`/`updateMyCard`/`deleteMyCard(s)`. Internally, `createMyCard`/`updateMyCard` call a private `resolveCatalogIds()` that does multi-step business logic: find-or-create a `set`, find-or-create a `card`, find-or-create a `player` and link it via `card_players`, find-or-create a `parallel_type`, find-or-create a `card_variant`, find-or-create a `location`, find-or-create a `grading_company` — then assembles the `user_cards` insert/update payload. All of this lives in one file under `src/lib/repositories/`.

**Documented architecture**: `application.md`'s Data Layer section specifies four distinct layers: *domain models* (business concepts) → *repositories* (database access only) → *services* (business workflows) → *UI components*. Find-or-create-across-six-tables is a business workflow, not plain database access — under the documented layering it belongs in a service, calling into the individual repositories (`cards.ts`, `sets.ts`, `players.ts`, etc.) rather than living inside something named/located as a repository.

**Recommended fix**: Split `myCards.ts` into:
- `src/lib/domain/card.ts` (or similar) — the `MyCard`/`MyCardInput` types only.
- `src/lib/services/cardCatalogService.ts` (or similar) — `resolveCatalogIds` and the orchestration currently in `createMyCard`/`updateMyCard`.
- Keep `listMyCards`/`getMyCard`/plain CRUD delegation as the actual repository surface, calling the service for the catalog-resolution step.

This is a mechanical refactor (move functions, adjust imports) with no behavior change, so it's low-risk to do once the naming question above is settled — I'd suggest doing both renames in the same pass rather than two separate migrations of import paths.

**Risk if left as-is**: No immediate functional risk — it works and every UI page already only calls the five public functions (`listMyCards`, `getMyCard`, `createMyCard`, `updateMyCard`, `deleteMyCard(s)`), so a future split is purely internal and won't touch the ~13 call sites. The risk is purely architectural debt: as more find-or-create logic accretes (e.g. when a real sport/league/team picker is built), this file will keep growing and the repository/service boundary will get harder to retrofit the longer it's deferred.

---

## 3. `team_name`, `serial_number`, and `comps`

None of these three columns appear in `database-v1.md` or `database.md`. Each was added for a specific, concrete reason surfaced while rewiring existing working UI:

### `team_name` (text, on `user_cards`)
**Current implementation**: Free-text team name stored directly on the user's card row.
**Documented architecture**: Team is modeled as a catalog entity — `players.team_id → teams.id`, and `teams` requires a non-null `league_id`. A card's "team" should be reachable via `card → card_players → player → team`, not stored per-user-card.
**Why I deviated**: There is no sport/league/team-picker UI anywhere in the app today (`cards/new/page.tsx` only collects free-text player/set/team strings). Wiring team through the real catalog path would require: (a) a sport selector, (b) a league selector scoped to that sport, (c) a team selector scoped to that league, and (d) find-or-create logic for all three — none of which exists, and building it wasn't in scope for a data-layer migration. `team_name` was a stopgap to avoid silently dropping a field the existing UI (`CardTile`, card detail page) already displays.
**Recommended fix**: If the sport/league/team picker is a near-term roadmap item, hold off on adding `team_name` at all and instead block the team field in the UI until that picker exists. If it's further out, keep `team_name` as an explicit, documented interim column with a tracked follow-up to migrate it into `players.team_id` once the picker ships.
**Risk if left as-is**: Data fragmentation — team info lives outside the catalog, so it can't be searched/filtered/reported on consistently with the rest of the catalog (violates `database.md`'s stated principle "search operates against catalog tables"). Low risk to *correctness* today since nothing else depends on team being normalized yet.

### `serial_number` (integer, on `user_cards`)
**Current implementation**: The specific numbered copy this user owns (e.g. "23" of a "/99" print run) stored on `user_cards`.
**Documented architecture**: Not addressed directly, but `card_variants` already models the print run itself (`print_run` on the catalog-level variant, e.g. "this is a /99 parallel"). The *specific copy number* within that run is inherently a per-owned-item fact, not a catalog fact (two different collectors can each own e.g. #23 and #45 of the same /99 variant).
**Recommended fix**: I believe this one is placed correctly already — it's the one of the three that has no natural catalog home by definition, since it varies per physical card, not per catalog entry. Flagging for confirmation rather than a fix.
**Risk if left as-is**: None identified — this appears to be the right layer for this fact.

### `comps` (jsonb, on `user_cards`)
**Current implementation**: An array of `{id, price, date, source, url, notes}` objects, stored as JSONB directly on the user's card row, preserving a pre-existing "eBay sold comps" feature on the card detail page.
**Documented architecture**: Not mentioned in any of the three docs at all — no comps/comparables concept exists in the documented schema.
**Recommended fix**: If comps are meant to stay a real feature, decide deliberately between (a) JSONB on `user_cards` (what I did — simplest, fine for a small user-curated list, but not queryable/reportable at the SQL level), or (b) a normalized `card_comps` table (`id, user_card_id, price, date, source, url, notes`) if you want to eventually query/aggregate across comps (e.g. "average recent sold price across all users' comps for this card_variant" — which would actually want to hang off `card_variant_id`, not `user_card_id`, to be useful across users). If comps should be dropped/redesigned, say so and I'll remove the column and the `CardComp` type instead of carrying it forward silently.
**Risk if left as-is**: Low immediate risk (feature parity preserved, nothing else depends on it), but it's schema surface that exists with zero documentation backing it — exactly the kind of undocumented drift this reconciliation process is meant to catch.

---

## 4. Normalized `manufacturers`/`brands`

**Current implementation**: `sets.manufacturer` and `sets.brand` are plain `text` columns (this is pre-existing — defined in the original `202607040001_thebinder_database_v1.sql`, not something from this session). My new migration and `myCards.ts` don't touch `sets` structurally; `findOrCreateSet()` just writes into these existing text columns.

**Documented architecture**: `database.md` lists `manufacturers` and `brands` as their own catalog tables, parallel to `sports`/`leagues`/`teams`.

**Recommended fix**: This gap predates my work and is outside what I was asked to build (I only added user-ownership tables, not catalog tables). If you want this normalized, it's a separate migration: create `manufacturers`/`brands` tables, add `manufacturer_id`/`brand_id` FKs to `sets`, backfill-or-drop the text columns, and update `sets.ts`'s `findOrCreateSet`/`createSet` to resolve/create those FKs instead of writing free text. I did not attempt this since it touches the already-shipped v1 catalog migration rather than the user-collections migration I was asked to write.

**Risk if left as-is**: Same category as `team_name` — catalog data that isn't fully normalized yet, so manufacturer/brand can't be filtered or deduplicated consistently (e.g. "Panini" vs "panini" vs "Panini America" could all end up as distinct free-text values). Pre-existing risk, not introduced this session.

---

## 5. Deleted `/api/cards*` routes

**What was deleted**: `src/app/api/cards/route.ts` (GET/POST), `src/app/api/cards/[id]/route.ts` (GET/DELETE), `src/app/api/cards/dedupe/route.ts` (POST).

**Why**: All three operated exclusively on `cards_v1` (a table that appears in none of the three migrations/docs — not `database-v1.md`, not `database.md`, not any `supabase/migrations/*.sql` file) via `src/lib/cardsDbMapper.ts`'s flat `CardsV1Row` shape, which is a *third*, separate flat-column representation of a card, distinct from both the legacy `SportsCard`/localStorage model and the new normalized catalog. I grepped the entire `src` tree for `/api/cards` (as a literal path string, all forms: `/api/cards'`, `/api/cards/$`, `/api/cards/dedupe`, `fetch(...api/cards`) before deleting and found zero call sites anywhere in the app — no page, component, or script calls any of these three routes. The "Dedupe" feature the route implements has no corresponding UI button/link anywhere either (grepped `dedupe` case-insensitively across `src`, zero matches outside the route file itself).

**Documented architecture**: `application.md` does list "cards" among the API Routes the app should have (`### API Routes — Server-side routes for cards, checklists, image checks, image reports, support, and account deletion`), so a `/api/cards*` surface is *intended* to exist per your docs — it's just that the one that existed was dead code pointed at an undocumented table, not a live implementation of that intent.

**Recommended fix**: Two separate questions:
1. Was it safe to delete *this* code? Yes — I'm confident it was unreachable dead code (verified by exhaustive grep, not just recollection, before writing this report).
2. Should a `/api/cards` surface exist going forward, per `application.md`? That's an open product/architecture question for you — e.g. is server-side REST access to cards needed (mobile client, public API, webhook), or does the app deliberately do everything through direct client-side Supabase calls via the repository layer (which is the pattern every rewired page now uses)? If you want a real `/api/cards` surface, it should be designed fresh against `MyCard`/the normalized schema rather than resurrecting the `cards_v1` version.

**Risk if left as-is (deleted)**: None functionally (nothing called it). The only risk is if `application.md`'s mention of a cards API route reflects a near-term planned consumer (e.g. a mobile app) that I'm not aware of — in which case the route should be rebuilt against the new schema rather than assumed unnecessary. Flagging explicitly since I can't tell that from the repo alone.

---

## 6. Are the other deleted legacy files truly safe to remove?

Re-verified fresh (not from memory) immediately before writing this report, via a single grep across all of `src` for: `cardsDbMapper`, `cardsDb.ts`, `dbLoadCards`, `dbUpsertCard`, `dbGetCard`, `dbDeleteCard`, `migrateLocalToSupabase`, `SportsCard`, and the literal string `/api/cards"`/`/api/cards'`. Result: the only remaining match is a plain-English doc comment in `myCards.ts` ("MyCard is the direct replacement for the legacy flat `SportsCard` type...") — not a reference to the type or any deleted symbol.

Files deleted and why each is confirmed unreferenced:
| File | Reason safe |
|---|---|
| `src/lib/cardsDb.ts` | Zero imports anywhere; superseded by `myCards.ts` |
| `src/lib/cardsDbMapper.ts` | Only consumer was the now-deleted `/api/cards*` routes |
| `src/lib/db/cards.ts` | Zero imports anywhere after all pages were rewired |
| `src/lib/db/migrateLocalToSupabase.ts` | Already dead before this session — imported a function (`dbUpsertCard`, singular) that never existed in `lib/db/cards.ts` to begin with, and targeted a stale `localStorage` key (`thebinder:sports-cards:v1`) that `dbLoadCards`/`dbUpsertCards` never read from (they used the key `"cards"`). It could not have run successfully even before I touched anything. |
| 9 empty (0-byte) `src/lib/db/*.ts` stub files (`cardConditions`, `cardPlayers`, `cardVariants`, `gradingCompanies`, `locations`, `parallelTypes`, `saleStatuses`, `userCards`, `valueSnapshots`) | Literally empty files; real implementations already existed in the parallel `src/lib/repositories/*` versions of the same names |
| `SportsCard` type in `src/lib/types.ts` | Zero remaining imports after all ~13 UI files were rewired to `MyCard` |
| Dead image-crop subsystem in `cards/[id]/page.tsx` (`handleSaveImage`, `handleRemoveImage`, `handleImageFile`, `confirmCrop`, the crop modal JSX, ~15 pieces of state) | Confirmed via grep that none of these three handler functions had any caller anywhere in the file — the page's own visible UI says "Image editing is available only on the edit screen" and only links there, so this was already-unreachable code before I touched it, left over from an earlier refactor |
| `soldFees` localStorage cleanup effect in `AppShell.tsx` | One-time migration shim that read/wrote the legacy `localStorage["cards"]` array (via the now-deleted `dbLoadCards`/`dbUpsertCards`); moot now that nothing populates that key |

`tsc --noEmit` and `eslint` both pass clean with all of the above removed (re-ran both after the deletions, not just after the rewiring), which is the strongest available confirmation short of runtime testing that nothing still depends on them.

---

## Summary of what already matches the docs (no discrepancy)

- Core table names: `profiles`, `locations`, `user_cards`, `grading_companies`, `card_conditions`, `sale_statuses` all match `database-v1.md`/`database.md` exactly.
- Key relationships match: `user_cards → card_variants`, `user_cards → locations`, `card_variants → parallel_types`, `user_cards → profiles`.
- RLS scoping (`profile_id = auth.uid()`) follows the same pattern as the pre-existing `device_sessions`/`shared_images` policies elsewhere in the repo.
- "Catalog data exists only once, users never modify catalog records, user inventory references catalog records" (the `database.md` principles section) is respected by the find-or-create design — no code path lets a user mutate a shared `cards`/`sets`/`players` row, only create-if-missing or reference existing ones.

## Open decisions needed before implementation resumes
1. `value_snapshots` vs `card_value_snapshots` — which name is authoritative?
2. Split `myCards.ts` into repository + service now, or defer?
3. `team_name`/`comps` — keep as interim columns, or redesign?
4. Should a real `/api/cards` REST surface be (re)built against the new schema?

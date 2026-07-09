# TheBinder Catalog v2 — Specification

Source-of-truth rules for TheBinder's real catalog, ahead of any Catalog v2 migration. See also [catalog-v2-erd.md](catalog-v2-erd.md) for the entity-relationship diagram and [database.md](database.md) for the schema as it exists today.

## 1. Import readiness status

**TheBinder is not ready to import real catalog data yet.**

- The current schema keys `cards` by `(set_id, card_number)`. Validated against the real 2025 Select Football checklist, this identity is insufficient: one release is one Set, but it contains 44 distinct checklist sections that each restart card numbering from 1. Importing under the current schema would silently collide cards from different sections that happen to share a number.
- **The next required step is Catalog v2 schema implementation** — the `checklist_sections` table, the `cards`/`card_variants` identity changes, and the repository/search/ranking updates described in this document and in `catalog-v2-erd.md`.
- We are moving closer to the first real import, not further from it: the checklist decomposition logic has been designed and validated offline against the full real file (0 ambiguous CARD SET splits across all 423 distinct values, 27,870 rows), and the in-memory entity model it produces (`build-catalog-entities.ts`) already matches the schema this document specifies. What remains is migrating the schema and updating the code paths that read/write it — not further research into whether the model is right.
- **First real import target: 2025 Select Football.** No data has been written to Supabase for this release. Everything to date has been offline analysis, design, and documentation.

## 2. Entity definitions

| Entity | Definition |
|---|---|
| **Sport** | A top-level sport (e.g. "Football"). Scopes leagues. |
| **League** | A league within a sport (e.g. "NFL"). Scopes teams and players. |
| **Team** | A team within a league (e.g. "Kansas City Chiefs"). Real checklists reference decades of teams, including retired/relocated ones. |
| **Manufacturer** | Who produced a release (e.g. "Panini"). Currently a free-text column on `sets`, not a normalized table — see open questions in `catalog-v2-erd.md`. |
| **Brand** | The product line within a manufacturer (e.g. "Select"). Currently a free-text column on `sets`, alongside Manufacturer. |
| **Set** | One release (e.g. "2025 Panini Select Football"). Synthesized from YEAR + BRAND + PROGRAM + SPORT, not read from a single source column. The top of the card-identity hierarchy. |
| **ChecklistSection** | One section within a Set (e.g. "Base Club Level", "Rookie Signatures", "Draft Selections Memorabilia"). New in v2. Owns the base/insert and autograph/memorabilia classification. |
| **Card** | One physical card design: a specific card number within a specific ChecklistSection. |
| **CardVariant** | One parallel/print-run/swatch-descriptor combination of a Card (e.g. "Black Prizm", "/99", "Brand Logo"). |
| **ParallelType** | A global, cross-set lookup of parallel names (e.g. "Silver Prizm"). Shared across releases, not scoped to one Set. |
| **Player** | One player, optionally scoped to a team/league. |
| **CardPlayer** | Join between a Card and the Player(s) featured on it. Supports multiple players per card (dual autos, team cards). |
| **UserCard** | A profile's owned copy of a catalog Card, optionally pointing at a specific CardVariant. Unaffected by the Catalog v2 hierarchy change — it references Card/CardVariant exactly as it always has. |

## 3. Entity identity rules

- **Set identity**: `release_year + manufacturer + brand + set_name` (synthesized), unique by slug within the catalog. Not derived from a single column — Beckett's format has no literal "set name" field, only the four components that compose it.
- **ChecklistSection identity**: unique within a Set — `(set_id, slug)`. Two different Sets may each legitimately have a section named "Base," but within one Set, section names are unique.
- **Card identity**: unique within a ChecklistSection — `(checklist_section_id, card_number)`. **Not** `(set_id, card_number)`. This is the core fix Catalog v2 makes: numbering restarts per section, so the section must be part of the key.
- **Variant identity**: unique within a Card — `(card_id, parallel_type_id, print_run, swatch_descriptor)`. Autograph/memorabilia flags describe what a variant is, not an independent identity axis, and are deliberately excluded from the uniqueness scope.
- **Player identity**: unique full name within a league (`league_id, slug`), approximated globally when no league has been resolved yet (e.g. pre-import, before a sport/league picker exists in the UI).
- **CardPlayer identity**: `(card_id, player_id)` — a card may reference more than one player (dual autographs, team cards); a player may appear on many cards.

## 4. Beckett import mapping

| Beckett column | Maps to |
|---|---|
| `SPORT` | `sport` (also used to resolve League: Football → NFL) |
| `YEAR` | `release_year` (component of Set identity) |
| `BRAND` | `set_manufacturer` (component of Set identity, e.g. "Panini") |
| `PROGRAM` | `set_brand` (component of Set identity, e.g. "Select") |
| `CARD SET` | `subset_or_insert` — decomposed into ChecklistSection + parallel + trailing modifier + flags, **not** read as the Set name (see §5) |
| `ATHLETE` | `player_name` |
| `TEAM` | `team_name` |
| `POSITION` | `position` (preview-only metadata; not yet modeled as its own entity field) |
| `CARD NUMBER` | `card_number` |
| `SEQUENCE` | `sequence` (preview-only metadata; print run was found embedded in CARD SET text zero times across all 27,870 real rows — it lives here instead) |

## 5. CARD SET decomposition rules

Beckett's CARD SET text is not one value — it consistently decomposes into up to four independent pieces, validated with 0 ambiguous splits across all 423 real distinct values in the 2025 Select Football checklist:

- **Section**: whatever remains after the parallel (and everything after it) is removed — e.g. `"Rookie Signatures"` from `"Rookie Signatures Black Prizm"`. Becomes the ChecklistSection.
- **Parallel**: a color/effect descriptor immediately followed by a recognized family word (Prizm, Prizm Shock, Snakeskin Prizm, Disco Prizm, Dragon Scale Prizm, Pulsar Prizm, Sparkle, Cosmic, Envelope) — e.g. `"Black Prizm"`. Normalized before storage: word-order variants of the same parallel (`"Disco Black Prizm"` vs. `"Black Disco Prizm"`) collapse to one canonical form, and the real `"Envolpe"` typo is corrected to `"Envelope"`.
- **Trailing modifier / swatch descriptor**: text after the matched parallel that isn't part of the section or the parallel itself — e.g. `"Brand Logo"`, `"NFL Shield"`, `"Laundry Nike"`, `"Die-Cut"`. Confirmed real and load-bearing: 1,170 of 27,870 real variants carry one, and some (e.g. three different swatch-tag rows sharing the same section + same parallel) are only distinguishable by this field.
- **Autograph flag**: keyword scan across the *entire* raw CARD SET text (not position-dependent) for "autograph"/"signature".
- **Memorabilia flag**: keyword scan for "jersey"/"materials"/"patch"/"relic"/"memorabilia"/"swatch(es)". Known gap: some memorabilia sections (e.g. "Sparks") don't contain any of these literal keywords and are undercounted — closing this gap needs a small human-reviewed section→category override table, not more keywords.
- **Base/insert/category**: a section whose name starts with "Base" is classified `base`; everything else is `insert`. This single classification (not independent booleans) should become `checklist_sections.section_category`.

## 6. Search and OCR implications

- **Search must use section context, not just set/title/player/card-number.** Once one Set has 44+ sections, "which section" is a first-class disambiguator, not incidental text.
- **Card number alone is not enough.** Different sections within the same Set commonly restart numbering from 1 — a bare card-number match can now legitimately hit dozens of unrelated cards in the same Set.
- **Ranking must consider set + section + player + card number + parallel jointly**, not card number as a single dominant signal. Today's ranking engine scores an exact card-number match as the highest standalone bonus (100 points) — validated as the highest-priority scoring fix needed before any checklist like this one is actually imported, or catalog search quality visibly regresses the moment real bulk data lands.
- OCR text extraction itself (`src/lib/ocr/*`) has no coupling to card/set/schema structure and needs no change — all real impact is in the downstream search/ranking layer it feeds.

## 7. First import target

**2025 Select Football**, validated offline against the real Beckett XLSX file (27,870 rows, "Master Checklist" sheet). Expected entity shape, already confirmed by the offline entity builder:

| Entity | Count |
|---|---|
| Sets | 1 |
| Checklist Sections | 44 |
| Cards | 1,721 |
| Variants | 27,870 |
| Players | 593 |
| Teams | 138 |

No data from this release has been written to Supabase. This shape is the target the Catalog v2 migration and writer must reproduce for real.

## 8. Migration readiness checklist

- [ ] `checklist_sections` table created
- [ ] `cards.checklist_section_id` added
- [ ] `cards` uniqueness updated to `(checklist_section_id, card_number)`
- [ ] `card_variants.swatch_descriptor` added (and uniqueness updated to include it)
- [ ] Repository updates (`cards.ts`, `cardVariants.ts`, new `checklistSections.ts`, `myCards.ts`)
- [ ] Import plan update (`build-import-plan.ts` natural keys made section/swatch-descriptor aware)
- [ ] Writer dry run (a real Supabase-writing importer, exercised against a safe/staging path before the real release)
- [ ] Final import (2025 Select Football written for real)

Each item is a precondition for the one after it — schema before repositories, repositories before the import plan, the import plan before a writer exists, a dry run before the final real import.

---

No migrations were created, no application code was changed, no database connection was made, and nothing was committed as part of this document.

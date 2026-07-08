# TheBinder Design System

This document describes the UI patterns that already exist in the TheBinder codebase today. It is a record of current practice, not a proposed redesign — every pattern below is backed by real markup found in `src/components/ui`, `src/components/cards`, and the pages under `src/app/(app)`.

---

## Philosophy

Patterns observed across the app reflect a consistent set of implicit goals:

- **Collector-first** — the Binder, Wishlist, For Sale, and Sold History pages are organized around a single card's lifecycle status (`HAVE` / `WANT` / `FOR_SALE` / `SOLD`), and nearly every surface (Dashboard insights, Next Actions, Collection Health) exists to help a collector act on their own collection rather than browse abstractly.
- **Mobile-first structural concessions** — most multi-column layouts default to a single column or 2-column grid and expand at `sm:`/`lg:` breakpoints (e.g. `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5` in the Binder card grid). The app shell itself swaps a sidebar for a bottom tab bar below `sm:`.
- **Information density without clutter** — card tiles pack year/set, player, team, badges (variation/insert/parallel/serial/rookie/auto/patch/data-quality) and a price label into a single compact tile, using small type sizes (`text-[10px]`, `text-[11px]`, `text-xs`) rather than removing information.
- **Fast scanning** — repeated use of small pill/chip/badge components (`MiniBadge`, `SummaryChip`, `Chip`, `Tab`) lets users scan status and metadata without reading full sentences.
- **Consistency over decoration** — nearly every panel uses the same `rounded-xl border bg-white p-4` (or `p-3`) card shell; there is very little bespoke visual styling outside of semantic color (positive/negative/severity tones).

---

## Typography

| Role | Classes actually used | Where |
|---|---|---|
| Page title (majority pattern) | `text-2xl font-semibold tracking-tight` | Dashboard, Binder, Catalog, Wishlist, For Sale |
| Page title (large variant) | `text-3xl font-bold` | Players (`PageHeader variant="large"`) |
| Page title (Account, third distinct style) | `text-3xl font-semibold tracking-tight font-display` | Account — not yet unified into `PageHeader` |
| Page subtitle (majority) | `text-sm text-zinc-600` | Dashboard, Wishlist, For Sale, Catalog |
| Page subtitle (large variant) | `text-muted-foreground` | Players |
| Section header | `text-lg font-semibold tracking-tight` (`SectionHeader`) | Dashboard sections |
| Condensed/inline section header | `text-sm font-semibold text-zinc-900` | Binder's condensed "Next Actions" / "Collection Health" blocks |
| Card title / player name | `text-[13px] font-semibold leading-snug text-zinc-900` (desktop), `text-sm font-semibold text-zinc-900` (mobile-only line) | `CardTile` |
| Card meta line | `text-[10px] uppercase tracking-wide text-zinc-500` | `CardTile` (year • set) |
| Body text | `text-sm text-zinc-700` / `text-sm text-zinc-600` | list rows, descriptions throughout |
| Helper / micro text | `text-xs text-zinc-500`, `text-[11px] text-zinc-600`, `text-[10px] text-zinc-500` | stat labels, empty sublabels, filter group labels |
| Stat value | `text-xl font-semibold` (`Stat`), `text-2xl font-semibold text-zinc-900` (`StatCard`) | Dashboard stat grids, StatCard |
| Nav uppercase group label | `text-[11px] font-medium uppercase tracking-wide text-zinc-500` | `AppShell` sidebar ("Binder", "Actions", "Quick Tip") |

Base heading tag sizes are also globally set in `globals.css` (`h1` 44px/700, `h2` 30px/600, `h3` 22px/600), but in practice every page overrides `<h1>`/`<h2>` with the Tailwind utility classes above rather than relying on the bare tag size.

---

## Spacing

Scale actually observed (values not in this list do not recur enough to be considered part of the system):

**Gap:**
- `gap-1`, `gap-1.5` — tight inline clusters (badge groups, chip label+value)
- `gap-2` — the default control/element gap (buttons in a row, chip rows, form rows)
- `gap-3` — card-grid gutters, toolbar internal spacing
- `gap-4` — page-level card grids, header title/action split

**Padding:**
- `p-2` — icon buttons, nav icon wells
- `p-3` — compact panels (toolbar shell, condensed Next Actions/Health cards)
- `p-4` — standard content panels (`StatCard`, Dashboard section cards, Collection Goal card)
- `px-3 py-2` / `px-4 py-2` — buttons and inputs
- `px-2 py-0.5` / `px-1.5 py-0.5` — badges/chips

**Vertical rhythm:**
- `space-y-2` — within a section (header + content)
- `space-y-3` — grouped filter rows
- `space-y-6` — top-level page wrapper (`<div className="space-y-6">` is the near-universal page root)

**Radius:**
- `rounded-md` — buttons, inputs, small icon wells
- `rounded-lg` — nested/secondary panels (filter panel, list rows)
- `rounded-xl` — the default panel/card shell (`StatCard`, toolbar shell, Dashboard cards, condensed Binder cards)
- `rounded-full` — chips, badges, pills, avatar-style icon buttons

---

## Cards

Patterns that already exist, by name:

- **`StatCard`** (`src/components/ui/StatCard.tsx`) — `rounded-xl border bg-white p-4` shell with a `text-xs text-zinc-500` title, optional `text-2xl font-semibold text-zinc-900` value, optional `text-sm text-zinc-600` subtitle. Used today only for Dashboard's Collection Health card.
- **`Stat`** (`src/components/cards/BinderUi.tsx`) — a smaller, tone-aware stat block (`rounded-xl border p-4`, `text-xl font-semibold` value) with `neutral`/`positive`/`negative` tone driving text/border/background color. Used throughout Dashboard's Collection/Breakdown/Financial/Quality grids.
- **`SummaryChip`** (`src/components/ui/SummaryChip.tsx`) — `inline-flex items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 py-1 text-xs` pill with a gray label and bold value. Used for the Binder snapshot strip (Owned/Wishlist/For Sale/Sold).
- **`MiniBadge`** (`src/components/cards/BinderUi.tsx`) — `rounded-full border px-2 py-0.5` badge with a large `tone` enum (zinc/blue/dots-blue/purple/amber/red/green/orange/yellow/pink/teal/black/white/silver/gold/lava) used for parallel colors, rookie/auto/patch flags, data-quality warnings, and Next Action severities.
- **`CardTile`** (`src/components/cards/CardTile.tsx`) — the card-grid unit: `rounded-lg border border-zinc-200 bg-white shadow-sm` with a hover lift (`hover:-translate-y-0.5 hover:shadow-md`), an image well (`aspect-[2.5/3.5]` on `sm:`), a stacked meta block, a badge row, and an absolutely-positioned selection checkbox + kebab menu button.
- **Generic "information card"** — the un-extracted `rounded-xl border bg-white p-4` block repeated by hand for Dashboard's Collection Goal, Next Actions list items, and Collection Insights entries. This is the same visual pattern as `StatCard` but not yet using the component (flagged, not fixed, per the incremental migration approach).
- **Condensed card variant** — Binder's condensed Collection Health and Next Actions blocks use a tighter `rounded-xl border bg-white p-3` shell (vs. `p-4` on Dashboard), reflecting a "less space, same page" density rule for pages that already have a toolbar and grid competing for vertical space.

---

## Buttons

| Class | Definition (in `globals.css`) | Used for |
|---|---|---|
| `btn-primary` | `rounded-md px-4 py-2 text-sm font-semibold`, `bg-[var(--brand-accent)] text-white`, hover `bg-[#1d4ed8]` | Primary page actions ("Add to Binder", "Add to Wishlist") |
| `btn-secondary` | Same sizing, `border border-zinc-200 bg-zinc-100 text-zinc-900`, hover `bg-zinc-200` | Secondary actions ("Return to For Sale", filter panel's "Clear filters") |
| `btn-destructive` | Same sizing, `bg-red-600 text-white`, hover `bg-red-700` | Destructive confirmations (delete dialogs) |
| `btn-link` | `text-sm font-semibold text-[var(--brand-accent)]`, hover underline | Low-emphasis inline actions ("Clear filter", "Done", "Clear" selection) |

Other button patterns (not shared classes, but repeated inline):
- **Toolbar buttons** — `rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm text-zinc-900 hover:bg-zinc-50` (Filters toggle, Clear filters, Sport select on mobile). Visually similar to `btn-secondary` but with a `zinc-400` border instead of `zinc-200`/`zinc-100` fill — an inconsistency that exists today rather than a deliberate second variant.
- **Icon buttons** — circular, e.g. the `CardTile` kebab menu (`rounded-full bg-white/90 p-2 text-zinc-600 shadow-sm hover:bg-white`) and the sidebar collapse/expand button (`h-9 w-9 rounded-full border bg-white shadow-sm`).
- **`Tab`** (`BinderUi.tsx`) — pill-shaped toggle buttons for sport filters, with sport-specific color variants (`football`, `soccer`, `default`).
- **`Chip`** (`BinderUi.tsx`) — smaller pill toggle buttons for filter facets (location, insert, parallel, numbered, data quality, duplicate/auto/patch/rookie flags), active state switching to a filled `bg-[var(--brand-primary)]` state.

---

## Colors

Only colors actually referenced in the codebase today:

- **`zinc`** — the dominant neutral scale (`zinc-50` through `zinc-900`), used for borders, backgrounds, body/helper text, and the default badge tone.
- **`brand-accent` (`#2563eb`, a blue)** — primary buttons, links (`btn-link`, "View all" link), focus rings, progress bars (Collection Goal bar, Growth chart bars).
- **`brand-primary` (`#111827`, near-black)** — active nav item background, active `Tab`/`Chip` fill, sidebar tooltip background.
- **`emerald` (green)** — positive tone (`Stat` positive value/border, MiniBadge `green` tone, "Goal achieved!" text).
- **`red`** — negative tone (`Stat` negative value/border), `btn-destructive`, `error-state`, MiniBadge `red` tone (high-priority data-quality warning).
- **`amber`** — warning tone (MiniBadge `amber` tone for Patch badges and lower-priority data-quality warnings, the "showing filtered" banner on Binder, warning severity on Next Actions).
- **`blue`** (as a MiniBadge tone, distinct from `brand-accent`) — used for `dots-blue`/`blue` parallel badge tones and "info" Next Action severity.
- **`purple`** — MiniBadge tone for Autograph.
- **`orange`, `yellow`, `pink`, `teal`, `black`, `white`, `silver`, `gold`, `lava`** — MiniBadge parallel-color tones only, matching real trading-card parallel names (not used anywhere outside `MiniBadge`).

There is no dark mode implementation beyond the CSS variable stubs in `globals.css` (`--background`/`--foreground` swap under `prefers-color-scheme: dark`); no component or page currently branches on a dark theme.

---

## Mobile

Principles already reflected in the code (not aspirational):

- **Stack before wrap** — nearly every multi-item header/toolbar row uses `flex flex-col gap-2/gap-4 sm:flex-row sm:items-center` so mobile stacks vertically and desktop becomes a single row (page headers with an action button, the Binder toolbar's search+sort row, the bulk action bar).
- **44px tap targets** — the `CardTile` selection checkbox is wrapped in a `flex h-11 w-11 items-center justify-center` label specifically to enlarge the tappable area beyond the visual checkbox size.
- **Responsive grids** — card grids step from 2 columns (mobile) to 3/4/5 columns at `sm:`/`lg:`/`xl:` (`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5`); Dashboard stat grids step from 1 to 4 columns (`grid gap-3 sm:grid-cols-4`).
- **Bottom navigation** — `AppShell` swaps its full sidebar for a fixed `sm:hidden` bottom tab bar (`fixed bottom-0 ... border-t bg-white/95 backdrop-blur`) with an overflow "More" button opening a bottom sheet (via `createPortal`) for secondary links (Account, Help, Backup, Export).
- **Collapsible filters** — the Binder's filter panel is hidden behind a `showFilters` toggle button on both the mobile and desktop toolbar rows, expanding into a `rounded-lg border bg-zinc-50 p-3` panel only when opened.
- **`display: contents` for responsive de-nesting** — several bulk-action-bar field groups use `sm:contents` so a wrapper `<div>` that stacks children vertically on mobile disappears at `sm:` and lets its children join the parent's single-row flex layout instead.
- **Card meta collapses on mobile** — `CardTile` shows only the player name on mobile (`sm:hidden` block) and reveals the full year/set/team/badge stack only at `sm:` and above, trading detail for scan speed on small screens.

---

## Component Inventory

**`src/components/ui/`** (the design-system primitives folder):
- `SectionHeader.tsx` — a plain `<h2>` section title (`text-lg font-semibold tracking-tight`).
- `SummaryChip.tsx` — a labeled value pill (`label` + `value`) matching the Binder snapshot strip.
- `StatCard.tsx` — a bordered panel with optional title/value/subtitle, used for single-metric callouts.
- `PageHeader.tsx` — a page title block with optional subtitle, a `default`/`large` typography variant, and an optional single action button (`btn-primary`/`btn-secondary`).

**`src/components/cards/`**:
- `BinderUi.tsx` — a grouped file of small shared primitives: `Stat` (tone-aware metric block), `Tab` (sport-filter pill), `Chip` (facet-filter pill), `MiniBadge` (tone-based small badge), `IconDots` (kebab icon).
- `BinderToolbar.tsx` — the Binder page's search/sort/filter toolbar, including the collapsible filter panel (location, insert, parallel, numbered, data quality, duplicate/auto/patch/rookie chips).
- `BinderGrid.tsx` — grid-layout wrapper for rendering grouped card tiles.
- `BinderSet.tsx` — a collapsible group section (used to cluster cards by set) with a header and toggle.
- `BinderStats.tsx` — Binder-specific stat summary block.
- `CardTile.tsx` — the individual card grid item (image, meta, badges, price, selection checkbox, kebab menu).
- `CardRowMenu.tsx` — the dropdown/menu opened from a card tile's kebab button.
- `CardImageUploader.tsx` — card image upload control.
- `CardImageCropModal.tsx` — modal for cropping an uploaded card image.
- `DeleteCardDialog.tsx` — confirmation dialog for deleting a card.

---

## Future Principles

- Prefer reusable primitives (`src/components/ui`) over hand-repeated markup once a pattern appears on 2+ pages.
- Avoid duplicated markup — where duplication already exists (e.g. the Binder filter panel appearing twice in the DOM as responsive variants, or the un-extracted `rounded-xl border bg-white p-4` "information card" pattern), treat it as a candidate for consolidation rather than a template to copy again.
- Mobile before desktop — write the stacked/mobile layout first (`flex-col`), then add `sm:`/`lg:` overrides, matching how every existing responsive block in the app is structured.
- Add components before migrating pages — extract a primitive only once its exact current markup is understood, then migrate pages one or two at a time, matching pixel-for-pixel before generalizing further.
- Verify before commit — confirm `npx tsc --noEmit` is clean and check real rendered output (ideally in a browser) before treating any design-system change as done.

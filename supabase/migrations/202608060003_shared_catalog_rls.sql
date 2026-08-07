-- Fix Supabase Advisor "RLS Disabled in Public" warnings on the shared
-- catalog tables: players, cards, card_players, parallel_types,
-- card_variants, checklist_sections, brands, manufacturers, and sets.
--
-- All nine were created without `enable row level security` (see
-- 202607040001_thebinder_database_v1.sql, 202607090001_catalog_v2_checklist_
-- sections.sql, 202607090002_catalog_v2_manufacturers_brands.sql) and, unlike
-- sports/leagues/teams (fixed in 202608060002_catalog_lookup_rls.sql), the
-- browser used to write to these tables directly via findOrCreate*
-- repository functions -- which is exactly why enabling RLS here was
-- deferred until now instead of being bundled into that earlier migration.
--
-- That write path no longer exists: the "Secure Catalog Writes" project
-- (Phase 1: POST /api/catalog/resolve-card, a service-role-backed route that
-- reuses the same find-before-create/collision logic; Phase 2: cards/new and
-- cards/[id]/edit's browser flows switched to call that route instead of
-- writing catalog tables directly, and a production bundle was inspected to
-- confirm no catalog insert calls ship to the client) already removed every
-- browser-side write to these tables. This migration is Phase 3: now that
-- browser writes are gone, these tables can safely get the same read-only
-- treatment sports/leagues/teams already have.
--
-- No client write policy is added here, intentionally. INSERT/UPDATE/DELETE
-- on these tables now only ever happen server-side, via
-- src/lib/catalog/resolveCatalogIdsServer.ts's service-role client, which
-- bypasses RLS entirely -- it needs no policy to keep working. Anon and
-- authenticated both get read-only access, matching current usage: /players,
-- /catalog, /catalog/cards/[id], /cards/new, and /cards/[id]/edit all read
-- these tables with no auth gate on the page itself.

begin;

alter table public.players enable row level security;

drop policy if exists "public read players" on public.players;

create policy "public read players"
on public.players
for select
to anon, authenticated
using (true);

alter table public.cards enable row level security;

drop policy if exists "public read cards" on public.cards;

create policy "public read cards"
on public.cards
for select
to anon, authenticated
using (true);

alter table public.card_players enable row level security;

drop policy if exists "public read card players" on public.card_players;

create policy "public read card players"
on public.card_players
for select
to anon, authenticated
using (true);

alter table public.parallel_types enable row level security;

drop policy if exists "public read parallel types" on public.parallel_types;

create policy "public read parallel types"
on public.parallel_types
for select
to anon, authenticated
using (true);

alter table public.card_variants enable row level security;

drop policy if exists "public read card variants" on public.card_variants;

create policy "public read card variants"
on public.card_variants
for select
to anon, authenticated
using (true);

alter table public.checklist_sections enable row level security;

drop policy if exists "public read checklist sections" on public.checklist_sections;

create policy "public read checklist sections"
on public.checklist_sections
for select
to anon, authenticated
using (true);

alter table public.brands enable row level security;

drop policy if exists "public read brands" on public.brands;

create policy "public read brands"
on public.brands
for select
to anon, authenticated
using (true);

alter table public.manufacturers enable row level security;

drop policy if exists "public read manufacturers" on public.manufacturers;

create policy "public read manufacturers"
on public.manufacturers
for select
to anon, authenticated
using (true);

alter table public.sets enable row level security;

drop policy if exists "public read sets" on public.sets;

create policy "public read sets"
on public.sets
for select
to anon, authenticated
using (true);

commit;

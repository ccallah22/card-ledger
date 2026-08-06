-- Fix Supabase Advisor "RLS Disabled in Public" warnings on the read-only
-- catalog lookup tables sports, leagues, and teams.
--
-- All three were created in 202607040001_thebinder_database_v1.sql without
-- `enable row level security`, like every other catalog table added since.
-- Unlike the catalog tables that hold user-authored data (cards, sets,
-- players, card_variants, card_players, parallel_types -- which the client
-- inserts into directly from src/lib/repositories/*.ts when a user adds a
-- card not yet in the catalog), sports/leagues/teams have no client-side
-- write path anywhere in src/ -- only listSports/listLeagues/listTeams
-- selects. They're loaded unconditionally by PlayerExplorer on /players,
-- which has no auth gate, so both anon and authenticated roles need read
-- access. A single public select policy per table covers current usage
-- exactly; no insert/update/delete policy is added since nothing writes to
-- these tables client-side. The other catalog tables are intentionally left
-- untouched here -- enabling RLS on them without an insert policy would
-- break that inline catalog-creation flow.

begin;

alter table public.sports enable row level security;

drop policy if exists "public read sports" on public.sports;

create policy "public read sports"
on public.sports
for select
to anon, authenticated
using (true);

alter table public.leagues enable row level security;

drop policy if exists "public read leagues" on public.leagues;

create policy "public read leagues"
on public.leagues
for select
to anon, authenticated
using (true);

alter table public.teams enable row level security;

drop policy if exists "public read teams" on public.teams;

create policy "public read teams"
on public.teams
for select
to anon, authenticated
using (true);

commit;

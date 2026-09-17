-- Canonical per-card Team architecture, Phase 1: database/repository
-- foundation only. See docs/architecture (Team audit) for the full design
-- rationale -- this migration implements exactly the approved decision:
-- Team belongs on the card_players relationship (the team a given player
-- was on FOR THIS SPECIFIC CARD), never on players.team_id (a general/
-- current player-team association that must never be read as historically
-- accurate for an arbitrary card).
--
-- Additive-only, like every other Catalog v2 migration:
--   - team_id is nullable, so every existing card_players row (production
--     currently has real rows from the 2025 Select Football import) stays
--     valid with team_id = null -- no backfill, no NOT NULL constraint.
--   - The existing primary key (card_id, player_id) is untouched.
--   - No new table (card_teams) is created -- see the audit's Option C:
--     team must be scoped per (card, player), not merely per card, to
--     correctly represent a multi-player card where different players
--     were on different teams; card_players is already exactly that row.
--   - No data is written by this migration. players.team_id is untouched
--     and is NOT used as a source for this column, in this migration or
--     otherwise -- see the audit's explicit prohibition.
--
-- RLS: no policy change needed. card_players already has RLS enabled with
-- a single "public read card players" SELECT policy (`using (true)`, to
-- anon/authenticated) from 202608060003_shared_catalog_rls.sql -- that
-- policy is row-level, not column-scoped, so it already covers this new
-- column for reads. No INSERT/UPDATE/DELETE policy exists or is added
-- here; all writes continue to happen only via the service-role client in
-- src/lib/catalog/resolveCatalogIdsServer.ts, which bypasses RLS entirely.

begin;

alter table public.card_players
  add column team_id bigint references public.teams(id) on delete set null;

create index if not exists card_players_team_id_idx
  on public.card_players (team_id);

commit;

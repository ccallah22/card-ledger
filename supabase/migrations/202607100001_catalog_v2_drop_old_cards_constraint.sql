-- Catalog v2: finalize card identity by dropping the old, now-incompatible
-- uniqueness constraint.
--
-- The 2025 Select Football import (see docs/architecture/catalog-v2-spec.md)
-- confirmed this blocks real data: every card in that release shares one
-- set_id, and the old cards_set_id_card_number_key constraint requires
-- card_number to be unique across the *entire set* -- but Catalog v2's
-- whole point is that different checklist sections legitimately reuse the
-- same card number within one set (e.g. "Base Club Level #5" and a
-- different section's "#5" are different cards). The new
-- cards_checklist_section_id_card_number_key constraint (added in
-- 202607090001_catalog_v2_checklist_sections.sql) already enforces
-- uniqueness at the correct scope -- the old constraint is now purely
-- harmful, not just redundant: real import attempts hit
-- `duplicate key value violates unique constraint
-- "cards_set_id_card_number_key"` on legitimate, distinct cards.
--
-- This migration ONLY drops that one old constraint. It does not:
--   - drop any column (cards.set_id and cards.is_insert both stay,
--     unchanged, for now -- see the Phase 1B migration's deferred
--     retirement plan)
--   - alter any data
--   - touch card_variants' constraints at all
--
-- cards.checklist_section_id is still nullable (no backfill/not-null pass
-- has happened yet -- see 202607090001's own deferred-work note), but that
-- doesn't weaken this constraint: Postgres never treats two NULLs as equal
-- for uniqueness purposes, and in practice the writer (write-catalog-v2.ts)
-- always supplies a real checklist_section_id when creating a card, so
-- cards_checklist_section_id_card_number_key alone is sufficient to
-- enforce card identity going forward.

begin;

alter table public.cards
  drop constraint cards_set_id_card_number_key;

commit;

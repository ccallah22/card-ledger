-- Vision Engine V3, Phase V3.5A2 pre-commit fix: preserve the original
-- manual-override timestamp through persistence.
--
-- 202608070001_manual_evidence_overrides.sql's replace_manual_evidence_
-- override always wrote created_at = now() (the column's own default),
-- discarding the local ManualOverride.createdAt (src/lib/evidence/
-- manualOverrides.ts) that records when the user actually made the
-- correction in the Evidence Inspector. That made the Evidence Timeline
-- untruthful after reload: a correction made minutes/hours before Save
-- would read as having happened at Save time instead. This migration
-- closes that gap by replacing the function with a version that takes the
-- caller's timestamp and uses it verbatim for the new row's created_at.
--
-- This is a CREATE OR REPLACE of the existing function, not a new table
-- migration -- 202608070001_manual_evidence_overrides.sql itself is left
-- untouched, per that migration's own "already applied, do not modify"
-- status.
--
-- Still deliberately excludes (unchanged from 202608070001):
--   - profile_id: ownership remains indirect via user_cards, same as
--     card_media/card_value_snapshots.
--   - source/confidence: always "manual_override"/1.0 by definition,
--     reconstructed in application code, never trusted from the database.
--     Accepting a caller-supplied created_at does not open this door --
--     created_at is merely WHEN the correction was made, not WHAT it
--     claims or how confident it is.

begin;

-- p_created_at is required (validated below), not defaulted to now(),
-- so a caller can never silently fall back to insert-time and mask a
-- missing local timestamp as if it were a genuine one.
create or replace function public.replace_manual_evidence_override(
  p_user_card_id uuid,
  p_field_name text,
  p_value jsonb,
  p_explanation text,
  p_created_at timestamptz
)
returns public.manual_evidence_overrides
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.manual_evidence_overrides;
begin
  if p_created_at is null then
    raise exception 'p_created_at must not be null';
  end if;

  update public.manual_evidence_overrides
  set superseded_at = now()
  where user_card_id = p_user_card_id
    and field_name = p_field_name
    and superseded_at is null;

  insert into public.manual_evidence_overrides
    (user_card_id, field_name, value, explanation, created_at)
  values
    (p_user_card_id, p_field_name, p_value, p_explanation, p_created_at)
  returning * into v_row;

  return v_row;
end;
$$;

-- Postgres does not treat a changed parameter list as replacing a grant;
-- the original 4-arg overload's grant/revoke doesn't apply here (this is
-- a genuinely different function signature, not the same one), so both
-- are set explicitly for the new 5-arg overload.
revoke all on function public.replace_manual_evidence_override(uuid, text, jsonb, text, timestamptz) from public;
grant execute on function public.replace_manual_evidence_override(uuid, text, jsonb, text, timestamptz) to authenticated;

-- The old 4-arg overload is no longer called by any application code
-- (src/lib/repositories/manualEvidenceOverrides.ts's upsertManualEvidenceOverride
-- now always supplies p_created_at) and would otherwise remain callable
-- indefinitely as dead surface that silently drops the caller's original
-- timestamp in favor of now() -- dropped so there is exactly one, correct
-- version of this function.
drop function if exists public.replace_manual_evidence_override(uuid, text, jsonb, text);

commit;

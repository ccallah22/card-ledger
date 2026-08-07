-- Vision Engine V3, Phase V3.5A1: durable manual evidence overrides.
--
-- Persistence foundation only -- see the V3.5A audit for the full
-- lifecycle/design rationale (ownership anchor, storage model comparison,
-- history model, RLS pattern). This migration creates the table,
-- constraints, indexes, RLS policies, and one small SECURITY INVOKER
-- function for atomic history-preserving replacement. Nothing in the
-- application reads or writes this table yet (see
-- src/lib/repositories/manualEvidenceOverrides.ts) -- it is not called
-- from /cards/new or /cards/[id]/edit until V3.5A2/V3.5A3.
--
-- Deliberately excludes:
--   - profile_id: ownership is checked indirectly via user_cards, matching
--     card_media/card_value_snapshots' existing pattern (see
--     202607100002_vision_engine_v2_card_media.sql,
--     202607050001_user_collections.sql) -- never duplicate profile_id
--     onto an indirectly-owned table.
--   - source/confidence: always "manual_override"/1.0 by definition,
--     reconstructed in application code (src/lib/evidence/manualOverrides.ts's
--     buildOverrideObservation), never trusted from the database. There is
--     nowhere here for the database to even claim otherwise.
--   - catalog_card_id/card_variant_id/card_media_id: an override is a
--     collector's interpretation of their own card, never anchored to
--     shared catalog data or to one specific photo (front/back images can
--     be replaced independently of the correction remaining valid).

begin;

create table public.manual_evidence_overrides (
  id bigserial primary key,
  user_card_id uuid not null references public.user_cards(id) on delete cascade,

  -- Matches EvidenceFieldName (src/lib/evidence/types.ts) exactly -- the
  -- full 16-field domain, not just the 10 fields the Evidence Inspector
  -- currently renders, so a future UI expansion never needs a schema
  -- migration just to allow overriding another already-fusable field.
  field_name text not null,

  -- Native JSON scalar only (a bare string/boolean, never an object
  -- wrapping it) -- matches card_media.ocr_output/vision_output's existing
  -- JSONB convention. source/confidence are never stored; see above.
  value jsonb not null,

  explanation text not null,

  created_at timestamptz not null default now(),

  -- null = this is the currently active override for its field.
  -- non-null = superseded (replaced or removed) -- retained for history,
  -- never hard-deleted by normal repository behavior.
  superseded_at timestamptz,

  constraint manual_evidence_overrides_field_name_check check (
    field_name in (
      'playerName', 'teamName', 'setName', 'brand', 'manufacturer', 'year',
      'cardNumber', 'cardName', 'parallelText', 'autographPresent',
      'memorabiliaPresent', 'serialNumberText', 'serialAreaVisible',
      'dominantColor', 'borderColor', 'orientation'
    )
  )
);

create index manual_evidence_overrides_user_card_id_idx
  on public.manual_evidence_overrides (user_card_id);

-- At most one ACTIVE override per field per card -- unlimited superseded
-- history rows for the same (user_card_id, field_name) remain allowed.
-- Same partial-unique-index technique already used by
-- card_media_user_card_media_type_side_key (where side <> 'none').
create unique index manual_evidence_overrides_active_key
  on public.manual_evidence_overrides (user_card_id, field_name)
  where superseded_at is null;

alter table public.manual_evidence_overrides enable row level security;

-- Ownership is indirect (manual_evidence_overrides -> user_cards ->
-- profile_id), following the exact pattern already established by
-- card_media and card_value_snapshots. anon has no policies at all here,
-- so RLS's default-deny leaves it with zero access, same baseline as every
-- other table in this project.
create policy "read own manual evidence overrides" on public.manual_evidence_overrides
  for select using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = manual_evidence_overrides.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "insert own manual evidence overrides" on public.manual_evidence_overrides
  for insert with check (
    exists (
      select 1 from public.user_cards uc
      where uc.id = manual_evidence_overrides.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "update own manual evidence overrides" on public.manual_evidence_overrides
  for update using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = manual_evidence_overrides.user_card_id and uc.profile_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.user_cards uc
      where uc.id = manual_evidence_overrides.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "delete own manual evidence overrides" on public.manual_evidence_overrides
  for delete using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = manual_evidence_overrides.user_card_id and uc.profile_id = auth.uid()
    )
  );

-- Atomic history-preserving replacement.
--
-- PostgREST (and the Supabase JS client on top of it) cannot run "supersede
-- the old active row, then insert the new one" as one transaction across
-- two separate calls. A crash/race between two such calls would still be
-- SAFE (the partial unique index above never allows two active rows to
-- coexist, so a concurrent second writer would simply fail its own insert
-- with a unique-violation rather than corrupt anything) but would NOT
-- reliably preserve history -- a failure between the two calls could leave
-- the field with zero active rows instead of one superseded + one active.
-- This function wraps both statements in a single transaction so the
-- history-preserving replace is genuinely atomic, not merely "usually
-- fine."
--
-- SECURITY INVOKER, deliberately not DEFINER: this function carries no
-- elevated privilege of its own -- it runs as the calling authenticated
-- user, so the exact same RLS UPDATE and INSERT policies above apply to
-- every statement inside it, identically to what would happen if the two
-- statements were sent as separate PostgREST calls. There is no ownership
-- check duplicated in this function body and no privilege-escalation
-- surface, unlike a SECURITY DEFINER function would introduce. This repo
-- already carries one SECURITY DEFINER advisor finding (handle_new_user,
-- 202607060001_profile_bootstrap_and_device_sessions.sql, which genuinely
-- needs elevated privilege to bootstrap a profile row during signup); this
-- migration deliberately avoids adding a second one. search_path is still
-- pinned as deterministic hygiene, not because it is required for safety
-- under SECURITY INVOKER the way it would be under SECURITY DEFINER.
create function public.replace_manual_evidence_override(
  p_user_card_id uuid,
  p_field_name text,
  p_value jsonb,
  p_explanation text
)
returns public.manual_evidence_overrides
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row public.manual_evidence_overrides;
begin
  update public.manual_evidence_overrides
  set superseded_at = now()
  where user_card_id = p_user_card_id
    and field_name = p_field_name
    and superseded_at is null;

  insert into public.manual_evidence_overrides (user_card_id, field_name, value, explanation)
  values (p_user_card_id, p_field_name, p_value, p_explanation)
  returning * into v_row;

  return v_row;
end;
$$;

-- Explicit least-privilege grant (defense in depth on top of RLS, which is
-- already sufficient on its own): anon cannot even call this function.
revoke all on function public.replace_manual_evidence_override(uuid, text, jsonb, text) from public;
grant execute on function public.replace_manual_evidence_override(uuid, text, jsonb, text) to authenticated;

commit;

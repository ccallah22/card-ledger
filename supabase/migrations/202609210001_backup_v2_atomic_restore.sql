-- TheBinder Backup V2 -- Phase 4D: the atomic database restore primitive.
--
-- This migration creates public.restore_backup_v2(p_payload jsonb), the ONE
-- Postgres function that performs an entire Backup V2 metadata-mode restore
-- as a single all-or-nothing transaction: delete the caller's existing
-- user_cards/locations, then insert the payload's locations/user_cards/
-- card_media/card_value_snapshots/manual_evidence_overrides. An exception
-- anywhere in this function body aborts the whole implicit transaction --
-- that is the actual atomicity mechanism (see Part 24 of this phase's
-- report for the full proof), not anything this migration adds explicitly.
--
-- This is a DATABASE PRIMITIVE ONLY. Nothing calls this function yet: no
-- API route, no client wrapper, no restore UI. It creates a genuinely
-- destructive capability, gated purely by RLS/auth.uid() + the validation
-- inside this function, deliberately not wired to anything reachable by a
-- real user in this phase.
--
-- ---------------------------------------------------------------------------
-- Trust boundary (read this before touching this function)
-- ---------------------------------------------------------------------------
-- The locked architecture (Backup V2 Phase 4A-4D) assumes an untrusted
-- client: parsing, structural validation, and read-only catalog/grading
-- preflight resolution (src/lib/backup/v2.ts, src/lib/backup/
-- restorePreflight.ts) all happen in application code BEFORE this function
-- is ever called -- but this function must not trust that any of that
-- happened. A malicious authenticated caller can invoke
-- restore_backup_v2(...) directly via PostgREST/Supabase RPC with a
-- hand-crafted payload, bypassing every client-side check entirely. Every
-- validation this function performs exists because of that possibility, not
-- because the "normal" caller needs it -- the normal caller's payload will
-- already satisfy every check here, by construction, since it was itself
-- produced by validated+preflighted data.
--
-- ---------------------------------------------------------------------------
-- Payload shape (produced by future client orchestration, not this
-- migration -- documented here only so the validation below is legible)
-- ---------------------------------------------------------------------------
-- {
--   "version": 2,
--   "cards": [{
--     "id": "<uuid, preserved user_cards.id>",
--     "resolvedCardId": <bigint, cards.id>,
--     "resolvedCardVariantId": <bigint, card_variants.id> | null,
--     "resolvedGradingCompanyId": <bigint, grading_companies.id> | null,
--     "team": <text> | null,
--     "locationName": <text> | null,
--     "serialNumber": <integer> | null,
--     "gradingStatus": "RAW" | "GRADED",
--     "condition": <text> | null,
--     "grade": <text> | null,
--     "certNumber": <text> | null,
--     "status": "HAVE" | "WANT" | "FOR_SALE" | "SOLD",
--     "purchasePrice": <numeric> | null,
--     "purchaseDate": <date string> | null,
--     "estimatedValue": <numeric> | null,
--     "askingPrice": <numeric> | null,
--     "soldPrice": <numeric> | null,
--     "soldDate": <date string> | null,
--     "soldFees": <numeric> | null,
--     "soldNotes": <text> | null,
--     "quantity": <integer>,
--     "notes": <text> | null,
--     "comps": <jsonb array> | null,
--     "createdAt": <timestamptz string> | null,
--     "updatedAt": <timestamptz string> | null
--   }],
--   "locations": [{ "name": <text>, "description": <text> | null }],
--   "media": [{
--     "userCardId": <uuid, must match a cards[].id in this same payload>,
--     "side": "front" | "back" | "none",
--     "isSlabbed": <boolean>,
--     "ocrOutput": <jsonb> | null,
--     "visionOutput": <jsonb> | null,
--     "catalogMatchVariantId": <bigint> | null,
--     "confidenceScore": <numeric 0-1> | null,
--     "imageContentHash": <text> | null,
--     "processingStatus": "uploaded" | "cropped" | "ocr_complete" |
--       "vision_complete" | "catalog_matched" | "verified" | "failed",
--     "createdAt": <timestamptz string>,
--     "updatedAt": <timestamptz string>
--   }],
--   "valueSnapshots": [{
--     "userCardId": <uuid, must match a cards[].id in this same payload>,
--     "marketValue": <numeric>,
--     "source": <text> | null,
--     "recordedAt": <timestamptz string>,
--     "createdAt": <timestamptz string>
--   }],
--   "manualEvidenceOverrides": [{
--     "userCardId": <uuid, must match a cards[].id in this same payload>,
--     "fieldName": <one of the 16 EvidenceFieldName values>,
--     "value": <jsonb>,
--     "explanation": <text>,
--     "createdAt": <timestamptz string>,
--     "supersededAt": <timestamptz string> | null
--   }]
-- }
--
-- `profileId` is deliberately NOT part of this shape at all -- ownership is
-- derived exclusively from auth.uid() (Part 4). If a future payload version
-- ever includes it for informational/audit purposes, this function must
-- keep ignoring it for authorization.

begin;

create or replace function public.restore_backup_v2(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_profile_id uuid := auth.uid();
  v_now timestamptz := now();

  v_card record;
  v_loc record;
  v_media record;
  v_snap record;
  v_override record;

  v_card_ids uuid[];
  v_distinct_card_id_count integer;

  v_variant_card_id bigint;
  v_match_count integer;
  v_dup_count integer;

  -- Scratch variables used only to force+catch a cast failure during
  -- validation (assignment, not PERFORM, so the syntax is unambiguous even
  -- without a live Postgres instance to test against -- see this phase's
  -- report). Their values are never read after assignment.
  v_scratch_uuid uuid;
  v_scratch_int integer;
  v_scratch_numeric numeric;
  v_scratch_date date;
  v_scratch_ts timestamptz;

  v_restored_cards integer := 0;
  v_restored_locations integer := 0;
  v_restored_media integer := 0;
  v_restored_snapshots integer := 0;
  v_restored_overrides integer := 0;
begin
  -- =========================================================================
  -- Part 4: authentication. Ownership is derived EXCLUSIVELY from auth.uid()
  -- -- never from any field inside p_payload. This is checked before any
  -- other work at all.
  -- =========================================================================
  if v_profile_id is null then
    raise exception 'restore_backup_v2: no authenticated user (auth.uid() is null)';
  end if;

  -- =========================================================================
  -- Part 6: top-level structural validation. Every expected collection is
  -- confirmed to actually be a JSON array before anything below ever calls
  -- jsonb_array_elements/jsonb_array_length on it -- a non-array value for
  -- any of these fails here with a clear message instead of a generic
  -- Postgres type error deeper in the function.
  -- =========================================================================
  if p_payload is null or jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'restore_backup_v2: payload must be a JSON object';
  end if;

  if (p_payload->'version') is null or (p_payload->>'version')::int is distinct from 2 then
    raise exception 'restore_backup_v2: payload.version must be exactly 2';
  end if;

  if jsonb_typeof(p_payload->'cards') is distinct from 'array' then
    raise exception 'restore_backup_v2: payload.cards must be a JSON array';
  end if;
  if jsonb_typeof(p_payload->'locations') is distinct from 'array' then
    raise exception 'restore_backup_v2: payload.locations must be a JSON array';
  end if;
  if jsonb_typeof(p_payload->'media') is distinct from 'array' then
    raise exception 'restore_backup_v2: payload.media must be a JSON array';
  end if;
  if jsonb_typeof(p_payload->'valueSnapshots') is distinct from 'array' then
    raise exception 'restore_backup_v2: payload.valueSnapshots must be a JSON array';
  end if;
  if jsonb_typeof(p_payload->'manualEvidenceOverrides') is distinct from 'array' then
    raise exception 'restore_backup_v2: payload.manualEvidenceOverrides must be a JSON array';
  end if;

  -- =========================================================================
  -- Part 5: payload size / row-count ceilings. Generous anti-abuse limits,
  -- not a realistic-collection constraint -- chosen because TheBinder's
  -- eventual maximum collection size is not yet known (see this phase's
  -- report). Checked before any destructive statement.
  -- =========================================================================
  if octet_length(p_payload::text) > 20 * 1024 * 1024 then
    raise exception 'restore_backup_v2: payload exceeds the 20 MiB size limit';
  end if;
  if jsonb_array_length(p_payload->'cards') > 25000 then
    raise exception 'restore_backup_v2: payload.cards exceeds the 25000-row limit';
  end if;
  if jsonb_array_length(p_payload->'locations') > 5000 then
    raise exception 'restore_backup_v2: payload.locations exceeds the 5000-row limit';
  end if;
  if jsonb_array_length(p_payload->'media') > 50000 then
    raise exception 'restore_backup_v2: payload.media exceeds the 50000-row limit';
  end if;
  if jsonb_array_length(p_payload->'valueSnapshots') > 250000 then
    raise exception 'restore_backup_v2: payload.valueSnapshots exceeds the 250000-row limit';
  end if;
  if jsonb_array_length(p_payload->'manualEvidenceOverrides') > 250000 then
    raise exception 'restore_backup_v2: payload.manualEvidenceOverrides exceeds the 250000-row limit';
  end if;

  -- =========================================================================
  -- Part 10 (locations, part 1): row-level validation + case-insensitive
  -- duplicate-name rejection, mirroring the exact normalization Backup V2's
  -- own client-side validator uses (trim().toLowerCase()) -- see
  -- src/lib/backup/v2.ts's validateBackupV2Manifest. Never silently
  -- deduplicated; rejected outright, same as the client-side check.
  -- =========================================================================
  for v_loc in
    select value as elem, ordinality
    from jsonb_array_elements(p_payload->'locations') with ordinality
  loop
    begin
      if jsonb_typeof(v_loc.elem) is distinct from 'object' then
        raise exception 'not a JSON object';
      end if;
      if (v_loc.elem->>'name') is null or btrim(v_loc.elem->>'name') = '' then
        raise exception 'name is required and must be non-empty';
      end if;
      if (v_loc.elem->'description') is not null
        and jsonb_typeof(v_loc.elem->'description') not in ('string', 'null') then
        raise exception 'description must be a string if present';
      end if;
    exception when others then
      raise exception 'restore_backup_v2: locations[%] invalid: %', v_loc.ordinality - 1, sqlerrm;
    end;
  end loop;

  select count(*) into v_dup_count
  from (
    select lower(btrim(elem->>'name')) as norm_name
    from jsonb_array_elements(p_payload->'locations') as elem
    group by lower(btrim(elem->>'name'))
    having count(*) > 1
  ) dups;
  if v_dup_count > 0 then
    raise exception 'restore_backup_v2: payload.locations contains % case-insensitively duplicate name(s)', v_dup_count;
  end if;

  -- =========================================================================
  -- Part 7 + Part 8: per-card validation -- required/typed fields, enum
  -- membership against the CURRENT user_cards check constraints, and
  -- read-only catalog/grading reference existence + the load-bearing
  -- variant->card consistency check. All before any destructive statement.
  -- =========================================================================
  for v_card in
    select value as elem, ordinality
    from jsonb_array_elements(p_payload->'cards') with ordinality
  loop
    begin
      if jsonb_typeof(v_card.elem) is distinct from 'object' then
        raise exception 'not a JSON object';
      end if;

      -- id: required, must cast to uuid (also the future user_cards.id).
      if (v_card.elem->>'id') is null then
        raise exception 'id is required';
      end if;
      v_scratch_uuid := (v_card.elem->>'id')::uuid;

      -- resolvedCardId: required, must cast to bigint, and must reference
      -- an existing public.cards row. The eventual FK would enforce
      -- existence too, but checking here gives a clear failure before any
      -- destructive statement runs (see Part 8's own rationale).
      if (v_card.elem->>'resolvedCardId') is null then
        raise exception 'resolvedCardId is required';
      end if;
      if not exists (
        select 1 from public.cards where id = (v_card.elem->>'resolvedCardId')::bigint
      ) then
        raise exception 'resolvedCardId % does not reference an existing catalog card', v_card.elem->>'resolvedCardId';
      end if;

      -- resolvedCardVariantId: null/missing OR must cast to bigint, exist,
      -- AND belong to resolvedCardId. This pairing check is load-bearing:
      -- a malicious caller could supply a genuinely valid resolvedCardId
      -- (card A) alongside a genuinely valid resolvedCardVariantId that
      -- actually belongs to a DIFFERENT card (card B) -- both individual FK
      -- checks would pass, so this explicit relationship check is the only
      -- thing that rejects that pairing.
      if (v_card.elem->'resolvedCardVariantId') is not null
        and jsonb_typeof(v_card.elem->'resolvedCardVariantId') is distinct from 'null' then
        select card_id into v_variant_card_id
        from public.card_variants
        where id = (v_card.elem->>'resolvedCardVariantId')::bigint;

        if v_variant_card_id is null then
          raise exception 'resolvedCardVariantId % does not reference an existing catalog variant', v_card.elem->>'resolvedCardVariantId';
        end if;
        if v_variant_card_id is distinct from (v_card.elem->>'resolvedCardId')::bigint then
          raise exception 'resolvedCardVariantId % belongs to catalog card %, not the resolvedCardId % this row supplied',
            v_card.elem->>'resolvedCardVariantId', v_variant_card_id, v_card.elem->>'resolvedCardId';
        end if;
      end if;

      -- resolvedGradingCompanyId: null/missing OR must cast to bigint and
      -- reference an existing grading_companies row. Never created here.
      if (v_card.elem->'resolvedGradingCompanyId') is not null
        and jsonb_typeof(v_card.elem->'resolvedGradingCompanyId') is distinct from 'null' then
        if not exists (
          select 1 from public.grading_companies
          where id = (v_card.elem->>'resolvedGradingCompanyId')::bigint
        ) then
          raise exception 'resolvedGradingCompanyId % does not reference an existing grading company', v_card.elem->>'resolvedGradingCompanyId';
        end if;
      end if;

      -- gradingStatus / status: must match the CURRENT user_cards check
      -- constraints exactly (user_cards_grading_status_check /
      -- user_cards_status_check, 202607050001_user_collections.sql). Not
      -- invented -- copied from the live constraint definitions re-read
      -- this phase.
      if (v_card.elem->>'gradingStatus') is null
        or (v_card.elem->>'gradingStatus') not in ('RAW', 'GRADED') then
        raise exception 'gradingStatus must be one of RAW, GRADED';
      end if;
      if (v_card.elem->>'status') is null
        or (v_card.elem->>'status') not in ('HAVE', 'WANT', 'FOR_SALE', 'SOLD') then
        raise exception 'status must be one of HAVE, WANT, FOR_SALE, SOLD';
      end if;

      -- condition: user_cards.condition has NO check constraint at the
      -- database level today (confirmed by re-reading
      -- 202607050001_user_collections.sql this phase -- it is plain
      -- nullable text). No enum is invented here that the schema itself
      -- does not have; only presence-as-text is implied by the ->>
      -- extraction below.

      -- quantity: required, must cast to integer (user_cards.quantity is
      -- `integer not null default 1` with no positivity/range check
      -- constraint -- none invented here either).
      if (v_card.elem->>'quantity') is null then
        raise exception 'quantity is required';
      end if;
      v_scratch_int := (v_card.elem->>'quantity')::integer;

      -- serialNumber: optional integer.
      if (v_card.elem->'serialNumber') is not null
        and jsonb_typeof(v_card.elem->'serialNumber') is distinct from 'null' then
        v_scratch_int := (v_card.elem->>'serialNumber')::integer;
      end if;

      -- money fields: optional numeric. Defect C correction (Phase 4D
      -- static review): casting straight from ->>'field' to ::numeric
      -- without first requiring the JSON value itself to be a JSON number
      -- let a malicious payload supply a JSON STRING like "NaN" or
      -- "Infinity" -- ::numeric's text parser explicitly accepts those
      -- words, producing a numeric value that cannot round-trip cleanly
      -- through JSON on read. Each field now explicitly requires
      -- jsonb_typeof = 'number' once it's confirmed present and non-null,
      -- mirroring the same pattern confidenceScore already used correctly.
      if (v_card.elem->'purchasePrice') is not null and jsonb_typeof(v_card.elem->'purchasePrice') is distinct from 'null' then
        if jsonb_typeof(v_card.elem->'purchasePrice') is distinct from 'number' then
          raise exception 'purchasePrice must be a JSON number if present';
        end if;
        v_scratch_numeric := (v_card.elem->>'purchasePrice')::numeric;
      end if;
      if (v_card.elem->'estimatedValue') is not null and jsonb_typeof(v_card.elem->'estimatedValue') is distinct from 'null' then
        if jsonb_typeof(v_card.elem->'estimatedValue') is distinct from 'number' then
          raise exception 'estimatedValue must be a JSON number if present';
        end if;
        v_scratch_numeric := (v_card.elem->>'estimatedValue')::numeric;
      end if;
      if (v_card.elem->'askingPrice') is not null and jsonb_typeof(v_card.elem->'askingPrice') is distinct from 'null' then
        if jsonb_typeof(v_card.elem->'askingPrice') is distinct from 'number' then
          raise exception 'askingPrice must be a JSON number if present';
        end if;
        v_scratch_numeric := (v_card.elem->>'askingPrice')::numeric;
      end if;
      if (v_card.elem->'soldPrice') is not null and jsonb_typeof(v_card.elem->'soldPrice') is distinct from 'null' then
        if jsonb_typeof(v_card.elem->'soldPrice') is distinct from 'number' then
          raise exception 'soldPrice must be a JSON number if present';
        end if;
        v_scratch_numeric := (v_card.elem->>'soldPrice')::numeric;
      end if;
      if (v_card.elem->'soldFees') is not null and jsonb_typeof(v_card.elem->'soldFees') is distinct from 'null' then
        if jsonb_typeof(v_card.elem->'soldFees') is distinct from 'number' then
          raise exception 'soldFees must be a JSON number if present';
        end if;
        v_scratch_numeric := (v_card.elem->>'soldFees')::numeric;
      end if;

      -- dates: optional date.
      if (v_card.elem->'purchaseDate') is not null and jsonb_typeof(v_card.elem->'purchaseDate') is distinct from 'null' then
        v_scratch_date := (v_card.elem->>'purchaseDate')::date;
      end if;
      if (v_card.elem->'soldDate') is not null and jsonb_typeof(v_card.elem->'soldDate') is distinct from 'null' then
        v_scratch_date := (v_card.elem->>'soldDate')::date;
      end if;

      -- timestamps: optional timestamptz (missing means "fall back to
      -- now()" at insert time -- see Part 14 -- not an error; only an
      -- unparsable PRESENT value is rejected here).
      if (v_card.elem->'createdAt') is not null and jsonb_typeof(v_card.elem->'createdAt') is distinct from 'null' then
        v_scratch_ts := (v_card.elem->>'createdAt')::timestamptz;
      end if;
      if (v_card.elem->'updatedAt') is not null and jsonb_typeof(v_card.elem->'updatedAt') is distinct from 'null' then
        v_scratch_ts := (v_card.elem->>'updatedAt')::timestamptz;
      end if;

      -- comps: optional, must be a JSON array if present (matches the
      -- column's own `jsonb not null default '[]'::jsonb` shape).
      if (v_card.elem->'comps') is not null and jsonb_typeof(v_card.elem->'comps') is distinct from 'null'
        and jsonb_typeof(v_card.elem->'comps') is distinct from 'array' then
        raise exception 'comps must be a JSON array if present';
      end if;

      -- locationName: null/empty means no location; non-empty must resolve
      -- case-insensitively against exactly one incoming location. "Exactly
      -- one" is guaranteed once "at least one" holds, since the duplicate
      -- check above already rejects any case-insensitive collision among
      -- payload.locations.
      if (v_card.elem->>'locationName') is not null and btrim(v_card.elem->>'locationName') <> '' then
        select count(*) into v_match_count
        from jsonb_array_elements(p_payload->'locations') as loc
        where lower(btrim(loc->>'name')) = lower(btrim(v_card.elem->>'locationName'));
        if v_match_count = 0 then
          raise exception 'locationName "%" has no matching entry in payload.locations', v_card.elem->>'locationName';
        end if;
      end if;
    exception when others then
      raise exception 'restore_backup_v2: cards[%] (id=%) invalid: %', v_card.ordinality - 1, coalesce(v_card.elem->>'id', '?'), sqlerrm;
    end;
  end loop;

  -- v_card_ids is used below (media/valueSnapshots/manualEvidenceOverrides
  -- userCardId cross-reference checks) via `= any (v_card_ids)`. Coalesced
  -- to an EMPTY array here, not left NULL, specifically because
  -- array_agg() over zero rows returns NULL when payload.cards is a valid,
  -- intentionally-empty array (Part 18) -- `x = any(NULL)` evaluates to
  -- NULL (neither true nor false), which `if not (...)` treats as false,
  -- silently skipping the cross-reference check entirely. An empty array
  -- makes `= any(...)` correctly evaluate to false for every comparison
  -- instead, so a media/snapshot/override row referencing any card id at
  -- all correctly fails validation when payload.cards is empty.
  select coalesce(array_agg((elem->>'id')::uuid), array[]::uuid[]) into v_card_ids
  from jsonb_array_elements(p_payload->'cards') as elem;

  -- Within-payload duplicate card id check. The eventual user_cards primary
  -- key would also catch this (Part 9), but checking here gives a clear
  -- failure before any destructive statement rather than a bare
  -- unique_violation during the insert.
  select count(distinct x) into v_distinct_card_id_count from unnest(v_card_ids) as x;
  if v_distinct_card_id_count is distinct from array_length(v_card_ids, 1) and array_length(v_card_ids, 1) is not null then
    raise exception 'restore_backup_v2: payload.cards contains duplicate id values';
  end if;

  -- =========================================================================
  -- Part 11: card_media validation -- required/typed fields, enum
  -- membership against the CURRENT card_media check constraints, the
  -- existing partial-uniqueness rule for (userCardId, side) where side <>
  -- 'none' (never a new rule for side = 'none'), userCardId cross-reference
  -- against this same payload's cards, and read-only catalogMatchVariantId
  -- existence. No path/Storage field is read or written anywhere here.
  -- =========================================================================
  for v_media in
    select value as elem, ordinality
    from jsonb_array_elements(p_payload->'media') with ordinality
  loop
    begin
      if jsonb_typeof(v_media.elem) is distinct from 'object' then
        raise exception 'not a JSON object';
      end if;

      if (v_media.elem->>'userCardId') is null then
        raise exception 'userCardId is required';
      end if;
      if not ((v_media.elem->>'userCardId')::uuid = any (v_card_ids)) then
        raise exception 'userCardId % does not reference a card in payload.cards', v_media.elem->>'userCardId';
      end if;

      if (v_media.elem->>'side') is null or (v_media.elem->>'side') not in ('front', 'back', 'none') then
        raise exception 'side must be one of front, back, none';
      end if;

      if jsonb_typeof(v_media.elem->'isSlabbed') is distinct from 'boolean' then
        raise exception 'isSlabbed must be a boolean';
      end if;

      if (v_media.elem->>'processingStatus') is null or (v_media.elem->>'processingStatus') not in (
        'uploaded', 'cropped', 'ocr_complete', 'vision_complete', 'catalog_matched', 'verified', 'failed'
      ) then
        raise exception 'processingStatus must be one of uploaded, cropped, ocr_complete, vision_complete, catalog_matched, verified, failed';
      end if;

      if (v_media.elem->'confidenceScore') is not null and jsonb_typeof(v_media.elem->'confidenceScore') is distinct from 'null' then
        if jsonb_typeof(v_media.elem->'confidenceScore') is distinct from 'number'
          or (v_media.elem->>'confidenceScore')::numeric < 0
          or (v_media.elem->>'confidenceScore')::numeric > 1 then
          raise exception 'confidenceScore must be a number between 0 and 1 if present';
        end if;
      end if;

      if (v_media.elem->'catalogMatchVariantId') is not null
        and jsonb_typeof(v_media.elem->'catalogMatchVariantId') is distinct from 'null' then
        if not exists (
          select 1 from public.card_variants where id = (v_media.elem->>'catalogMatchVariantId')::bigint
        ) then
          raise exception 'catalogMatchVariantId % does not reference an existing catalog variant', v_media.elem->>'catalogMatchVariantId';
        end if;
      end if;

      if (v_media.elem->>'createdAt') is null then
        raise exception 'createdAt is required';
      end if;
      v_scratch_ts := (v_media.elem->>'createdAt')::timestamptz;
      if (v_media.elem->>'updatedAt') is null then
        raise exception 'updatedAt is required';
      end if;
      v_scratch_ts := (v_media.elem->>'updatedAt')::timestamptz;
    exception when others then
      raise exception 'restore_backup_v2: media[%] invalid: %', v_media.ordinality - 1, sqlerrm;
    end;
  end loop;

  select count(*) into v_dup_count
  -- Defect D correction (Phase 4D static review): grouping on the raw JSON
  -- text of userCardId let two case-different-but-equal UUID strings evade
  -- this precheck (a UUID's canonical text form is case-insensitive). By
  -- this point every row's userCardId has already been cast successfully
  -- in the per-row validation loop above, so casting again here to group by
  -- the canonical uuid value is safe and cannot introduce a new failure.
  from (
    select (elem->>'userCardId')::uuid as uid, elem->>'side' as side
    from jsonb_array_elements(p_payload->'media') as elem
    where (elem->>'side') <> 'none'
    group by (elem->>'userCardId')::uuid, elem->>'side'
    having count(*) > 1
  ) dups;
  if v_dup_count > 0 then
    raise exception 'restore_backup_v2: payload.media contains % row(s) violating the one-row-per-(card,side) rule', v_dup_count;
  end if;

  -- =========================================================================
  -- Part 12: value snapshot validation.
  -- =========================================================================
  for v_snap in
    select value as elem, ordinality
    from jsonb_array_elements(p_payload->'valueSnapshots') with ordinality
  loop
    begin
      if jsonb_typeof(v_snap.elem) is distinct from 'object' then
        raise exception 'not a JSON object';
      end if;
      if (v_snap.elem->>'userCardId') is null then
        raise exception 'userCardId is required';
      end if;
      if not ((v_snap.elem->>'userCardId')::uuid = any (v_card_ids)) then
        raise exception 'userCardId % does not reference a card in payload.cards', v_snap.elem->>'userCardId';
      end if;
      -- Defect C correction (Phase 4D static review): `->>'marketValue' is
      -- null` already correctly rejects both a missing key and an explicit
      -- JSON null (-> >> collapses both to SQL NULL), but on its own still
      -- let a JSON STRING like "NaN"/"Infinity" through to ::numeric, since
      -- that text parser accepts those words. marketValue is required (not
      -- optional like the card money fields above), so every non-'number'
      -- JSON type -- including a well-formed numeric-looking string -- is
      -- rejected here.
      if (v_snap.elem->>'marketValue') is null then
        raise exception 'marketValue is required';
      end if;
      if jsonb_typeof(v_snap.elem->'marketValue') is distinct from 'number' then
        raise exception 'marketValue must be a JSON number';
      end if;
      v_scratch_numeric := (v_snap.elem->>'marketValue')::numeric;
      if (v_snap.elem->>'recordedAt') is null then
        raise exception 'recordedAt is required';
      end if;
      v_scratch_ts := (v_snap.elem->>'recordedAt')::timestamptz;
      if (v_snap.elem->>'createdAt') is null then
        raise exception 'createdAt is required';
      end if;
      v_scratch_ts := (v_snap.elem->>'createdAt')::timestamptz;
    exception when others then
      raise exception 'restore_backup_v2: valueSnapshots[%] invalid: %', v_snap.ordinality - 1, sqlerrm;
    end;
  end loop;

  -- =========================================================================
  -- Part 13: manual evidence override validation. fieldName is validated
  -- against the exact 16-value list copied from the CURRENT
  -- manual_evidence_overrides_field_name_check constraint (re-read this
  -- phase from 202608070001_manual_evidence_overrides.sql) -- if that
  -- constraint's value set ever changes, this list needs updating too, the
  -- same drift-risk note src/lib/backup/v2.ts's own EVIDENCE_FIELD_NAMES
  -- already carries. Full history (active AND superseded) is validated and
  -- restored -- never just the active row.
  -- =========================================================================
  for v_override in
    select value as elem, ordinality
    from jsonb_array_elements(p_payload->'manualEvidenceOverrides') with ordinality
  loop
    begin
      if jsonb_typeof(v_override.elem) is distinct from 'object' then
        raise exception 'not a JSON object';
      end if;
      if (v_override.elem->>'userCardId') is null then
        raise exception 'userCardId is required';
      end if;
      if not ((v_override.elem->>'userCardId')::uuid = any (v_card_ids)) then
        raise exception 'userCardId % does not reference a card in payload.cards', v_override.elem->>'userCardId';
      end if;
      if (v_override.elem->>'fieldName') is null or (v_override.elem->>'fieldName') not in (
        'playerName', 'teamName', 'setName', 'brand', 'manufacturer', 'year',
        'cardNumber', 'cardName', 'parallelText', 'autographPresent',
        'memorabiliaPresent', 'serialNumberText', 'serialAreaVisible',
        'dominantColor', 'borderColor', 'orientation'
      ) then
        raise exception 'fieldName must be one of the 16 supported evidence fields';
      end if;
      -- Defect B correction (Phase 4D static review): `->'value'` on an
      -- explicit JSON "null" is a real, non-SQL-NULL jsonb value, so the
      -- original `is null` check alone only caught a genuinely MISSING key,
      -- not an explicit "value": null -- letting a nonsensical null-value
      -- override row slip through and satisfy the column's NOT NULL
      -- constraint (jsonb 'null' is not SQL NULL). No type restriction
      -- narrower than "present and not JSON null" is added -- false, 0, "",
      -- objects, and arrays are all still valid values here, preserved
      -- exactly as supplied by the INSERT below.
      if (v_override.elem->'value') is null or jsonb_typeof(v_override.elem->'value') = 'null' then
        raise exception 'value is required and must not be JSON null';
      end if;
      if (v_override.elem->>'explanation') is null then
        raise exception 'explanation is required';
      end if;
      if (v_override.elem->>'createdAt') is null then
        raise exception 'createdAt is required';
      end if;
      v_scratch_ts := (v_override.elem->>'createdAt')::timestamptz;
      if (v_override.elem->'supersededAt') is not null and jsonb_typeof(v_override.elem->'supersededAt') is distinct from 'null' then
        v_scratch_ts := (v_override.elem->>'supersededAt')::timestamptz;
      end if;
    exception when others then
      raise exception 'restore_backup_v2: manualEvidenceOverrides[%] invalid: %', v_override.ordinality - 1, sqlerrm;
    end;
  end loop;

  select count(*) into v_dup_count
  -- Defect D correction (Phase 4D static review): same case-normalization
  -- fix as the media precheck above -- group by the canonical cast uuid
  -- value, not the raw JSON text. Superseded rows remain fully unlimited
  -- (the where clause below is unchanged) -- only active rows participate.
  from (
    select (elem->>'userCardId')::uuid as uid, elem->>'fieldName' as field_name
    from jsonb_array_elements(p_payload->'manualEvidenceOverrides') as elem
    where (elem->'supersededAt') is null or jsonb_typeof(elem->'supersededAt') = 'null'
    group by (elem->>'userCardId')::uuid, elem->>'fieldName'
    having count(*) > 1
  ) dups;
  if v_dup_count > 0 then
    raise exception 'restore_backup_v2: payload.manualEvidenceOverrides contains % row(s) with more than one active override for the same card/field', v_dup_count;
  end if;

  -- =========================================================================
  -- Part 15: atomic delete. Every pre-write validation above has already
  -- succeeded, so nothing beyond this point should fail for a well-formed
  -- payload -- but if anything still does (e.g. Part 9's UUID collision
  -- defense), this DELETE rolls back along with everything else, since it
  -- is part of the same function-call transaction. Only the caller's own
  -- rows are ever targeted (profile_id = v_profile_id, i.e. auth.uid()) --
  -- RLS is never disabled and no other user's rows are touched. card_media,
  -- card_value_snapshots, and manual_evidence_overrides are never deleted
  -- explicitly here -- they cascade automatically from user_cards via each
  -- table's existing `on delete cascade` foreign key.
  -- =========================================================================
  delete from public.user_cards where profile_id = v_profile_id;
  delete from public.locations where profile_id = v_profile_id;

  -- =========================================================================
  -- Part 16: atomic insert, in the documented order. Any exception here
  -- (e.g. the user_cards primary-key collision defense in Part 9) propagates
  -- and rolls back everything above, including the deletes just performed --
  -- there is no catch-and-ignore anywhere in this function.
  -- =========================================================================

  -- 1. locations -- REPLACED, not merged (Part 10). No id/timestamps are
  -- preserved from the payload (Backup V2 never exported them); the table's
  -- own defaults apply.
  insert into public.locations (profile_id, name, description)
  select v_profile_id, btrim(elem->>'name'), elem->>'description'
  from jsonb_array_elements(p_payload->'locations') as elem;

  get diagnostics v_restored_locations = row_count;

  -- 2. user_cards -- id is PRESERVED (never regenerated, never remapped;
  -- see Part 9). location_id is resolved via a case-insensitive join
  -- against the locations just inserted above -- this SELECT is itself
  -- subject to the same "read own locations" RLS policy as any other
  -- query under SECURITY INVOKER, and it is satisfied here because
  -- loc.profile_id = v_profile_id = auth.uid(). Fields absent from the V2
  -- payload (purchase_source, the legacy image_path/thumb_path/
  -- image_shared/image_type columns) are left at their column
  -- default/null -- nothing is fabricated (Part 17).
  insert into public.user_cards (
    id, profile_id, card_id, card_variant_id, location_id,
    team_name, serial_number,
    grading_status, condition, grading_company_id, grade, cert_number,
    status,
    purchase_price, purchase_date, purchase_source,
    estimated_value,
    asking_price, sold_price, sold_date, sold_fees, sold_notes,
    quantity, notes, comps,
    created_at, updated_at
  )
  select
    (c->>'id')::uuid,
    v_profile_id,
    (c->>'resolvedCardId')::bigint,
    (c->>'resolvedCardVariantId')::bigint,
    loc.id,
    c->>'team',
    (c->>'serialNumber')::integer,
    c->>'gradingStatus',
    c->>'condition',
    (c->>'resolvedGradingCompanyId')::bigint,
    c->>'grade',
    c->>'certNumber',
    c->>'status',
    (c->>'purchasePrice')::numeric,
    (c->>'purchaseDate')::date,
    null, -- purchase_source: not part of the V2 contract; never fabricated
    (c->>'estimatedValue')::numeric,
    (c->>'askingPrice')::numeric,
    (c->>'soldPrice')::numeric,
    (c->>'soldDate')::date,
    (c->>'soldFees')::numeric,
    c->>'soldNotes',
    (c->>'quantity')::integer,
    c->>'notes',
    -- Defect A correction (Phase 4D static review): COALESCE alone does not
    -- catch an explicit JSON "null" (as opposed to a missing key), because
    -- c->'comps' on a JSON-null value is a real, non-SQL-NULL jsonb value --
    -- COALESCE only substitutes on true SQL NULL. Validation above already
    -- allows exactly {missing, JSON null, array} through and rejects
    -- anything else, so by this point c->'comps' is always one of those
    -- three shapes; this CASE explicitly maps the first two to the empty
    -- array default and preserves the array verbatim otherwise.
    case when jsonb_typeof(c->'comps') = 'array' then c->'comps' else '[]'::jsonb end,
    coalesce((c->>'createdAt')::timestamptz, v_now),
    coalesce((c->>'updatedAt')::timestamptz, v_now)
  from jsonb_array_elements(p_payload->'cards') as c
  left join public.locations loc
    on loc.profile_id = v_profile_id
    and (c->>'locationName') is not null
    and btrim(c->>'locationName') <> ''
    and lower(btrim(loc.name)) = lower(btrim(c->>'locationName'));

  get diagnostics v_restored_cards = row_count;

  -- 3. card_media -- metadata only (Part 11). original_path/processed_path/
  -- thumbnail_path are ALWAYS null here: this payload carries no image
  -- bytes and no Storage paths, and no old live path is ever reused or
  -- inferred. media_type is always 'image' (the only value the check
  -- constraint allows today; BackupV2Media never carries it -- see
  -- v2.ts's own comment on why it is excluded from the export contract).
  insert into public.card_media (
    user_card_id, media_type, side, is_slabbed,
    original_path, processed_path, thumbnail_path,
    ocr_output, vision_output, catalog_match_id,
    confidence_score, image_content_hash, processing_status,
    created_at, updated_at
  )
  select
    (m->>'userCardId')::uuid,
    'image',
    m->>'side',
    (m->>'isSlabbed')::boolean,
    null, null, null,
    m->'ocrOutput',
    m->'visionOutput',
    (m->>'catalogMatchVariantId')::bigint,
    (m->>'confidenceScore')::numeric,
    m->>'imageContentHash',
    m->>'processingStatus',
    (m->>'createdAt')::timestamptz,
    (m->>'updatedAt')::timestamptz
  from jsonb_array_elements(p_payload->'media') as m;

  get diagnostics v_restored_media = row_count;

  -- 4. card_value_snapshots -- full history restored; row id is NOT
  -- preserved (V2 never exported it -- Part 12), so the column default
  -- (bigserial) generates a fresh id for every row.
  insert into public.card_value_snapshots (
    user_card_id, market_value, source, recorded_at, created_at
  )
  select
    (s->>'userCardId')::uuid,
    (s->>'marketValue')::numeric,
    s->>'source',
    (s->>'recordedAt')::timestamptz,
    (s->>'createdAt')::timestamptz
  from jsonb_array_elements(p_payload->'valueSnapshots') as s;

  get diagnostics v_restored_snapshots = row_count;

  -- 5. manual_evidence_overrides -- full history restored (active AND
  -- superseded) via a direct bulk insert, never through
  -- replace_manual_evidence_override (that function always stamps a NEW
  -- supersession event, which is the wrong operation for restoring
  -- already-decided history verbatim -- Part 13). Supersession is never
  -- recomputed here; supersededAt is preserved exactly as supplied. The
  -- existing partial unique index (manual_evidence_overrides_active_key)
  -- remains the final safety net against more than one active row per
  -- (card, field) slipping through, on top of the pre-check above.
  insert into public.manual_evidence_overrides (
    user_card_id, field_name, value, explanation, created_at, superseded_at
  )
  select
    (o->>'userCardId')::uuid,
    o->>'fieldName',
    o->'value',
    o->>'explanation',
    (o->>'createdAt')::timestamptz,
    (o->>'supersededAt')::timestamptz
  from jsonb_array_elements(p_payload->'manualEvidenceOverrides') as o;

  get diagnostics v_restored_overrides = row_count;

  -- =========================================================================
  -- Part 19: return shape -- a small structured result for future
  -- orchestration/UI, never sensitive data.
  -- =========================================================================
  return jsonb_build_object(
    'restoredCards', v_restored_cards,
    'restoredLocations', v_restored_locations,
    'restoredMedia', v_restored_media,
    'restoredValueSnapshots', v_restored_snapshots,
    'restoredManualEvidenceOverrides', v_restored_overrides
  );
end;
$$;

-- Explicit least-privilege grants (Part 2) -- the same defense-in-depth
-- pattern already established by replace_manual_evidence_override
-- (202608070001_manual_evidence_overrides.sql) and check_ai_rate_limit
-- (202609150001_ai_api_rate_limits.sql): a Postgres function grants EXECUTE
-- to PUBLIC by default unless explicitly revoked, so this is not optional
-- hygiene -- without it, `anon` would be able to call this function (RLS on
-- the underlying tables would still block anon's writes today since every
-- policy here requires auth.uid() = profile_id and auth.uid() is null for
-- an anon request, but relying on that alone would leave this function's
-- own access control entirely implicit).
revoke all on function public.restore_backup_v2(jsonb) from public;
revoke all on function public.restore_backup_v2(jsonb) from anon;
grant execute on function public.restore_backup_v2(jsonb) to authenticated;

commit;

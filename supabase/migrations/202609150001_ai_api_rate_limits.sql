-- AI endpoint cost/abuse protection (TheBinder V1 finish-line roadmap,
-- Phase 1 / Task #2): a durable, Postgres-backed rate limiter shared by
-- /api/ocr, /api/image-check, and /api/vision -- the three routes that call
-- OpenAI. This repo's own src/app/api/vision/route.ts already carried an
-- explicit comment (since this task's predecessor phase) explaining why an
-- in-process counter (e.g. a module-scope Map) cannot work correctly here:
-- this project runs on Vercel-style serverless infrastructure, where a
-- request can land on any of several isolated instances with no shared
-- memory between them. This migration is that comment's resolution --
-- state lives in the one durable, already-present, shared backend
-- (Supabase Postgres) instead of adding a new paid dependency (e.g.
-- Upstash Redis), which the architecture does not otherwise need.
--
-- One combined "ai" budget is used across all three routes (not three
-- separate per-endpoint quotas) -- a real Add Card session legitimately
-- interleaves image-check, OCR, and Vision calls for the same card, and a
-- combined budget can't be dodged by spreading abuse across endpoints.
--
-- Two window kinds per user, both tracked in the same table:
--   - 'burst': a 60-second rolling-bucket window, max 20 requests.
--   - 'daily': a UTC calendar-day window, max 300 requests.
-- These are the approved V1 production constants, hardcoded inside the RPC
-- below -- never accepted as a parameter from any caller, so a client can
-- never request its own limit.

begin;

create table public.api_rate_limit_counters (
  id bigserial primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Fixed to 'ai' for this phase (the one combined OCR/image-check/Vision
  -- budget) -- a text column rather than a hardcoded assumption in every
  -- query, so a genuinely distinct future budget (unrelated to these three
  -- routes) could reuse this same table without a schema change.
  bucket text not null,
  window_kind text not null check (window_kind in ('burst', 'daily')),
  window_start timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

-- The atomic upsert below (see check_ai_rate_limit) depends entirely on
-- this unique constraint: it is what makes "insert a new window row, or
-- increment the existing one" a single, race-free statement rather than a
-- read-then-write race. One row per (user, bucket, window kind, window
-- start) -- never more.
create unique index api_rate_limit_counters_user_bucket_window_key
  on public.api_rate_limit_counters (user_id, bucket, window_kind, window_start);

-- Supports the cleanup delete below and any future "how much has this user
-- used recently" read, without a full-table scan.
create index api_rate_limit_counters_user_window_start_idx
  on public.api_rate_limit_counters (user_id, window_start);

-- RLS enabled with ZERO policies -- this table is never intended to be
-- read or written directly by any client role (anon or authenticated),
-- only through check_ai_rate_limit() below. With no policy for any
-- command, Postgres RLS denies every operation to every role it applies
-- to (anon, authenticated) regardless of table-level grants -- the same
-- "reachable only through an approved function" pattern already
-- established in this repo for manual_evidence_overrides
-- (202608070001_manual_evidence_overrides.sql).
alter table public.api_rate_limit_counters enable row level security;

-- Belt-and-braces alongside RLS (RLS alone is already sufficient, since
-- neither anon nor authenticated has BYPASSRLS): explicitly remove any
-- default table-level privilege a role might otherwise have.
revoke all on public.api_rate_limit_counters from public, anon, authenticated;

-- Atomically checks and consumes one unit of the caller's combined AI
-- budget for this request, deriving identity exclusively from the
-- session's own auth.uid() -- never a parameter, so no caller can check or
-- consume another user's quota, and no caller can supply its own limit.
--
-- SECURITY DEFINER is necessary, not incidental: api_rate_limit_counters
-- has RLS enabled with no policies, so a SECURITY INVOKER function running
-- as the calling `authenticated` role would have its own INSERT blocked by
-- that same RLS, exactly like any other direct client write would be. This
-- function must run as its owner (the migration-applying role, effectively
-- bypassing RLS the same way other SECURITY DEFINER functions in this
-- project already do, e.g. handle_new_user() in
-- 202607060001_profile_bootstrap_and_device_sessions.sql) so it can
-- maintain counters a client is never allowed to touch directly.
-- `set search_path = public` is required alongside SECURITY DEFINER to
-- prevent a caller-controlled search_path from substituting a different
-- `api_rate_limit_counters` relation than the one this function intends to
-- write.
--
-- Concurrency correctness: the two `insert ... on conflict (...) do update
-- ... returning request_count` statements below are each a single atomic
-- Postgres statement against the unique index created above. Two
-- concurrent calls for the same (user_id, bucket, window_kind,
-- window_start) cannot both "win" an insert and then both separately
-- increment a stale value the way a read-count-then-write-count sequence
-- in application code could -- Postgres serializes conflicting upserts on
-- the same key via the unique index's row lock, so each call's
-- `returning request_count` reflects a value that already accounts for
-- every other concurrent call that committed first. No explicit
-- application-level locking, and no SELECT-then-decide race window, exists
-- anywhere in this function.
--
-- Burst-before-daily ordering matters: if the burst window is already at
-- its limit, this function returns immediately WITHOUT ever touching the
-- daily counter -- a request that never gets past the cheaper, more
-- specific burst check should not also consume a unit of the coarser daily
-- allowance. Conversely, if burst allows but daily then blocks, the burst
-- counter legitimately reflects a real attempt that happened in that
-- window; it is not "double-charged," it is simply two different
-- questions ("how many attempts in the last 60 seconds" vs. "how many
-- today") answered from the same underlying attempt. Every code path
-- either commits both upserts (allowed) or exactly one (burst-rejected) --
-- there is no path that leaves the two counters in a partially-applied,
-- inconsistent state relative to each other, since each upsert is it own
-- complete statement and the function either returns right after the
-- first or proceeds to run (and commit) the second in full.
create or replace function public.check_ai_rate_limit()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := now();
  v_bucket constant text := 'ai';
  v_burst_window_seconds constant integer := 60;
  v_burst_max constant integer := 20;
  v_daily_max constant integer := 300;
  v_burst_window_start timestamptz;
  v_daily_window_start timestamptz;
  v_burst_count integer;
  v_daily_count integer;
begin
  -- Defense in depth only: PostgREST/Postgres already refuse to let an
  -- unauthenticated (anon-role) caller reach this function at all, since
  -- EXECUTE is granted to `authenticated` only (see below) -- auth.uid()
  -- being null here should not be reachable in normal operation. Still
  -- handled explicitly, and still blocked, rather than assumed impossible.
  if v_user_id is null then
    return query select false, v_burst_window_seconds;
    return;
  end if;

  -- Fixed-width burst bucket: the 60-second period containing `now()`,
  -- identified by its own start time so every request in the same period
  -- maps to the same row.
  v_burst_window_start := to_timestamp(
    floor(extract(epoch from v_now) / v_burst_window_seconds) * v_burst_window_seconds
  );

  insert into public.api_rate_limit_counters (user_id, bucket, window_kind, window_start, request_count)
  values (v_user_id, v_bucket, 'burst', v_burst_window_start, 1)
  on conflict (user_id, bucket, window_kind, window_start)
  do update set
    request_count = public.api_rate_limit_counters.request_count + 1,
    updated_at = v_now
  returning request_count into v_burst_count;

  if v_burst_count > v_burst_max then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (
          v_burst_window_start + make_interval(secs => v_burst_window_seconds) - v_now
        )))::integer
      );
    return;
  end if;

  -- UTC calendar-day bucket, independent of the database session's own
  -- timezone setting: convert `now()` to a UTC-wall-clock timestamp first,
  -- truncate to the day, then reinterpret that naive timestamp as UTC.
  v_daily_window_start := date_trunc('day', v_now at time zone 'utc') at time zone 'utc';

  insert into public.api_rate_limit_counters (user_id, bucket, window_kind, window_start, request_count)
  values (v_user_id, v_bucket, 'daily', v_daily_window_start, 1)
  on conflict (user_id, bucket, window_kind, window_start)
  do update set
    request_count = public.api_rate_limit_counters.request_count + 1,
    updated_at = v_now
  returning request_count into v_daily_count;

  if v_daily_count > v_daily_max then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (
          v_daily_window_start + interval '1 day' - v_now
        )))::integer
      );
    return;
  end if;

  return query select true, 0;
end;
$$;

-- Least-privilege: no role may call this by default (including the
-- table's own RLS-bypassing owner privilege isn't what's being granted
-- here -- EXECUTE on the function is a separate privilege from the
-- function's internal SECURITY DEFINER execution context). Only a
-- genuinely signed-in user may consume their own quota; anon is
-- deliberately never granted EXECUTE, so an unauthenticated caller is
-- refused by PostgREST before this function's body ever runs -- the route
-- handlers' own auth.getUser() checks are the first line of defense, this
-- grant is the second.
revoke all on function public.check_ai_rate_limit() from public;
grant execute on function public.check_ai_rate_limit() to authenticated;

commit;

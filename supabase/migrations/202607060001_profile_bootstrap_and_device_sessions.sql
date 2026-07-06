-- Fix fresh-user onboarding and restore device session tracking.
--
-- Discovered during runtime verification: brand-new signups had no matching
-- public.profiles row (no trigger existed to create one), which made every
-- profile-scoped page ("Not logged in") fail even with a valid session.
-- Also: device_sessions was referenced by src/lib/db/deviceSessions.ts and
-- AppShell.tsx's heartbeat, but its DDL only ever lived in the untracked
-- supabase_old_sql/device_sessions.sql reference file, never an applied
-- migration -- so the table never actually existed in this database.

begin;

-- 1. Auto-create a profiles row for every new auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2. Backfill profiles for any existing auth users missing one (this
-- includes the test accounts created earlier during runtime verification).
insert into public.profiles (id, display_name)
select u.id, u.email
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null
on conflict (id) do nothing;

-- 3. Restore device_sessions (verbatim from supabase_old_sql/device_sessions.sql,
-- matching the columns/onConflict target src/lib/db/deviceSessions.ts expects).
create table public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index device_sessions_user_device_uidx
  on public.device_sessions (user_id, device_id);

create index device_sessions_user_last_seen_idx
  on public.device_sessions (user_id, last_seen_at desc);

alter table public.device_sessions enable row level security;

create policy "read own device sessions" on public.device_sessions
  for select using (auth.uid() = user_id);

create policy "insert own device sessions" on public.device_sessions
  for insert with check (auth.uid() = user_id);

create policy "update own device sessions" on public.device_sessions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own device sessions" on public.device_sessions
  for delete using (auth.uid() = user_id);

commit;

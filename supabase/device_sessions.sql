-- Per-device session tracking for account security UI
create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_name text,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists device_sessions_user_device_uidx
  on public.device_sessions (user_id, device_id);

create index if not exists device_sessions_user_last_seen_idx
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

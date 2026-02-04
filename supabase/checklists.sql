-- Checklist entries stored in Supabase
create table if not exists public.checklist_entries (
  id bigserial primary key,
  set_key text not null,
  number text not null,
  name text not null,
  team text,
  section text not null,
  created_at timestamptz default now()
);

create index if not exists checklist_entries_set_key_idx on public.checklist_entries (set_key);

alter table public.checklist_entries enable row level security;

-- Anyone can read checklist entries
create policy "read checklist entries" on public.checklist_entries
  for select using (true);

-- Only authenticated users can write (you can tighten this later)
create policy "insert checklist entries" on public.checklist_entries
  for insert with check (auth.uid() is not null);

create policy "update checklist entries" on public.checklist_entries
  for update using (auth.uid() is not null);

create policy "delete checklist entries" on public.checklist_entries
  for delete using (auth.uid() is not null);

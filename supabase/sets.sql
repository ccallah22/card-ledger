-- Sets catalog stored in Supabase
create table if not exists public.sets (
  id bigserial primary key,
  year text not null,
  name text not null,
  brand text,
  sport text,
  checklist_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists sets_year_name_uq on public.sets (year, name);

alter table public.sets enable row level security;

-- Anyone can read sets
create policy "read sets" on public.sets
  for select using (true);

-- Only authenticated users can write
create policy "insert sets" on public.sets
  for insert with check (auth.uid() is not null);

create policy "update sets" on public.sets
  for update using (auth.uid() is not null);

create policy "delete sets" on public.sets
  for delete using (auth.uid() is not null);

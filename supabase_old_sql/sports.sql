create table if not exists public.sports (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger update_sports_updated_at
before update on public.sports
for each row
execute function public.update_updated_at_column();


create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  name text not null,
  abbreviation text,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sport_id, slug)
);

create trigger update_positions_updated_at
before update on public.positions
for each row
execute function public.update_updated_at_column();


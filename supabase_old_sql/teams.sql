create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  sport_id uuid not null references public.sports(id),
  name text not null,
  nickname text,
  abbreviation text,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (sport_id, slug)
);

create trigger update_teams_updated_at
before update on public.teams
for each row
execute function public.update_updated_at_column();

create index if not exists idx_teams_sport_id
on public.teams (sport_id);


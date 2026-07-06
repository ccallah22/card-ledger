create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  first_name text,
  last_name text,
  full_name text not null,
  nickname text,
  search_name text,
  sport_id uuid references public.sports(id),
  primary_position_id uuid references public.positions(id),
  primary_team_id uuid references public.teams(id),
  rookie_year integer,
  debut_year integer,
  retirement_year integer,
  hall_of_fame boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger update_players_updated_at
before update on public.players
for each row
execute function public.update_updated_at_column();

create index if not exists idx_players_full_name
on public.players (full_name);

create index if not exists idx_players_search_name
on public.players (search_name);

create index if not exists idx_players_primary_position_id
on public.players (primary_position_id);

create index if not exists idx_players_sport_id
on public.players (sport_id);

create index if not exists idx_players_primary_team_id
on public.players (primary_team_id);

create index if not exists idx_players_rookie_year
on public.players (rookie_year);

create index if not exists idx_players_debut_year
on public.players (debut_year);

create index if not exists idx_players_retirement_year
on public.players (retirement_year);


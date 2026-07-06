-- TheBinder Database v1
-- Creates the first production-ready schema for cards, variants, ownership, storage, values, and lookup data.

begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.sports (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.leagues (
  id bigserial primary key,
  sport_id bigint not null references public.sports(id) on delete restrict,
  name text not null,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint leagues_sport_id_slug_key unique (sport_id, slug),
  constraint leagues_sport_id_name_key unique (sport_id, name)
);
create table public.teams (
  id bigserial primary key,
  league_id bigint not null references public.leagues(id) on delete restrict,
  name text not null,
  city text,
  abbreviation text,
  slug text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint teams_league_id_slug_key unique (league_id, slug),
  constraint teams_league_id_name_key unique (league_id, name)
);
create table public.players (
  id bigserial primary key,
  league_id bigint references public.leagues(id) on delete restrict,
  team_id bigint references public.teams(id) on delete set null,
  full_name text not null,
  first_name text,
  last_name text,
  slug text not null,
  search_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint players_league_id_slug_key unique (league_id, slug)
);
create table public.sets (
  id bigserial primary key,
  sport_id bigint references public.sports(id) on delete restrict,
  league_id bigint references public.leagues(id) on delete restrict,
  name text not null,
  manufacturer text,
  brand text,
  release_year integer,
  season text,
  slug text not null,
  search_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint sets_slug_key unique (slug)
);
create table public.cards (
  id bigserial primary key,
  set_id bigint not null references public.sets(id) on delete restrict,

  card_number text not null,
  title text,

  rookie_card boolean not null default false,
  printed_year integer,
  release_year integer,

  is_insert boolean not null default false,
  is_autograph boolean not null default false,
  is_memorabilia boolean not null default false,

  search_text text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint cards_set_id_card_number_key unique (set_id, card_number)
);
create table public.card_players (
  card_id bigint not null references public.cards(id) on delete cascade,
  player_id bigint not null references public.players(id) on delete restrict,
  role text not null default 'primary',
  created_at timestamptz not null default now(),

  primary key (card_id, player_id)
);
create table public.parallel_types (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.card_variants (
  id bigserial primary key,
  card_id bigint not null references public.cards(id) on delete cascade,
  parallel_type_id bigint references public.parallel_types(id) on delete restrict,

  name_override text,

  serial_numbered boolean not null default false,
  print_run integer,

  has_autograph boolean not null default false,
  has_memorabilia boolean not null default false,
  is_refractor boolean not null default false,
  is_die_cut boolean not null default false,
  is_short_print boolean not null default false,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint card_variants_card_id_parallel_type_id_print_run_key
    unique (card_id, parallel_type_id, print_run)
);

commit;


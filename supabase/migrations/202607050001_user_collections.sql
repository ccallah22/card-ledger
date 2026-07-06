-- TheBinder User Collections
-- Adds the tables that let a profile own copies of catalog cards: user_cards,
-- locations, small lookup tables (grading companies / conditions / sale
-- statuses), and value history. Everything is scoped to profile_id = auth.uid().
--
-- Column shapes match the Row types already defined in src/lib/repositories/
-- (locations.ts, gradingCompanies.ts, cardConditions.ts, saleStatuses.ts,
-- valueSnapshots.ts, userCards.ts) rather than the other way around.

begin;

create table public.locations (
  id bigserial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint locations_profile_id_name_key unique (profile_id, name)
);

alter table public.locations enable row level security;

create policy "read own locations" on public.locations
  for select using (auth.uid() = profile_id);
create policy "insert own locations" on public.locations
  for insert with check (auth.uid() = profile_id);
create policy "update own locations" on public.locations
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "delete own locations" on public.locations
  for delete using (auth.uid() = profile_id);

create table public.grading_companies (
  id bigserial primary key,
  name text not null unique,
  abbreviation text not null unique,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.card_conditions (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  description text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sale_statuses (
  id bigserial primary key,
  name text not null unique,
  slug text not null unique,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lookup tables are readable by anyone signed in; only managed by admins via
-- the dashboard/service role for now, so no insert/update/delete policies.
alter table public.grading_companies enable row level security;
create policy "read grading companies" on public.grading_companies
  for select using (auth.uid() is not null);

alter table public.card_conditions enable row level security;
create policy "read card conditions" on public.card_conditions
  for select using (auth.uid() is not null);

alter table public.sale_statuses enable row level security;
create policy "read sale statuses" on public.sale_statuses
  for select using (auth.uid() is not null);

create table public.user_cards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  card_id bigint not null references public.cards(id) on delete restrict,
  card_variant_id bigint references public.card_variants(id) on delete set null,
  location_id bigint references public.locations(id) on delete set null,

  -- The catalog's `teams` table requires a league_id and there's no
  -- sport/league/team picker UI yet, so team is kept as free text on the
  -- user's own card until that catalog path exists.
  team_name text,
  -- Specific to this physical copy (e.g. "23" of a /99 print run tracked on
  -- the shared card_variants row) -- not a catalog-level fact.
  serial_number integer,

  grading_status text not null default 'RAW',
  condition text,
  grading_company_id bigint references public.grading_companies(id) on delete set null,
  grade text,
  cert_number text,

  status text not null default 'HAVE',

  purchase_price numeric,
  purchase_date date,
  purchase_source text,

  estimated_value numeric,

  asking_price numeric,
  sold_price numeric,
  sold_date date,
  sold_fees numeric,
  sold_notes text,

  quantity integer not null default 1,
  notes text,

  -- User-authored eBay/market comps for this specific card. Small and
  -- per-card, so a JSONB column is a better fit than a normalized table.
  comps jsonb not null default '[]'::jsonb,

  image_path text,
  thumb_path text,
  image_shared boolean not null default false,
  image_type text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_cards_grading_status_check check (grading_status in ('RAW', 'GRADED')),
  constraint user_cards_status_check check (status in ('HAVE', 'WANT', 'FOR_SALE', 'SOLD'))
);

create index user_cards_profile_id_idx on public.user_cards (profile_id);
create index user_cards_card_id_idx on public.user_cards (card_id);
create index user_cards_status_idx on public.user_cards (profile_id, status);

alter table public.user_cards enable row level security;

create policy "read own user cards" on public.user_cards
  for select using (auth.uid() = profile_id);
create policy "insert own user cards" on public.user_cards
  for insert with check (auth.uid() = profile_id);
create policy "update own user cards" on public.user_cards
  for update using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
create policy "delete own user cards" on public.user_cards
  for delete using (auth.uid() = profile_id);

create table public.card_value_snapshots (
  id bigserial primary key,
  user_card_id uuid not null references public.user_cards(id) on delete cascade,
  market_value numeric not null,
  source text,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index card_value_snapshots_user_card_id_idx on public.card_value_snapshots (user_card_id, recorded_at desc);

alter table public.card_value_snapshots enable row level security;

create policy "read own value snapshots" on public.card_value_snapshots
  for select using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_value_snapshots.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "insert own value snapshots" on public.card_value_snapshots
  for insert with check (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_value_snapshots.user_card_id and uc.profile_id = auth.uid()
    )
  );
create policy "delete own value snapshots" on public.card_value_snapshots
  for delete using (
    exists (
      select 1 from public.user_cards uc
      where uc.id = card_value_snapshots.user_card_id and uc.profile_id = auth.uid()
    )
  );

commit;

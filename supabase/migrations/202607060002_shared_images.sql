-- Restore shared_images (community reference card images).
--
-- Same situation as device_sessions: this table's DDL only ever lived in the
-- untracked supabase_old_sql/shared_images.sql reference file, never an
-- applied migration, so it never actually existed in this database. That's
-- why every /cards load threw a recurring 404 on
-- GET /rest/v1/shared_images -- the app (src/lib/db/sharedImages.ts,
-- CardTile.tsx, cards/page.tsx, cards/[id]/page.tsx, cards/new/page.tsx)
-- still genuinely depends on it. Restored verbatim from that reference file.

begin;

create table public.shared_images (
  fingerprint text primary key,
  image_path text not null,
  is_front boolean default true,
  is_slabbed boolean default false,
  created_at timestamptz default now(),
  user_id uuid references auth.users (id)
);

alter table public.shared_images enable row level security;

-- Anyone can read shared images
create policy "read shared images" on public.shared_images
  for select using (true);

-- Only authenticated users can insert their own row
create policy "insert shared images" on public.shared_images
  for insert with check (auth.uid() = user_id);

-- Storage bucket (public read)
insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', true)
on conflict (id) do nothing;

-- Public read access to images
create policy "public read card images" on storage.objects
  for select using (bucket_id = 'card-images');

-- Authenticated users can upload images
create policy "authenticated upload card images" on storage.objects
  for insert with check (bucket_id = 'card-images' and auth.uid() is not null);

commit;

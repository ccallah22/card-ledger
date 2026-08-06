-- Fix Supabase Advisor "RLS Disabled in Public" warning on public.profiles.
--
-- profiles was created in 202607040001_thebinder_database_v1.sql without
-- `enable row level security`, unlike every other user-scoped table added
-- since (locations, user_cards, device_sessions, shared_images, card_media).
-- The only client-side query against this table (getCurrentProfile in
-- src/lib/repositories/profiles.ts) already scopes to the caller's own id
-- via the anon-key client, so a single "read own profile" select policy
-- fully covers current usage -- no insert/update/delete policy is needed
-- since the app never mutates profiles directly (creation goes through the
-- security-definer handle_new_user trigger, deletion cascades from
-- auth.users via the service-role admin client in
-- src/app/api/account/delete/route.ts).

begin;

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;

create policy "read own profile"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

commit;

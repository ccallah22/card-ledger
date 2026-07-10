-- Vision Engine V2, Phase 5A: private per-user-card media storage.
--
-- The Phase 5 persistence work discovered that the only existing Storage
-- bucket (`card-images`, from 202607060002_shared_images.sql) cannot safely
-- hold private front/back card photos: it is created with `public = true`
-- (which serves every object via an unauthenticated public URL regardless
-- of any storage.objects RLS policy), its one INSERT policy has no
-- path/ownership scoping, and it has no UPDATE or DELETE policy at all.
-- That bucket is intentionally left untouched here -- it remains dedicated
-- to the community/shared-image feature it was built for.
--
-- This migration adds a second, private bucket (`user-card-media`) with
-- ownership-aware RLS on storage.objects, scoped to the exact object-path
-- namespace `users/{auth.uid()}/cards/{userCardId}/{front|back}/processed.webp`.
-- This is additive only -- it does not modify card-images, card_media, or
-- any other existing table/bucket/policy.

begin;

-- file_size_limit matches IMAGE_RULES.maxBytes in src/lib/image.ts (10 MiB)
-- -- the only existing numeric size constraint already governing uploads in
-- this app, reused here rather than inventing a new figure. The actual
-- processed/cropped output is far smaller in practice (cropped to a small
-- fixed box and re-encoded at quality 0.92), so this is a generous ceiling,
-- not a tight fit.
--
-- allowed_mime_types is restricted to image/webp only: every image
-- processing function this app has (processImageFile, cropImageDataUrl,
-- rotateImageDataUrl in src/lib/image.ts) re-encodes its output via
-- `canvas.toDataURL("image/webp", ...)` before it's ever persisted, and the
-- required object filename (`processed.webp`) is WebP-only by convention.
-- IMAGE_RULES.allowedTypes (jpeg/png/webp/heic/heif) governs which *raw*
-- files a user may pick client-side -- it does not describe what this
-- bucket ever receives.
--
-- on conflict does update (not the "do nothing" used for card-images in
-- 202607060002_shared_images.sql), so that if a bucket with this id
-- somehow already exists (e.g. created by hand outside migrations) with a
-- wrong `public`/size/mime configuration, re-running this migration
-- corrects it rather than silently leaving it misconfigured.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-card-media', 'user-card-media', false, 10485760, array['image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Ownership check used by all four policies below: the object's path must
-- sit in the caller's own `users/{auth.uid()}/...` namespace AND the
-- {userCardId} path segment must name a user_cards row actually owned by
-- the caller (profile_id = auth.uid()) -- path-namespace ownership alone is
-- necessary but not sufficient, since nothing else stops one signed-in user
-- from writing `users/{their-own-uid}/cards/{someone-elses-user-card-id}/...`.
--
-- storage.foldername(name) returns the path's folder segments as a 1-based
-- text[] (Postgres arrays are 1-indexed, not 0-indexed), excluding the
-- filename itself: for `users/{uid}/cards/{userCardId}/front/processed.webp`
-- that's {1:'users', 2:uid, 3:'cards', 4:userCardId, 5:'front'}.
-- storage.filename(name) returns the final segment ('processed.webp').
--
-- uc.id::text = (...)[4] (rather than casting the path segment to uuid) so
-- a malformed/non-uuid path segment simply fails to match instead of
-- throwing a cast error during policy evaluation.
--
-- Referencing public.user_cards from a storage.objects RLS policy is not a
-- Supabase limitation -- EXISTS subqueries against ordinary tables inside
-- USING/WITH CHECK clauses are fully supported (the same pattern this
-- project already uses for card_media/card_value_snapshots' own policies),
-- so the full path+ownership check below is implemented directly rather
-- than a reduced fallback.
create policy "read own card media objects" on storage.objects
  for select using (
    bucket_id = 'user-card-media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'cards'
    and (storage.foldername(name))[5] in ('front', 'back')
    and storage.filename(name) = 'processed.webp'
    and exists (
      select 1 from public.user_cards uc
      where uc.id::text = (storage.foldername(name))[4]
        and uc.profile_id = auth.uid()
    )
  );

create policy "insert own card media objects" on storage.objects
  for insert with check (
    bucket_id = 'user-card-media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'cards'
    and (storage.foldername(name))[5] in ('front', 'back')
    and storage.filename(name) = 'processed.webp'
    and exists (
      select 1 from public.user_cards uc
      where uc.id::text = (storage.foldername(name))[4]
        and uc.profile_id = auth.uid()
    )
  );

-- Both using and with check are required (and identical): using alone would
-- let an owned object be renamed/moved into another namespace as long as
-- the *original* path passed ownership, since with check governs the
-- *resulting* row. Repeating the same predicate in with check ensures the
-- destination path must also be in the caller's own, ownership-verified
-- namespace.
create policy "update own card media objects" on storage.objects
  for update using (
    bucket_id = 'user-card-media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'cards'
    and (storage.foldername(name))[5] in ('front', 'back')
    and storage.filename(name) = 'processed.webp'
    and exists (
      select 1 from public.user_cards uc
      where uc.id::text = (storage.foldername(name))[4]
        and uc.profile_id = auth.uid()
    )
  ) with check (
    bucket_id = 'user-card-media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'cards'
    and (storage.foldername(name))[5] in ('front', 'back')
    and storage.filename(name) = 'processed.webp'
    and exists (
      select 1 from public.user_cards uc
      where uc.id::text = (storage.foldername(name))[4]
        and uc.profile_id = auth.uid()
    )
  );

create policy "delete own card media objects" on storage.objects
  for delete using (
    bucket_id = 'user-card-media'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = auth.uid()::text
    and (storage.foldername(name))[3] = 'cards'
    and (storage.foldername(name))[5] in ('front', 'back')
    and storage.filename(name) = 'processed.webp'
    and exists (
      select 1 from public.user_cards uc
      where uc.id::text = (storage.foldername(name))[4]
        and uc.profile_id = auth.uid()
    )
  );

commit;

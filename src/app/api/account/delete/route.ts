import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { removeCardMediaObjects } from "@/lib/db/cardMediaStorage";

// Never expose raw Postgres/PostgREST/Storage error text to the browser --
// every destructive step below logs its own real error server-side (no
// secrets, just the message and which user/step failed) and returns this
// same generic string instead.
const GENERIC_ERROR = "We couldn't delete your account right now. Please try again.";

export async function POST() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return Response.json({ error: error.message }, { status: 401 });
  }
  const user = data?.user;
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!serviceKey || !supabaseUrl) {
    console.error(`[account/delete] missing service-role env vars (user ${user.id})`);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Private Storage cleanup, FIRST, before anything that would cascade-
  // delete the card_media rows recording these paths. user.id (never
  // request input) is the only identity used to scope this lookup, so this
  // can never reach outside the authenticated caller's own media.
  const { data: userCardRows, error: userCardsSelectErr } = await admin
    .from("user_cards")
    .select("id")
    .eq("profile_id", user.id);

  if (userCardsSelectErr) {
    console.error(
      `[account/delete] user_cards lookup failed (user ${user.id}):`,
      userCardsSelectErr.message,
    );
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  const userCardIds = (userCardRows ?? []).map((row) => (row as { id: string }).id);

  if (userCardIds.length > 0) {
    const { data: mediaRows, error: mediaSelectErr } = await admin
      .from("card_media")
      .select("original_path, processed_path, thumbnail_path")
      .in("user_card_id", userCardIds);

    if (mediaSelectErr) {
      console.error(
        `[account/delete] card_media lookup failed (user ${user.id}):`,
        mediaSelectErr.message,
      );
      return Response.json({ error: GENERIC_ERROR }, { status: 500 });
    }

    const paths = (
      mediaRows as { original_path: string | null; processed_path: string | null; thumbnail_path: string | null }[]
    )
      .flatMap((row) => [row.original_path, row.processed_path, row.thumbnail_path])
      .filter((path): path is string => !!path);

    if (paths.length > 0) {
      try {
        await removeCardMediaObjects(paths, admin);
      } catch (err) {
        console.error(
          `[account/delete] user-card-media Storage cleanup failed (user ${user.id}):`,
          err instanceof Error ? err.message : err,
        );
        return Response.json({ error: GENERIC_ERROR }, { status: 500 });
      }
    }
  }

  // 2. shared_images: no client-facing DELETE policy exists (RLS there only
  // allows public SELECT and owner-scoped INSERT), so this must use the
  // admin client, not the authenticated one -- the previous version of this
  // route used the authenticated client here, which RLS silently reduced to
  // a no-op every time. Only the database row is removed. The underlying
  // card-images object is fingerprint-keyed, content-addressed community
  // data (see src/lib/db/sharedImages.ts) that another collector's card may
  // still resolve to independently of who originally uploaded it, and the
  // bucket provides no per-user path namespace to prove otherwise -- so the
  // physical object is deliberately left intact.
  const { error: sharedImagesErr } = await admin
    .from("shared_images")
    .delete()
    .eq("user_id", user.id);

  if (sharedImagesErr) {
    console.error(
      `[account/delete] shared_images delete failed (user ${user.id}):`,
      sharedImagesErr.message,
    );
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // 3. user_cards -- cascades to card_value_snapshots, card_media, and
  // manual_evidence_overrides (all `on delete cascade` from user_cards.id;
  // see supabase/migrations/202607050001_user_collections.sql,
  // 202607100002_vision_engine_v2_card_media.sql,
  // 202608070001_manual_evidence_overrides.sql). Not relied on to run
  // before shared_images above: shared_images has no FK to user_cards at
  // all, only to auth.users, which is why it has to be handled as its own
  // explicit step regardless of this one's outcome.
  const { error: userCardsDeleteErr } = await admin
    .from("user_cards")
    .delete()
    .eq("profile_id", user.id);

  if (userCardsDeleteErr) {
    console.error(
      `[account/delete] user_cards delete failed (user ${user.id}):`,
      userCardsDeleteErr.message,
    );
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // 4. locations.
  const { error: locationsErr } = await admin
    .from("locations")
    .delete()
    .eq("profile_id", user.id);

  if (locationsErr) {
    console.error(
      `[account/delete] locations delete failed (user ${user.id}):`,
      locationsErr.message,
    );
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  // 5. The Auth user identity itself, LAST, only once every step that could
  // otherwise block it (Storage objects removed, shared_images' non-
  // cascading FK cleared) has already succeeded. profiles and
  // device_sessions cascade from this (`on delete cascade` from
  // auth.users.id).
  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    console.error(`[account/delete] auth user delete failed (user ${user.id}):`, deleteErr.message);
    return Response.json({ error: GENERIC_ERROR }, { status: 500 });
  }

  return Response.json({ ok: true });
}

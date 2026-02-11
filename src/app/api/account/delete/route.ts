import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

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
    return Response.json(
      { error: "Server missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const admin = createAdminClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: cardsErr } = await supabase.from("cards_v1").delete().eq("user_id", user.id);
  if (cardsErr) {
    return Response.json({ error: cardsErr.message }, { status: 500 });
  }

  await supabase.from("shared_images").delete().eq("user_id", user.id);

  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return Response.json({ error: deleteErr.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

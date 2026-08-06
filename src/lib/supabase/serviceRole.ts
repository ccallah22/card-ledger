import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for trusted server-only writes (e.g. the
 * catalog resolution route). Bypasses RLS entirely -- never import this
 * into a client component, and never forward SUPABASE_SERVICE_ROLE_KEY to
 * the browser via a NEXT_PUBLIC_ variable. `import "server-only"` above
 * makes any accidental client-bundle import a build-time error.
 *
 * Mirrors the inline service-role client already used in
 * src/app/api/account/delete/route.ts (same auth options), centralized
 * here so future server-only routes don't each hand-roll their own.
 */
export function createServiceRoleClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

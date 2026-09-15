import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared AI-endpoint rate-limit check for /api/ocr, /api/image-check, and
 * /api/vision -- the three routes that call OpenAI, sharing one combined
 * "ai" budget (see supabase/migrations/202609150001_ai_api_rate_limits.sql).
 *
 * The database is the sole source of truth: this helper holds no state of
 * its own (no Map, no module-level counter, nothing that would only be
 * correct within a single serverless instance). Every call is a single
 * RPC round-trip to check_ai_rate_limit(), which derives the caller's
 * identity from auth.uid() -- so the Supabase client passed in MUST be the
 * same per-request, cookie-authenticated client the route already used for
 * its own supabase.auth.getUser() check (never the service-role client,
 * and never a client constructed from request-supplied identity). This
 * helper has no parameter for a user id or a limit, by design -- there is
 * nothing here for a caller to override.
 */
export type AiRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number; reason: "quota" | "error" };

type CheckAiRateLimitRow = { allowed: boolean; retry_after_seconds: number };

/**
 * Fails CLOSED: if the RPC itself cannot be reached or returns something
 * unexpected, this returns `allowed: false, reason: "error"` rather than
 * silently letting the request through. A broken limiter must never become
 * an open door -- the caller should treat `reason: "error"` as a real
 * server failure (500), not a quota message (429), while still never
 * proceeding to call OpenAI either way.
 */
export async function checkAiRateLimit(
  supabase: SupabaseClient,
): Promise<AiRateLimitResult> {
  const { data, error } = await supabase.rpc("check_ai_rate_limit");

  if (error) {
    console.error("[aiRateLimit] check_ai_rate_limit RPC failed:", error.message);
    return { allowed: false, retryAfterSeconds: 60, reason: "error" };
  }

  const row = (Array.isArray(data) ? data[0] : data) as CheckAiRateLimitRow | undefined;
  if (!row || typeof row.allowed !== "boolean") {
    console.error("[aiRateLimit] check_ai_rate_limit returned an unexpected shape");
    return { allowed: false, retryAfterSeconds: 60, reason: "error" };
  }

  if (row.allowed) return { allowed: true };

  const retryAfterSeconds =
    typeof row.retry_after_seconds === "number" && row.retry_after_seconds > 0
      ? row.retry_after_seconds
      : 60;
  return { allowed: false, retryAfterSeconds, reason: "quota" };
}

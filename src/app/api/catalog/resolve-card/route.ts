import { NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { resolveCatalogIdsServer } from "@/lib/catalog/resolveCatalogIdsServer";
import { validateBody } from "@/lib/catalog/validateCatalogResolutionInput";

/**
 * POST /api/catalog/resolve-card
 *
 * Trusted, service-role-backed replacement write path for the shared
 * catalog tables (manufacturers/brands/sets/players/cards/card_players/
 * parallel_types/card_variants), reusing resolveCatalogIds exactly (see
 * resolveCatalogIdsServer.ts) rather than re-implementing its identity/
 * collision logic. Additive only: nothing in the app calls this route yet
 * -- the browser flow in src/lib/repositories/myCards.ts (createMyCard,
 * called from cards/new/page.tsx) is untouched and remains the live path
 * until a later phase switches it over.
 *
 * Resolves only shared catalog/lookup ids. Never inserts a user_cards row,
 * never accepts a save payload, never touches image/media -- exactly the
 * same boundary resolveCatalogIds already has today.
 */

// Production Add Card save investigation: a real iPhone Save attempt
// against this deployed route produced only the client's generic "We
// couldn't save this card" fallback -- never the session-expired message
// -- meaning it failed here or in createMyCard()'s own direct writes, for a
// reason that isn't an auth problem. The one console.error this route had
// before only fired on the final resolveCatalogIdsServer() failure and
// carried no way to correlate it to one specific request in Vercel's log
// stream. diagnosticId is generated once per request and prefixes every
// log line for that request so a specific phone attempt can be found by
// searching Vercel's logs for it (see this route's own comment on the
// catch block below for exactly what value to search for). Every log line
// is a short, fixed stage name plus safe scalars only -- never the
// request body, never player/card/set values (not needed to diagnose
// where in the pipeline a request stopped), never tokens/cookies/keys.
function generateDiagnosticId(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Production Add Card save investigation, round 2: a real request reached
// resolution-start and failed, but the previous sanitizer's `err instanceof
// Error` check produced { name: "object", message: "[object Object]",
// code: undefined } -- useless for diagnosis. Root cause: nothing in this
// codebase's repository layer ever calls postgrest-js's .throwOnError()
// (confirmed -- no occurrences anywhere in src/), so every `if (error)
// throw error` in the repository files resolveCatalogIds calls into
// rethrows the exact plain object postgrest-js's own request handling
// parses straight from the HTTP response body -- never a PostgrestError
// instance, never anything `instanceof Error`. That's true of every
// Supabase call in this app, not one specific operation, so the old
// `instanceof Error` check was the wrong test for the error shape this
// codebase actually produces. This reads name/message/code/details/hint
// directly off whatever was thrown, whether it's a real Error or (the
// common case here) a plain object, plus resolutionStage if
// resolveCatalogIdsServer tagged one (see resolveCatalogIdsServer.ts).
function safeCatalogErrorInfo(err: unknown): {
  stage?: string;
  name?: string;
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
} {
  if (typeof err !== "object" || err === null) {
    return { name: typeof err, message: typeof err === "string" ? err : undefined };
  }
  const obj = err as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return {
    stage: str(obj.resolutionStage),
    name: err instanceof Error ? err.name : "object",
    message: err instanceof Error ? err.message : str(obj.message),
    code: str(obj.code),
    details: str(obj.details),
    hint: str(obj.hint),
  };
}

export async function POST(req: Request) {
  const diagnosticId = generateDiagnosticId();
  console.log(`[resolve-card:${diagnosticId}] request`);

  const supabase = await createServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (authError || !user) {
    console.log(`[resolve-card:${diagnosticId}] auth-failed`, {
      hasAuthError: !!authError,
      authErrorName: authError?.name,
    });
    return NextResponse.json({ error: "Not authenticated.", diagnosticId }, { status: 401 });
  }
  console.log(`[resolve-card:${diagnosticId}] auth-ok`);

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    console.log(`[resolve-card:${diagnosticId}] invalid-json`);
    return NextResponse.json({ error: "Invalid JSON body.", diagnosticId }, { status: 400 });
  }

  const validated = validateBody(rawBody);
  if ("errors" in validated) {
    console.log(`[resolve-card:${diagnosticId}] validation-failed`, {
      fieldCount: validated.errors.length,
    });
    return NextResponse.json(
      {
        error: "Invalid request.",
        fieldErrors: validated.errors,
        diagnosticId,
      },
      { status: 400 },
    );
  }
  console.log(`[resolve-card:${diagnosticId}] validation-ok`);

  try {
    console.log(`[resolve-card:${diagnosticId}] resolution-start`);
    const result = await resolveCatalogIdsServer(user.id, validated.input);
    console.log(`[resolve-card:${diagnosticId}] resolution-ok`);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Never forward raw internal errors (may include Postgres/PostgREST
    // detail) or any credential material to the client -- log server-side
    // only, and return a generic 500 + diagnosticId only. `stage` says
    // which of resolveCatalogIds's operations failed (set/player/card/
    // card-player-link/parallel-type/variant/location/grading-company
    // resolution, or the catalogCardId lookup); details/hint/code are
    // PostgREST's own safe (no credential/row-data) fields, present when
    // the underlying failure was a genuine database error and absent
    // otherwise (e.g. a non-JSON response from an infra-level failure --
    // see resolveCatalogIdsServer.ts's own comment on this).
    //
    // To find this exact request in Vercel's logs after a real attempt:
    // search for "[resolve-card:" plus the diagnosticId shown to the user
    // (see cards/new/page.tsx's saveFailureMessage) or logged in their
    // browser console.
    console.error(`[resolve-card:${diagnosticId}] error`, safeCatalogErrorInfo(err));
    return NextResponse.json({ error: "Catalog resolution failed.", diagnosticId }, { status: 500 });
  }
}

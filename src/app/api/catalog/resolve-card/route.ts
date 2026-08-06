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
export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: userData, error: authError } = await supabase.auth.getUser();
  const user = userData?.user;

  if (authError || !user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const validated = validateBody(rawBody);
  if ("errors" in validated) {
    return NextResponse.json(
      {
        error: "Invalid request.",
        fieldErrors: validated.errors,
      },
      { status: 400 },
    );
  }

  try {
    const result = await resolveCatalogIdsServer(user.id, validated.input);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    // Never forward raw internal errors (may include Postgres/PostgREST
    // detail) or any credential material to the client -- log server-side
    // only, keyed by user id for traceability, and return a generic 500.
    console.error(
      `[api/catalog/resolve-card] resolution failed for user ${user.id}:`,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Catalog resolution failed." }, { status: 500 });
  }
}

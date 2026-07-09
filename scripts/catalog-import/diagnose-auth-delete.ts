import { createClient } from "@supabase/supabase-js";

/**
 * Diagnoses why cleanup-sample-catalog.ts's Step 1 (deleting test auth
 * accounts) stopped, by rebuilding the exact same ordered candidate list
 * and inspecting each account for anything that could make
 * auth.admin.deleteUser() fail or hang -- without ever calling it.
 *
 * Read-only. This script never calls auth.admin.deleteUser() and has no
 * mode that does -- inspection only (getUserById, plain selects). No
 * deletes, no updates, no migrations. Requires the Supabase service role
 * key, which is never printed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Kept identical to the other cleanup scripts so all of them agree on what
// counts as "sample"/test-created.
const TEST_PATTERN =
  /test|verify|hook|check|fix|dup|click|summary|order|stub|refactor|autofill|setlookup|checklist|\d{10,}/i;

function isSampleText(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => !!v && TEST_PATTERN.test(v));
}

type SetRow = { id: number; name: string | null; slug: string | null };
type PlayerRow = { id: number; full_name: string | null; slug: string | null };
type CardRow = {
  id: number;
  set_id: number | null;
  title: string | null;
  search_text: string | null;
};
type CardPlayerRow = { card_id: number; player_id: number };
type CardVariantRow = { id: number; card_id: number | null };
type UserCardRow = { id: string; profile_id: string; card_id: number; card_variant_id: number | null };
type ProfileRow = { id: string; display_name: string | null };

type AccountFinding = {
  profileId: string;
  email: string | null;
  displayName: string | null;
  authUserFound: boolean;
  profileFound: boolean;
  userCardsCount: number;
  anomalies: string[];
};

async function main() {
  console.log("=== Auth Deletion Failure Diagnosis (read-only, inspection only) ===\n");

  if (!SUPABASE_URL) {
    console.error("FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- no queries were run.");
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. This script requires the service role key " +
        "to inspect auth users and user_cards across everyone. Aborting -- no queries were run."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- rebuild the exact same flagged sample rows cleanup-sample-catalog.ts would ----
  const { data: setsData, error: setsErr } = await supabase.from("sets").select("id, name, slug");
  if (setsErr) throw setsErr;
  const sets = (setsData ?? []) as SetRow[];
  const sampleSetIdSet = new Set(
    sets.filter((s) => isSampleText(s.name, s.slug)).map((s) => s.id)
  );

  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, slug");
  if (playersErr) throw playersErr;
  const players = (playersData ?? []) as PlayerRow[];
  const samplePlayerIdSet = new Set(
    players.filter((p) => isSampleText(p.full_name, p.slug)).map((p) => p.id)
  );

  const { data: cardPlayersData, error: cardPlayersErr } = await supabase
    .from("card_players")
    .select("card_id, player_id");
  if (cardPlayersErr) throw cardPlayersErr;
  const cardPlayers = (cardPlayersData ?? []) as CardPlayerRow[];
  const cardIdsWithSamplePlayer = new Set(
    cardPlayers.filter((cp) => samplePlayerIdSet.has(cp.player_id)).map((cp) => cp.card_id)
  );

  const { data: cardsData, error: cardsErr } = await supabase
    .from("cards")
    .select("id, set_id, title, search_text");
  if (cardsErr) throw cardsErr;
  const cards = (cardsData ?? []) as CardRow[];
  const sampleCardIds = cards
    .filter(
      (c) =>
        (c.set_id != null && sampleSetIdSet.has(c.set_id)) ||
        cardIdsWithSamplePlayer.has(c.id) ||
        isSampleText(c.title, c.search_text)
    )
    .map((c) => c.id);
  const sampleCardIdSet = new Set(sampleCardIds);

  const { data: variantsData, error: variantsErr } = await supabase
    .from("card_variants")
    .select("id, card_id");
  if (variantsErr) throw variantsErr;
  const variants = (variantsData ?? []) as CardVariantRow[];
  const sampleVariantIds = variants
    .filter((v) => v.card_id != null && sampleCardIdSet.has(v.card_id))
    .map((v) => v.id);

  if (sampleCardIds.length === 0 && sampleVariantIds.length === 0) {
    console.log("No flagged sample cards/variants found -- no user_cards to derive candidates from.");
    return;
  }

  // ---- rebuild the SAME ordered distinct-profile-id list cleanup-sample-catalog.ts computes ----
  // Same query shape, no added ORDER BY -- intentionally not "improved" so the
  // order matches what the original script actually iterated over.
  const orClauses: string[] = [];
  if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
  if (sampleVariantIds.length > 0) {
    orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
  }
  const { data: referencingData, error: refErr } = await supabase
    .from("user_cards")
    .select("id, profile_id, card_id, card_variant_id")
    .or(orClauses.join(","));
  if (refErr) throw refErr;
  const referencing = (referencingData ?? []) as UserCardRow[];

  const distinctProfileIds = Array.from(new Set(referencing.map((r) => r.profile_id)));

  const { data: profilesData, error: profilesErr } =
    distinctProfileIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", distinctProfileIds)
      : { data: [] as ProfileRow[], error: null };
  if (profilesErr) throw profilesErr;
  const profileById = new Map(((profilesData ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  // ---- inspect each candidate account (getUserById also gives us the email
  //      needed to determine test-likeness, so this one call serves both) ----
  const allFindings: AccountFinding[] = [];
  for (const profileId of distinctProfileIds) {
    const profile = profileById.get(profileId);
    const profileFound = !!profile;

    let authUserFound = false;
    let email: string | null = null;
    let anomalies: string[] = [];

    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(profileId);
    if (userErr) {
      anomalies.push(`auth.admin.getUserById() itself errored: ${userErr.message}`);
    } else if (!userData?.user) {
      anomalies.push(
        "auth user not found (already deleted, or profile_id does not correspond to a real auth.users row)"
      );
    } else {
      authUserFound = true;
      const user = userData.user;
      email = user.email ?? null;

      if (!user.email) {
        anomalies.push("auth user has no email (unexpected for an email/password signup app)");
      }
      const bannedUntil = (user as { banned_until?: string | null }).banned_until;
      if (bannedUntil) {
        anomalies.push(`user is banned until ${bannedUntil}`);
      }
      const isSsoUser = (user as { is_sso_user?: boolean }).is_sso_user;
      if (isSsoUser) {
        anomalies.push(
          "user is an SSO user (is_sso_user: true) -- some Supabase versions restrict deleting SSO-linked users via the admin API"
        );
      }
      const identities = user.identities ?? [];
      if (identities.length === 0) {
        anomalies.push(
          "user has zero linked identities (unusual -- could indicate a partially-created or corrupted account)"
        );
      } else if (identities.length > 1) {
        anomalies.push(`user has ${identities.length} linked identities (multiple auth providers)`);
      }
      if (!user.confirmed_at && !user.email_confirmed_at) {
        anomalies.push("user's email/account is not confirmed");
      }
    }

    if (!profileFound) {
      anomalies.push(
        "linked profiles row not found (unexpected given profiles.id -> auth.users.id ON DELETE CASCADE)"
      );
    }

    const { count: userCardsCount, error: countErr } = await supabase
      .from("user_cards")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId);
    if (countErr) throw countErr;
    if ((userCardsCount ?? 0) > 500) {
      anomalies.push(
        `unusually high user_cards count (${userCardsCount}) -- could slow down or time out the cascade delete`
      );
    }

    allFindings.push({
      profileId,
      email,
      displayName: profile?.display_name ?? null,
      authUserFound,
      profileFound,
      userCardsCount: userCardsCount ?? 0,
      anomalies,
    });
  }

  // ---- filter to the same test-account list cleanup-sample-catalog.ts would have iterated ----
  const testAccountFindings = allFindings.filter((f) => isSampleText(f.email, f.displayName));

  console.log(
    `Rebuilt ordered candidate list: ${testAccountFindings.length} test account(s) ` +
      `(out of ${distinctProfileIds.length} distinct accounts referencing flagged rows), ` +
      "in the same order cleanup-sample-catalog.ts would have processed them.\n"
  );

  console.log("--- Per-account findings (in processing order) ---");
  for (const f of testAccountFindings) {
    console.log(
      `  profile ${f.profileId} | email: ${f.email ?? "unknown"} | display_name: ${
        f.displayName ?? "unknown"
      } | auth user found: ${f.authUserFound} | profile found: ${f.profileFound} | ` +
        `user_cards: ${f.userCardsCount} | anomalies: ${
          f.anomalies.length ? f.anomalies.join("; ") : "none"
        }`
    );
  }

  const firstInconsistent = testAccountFindings.find((f) => f.anomalies.length > 0);

  console.log("\n--- First inconsistent account ---");
  if (firstInconsistent) {
    console.log(`  profile_id: ${firstInconsistent.profileId}`);
    console.log(`  email: ${firstInconsistent.email ?? "unknown"}`);
    console.log(`  display_name: ${firstInconsistent.displayName ?? "unknown"}`);
    console.log(`  anomalies detected:`);
    for (const a of firstInconsistent.anomalies) console.log(`    - ${a}`);
  } else {
    console.log("  None found -- no account in the rebuilt list shows a detectable anomaly.");
  }

  console.log("\n--- Most likely explanation ---");
  if (firstInconsistent) {
    console.log(
      `The account at profile_id ${firstInconsistent.profileId} is the first in processing order ` +
        "with a detectable issue, and is the most likely place cleanup-sample-catalog.ts stopped:"
    );
    for (const a of firstInconsistent.anomalies) console.log(`  - ${a}`);
  } else {
    console.log(
      "No per-account data anomaly was found in any candidate. This points away from a bad record " +
        "and toward a transient/systemic cause instead -- e.g. a network interruption, an Auth Admin " +
        "API rate limit after many consecutive deleteUser() calls, the process being killed/interrupted " +
        "externally, or a temporarily invalid/expired service role key partway through the run. " +
        "Re-running with per-call logging (account id + success/failure) would pinpoint this if it recurs."
    );
  }

  console.log("\n--- For a future cleanup-sample-catalog.ts fix ---");
  if (firstInconsistent) {
    console.log(
      `  Add a pre-check before calling auth.admin.deleteUser(profileId) for profile_id ` +
        `${firstInconsistent.profileId} (and any account matching the same anomaly pattern): ` +
        "if getUserById() returns not-found, skip with a warning instead of calling deleteUser(); " +
        "if banned_until/is_sso_user is set, log and skip rather than attempting deletion; " +
        "either way, continue the loop instead of letting one failure abort the whole run."
    );
  } else {
    console.log(
      "  Wrap each deleteUser() call in its own try/catch that logs the specific account id and " +
        "error, then continues to the next account instead of letting one failure abort the whole " +
        "loop -- this alone would have let this run identify precisely where and why it stopped."
    );
  }

  console.log(
    "\nThis script made no changes and never called auth.admin.deleteUser(). " +
      "No deletes, no updates, no migrations were run."
  );
}

main().catch((err) => {
  console.error("Diagnosis failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

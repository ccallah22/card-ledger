import { createClient } from "@supabase/supabase-js";

/**
 * Diagnoses a partially-completed run of cleanup-sample-catalog.ts (e.g.
 * one that failed partway through Step 1, deleting test auth accounts).
 *
 * Deliberately does NOT rely on cleanup-sample-catalog.ts's original
 * candidate list, because that script recomputes its plan fresh each run
 * rather than persisting one -- and because deleted accounts cascade away
 * their own user_cards rows, "accounts still referencing a flagged card"
 * naturally shrinks as deletion succeeds and can't be used on its own to
 * count "how many test accounts still exist". Instead this script scans
 * ALL current profiles/auth users directly for the same test-pattern used
 * by the other scripts, independent of whether they still reference
 * anything, then separately checks which of those remaining accounts are
 * still referenced by user_cards pointing at flagged catalog rows (which
 * is what determines whether catalog cleanup is still blocked).
 *
 * Read-only. No deletes, no updates, no migrations. Never runs
 * cleanup-sample-catalog.ts. Requires the Supabase service role key,
 * which is never printed.
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

async function main() {
  console.log("=== Cleanup State Audit (read-only, diagnostic) ===\n");

  if (!SUPABASE_URL) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- no queries were run."
    );
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. This script requires the service role key " +
        "to read profiles/user_cards/auth users across everyone. Aborting -- no queries were run."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- current total counts ----
  async function tableCount(table: string): Promise<number> {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  }

  const currentCounts = {
    sets: await tableCount("sets"),
    players: await tableCount("players"),
    cards: await tableCount("cards"),
    card_variants: await tableCount("card_variants"),
    card_players: await tableCount("card_players"),
    shared_images: await tableCount("shared_images"),
  };

  // ---- re-derive flagged sample catalog rows (same logic as the other scripts) ----
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

  // ---- remaining user_cards referencing flagged cards/variants ----
  let referencing: UserCardRow[] = [];
  if (sampleCardIds.length > 0 || sampleVariantIds.length > 0) {
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
    referencing = (referencingData ?? []) as UserCardRow[];
  }
  const referencingProfileIds = new Set(referencing.map((r) => r.profile_id));

  // ---- every currently-existing profile, scanned directly for test pattern ----
  // (independent of catalog references -- this is what still answers "how many
  // test accounts exist" even after some have already been deleted, since a
  // deleted account's user_cards rows are already gone via cascade and would
  // otherwise make it invisible to a references-only count.)
  const { data: allProfilesData, error: allProfilesErr } = await supabase
    .from("profiles")
    .select("id, display_name");
  if (allProfilesErr) throw allProfilesErr;
  const allProfiles = (allProfilesData ?? []) as ProfileRow[];

  // Isolated in its own try/catch: this is the one call that hard-requires
  // real service-role permissions (unlike RLS-filtered reads, it rejects
  // any other key outright). A diagnostic script investigating a failure
  // should still report everything else it already gathered rather than
  // losing the whole report to this one section.
  const emailByProfileId = new Map<string, string>();
  let authListFailed = false;
  try {
    let page = 1;
    const perPage = 200;
    for (;;) {
      const { data: userPage, error: userErr } = await supabase.auth.admin.listUsers({
        page,
        perPage,
      });
      if (userErr) throw userErr;
      for (const u of userPage.users) {
        if (u.email) emailByProfileId.set(u.id, u.email);
      }
      if (userPage.users.length < perPage) break;
      page += 1;
    }
  } catch (err) {
    authListFailed = true;
    console.error(
      "Warning: auth.admin.listUsers() failed (likely not a real service role key): " +
        (err instanceof Error ? err.message : String(err))
    );
    console.error(
      "Continuing with catalog-only findings; test-account identification below will be incomplete.\n"
    );
  }

  const remainingTestProfiles = allProfiles.filter((p) =>
    isSampleText(p.display_name, emailByProfileId.get(p.id))
  );
  const remainingTestAuthUserIds = new Set(remainingTestProfiles.map((p) => p.id));

  // Every remaining test account also has an auth user (profiles.id
  // references auth.users(id) on delete cascade, so one can't outlive the
  // other) -- reported separately anyway since the task asks for both.
  const remainingTestAuthUserCount = remainingTestAuthUserIds.size;
  const remainingTestProfileCount = remainingTestProfiles.length;

  // ---- which remaining test accounts are still blocking cleanup ----
  const blockingAccounts = remainingTestProfiles.filter((p) => referencingProfileIds.has(p.id));

  // ---- report ----
  console.log("--- Current catalog table counts ---");
  for (const [table, count] of Object.entries(currentCounts)) {
    console.log(`  ${table}: ${count}`);
  }

  console.log("\n--- Remaining test accounts ---");
  if (authListFailed) {
    console.log(
      "  (auth.admin.listUsers() failed above -- these counts are based on profiles.display_name only, not email, and are likely undercounts)"
    );
  }
  console.log(`  test auth users still existing: ${remainingTestAuthUserCount}`);
  console.log(`  test profiles still existing: ${remainingTestProfileCount}`);

  console.log("\n--- Remaining catalog references ---");
  console.log(
    `  user_cards rows still referencing flagged cards/card_variants: ${referencing.length}`
  );

  console.log("\n--- Result ---");
  const stillBlocked = referencing.length > 0;
  console.log(
    stillBlocked
      ? "BLOCKED: catalog cleanup cannot proceed past Step 2 -- flagged cards/card_variants are " +
          "still referenced by user_cards. Do not re-run cleanup-sample-catalog.ts until this is resolved."
      : "NOT BLOCKED on user_cards references: 0 rows remain referencing flagged cards/card_variants. " +
          "(This does not by itself mean it's safe to re-run -- confirm the remaining test-account list " +
          "below is fully accounted for first.)"
  );

  console.log("\n--- Likely point of failure ---");
  if (blockingAccounts.length === 0) {
    console.log(
      "No remaining test account both looks test-created and still references a flagged row -- " +
        "cannot identify a specific failed account from current state alone."
    );
  } else {
    console.log(
      `${blockingAccounts.length} remaining test-created account(s) still reference flagged rows. ` +
        "Without the original run's terminal output, this script cannot prove with certainty which " +
        "one specifically threw the deletion error -- these are the accounts most likely to include it, " +
        "sorted by profile id for reproducibility:"
    );
    for (const p of blockingAccounts.sort((a, b) => a.id.localeCompare(b.id))) {
      const refCount = referencing.filter((r) => r.profile_id === p.id).length;
      console.log(
        `  profile ${p.id} | email: ${emailByProfileId.get(p.id) ?? "unknown"} | ` +
          `display_name: ${p.display_name ?? "unknown"} | referencing user_cards: ${refCount}`
      );
    }
  }

  console.log(
    "\nThis script made no changes. No deletes, no updates, no migrations were run. " +
      "cleanup-sample-catalog.ts was not re-run."
  );
}

main().catch((err) => {
  console.error("Audit failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

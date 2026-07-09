import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * DESTRUCTIVE. Deletes the exact test-created flagged sample catalog rows
 * (and, best-effort, their auth accounts) identified by cleanup-plan.ts.
 * Refuses to run unless explicitly confirmed.
 *
 * This intentionally re-derives the same candidates cleanup-plan.ts would
 * report (rather than reading a saved plan file) so the set of rows
 * deleted is always computed fresh, against current data, at the moment
 * this actually runs -- not against a possibly-stale snapshot.
 *
 * Revised order (database rows first, auth users last): an earlier version
 * of this script deleted auth users first and relied on
 * profiles.id/user_cards.profile_id ON DELETE CASCADE to clean up the rest
 * -- but that meant a single auth.admin.deleteUser() failure (see
 * diagnose-auth-delete.ts) aborted the whole run before any catalog row
 * was touched. Since this project's catalog only contains dev/test data,
 * the simpler and more robust order is to delete the database rows
 * directly first, and treat auth-account removal as a final, best-effort
 * step that can't block or undo the rest of the cleanup.
 *
 * Safety gates, in order:
 *   1. NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.
 *   2. CLEANUP_SAMPLE_CATALOG_CONFIRM must be exactly "DELETE_SAMPLE_CATALOG".
 *   3. Every account referencing a flagged card/card_variant must look
 *      test-created (same heuristic as the audit scripts) -- if even one
 *      does not, nothing is deleted.
 *   4. After directly deleting the flagged user_cards rows (Step 1),
 *      references to the flagged cards/card_variants are re-checked and
 *      must be exactly 0 before any catalog row is deleted. If not, the
 *      script stops immediately and deletes nothing further.
 *
 * Sample detection: in addition to the general TEST_PATTERN heuristic, a
 * small explicit allowlist (KNOWN_SAMPLE_SET_NAMES / KNOWN_SAMPLE_PLAYER_NAMES)
 * flags specific dev/test rows confirmed by manual audit that don't match
 * the general pattern (e.g. "prizm", "FormControls Set"). Their linked
 * cards/card_variants/card_players are picked up automatically by the
 * existing cascade logic below -- no separate handling needed for them.
 *
 * No migrations, no UI changes, no repository changes -- this only talks
 * to Supabase directly via the service role key, which is never printed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CONFIRM = process.env.CLEANUP_SAMPLE_CATALOG_CONFIRM;
const REQUIRED_CONFIRM_VALUE = "DELETE_SAMPLE_CATALOG";

// Kept identical to the other three scripts so all of them agree on what
// counts as "sample". Duplicated rather than imported so each script stays
// independently runnable.
const TEST_PATTERN =
  /test|verify|hook|check|fix|dup|click|summary|order|stub|refactor|autofill|setlookup|checklist|\d{10,}/i;

function isSampleText(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => !!v && TEST_PATTERN.test(v));
}

// Exact names confirmed via manual audit (inspect-remaining-catalog.ts) to
// be leftover dev/test fixtures that TEST_PATTERN doesn't catch -- e.g.
// "prizm" and component/hook-named sets like "FormControls Set" have no
// matching keyword or embedded timestamp. Checked as an explicit allowlist
// alongside isSampleText() rather than folded into the regex, so the
// general pattern used elsewhere (and by the other audit scripts) isn't
// loosened.
const KNOWN_SAMPLE_SET_NAMES = new Set(
  [
    "Consolidation Set",
    "prizm",
    "MyCards Set",
    "FormControls Set",
    "ImageUploader Set",
    "CropModal Final Set",
  ].map((name) => name.toLowerCase())
);
const KNOWN_SAMPLE_PLAYER_NAMES = new Set(["Baker Mayfield"].map((name) => name.toLowerCase()));

function isKnownSampleSetName(name: string | null | undefined): boolean {
  return !!name && KNOWN_SAMPLE_SET_NAMES.has(name.toLowerCase());
}

function isKnownSamplePlayerName(name: string | null | undefined): boolean {
  return !!name && KNOWN_SAMPLE_PLAYER_NAMES.has(name.toLowerCase());
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
type SharedImageRow = { fingerprint: string };
type UserCardRow = { id: string; profile_id: string };
type ProfileRow = { id: string; display_name: string | null };

async function tableCount(supabase: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
}

async function main() {
  console.log("=== Catalog Sample Cleanup (DESTRUCTIVE) ===\n");

  if (!SUPABASE_URL) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. Aborting -- nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }
  if (CONFIRM !== REQUIRED_CONFIRM_VALUE) {
    console.error(
      `FAILED: this script refuses to run unless CLEANUP_SAMPLE_CATALOG_CONFIRM is set to exactly ` +
        `"${REQUIRED_CONFIRM_VALUE}". Aborting -- nothing was read or changed.`
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- re-derive the exact same candidates cleanup-plan.ts would report ----
  const { data: setsData, error: setsErr } = await supabase.from("sets").select("id, name, slug");
  if (setsErr) throw setsErr;
  const sets = (setsData ?? []) as SetRow[];
  const sampleSetIds = sets
    .filter((s) => isSampleText(s.name, s.slug) || isKnownSampleSetName(s.name))
    .map((s) => s.id);
  const sampleSetIdSet = new Set(sampleSetIds);

  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, slug");
  if (playersErr) throw playersErr;
  const players = (playersData ?? []) as PlayerRow[];
  const samplePlayerIds = players
    .filter((p) => isSampleText(p.full_name, p.slug) || isKnownSamplePlayerName(p.full_name))
    .map((p) => p.id);
  const samplePlayerIdSet = new Set(samplePlayerIds);

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

  const { data: sharedImagesData, error: sharedErr } = await supabase
    .from("shared_images")
    .select("fingerprint");
  if (sharedErr) throw sharedErr;
  const sharedImages = (sharedImagesData ?? []) as SharedImageRow[];
  const sampleFingerprints = sharedImages
    .filter((s) => isSampleText(s.fingerprint))
    .map((s) => s.fingerprint);

  if (
    sampleSetIds.length === 0 &&
    samplePlayerIds.length === 0 &&
    sampleCardIds.length === 0 &&
    sampleVariantIds.length === 0 &&
    sampleFingerprints.length === 0
  ) {
    console.log("No sample rows found. Nothing to delete. Aborting -- nothing was changed.");
    return;
  }

  // ---- find every account referencing flagged cards/variants, and confirm all look test-created ----
  let referencing: UserCardRow[] = [];
  if (sampleCardIds.length > 0 || sampleVariantIds.length > 0) {
    const orClauses: string[] = [];
    if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
    if (sampleVariantIds.length > 0) {
      orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
    }
    const { data: referencingData, error: refErr } = await supabase
      .from("user_cards")
      .select("id, profile_id")
      .or(orClauses.join(","));
    if (refErr) throw refErr;
    referencing = (referencingData ?? []) as UserCardRow[];
  }

  const distinctProfileIds = Array.from(new Set(referencing.map((r) => r.profile_id)));

  const { data: profilesData, error: profilesErr } =
    distinctProfileIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", distinctProfileIds)
      : { data: [] as ProfileRow[], error: null };
  if (profilesErr) throw profilesErr;
  const profileById = new Map(((profilesData ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  const emailByProfileId = new Map<string, string>();
  if (distinctProfileIds.length > 0) {
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
  }

  const testAccountIds: string[] = [];
  const nonTestAccountIds: string[] = [];
  for (const profileId of distinctProfileIds) {
    const email = emailByProfileId.get(profileId);
    const displayName = profileById.get(profileId)?.display_name;
    if (isSampleText(email, displayName)) {
      testAccountIds.push(profileId);
    } else {
      nonTestAccountIds.push(profileId);
    }
  }

  if (nonTestAccountIds.length > 0) {
    console.error(
      `BLOCKED: ${nonTestAccountIds.length} account(s) referencing flagged catalog rows do NOT ` +
        `look test-created: ${nonTestAccountIds.join(", ")}. Aborting -- nothing was deleted.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Confirmed: ${testAccountIds.length} account(s) reference flagged rows and all look test-created.`
  );
  console.log(
    `Deleting ${sampleSetIds.length} set(s), ${samplePlayerIds.length} player(s), ` +
      `${sampleCardIds.length} card(s), ${sampleVariantIds.length} variant(s), ` +
      `${sampleFingerprints.length} shared image(s), and ${testAccountIds.length} test account(s).\n`
  );

  // ---- before counts ----
  const before = {
    sets: await tableCount(supabase, "sets"),
    players: await tableCount(supabase, "players"),
    cards: await tableCount(supabase, "cards"),
    card_variants: await tableCount(supabase, "card_variants"),
    card_players: await tableCount(supabase, "card_players"),
    shared_images: await tableCount(supabase, "shared_images"),
  };
  console.log("--- Before counts ---");
  for (const [table, count] of Object.entries(before)) console.log(`  ${table}: ${count}`);

  // ---- step 1: delete flagged user_cards directly ----
  console.log("\n--- Step 1: deleting flagged user_cards ---");
  if (sampleCardIds.length > 0 || sampleVariantIds.length > 0) {
    const orClauses: string[] = [];
    if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
    if (sampleVariantIds.length > 0) {
      orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
    }
    const { error } = await supabase.from("user_cards").delete().or(orClauses.join(","));
    if (error) throw error;
  }
  console.log(`  deleted ${referencing.length} user_cards row(s)`);

  // ---- verify: flagged user_cards references must now be 0; stop immediately if not ----
  console.log("\n--- Verifying flagged user_cards references are gone ---");
  let remainingReferences = 0;
  if (sampleCardIds.length > 0 || sampleVariantIds.length > 0) {
    const orClauses: string[] = [];
    if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
    if (sampleVariantIds.length > 0) {
      orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
    }
    const { count, error } = await supabase
      .from("user_cards")
      .select("id", { count: "exact", head: true })
      .or(orClauses.join(","));
    if (error) throw error;
    remainingReferences = count ?? 0;
  }
  console.log(`  remaining references: ${remainingReferences}`);

  if (remainingReferences > 0) {
    console.error(
      `STOPPED: ${remainingReferences} user_cards row(s) still reference flagged cards/variants ` +
        "after Step 1's direct delete. No further steps were run -- nothing else was deleted. " +
        "Review why these rows survived the delete before re-running."
    );
    process.exitCode = 1;
    return;
  }

  // ---- step 2: delete test profiles directly ----
  console.log("\n--- Step 2: deleting test profiles ---");
  if (testAccountIds.length > 0) {
    const { error } = await supabase.from("profiles").delete().in("id", testAccountIds);
    if (error) throw error;
  }
  console.log(`  deleted ${testAccountIds.length} profiles row(s)`);

  // ---- step 3: shared_images ----
  console.log("\n--- Step 3: deleting shared_images ---");
  if (sampleFingerprints.length > 0) {
    const { error } = await supabase.from("shared_images").delete().in("fingerprint", sampleFingerprints);
    if (error) throw error;
  }
  console.log(`  deleted ${sampleFingerprints.length} shared_images row(s)`);

  // ---- step 4: card_variants ----
  console.log("\n--- Step 4: deleting card_variants ---");
  if (sampleVariantIds.length > 0) {
    const { error } = await supabase.from("card_variants").delete().in("id", sampleVariantIds);
    if (error) throw error;
  }
  console.log(`  deleted ${sampleVariantIds.length} card_variants row(s)`);

  // ---- step 5: card_players ----
  console.log("\n--- Step 5: deleting card_players ---");
  let deletedCardPlayers = 0;
  if (sampleCardIds.length > 0 || samplePlayerIds.length > 0) {
    const orClauses: string[] = [];
    if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
    if (samplePlayerIds.length > 0) orClauses.push(`player_id.in.(${samplePlayerIds.join(",")})`);
    deletedCardPlayers = cardPlayers.filter(
      (cp) => sampleCardIdSet.has(cp.card_id) || samplePlayerIdSet.has(cp.player_id)
    ).length;
    const { error } = await supabase.from("card_players").delete().or(orClauses.join(","));
    if (error) throw error;
  }
  console.log(`  deleted ${deletedCardPlayers} card_players row(s)`);

  // ---- step 6: cards ----
  console.log("\n--- Step 6: deleting cards ---");
  if (sampleCardIds.length > 0) {
    const { error } = await supabase.from("cards").delete().in("id", sampleCardIds);
    if (error) throw error;
  }
  console.log(`  deleted ${sampleCardIds.length} cards row(s)`);

  // ---- step 7: players ----
  console.log("\n--- Step 7: deleting players ---");
  if (samplePlayerIds.length > 0) {
    const { error } = await supabase.from("players").delete().in("id", samplePlayerIds);
    if (error) throw error;
  }
  console.log(`  deleted ${samplePlayerIds.length} players row(s)`);

  // ---- step 8: sets ----
  console.log("\n--- Step 8: deleting sets ---");
  if (sampleSetIds.length > 0) {
    const { error } = await supabase.from("sets").delete().in("id", sampleSetIds);
    if (error) throw error;
  }
  console.log(`  deleted ${sampleSetIds.length} sets row(s)`);

  // ---- step 9: best-effort auth user deletion (does not fail the run) ----
  console.log("\n--- Step 9: attempting to delete test auth users (best-effort) ---");
  let authDeleteSucceeded = 0;
  let authDeleteFailed = 0;
  const authDeleteFailures: Array<{ profileId: string; message: string }> = [];
  for (const profileId of testAccountIds) {
    try {
      const { error } = await supabase.auth.admin.deleteUser(profileId);
      if (error) throw error;
      authDeleteSucceeded += 1;
      console.log(`  deleted auth user ${profileId}`);
    } catch (err) {
      authDeleteFailed += 1;
      const message = err instanceof Error ? err.message : String(err);
      authDeleteFailures.push({ profileId, message });
      console.error(`  FAILED to delete auth user ${profileId}: ${message} (continuing)`);
    }
  }
  console.log(
    `  auth deletion summary: ${authDeleteSucceeded} succeeded, ${authDeleteFailed} failed` +
      (authDeleteFailed > 0
        ? ` (failed: ${authDeleteFailures.map((f) => f.profileId).join(", ")})`
        : "")
  );
  if (authDeleteFailed > 0) {
    console.log(
      "  Note: the database rows for these accounts were already removed in Steps 1-8. " +
        "These auth.users records are now orphaned (no profile) and can be retried or cleaned up separately."
    );
  }

  // ---- after counts ----
  const after = {
    sets: await tableCount(supabase, "sets"),
    players: await tableCount(supabase, "players"),
    cards: await tableCount(supabase, "cards"),
    card_variants: await tableCount(supabase, "card_variants"),
    card_players: await tableCount(supabase, "card_players"),
    shared_images: await tableCount(supabase, "shared_images"),
  };
  console.log("\n--- After counts ---");
  for (const [table, count] of Object.entries(after)) {
    const beforeCount = before[table as keyof typeof before];
    console.log(`  ${table}: ${count} (was ${beforeCount}, removed ${beforeCount - count})`);
  }

  console.log("\n=== Cleanup complete ===");
}

main().catch((err) => {
  console.error("Cleanup failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

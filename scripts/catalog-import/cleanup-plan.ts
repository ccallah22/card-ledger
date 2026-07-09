import { createClient } from "@supabase/supabase-js";

/**
 * Generates a deterministic catalog cleanup PLAN from the same sample-row
 * detection used by audit-sample-catalog.ts and audit-user-card-references.ts.
 * This script only computes and prints what would be deleted and in what
 * order -- it never deletes, updates, or migrates anything.
 *
 * The deletion order below is derived directly from this schema's real FK
 * constraints (see supabase/migrations/*.sql), not assumed:
 *   - profiles.id            references auth.users(id)   on delete cascade
 *   - user_cards.profile_id  references profiles(id)     on delete cascade
 *   - user_cards.card_id     references cards(id)         on delete restrict
 *   - user_cards.card_variant_id references card_variants(id) on delete set null
 *   - card_variants.card_id  references cards(id)
 *   - card_players.card_id   references cards(id)
 *   - card_players.player_id references players(id)
 *   - cards.set_id           references sets(id)
 *   - shared_images has no FK to any of the above (keyed by text fingerprint)
 *
 * Because profiles/user_cards cascade automatically from deleting the auth
 * account, the plan's first real step is removing test auth accounts --
 * everything under them disappears as a side effect, which is what then
 * makes the cards.id "on delete restrict" constraint stop blocking cleanup
 * of the catalog rows those accounts were the only things referencing.
 *
 * Read-only. No deletes, no updates, no migrations, no app behavior
 * changes. Requires the Supabase service role key. The key is never
 * printed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Kept identical to the other two audit scripts so all three agree on what
// counts as "sample". Duplicated rather than imported so each script stays
// independently runnable.
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
type SharedImageRow = { fingerprint: string };
type UserCardRow = {
  id: string;
  profile_id: string;
  card_id: number;
  card_variant_id: number | null;
};
type ProfileRow = { id: string; display_name: string | null };

function idList(ids: number[] | string[]): string {
  return ids.length ? ids.join(", ") : "(none)";
}

async function main() {
  console.log("=== Catalog Cleanup Plan (read-only, no deletions performed) ===\n");

  if (!SUPABASE_URL) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL is not set. Aborting -- no queries were run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }
  if (!SERVICE_ROLE_KEY) {
    console.error(
      "FAILED: SUPABASE_SERVICE_ROLE_KEY is not set. This script requires the service role key " +
        "to read user_cards and auth accounts across every user (RLS blocks that with any other key). " +
        "Aborting -- no queries were run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- re-derive the same flagged sample rows as the other two audits ----
  const { data: setsData, error: setsErr } = await supabase.from("sets").select("id, name, slug");
  if (setsErr) throw setsErr;
  const sets = (setsData ?? []) as SetRow[];
  const sampleSetIds = sets.filter((s) => isSampleText(s.name, s.slug)).map((s) => s.id);
  const sampleSetIdSet = new Set(sampleSetIds);

  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, slug");
  if (playersErr) throw playersErr;
  const players = (playersData ?? []) as PlayerRow[];
  const samplePlayerIds = players.filter((p) => isSampleText(p.full_name, p.slug)).map((p) => p.id);
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

  const sampleCardPlayerPairs = cardPlayers.filter(
    (cp) => sampleCardIdSet.has(cp.card_id) || samplePlayerIdSet.has(cp.player_id)
  );

  const { data: sharedImagesData, error: sharedErr } = await supabase
    .from("shared_images")
    .select("fingerprint");
  if (sharedErr) throw sharedErr;
  const sharedImages = (sharedImagesData ?? []) as SharedImageRow[];
  const sampleFingerprints = sharedImages
    .filter((s) => isSampleText(s.fingerprint))
    .map((s) => s.fingerprint);

  // ---- find user_cards referencing flagged cards/variants ----
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

  const distinctProfileIds = Array.from(new Set(referencing.map((r) => r.profile_id)));

  // ---- resolve email/display_name for referencing accounts ----
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

  const planIsSafe = nonTestAccountIds.length === 0;

  // ---- print the plan ----
  console.log("--- Candidates identified ---");
  console.log(`test auth accounts to remove: ${idList(testAccountIds)}`);
  console.log(
    `profiles to remove: ${idList(testAccountIds)} ` +
      "(removed automatically via ON DELETE CASCADE when the auth account above is deleted -- no separate delete step)"
  );
  console.log(
    `user_cards to remove: ${referencing.length} row(s) ` +
      "(removed automatically via ON DELETE CASCADE when the auth account above is deleted -- no separate delete step)"
  );
  console.log(`shared_images to remove: ${idList(sampleFingerprints)}`);
  console.log(`card_variants to remove: ${idList(sampleVariantIds)}`);
  console.log(
    `card_players to remove: ${sampleCardPlayerPairs.length} row(s) ` +
      "(composite key, no single id column)"
  );
  console.log(`cards to remove: ${idList(sampleCardIds)}`);
  console.log(`players to remove: ${idList(samplePlayerIds)}`);
  console.log(`sets to remove: ${idList(sampleSetIds)}`);

  if (nonTestAccountIds.length > 0) {
    console.log(
      `\nnon-test accounts referencing flagged rows (plan withheld for these): ${idList(
        nonTestAccountIds
      )}`
    );
  }

  console.log("\n--- Result ---");
  if (!planIsSafe) {
    console.log(
      "BLOCKED: at least one non-test account references flagged catalog rows " +
        "(listed above). No safe deletion order can be generated until this is resolved. " +
        "Do not delete anything."
    );
  } else {
    console.log("SAFE: all accounts referencing flagged catalog rows look test-created.");
    console.log("\n--- Deletion order (as it would be executed, respecting foreign keys) ---");
    console.log(
      `1. Delete test auth accounts: ${idList(testAccountIds)}\n` +
        "   (via supabase.auth.admin.deleteUser -- cascades automatically to profiles, then to\n" +
        "   user_cards, per profiles.id/user_cards.profile_id ON DELETE CASCADE)"
    );
    console.log(
      "2. Verify: re-query user_cards for the flagged card/variant ids above and confirm 0 rows remain\n" +
        "   (this is what actually lifts the cards.id ON DELETE RESTRICT constraint)"
    );
    console.log(`3. Delete shared_images: ${idList(sampleFingerprints)} (no FK dependency, any order)`);
    console.log(`4. Delete card_variants: ${idList(sampleVariantIds)}`);
    console.log(`5. Delete card_players: ${sampleCardPlayerPairs.length} row(s)`);
    console.log(`6. Delete cards: ${idList(sampleCardIds)}`);
    console.log(`7. Delete players: ${idList(samplePlayerIds)}`);
    console.log(`8. Delete sets: ${idList(sampleSetIds)}`);
  }

  console.log(
    "\nThis script only prints a plan. It made no changes: no deletes, no updates, no migrations were run."
  );
}

main().catch((err) => {
  console.error("Cleanup plan generation failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

import { createClient } from "@supabase/supabase-js";

/**
 * Deeper read-only follow-up to audit-sample-catalog.ts: for the same
 * flagged sample sets/players/cards/card_variants, finds and characterizes
 * exactly which user_cards rows reference them, so a human can judge
 * whether those references are test-created rows (safe to eventually clean
 * up alongside the catalog rows) or real user collection data (must not be
 * touched).
 *
 * Read-only. No deletes, no updates, no migrations, no app behavior
 * changes. Requires the Supabase service role key (RLS otherwise hides
 * other users' user_cards rows, which is the whole point of this script).
 * The key itself is never printed.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Kept identical to audit-sample-catalog.ts's TEST_PATTERN/isSampleText so
// the two audits agree on what counts as "sample". Duplicated rather than
// imported so each script stays independently runnable.
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
  card_number: string | null;
  title: string | null;
  search_text: string | null;
};
type CardPlayerRow = { card_id: number; player_id: number };
type CardVariantRow = { id: number; card_id: number | null };
type UserCardRow = {
  id: string;
  profile_id: string;
  card_id: number;
  card_variant_id: number | null;
  status: string;
  created_at: string;
};
type ProfileRow = { id: string; display_name: string | null };

function sortedCounts(map: Map<number, number>): Array<[number, number]> {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
}

async function main() {
  console.log("=== user_cards Reference Audit (read-only) ===\n");

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
        "to read user_cards across every user (RLS blocks that with any other key). " +
        "Aborting -- no queries were run, nothing was read or changed."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ---- re-derive the same flagged sample rows as audit-sample-catalog.ts ----
  const { data: setsData, error: setsErr } = await supabase.from("sets").select("id, name, slug");
  if (setsErr) throw setsErr;
  const sets = (setsData ?? []) as SetRow[];
  const setById = new Map(sets.map((s) => [s.id, s]));
  const sampleSetIdSet = new Set(sets.filter((s) => isSampleText(s.name, s.slug)).map((s) => s.id));

  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, slug");
  if (playersErr) throw playersErr;
  const players = (playersData ?? []) as PlayerRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));
  const samplePlayerIdSet = new Set(
    players.filter((p) => isSampleText(p.full_name, p.slug)).map((p) => p.id)
  );

  const { data: cardPlayersData, error: cardPlayersErr } = await supabase
    .from("card_players")
    .select("card_id, player_id");
  if (cardPlayersErr) throw cardPlayersErr;
  const cardPlayers = (cardPlayersData ?? []) as CardPlayerRow[];
  const playerIdsByCardId = new Map<number, number[]>();
  for (const cp of cardPlayers) {
    const list = playerIdsByCardId.get(cp.card_id);
    if (list) list.push(cp.player_id);
    else playerIdsByCardId.set(cp.card_id, [cp.player_id]);
  }
  const cardIdsWithSamplePlayer = new Set(
    cardPlayers.filter((cp) => samplePlayerIdSet.has(cp.player_id)).map((cp) => cp.card_id)
  );

  const { data: cardsData, error: cardsErr } = await supabase
    .from("cards")
    .select("id, set_id, card_number, title, search_text");
  if (cardsErr) throw cardsErr;
  const cards = (cardsData ?? []) as CardRow[];
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const sampleCardIds = cards
    .filter(
      (c) =>
        (c.set_id != null && sampleSetIdSet.has(c.set_id)) ||
        cardIdsWithSamplePlayer.has(c.id) ||
        isSampleText(c.title, c.search_text)
    )
    .map((c) => c.id);

  const { data: variantsData, error: variantsErr } = await supabase
    .from("card_variants")
    .select("id, card_id");
  if (variantsErr) throw variantsErr;
  const variants = (variantsData ?? []) as CardVariantRow[];
  const sampleCardIdSet = new Set(sampleCardIds);
  const sampleVariantIds = variants
    .filter((v) => v.card_id != null && sampleCardIdSet.has(v.card_id))
    .map((v) => v.id);

  if (sampleCardIds.length === 0 && sampleVariantIds.length === 0) {
    console.log("No flagged sample cards or variants found -- nothing to check user_cards against.");
    return;
  }

  // ---- fetch the actual referencing user_cards rows ----
  const orClauses: string[] = [];
  if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
  if (sampleVariantIds.length > 0) {
    orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
  }

  const { data: referencingData, error: refErr } = await supabase
    .from("user_cards")
    .select("id, profile_id, card_id, card_variant_id, status, created_at")
    .or(orClauses.join(","));
  if (refErr) throw refErr;
  const referencing = (referencingData ?? []) as UserCardRow[];

  console.log(`total referenced user_cards count: ${referencing.length}\n`);

  if (referencing.length === 0) {
    console.log("=== Result ===");
    console.log("No user_cards rows reference the flagged sample catalog rows.");
    console.log("\nThis script made no changes. No deletes, no updates, no migrations were run.");
    return;
  }

  // ---- grouped counts ----
  const byCardId = new Map<number, number>();
  const byVariantId = new Map<number, number>();
  const bySetId = new Map<number, number>();
  let nullVariantCount = 0;
  let unresolvedSetCount = 0;

  for (const row of referencing) {
    byCardId.set(row.card_id, (byCardId.get(row.card_id) ?? 0) + 1);

    if (row.card_variant_id != null) {
      byVariantId.set(row.card_variant_id, (byVariantId.get(row.card_variant_id) ?? 0) + 1);
    } else {
      nullVariantCount += 1;
    }

    const card = cardById.get(row.card_id);
    if (card?.set_id != null) {
      bySetId.set(card.set_id, (bySetId.get(card.set_id) ?? 0) + 1);
    } else {
      unresolvedSetCount += 1;
    }
  }

  console.log("--- Referenced user_cards grouped by card_id ---");
  for (const [cardId, count] of sortedCounts(byCardId)) {
    console.log(`  card_id ${cardId}: ${count}`);
  }

  console.log("\n--- Referenced user_cards grouped by card_variant_id ---");
  for (const [variantId, count] of sortedCounts(byVariantId)) {
    console.log(`  card_variant_id ${variantId}: ${count}`);
  }
  if (nullVariantCount > 0) {
    console.log(`  (no variant set): ${nullVariantCount}`);
  }

  console.log("\n--- Referenced user_cards grouped by set_id ---");
  for (const [setId, count] of sortedCounts(bySetId)) {
    const set = setById.get(setId);
    console.log(`  set_id ${setId} (${set?.name ?? "unknown"}): ${count}`);
  }
  if (unresolvedSetCount > 0) {
    console.log(`  (set could not be resolved): ${unresolvedSetCount}`);
  }

  console.log("\n--- Top 20 most-referenced catalog cards ---");
  const top20 = sortedCounts(byCardId).slice(0, 20);
  for (const [cardId, count] of top20) {
    const card = cardById.get(cardId);
    const set = card?.set_id != null ? setById.get(card.set_id) : undefined;
    const playerNames = (playerIdsByCardId.get(cardId) ?? [])
      .map((pid) => playerById.get(pid)?.full_name)
      .filter((name): name is string => !!name);
    console.log(
      `  card_id ${cardId}: ${count} reference(s) | set: ${set?.name ?? "unknown"} | ` +
        `card #: ${card?.card_number ?? "unknown"} | player(s): ${
          playerNames.length ? playerNames.join(" / ") : "unknown"
        }`
    );
  }

  // ---- real vs. test-created heuristic ----
  console.log("\n--- Referencing accounts (real vs. test-created signal) ---");
  const distinctProfileIds = Array.from(new Set(referencing.map((r) => r.profile_id)));

  const { data: profilesData, error: profilesErr } = await supabase
    .from("profiles")
    .select("id, display_name")
    .in("id", distinctProfileIds);
  if (profilesErr) throw profilesErr;
  const profileById = new Map(((profilesData ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  // auth.admin.listUsers() is paginated; page through until all users seen
  // are covered (read-only -- does not modify any account).
  const emailByProfileId = new Map<string, string>();
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

  let testLikeAccountCount = 0;
  for (const profileId of distinctProfileIds) {
    const email = emailByProfileId.get(profileId);
    const displayName = profileById.get(profileId)?.display_name;
    const looksTestLike = isSampleText(email, displayName);
    if (looksTestLike) testLikeAccountCount += 1;
    const refCount = referencing.filter((r) => r.profile_id === profileId).length;
    console.log(
      `  profile ${profileId}: ${refCount} referencing row(s) | email: ${
        email ?? "unknown"
      } | display_name: ${displayName ?? "unknown"} | looks test-like: ${looksTestLike}`
    );
  }

  console.log("\n=== Result ===");
  console.log(
    `${distinctProfileIds.length} distinct account(s) reference flagged catalog rows; ` +
      `${testLikeAccountCount} of them look test-created based on email/display_name pattern.`
  );
  if (testLikeAccountCount === distinctProfileIds.length) {
    console.log(
      "All referencing accounts appear to be test-created based on this heuristic. " +
        "This is a signal, not a guarantee -- confirm manually before deleting anything."
    );
  } else {
    console.log(
      "At least one referencing account does NOT look test-created based on this heuristic. " +
        "Treat these references as potentially real user data and do not delete the underlying " +
        "catalog rows without manual review of the accounts listed above."
    );
  }

  console.log("\nThis script made no changes. No deletes, no updates, no migrations were run.");
}

main().catch((err) => {
  console.error("Audit failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

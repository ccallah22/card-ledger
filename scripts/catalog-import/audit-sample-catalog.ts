import { createClient } from "@supabase/supabase-js";

/**
 * Read-only safety audit for the shared catalog tables. Flags rows that
 * look like automated-test/dev artifacts (obvious test-pattern keywords, or
 * a run of 10+ digits -- a millisecond Unix timestamp embedded in an
 * automated test's generated name) in sets/players/cards/card_players/
 * card_variants/shared_images, then checks whether any real user_cards
 * rows reference the flagged cards/card_variants before any future cleanup
 * is attempted.
 *
 * This script only reads data and prints a report. It never deletes,
 * updates, or runs migrations, and it makes no changes to app behavior.
 *
 * Requires the Supabase service role key, because RLS otherwise hides
 * every other user's user_cards rows -- the whole point of this script is
 * to see across all of them before anything gets deleted.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same pattern used during the manual catalog investigation this audit is
// based on: obvious dev/test keywords, or an embedded 10+ digit timestamp.
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

async function main() {
  console.log("=== Catalog Sample-Data Audit (read-only) ===\n");

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

  // ---- sets ----
  const { data: setsData, error: setsErr } = await supabase
    .from("sets")
    .select("id, name, slug");
  if (setsErr) throw setsErr;
  const sets = (setsData ?? []) as SetRow[];
  const sampleSets = sets.filter((s) => isSampleText(s.name, s.slug));
  const sampleSetIds = sampleSets.map((s) => s.id);
  const sampleSetIdSet = new Set(sampleSetIds);

  // ---- players ----
  const { data: playersData, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, slug");
  if (playersErr) throw playersErr;
  const players = (playersData ?? []) as PlayerRow[];
  const samplePlayers = players.filter((p) => isSampleText(p.full_name, p.slug));
  const samplePlayerIds = samplePlayers.map((p) => p.id);
  const samplePlayerIdSet = new Set(samplePlayerIds);

  // ---- card_players (needed to also flag cards linked to a flagged player) ----
  const { data: cardPlayersData, error: cardPlayersErr } = await supabase
    .from("card_players")
    .select("card_id, player_id");
  if (cardPlayersErr) throw cardPlayersErr;
  const cardPlayers = (cardPlayersData ?? []) as CardPlayerRow[];

  const cardIdsWithSamplePlayer = new Set(
    cardPlayers.filter((cp) => samplePlayerIdSet.has(cp.player_id)).map((cp) => cp.card_id)
  );

  // ---- cards (flag by own text, by belonging to a flagged set, or by a flagged linked player) ----
  const { data: cardsData, error: cardsErr } = await supabase
    .from("cards")
    .select("id, set_id, title, search_text");
  if (cardsErr) throw cardsErr;
  const cards = (cardsData ?? []) as CardRow[];
  const sampleCards = cards.filter(
    (c) =>
      (c.set_id != null && sampleSetIdSet.has(c.set_id)) ||
      cardIdsWithSamplePlayer.has(c.id) ||
      isSampleText(c.title, c.search_text)
  );
  const sampleCardIds = sampleCards.map((c) => c.id);
  const sampleCardIdSet = new Set(sampleCardIds);

  // ---- card_variants (flag by belonging to a flagged card) ----
  const { data: variantsData, error: variantsErr } = await supabase
    .from("card_variants")
    .select("id, card_id");
  if (variantsErr) throw variantsErr;
  const variants = (variantsData ?? []) as CardVariantRow[];
  const sampleVariants = variants.filter((v) => v.card_id != null && sampleCardIdSet.has(v.card_id));
  const sampleVariantIds = sampleVariants.map((v) => v.id);

  // ---- card_players sample rows (no single id column -- reported as a count) ----
  const sampleCardPlayerRows = cardPlayers.filter(
    (cp) => sampleCardIdSet.has(cp.card_id) || samplePlayerIdSet.has(cp.player_id)
  );

  // ---- shared_images (flagged by fingerprint text) ----
  const { data: sharedImagesData, error: sharedErr } = await supabase
    .from("shared_images")
    .select("fingerprint");
  if (sharedErr) throw sharedErr;
  const sharedImages = (sharedImagesData ?? []) as SharedImageRow[];
  const sampleSharedImages = sharedImages.filter((s) => isSampleText(s.fingerprint));

  // ---- user_cards: the safety check ----
  let referencedUserCardsCount = 0;
  if (sampleCardIds.length > 0 || sampleVariantIds.length > 0) {
    const orClauses: string[] = [];
    if (sampleCardIds.length > 0) orClauses.push(`card_id.in.(${sampleCardIds.join(",")})`);
    if (sampleVariantIds.length > 0) {
      orClauses.push(`card_variant_id.in.(${sampleVariantIds.join(",")})`);
    }

    const { count, error: refErr } = await supabase
      .from("user_cards")
      .select("id", { count: "exact", head: true })
      .or(orClauses.join(","));
    if (refErr) throw refErr;
    referencedUserCardsCount = count ?? 0;
  }

  // ---- report ----
  console.log(`sets: ${sets.length} total, ${sampleSetIds.length} flagged as sample`);
  console.log("  sample set IDs:", sampleSetIds.length ? sampleSetIds.join(", ") : "(none)");

  console.log(`\nplayers: ${players.length} total, ${samplePlayerIds.length} flagged as sample`);
  console.log(
    "  sample player IDs:",
    samplePlayerIds.length ? samplePlayerIds.join(", ") : "(none)"
  );

  console.log(`\ncards: ${cards.length} total, ${sampleCardIds.length} flagged as sample`);
  console.log("  sample card IDs:", sampleCardIds.length ? sampleCardIds.join(", ") : "(none)");

  console.log(
    `\ncard_variants: ${variants.length} total, ${sampleVariantIds.length} flagged as sample`
  );
  console.log(
    "  sample variant IDs:",
    sampleVariantIds.length ? sampleVariantIds.join(", ") : "(none)"
  );

  console.log(
    `\ncard_players: ${cardPlayers.length} total, ${sampleCardPlayerRows.length} flagged as sample ` +
      "(join rows have no single id column, reported as a count only)"
  );

  console.log(
    `\nshared_images: ${sharedImages.length} total, ${sampleSharedImages.length} flagged as sample`
  );
  if (sampleSharedImages.length) {
    console.log(
      "  sample fingerprints:",
      sampleSharedImages.map((s) => s.fingerprint).join(" | ")
    );
  }

  console.log(`\nreferenced user_cards count: ${referencedUserCardsCount}`);

  console.log("\n=== Result ===");
  if (referencedUserCardsCount > 0) {
    console.log(
      `BLOCKED: ${referencedUserCardsCount} real user_cards row(s) reference flagged catalog rows. ` +
        "Do not delete the flagged sets/players/cards/card_variants above until this is resolved."
    );
  } else if (sampleSetIds.length === 0 && samplePlayerIds.length === 0 && sampleCardIds.length === 0) {
    console.log("SAFE: no sample rows were found in the tables checked.");
  } else {
    console.log(
      "SAFE: no user_cards rows reference the flagged catalog rows above. " +
        "Cleanup of the flagged rows would not orphan real user data."
    );
  }

  console.log("\nThis script made no changes. No deletes, no updates, no migrations were run.");
}

main().catch((err) => {
  console.error("Audit failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

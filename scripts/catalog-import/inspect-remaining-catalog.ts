import { createClient } from "@supabase/supabase-js";

/**
 * Read-only inspection of the current contents of the shared catalog
 * tables (sets/players/cards/card_variants/card_players/shared_images) --
 * prints actual row contents, not just counts/ids, and flags each row
 * against the same test-pattern heuristic the cleanup scripts use, so a
 * human can judge whether what remains looks like real/seed data or
 * leftover test data.
 *
 * Deliberately uses the public anon/publishable key, not the service role
 * key: every table this script reads is confirmed publicly readable, so
 * requiring the more sensitive service role key here would be unnecessary
 * privilege. No deletes, no updates, no migrations, no app behavior
 * changes.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TEST_PATTERN =
  /test|verify|hook|check|fix|dup|click|summary|order|stub|refactor|autofill|setlookup|checklist|\d{10,}/i;

function isSampleText(...values: Array<string | null | undefined>): boolean {
  return values.some((v) => !!v && TEST_PATTERN.test(v));
}

async function main() {
  console.log("=== Remaining Catalog Inspection (read-only) ===\n");

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error(
      "FAILED: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set. " +
        "Aborting -- no queries were run."
    );
    process.exitCode = 1;
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  const { data: sets, error: setsErr } = await supabase
    .from("sets")
    .select("id, name, brand, manufacturer, release_year, slug")
    .order("id", { ascending: true });
  if (setsErr) throw setsErr;

  const { data: players, error: playersErr } = await supabase
    .from("players")
    .select("id, full_name, league_id, team_id, slug")
    .order("id", { ascending: true });
  if (playersErr) throw playersErr;

  const { data: cards, error: cardsErr } = await supabase
    .from("cards")
    .select(
      "id, set_id, card_number, title, rookie_card, release_year, printed_year, is_insert, is_autograph, is_memorabilia, search_text"
    )
    .order("id", { ascending: true });
  if (cardsErr) throw cardsErr;

  const { data: cardVariants, error: variantsErr } = await supabase
    .from("card_variants")
    .select(
      "id, card_id, parallel_type_id, print_run, has_autograph, has_memorabilia, is_refractor, is_die_cut, is_short_print, notes"
    )
    .order("id", { ascending: true });
  if (variantsErr) throw variantsErr;

  const { data: cardPlayers, error: cardPlayersErr } = await supabase
    .from("card_players")
    .select("card_id, player_id, role")
    .order("card_id", { ascending: true });
  if (cardPlayersErr) throw cardPlayersErr;

  const { data: sharedImages, error: sharedErr } = await supabase
    .from("shared_images")
    .select("fingerprint, image_path, is_front, is_slabbed, created_at")
    .order("created_at", { ascending: true });
  if (sharedErr) throw sharedErr;

  console.log(`--- sets (${sets?.length ?? 0} row(s)) ---`);
  for (const s of sets ?? []) {
    const flagged = isSampleText(s.name, s.slug) ? "TEST-LOOKING" : "looks legitimate";
    console.log(
      `  id=${s.id} name="${s.name}" brand=${s.brand ?? "null"} manufacturer=${
        s.manufacturer ?? "null"
      } release_year=${s.release_year ?? "null"} slug="${s.slug}" [${flagged}]`
    );
  }

  console.log(`\n--- players (${players?.length ?? 0} row(s)) ---`);
  for (const p of players ?? []) {
    const flagged = isSampleText(p.full_name, p.slug) ? "TEST-LOOKING" : "looks legitimate";
    console.log(
      `  id=${p.id} full_name="${p.full_name}" league_id=${p.league_id ?? "null"} team_id=${
        p.team_id ?? "null"
      } slug="${p.slug}" [${flagged}]`
    );
  }

  console.log(`\n--- cards (${cards?.length ?? 0} row(s)) ---`);
  for (const c of cards ?? []) {
    const flagged = isSampleText(c.title, c.search_text) ? "TEST-LOOKING (own text)" : "no test text of its own";
    console.log(
      `  id=${c.id} set_id=${c.set_id ?? "null"} card_number=${c.card_number ?? "null"} title=${
        c.title ?? "null"
      } rookie=${c.rookie_card} release_year=${c.release_year ?? "null"} printed_year=${
        c.printed_year ?? "null"
      } insert=${c.is_insert} auto=${c.is_autograph} memorabilia=${c.is_memorabilia} search_text=${
        c.search_text ?? "null"
      } [${flagged}]`
    );
  }

  console.log(`\n--- card_variants (${cardVariants?.length ?? 0} row(s)) ---`);
  for (const v of cardVariants ?? []) {
    console.log(
      `  id=${v.id} card_id=${v.card_id ?? "null"} parallel_type_id=${
        v.parallel_type_id ?? "null"
      } print_run=${v.print_run ?? "null"} auto=${v.has_autograph} memorabilia=${
        v.has_memorabilia
      } refractor=${v.is_refractor} die_cut=${v.is_die_cut} short_print=${v.is_short_print} notes=${
        v.notes ?? "null"
      }`
    );
  }

  console.log(`\n--- card_players (${cardPlayers?.length ?? 0} row(s)) ---`);
  for (const cp of cardPlayers ?? []) {
    console.log(`  card_id=${cp.card_id} player_id=${cp.player_id} role=${cp.role ?? "null"}`);
  }

  console.log(`\n--- shared_images (${sharedImages?.length ?? 0} row(s)) ---`);
  for (const si of sharedImages ?? []) {
    const flagged = isSampleText(si.fingerprint) ? "TEST-LOOKING" : "looks legitimate";
    console.log(
      `  fingerprint="${si.fingerprint}" image_path=${si.image_path} is_front=${
        si.is_front
      } is_slabbed=${si.is_slabbed} created_at=${si.created_at} [${flagged}]`
    );
  }

  // ---- verdict ----
  const testLikeSets = (sets ?? []).filter((s) => isSampleText(s.name, s.slug)).length;
  const testLikePlayers = (players ?? []).filter((p) => isSampleText(p.full_name, p.slug)).length;
  const testLikeCards = (cards ?? []).filter((c) => isSampleText(c.title, c.search_text)).length;
  const testLikeSharedImages = (sharedImages ?? []).filter((si) => isSampleText(si.fingerprint)).length;

  console.log("\n=== Verdict ===");
  console.log(
    `sets: ${testLikeSets}/${sets?.length ?? 0} look test-created by name/slug pattern`
  );
  console.log(
    `players: ${testLikePlayers}/${players?.length ?? 0} look test-created by name/slug pattern`
  );
  console.log(
    `cards: ${testLikeCards}/${cards?.length ?? 0} have test-looking text of their own ` +
      "(cards with a null title/search_text can't be judged this way directly -- see whether their set/players above look test-created instead)"
  );
  console.log(
    `shared_images: ${testLikeSharedImages}/${sharedImages?.length ?? 0} look test-created by fingerprint pattern`
  );

  const totalRemaining =
    (sets?.length ?? 0) +
    (players?.length ?? 0) +
    (cards?.length ?? 0) +
    (cardVariants?.length ?? 0) +
    (cardPlayers?.length ?? 0) +
    (sharedImages?.length ?? 0);

  if (totalRemaining === 0) {
    console.log("\nAll six tables are empty. Nothing remains to classify.");
  } else if (testLikeSets === (sets?.length ?? 0) && testLikePlayers === (players?.length ?? 0)) {
    console.log(
      "\nEverything remaining still looks test-created based on this heuristic -- none of it reads " +
        "as real seed/imported data yet."
    );
  } else {
    console.log(
      "\nSome remaining rows do NOT match the test-pattern heuristic -- review the per-row listings " +
        "above directly; this may be real/legitimate data, or simply test data whose name happened not " +
        "to match the pattern (e.g. a real-sounding name used manually as test input)."
    );
  }

  console.log("\nThis script made no changes. No deletes, no updates, no migrations were run.");
}

main().catch((err) => {
  console.error("Inspection failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

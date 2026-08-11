/**
 * Vision Engine V3 / Catalog bug fix: canonical parser for a raw source
 * player-name string that may combine multiple names with "/".
 *
 * Beckett's checklist format (and Panini's own card-design conventions)
 * legitimately use "/" in the ATHLETE column two ways:
 *   - a genuine multi-player card, e.g. "Ashton Jeanty/Omarion Hampton"
 *   - the SAME player shown across multiple team jerseys on one card
 *     (Panini's "Multiverse Jerseys" insert type), e.g.
 *     "A.J. Brown/A.J. Brown" for a player who has played for two teams
 * Before this fix, both catalog-import (build-catalog-entities.ts) and the
 * live /cards/new -> catalog-resolution write path treated the entire raw
 * string as one opaque player identity, producing bogus `players` rows
 * like "A.J. Brown/A.J. Brown" instead of recognizing it as the single
 * real player "A.J. Brown". This function is the single, shared fix for
 * both call sites -- see build-catalog-entities.ts (import) and
 * resolveCatalogIdsServer.ts (live app) for its two callers.
 *
 * A pure, dependency-free leaf on purpose: scripts/catalog-import/*.ts run
 * under plain Node (`node --experimental-strip-types`), which cannot
 * resolve this project's "@/..." tsconfig path alias -- only Next.js's
 * bundler and tsc's own type-checking understand it (see
 * write-catalog-v2.ts's own file-header comment for the fuller
 * explanation of that constraint). Keeping this file free of any further
 * "@/..." imports means build-catalog-entities.ts can still import it via
 * a plain relative path (`../../src/lib/catalog/parsePlayerNames.ts`)
 * without hitting that resolution problem, so the parsing logic has
 * exactly one implementation instead of two.
 */

/**
 * Splits a raw player-name string on "/", trims each part, discards empty
 * parts, and deduplicates identical names (case-insensitively) while
 * preserving first-occurrence order and the first occurrence's exact
 * casing/punctuation. A string with no "/" simply returns as a single-
 * element array -- existing single-player behavior is byte-identical
 * before and after this function is introduced.
 *
 * Deliberately does NOT fuzzy-match: "Ashton Jeanty" and "Omarion Hampton"
 * are never merged just because they co-occur on one card. Only an exact
 * (trimmed, casefolded) match counts as "the same player" here -- that is
 * the one and only case this function exists to catch (Beckett's
 * same-player-multiple-teams convention), not general name reconciliation.
 */
export function parsePlayerNames(raw: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  for (const part of raw.split("/")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const dedupeKey = trimmed.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    seen.add(dedupeKey);
    names.push(trimmed);
  }

  return names;
}

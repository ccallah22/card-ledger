import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";

export type GradingCompanyRow = {
  id: number;
  name: string;
  abbreviation: string;
  website: string | null;
  created_at: string;
  updated_at: string;
};

export async function listGradingCompanies(): Promise<GradingCompanyRow[]> {
  const { data, error } = await supabase
    .from("grading_companies")
    .select("*")
    .order("name", { ascending: true });

  if (error) throw error;

  return (data ?? []) as GradingCompanyRow[];
}

/**
 * Backup V2 restore preflight audit (Phase 4C1): the previous implementation
 * built a PostgREST `.or("name.ilike.X,abbreviation.ilike.X")` string by
 * directly interpolating the caller-supplied name into PostgREST's own
 * filter syntax -- `.or()`'s argument isn't a plain value, it's parsed as a
 * comma/operator-delimited expression, so a name containing a comma,
 * parenthesis, or `.` could alter the query's structure rather than simply
 * fail to match. That was always a latent issue, but restore preflight makes
 * it newly attacker-reachable: `grader` is fully attacker-controlled text
 * from an untrusted Backup V2 file, not something a user types into a
 * trusted UI field.
 *
 * Fixed by using two separate, safely-parameterized `.ilike(column, value)`
 * calls (matching the same safe pattern already used by
 * findLocationByName/findParallelTypeByName elsewhere in this codebase) and
 * combining their results in application code, rather than building one
 * compound filter expression from untrusted text. Same case-insensitive
 * name-OR-abbreviation matching semantics as before; no create; no
 * service-role requirement.
 *
 * Exposed (not just an internal implementation detail) because Backup V2
 * restore preflight needs the full candidate list -- not just "the" single
 * match -- to detect and safely reject the pathological case where a
 * grader string matches more than one existing company (possible despite
 * `grading_companies.name`/`abbreviation` both being `unique`, since that
 * uniqueness is case-SENSITIVE while this lookup is intentionally
 * case-insensitive: e.g. both "PSA" and "psa" could exist as distinct rows).
 */
export async function listGradingCompaniesMatchingName(
  name: string,
  client: SupabaseClient = supabase,
): Promise<GradingCompanyRow[]> {
  const trimmed = name.trim();
  if (!trimmed) return [];

  const [byName, byAbbreviation] = await Promise.all([
    client.from("grading_companies").select("*").ilike("name", trimmed),
    client.from("grading_companies").select("*").ilike("abbreviation", trimmed),
  ]);

  if (byName.error) throw byName.error;
  if (byAbbreviation.error) throw byAbbreviation.error;

  const matches = new Map<number, GradingCompanyRow>();
  for (const row of (byName.data ?? []) as GradingCompanyRow[]) matches.set(row.id, row);
  for (const row of (byAbbreviation.data ?? []) as GradingCompanyRow[]) matches.set(row.id, row);

  return [...matches.values()];
}

/**
 * Preserves this function's original contract (one match or null) for its
 * existing caller (findOrCreateGradingCompany, used by the live Add/Edit
 * catalog-resolution flow) -- built on the hardened, injection-safe lookup
 * above. Throwing on more than one match is not a new failure mode: the old
 * `.or(...).maybeSingle()` implementation already threw when more than one
 * row matched (a `maybeSingle()` postgrest-js call errors on >1 row), so
 * existing callers already had to tolerate that possibility; this just
 * reaches the same outcome through a safe query instead of an interpolated
 * filter string.
 */
export async function findGradingCompanyByName(
  name: string,
  client: SupabaseClient = supabase,
): Promise<GradingCompanyRow | null> {
  const matches = await listGradingCompaniesMatchingName(name, client);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous grading company match for "${name}": ${matches.length} distinct companies matched by name or abbreviation.`,
    );
  }
  return matches[0];
}

export async function findOrCreateGradingCompany(
  name: string,
  client: SupabaseClient = supabase,
): Promise<GradingCompanyRow> {
  const existing = await findGradingCompanyByName(name, client);
  if (existing) return existing;

  const { data, error } = await client
    .from("grading_companies")
    .insert({ name, abbreviation: name })
    .select("*")
    .single();

  if (error) throw error;

  return data as GradingCompanyRow;
}

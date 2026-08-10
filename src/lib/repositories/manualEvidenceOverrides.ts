import { supabase } from "@/lib/supabaseClient";
import { COLOR_FAMILIES, ORIENTATIONS } from "@/lib/vision/types";
import type { EvidenceFieldName, EvidenceValueForField } from "@/lib/evidence/types";
import type { ManualOverride, ManualOverridesByField } from "@/lib/evidence/manualOverrides";

// Vision Engine V3, Phase V3.5A1: repository for the additive
// `manual_evidence_overrides` table (see
// supabase/migrations/202608070001_manual_evidence_overrides.sql).
// Phase V3.5A2 wired replaceManualEvidenceOverrides into /cards/new's
// save cycle (src/app/(app)/cards/new/page.tsx's runSaveCycle) -- listed
// there are the only caller; /cards/[id]/edit does not call this module
// yet.
//
// These are private, user-owned rows protected by RLS (ownership checked
// indirectly through user_cards.profile_id = auth.uid(), exactly like
// card_media/card_value_snapshots) -- this file uses the plain
// authenticated browser Supabase client, the same pattern already used by
// src/lib/repositories/userCards.ts and cardMedia.ts. No service-role
// client, no trusted API route: unlike the shared-catalog write endpoint
// (which needed centralized trust because catalog tables are shared across
// every user), these rows are already correctly scoped by RLS alone.

const MAX_EXPLANATION_LENGTH = 300; // matches validateVisionAnalysis.ts's own cap

// Raw shape of a `manual_evidence_overrides` row exactly as Postgres/
// PostgREST returns it (snake_case column names) -- both `.select()` and
// `.rpc()` (the function returns the same composite row shape) produce
// this. Not exported; callers only ever see the mapped, camelCase
// ManualEvidenceOverrideRow below.
type ManualEvidenceOverrideDbRow = {
  id: number;
  user_card_id: string;
  field_name: string;
  value: unknown;
  explanation: string;
  created_at: string;
  superseded_at: string | null;
};

/** Mapped, application-facing shape of one stored override row. */
export type ManualEvidenceOverrideRow = {
  id: number;
  userCardId: string;
  fieldName: string;
  value: unknown;
  explanation: string;
  createdAt: string;
  supersededAt: string | null;
};

function mapManualEvidenceOverrideRow(row: ManualEvidenceOverrideDbRow): ManualEvidenceOverrideRow {
  return {
    id: row.id,
    userCardId: row.user_card_id,
    fieldName: row.field_name,
    value: row.value,
    explanation: row.explanation,
    createdAt: row.created_at,
    supersededAt: row.superseded_at,
  };
}

// ---------------------------------------------------------------------------
// Runtime validation -- database JSON is untrusted input, exactly like a
// provider response (see validateVisionAnalysis.ts). A row is never cast
// directly to a typed override; every field is checked before use, and a
// single malformed row is dropped rather than failing the whole load.
// ---------------------------------------------------------------------------

type FieldValueKind = "string" | "boolean" | "color" | "orientation";

// One entry per EvidenceFieldName (enforced by the mapped-type shape below,
// so a missing/extra field is a compile error) -- the single source of
// truth this module uses both for "is this a known field" and "what value
// shape does it expect." Intentionally self-contained here rather than
// importing fieldStrategies.ts, since this is about value TYPING, not
// fusion ownership policy -- a different concern.
const FIELD_VALUE_KINDS: { [K in EvidenceFieldName]: FieldValueKind } = {
  playerName: "string",
  teamName: "string",
  setName: "string",
  brand: "string",
  manufacturer: "string",
  year: "string",
  cardNumber: "string",
  cardName: "string",
  parallelText: "string",
  serialNumberText: "string",
  autographPresent: "boolean",
  memorabiliaPresent: "boolean",
  serialAreaVisible: "boolean",
  dominantColor: "color",
  borderColor: "color",
  orientation: "orientation",
};

function isKnownEvidenceFieldName(value: string): value is EvidenceFieldName {
  return Object.prototype.hasOwnProperty.call(FIELD_VALUE_KINDS, value);
}

function isValidValueForField(fieldName: EvidenceFieldName, value: unknown): boolean {
  switch (FIELD_VALUE_KINDS[fieldName]) {
    case "string":
      return typeof value === "string" && value.trim().length > 0;
    case "boolean":
      return typeof value === "boolean";
    case "color":
      return typeof value === "string" && (COLOR_FAMILIES as readonly string[]).includes(value);
    case "orientation":
      return typeof value === "string" && (ORIENTATIONS as readonly string[]).includes(value);
  }
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

/**
 * Compares two ISO-ish timestamp strings by the instant they represent,
 * not by raw string equality -- a DB-loaded created_at (PostgREST's own
 * timestamptz serialization, e.g. trailing "+00:00" and/or a different
 * fractional-second digit count) is never guaranteed to be byte-identical
 * to the local `new Date().toISOString()` string that originally produced
 * it, even when both name the exact same instant. Used only for the
 * idempotent-retry comparison below; never for validation (isValidTimestamp
 * already covers that) or for anything persisted.
 */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b);
}

/**
 * Validates one stored row and, if valid, converts it into the field name
 * + ManualOverride<unknown> pair listManualEvidenceOverrides assembles into
 * a ManualOverridesByField. Returns null for anything malformed -- an
 * unknown field_name, a value that doesn't match that field's real type,
 * an oversized/non-string explanation, or an unparseable timestamp -- so a
 * single bad row (e.g. from a future incompatible schema change) never
 * crashes a card's evidence load.
 *
 * Deliberately does NOT read or reconstruct `source`/`confidence` here --
 * ManualOverride<T> (src/lib/evidence/manualOverrides.ts) has no fields for
 * either; source.kind = "manual_override" and confidence = 1.0 are only
 * ever produced later, by that module's own buildOverrideObservation, from
 * a fixed literal, never from anything this function returns. A stored row
 * has no way to influence either value, by construction.
 */
function parseManualEvidenceOverrideRow(
  row: ManualEvidenceOverrideRow,
): { fieldName: EvidenceFieldName; override: ManualOverride<unknown> } | null {
  if (!isKnownEvidenceFieldName(row.fieldName)) return null;
  if (!isValidValueForField(row.fieldName, row.value)) return null;
  if (typeof row.explanation !== "string" || row.explanation.length > MAX_EXPLANATION_LENGTH) return null;
  if (!isValidTimestamp(row.createdAt)) return null;
  if (row.supersededAt !== null && !isValidTimestamp(row.supersededAt)) return null;

  return {
    fieldName: row.fieldName,
    override: { value: row.value, createdAt: row.createdAt, explanation: row.explanation },
  };
}

// ---------------------------------------------------------------------------
// Repository functions.
// ---------------------------------------------------------------------------

/**
 * Loads the currently-active manual overrides for one user_card, already
 * validated and shaped as a ManualOverridesByField -- directly usable as
 * applyManualOverrides()'s second argument with no further conversion.
 * RLS scopes this to the caller's own user_cards; a row belonging to
 * another user is simply never returned (no error). Malformed individual
 * rows are silently skipped (see parseManualEvidenceOverrideRow) rather
 * than surfacing raw invalid JSON or throwing.
 */
export async function listManualEvidenceOverrides(userCardId: string): Promise<ManualOverridesByField> {
  const { data, error } = await supabase
    .from("manual_evidence_overrides")
    .select("id, user_card_id, field_name, value, explanation, created_at, superseded_at")
    .eq("user_card_id", userCardId)
    .is("superseded_at", null);

  if (error) throw error;

  const result: ManualOverridesByField = {};
  // Narrow, documented bridge cast -- same pattern used throughout
  // src/lib/evidence/*: TypeScript cannot correlate a mapped type's
  // per-key value type back to a runtime-iterated key, even though the
  // correlation is exactly right at every real assignment below.
  const bag = result as Record<EvidenceFieldName, ManualOverride<unknown>>;

  for (const dbRow of (data ?? []) as ManualEvidenceOverrideDbRow[]) {
    const parsed = parseManualEvidenceOverrideRow(mapManualEvidenceOverrideRow(dbRow));
    if (!parsed) continue;
    bag[parsed.fieldName] = parsed.override;
  }

  return result;
}

/**
 * Sets the active override for one field, preserving history: the
 * previous active row (if any) is marked superseded and a new active row
 * is created, both in one transaction -- see
 * public.replace_manual_evidence_override's own migration comment for why
 * this genuinely needs to be a database function rather than two
 * PostgREST calls (a crash/race between two separate calls would be safe,
 * thanks to the partial unique index, but would not reliably preserve
 * history). The function runs SECURITY INVOKER, so the same RLS policies
 * that would apply to direct calls apply here too -- no ownership check is
 * duplicated in this repository function.
 *
 * `createdAt` must be the ORIGINAL local ManualOverride.createdAt (see
 * src/lib/evidence/manualOverrides.ts) -- Vision Engine V3, Phase V3.5A2
 * pre-commit fix (202608100001_manual_evidence_overrides_created_at.sql):
 * the RPC now writes this value verbatim as the new row's created_at
 * instead of defaulting to insert time, so the Evidence Timeline stays
 * truthful after reload. This function deliberately never generates a
 * replacement timestamp itself (e.g. `new Date().toISOString()`) -- the
 * caller's local createdAt is the only source of truth for when the
 * manual action actually happened.
 */
export async function upsertManualEvidenceOverride<K extends EvidenceFieldName>(
  userCardId: string,
  fieldName: K,
  value: EvidenceValueForField<K>,
  explanation: string,
  createdAt: string,
): Promise<ManualEvidenceOverrideRow> {
  const { data, error } = await supabase.rpc("replace_manual_evidence_override", {
    p_user_card_id: userCardId,
    p_field_name: fieldName,
    p_value: value,
    p_explanation: explanation,
    p_created_at: createdAt,
  });

  if (error) throw error;
  return mapManualEvidenceOverrideRow(data as ManualEvidenceOverrideDbRow);
}

/**
 * Marks the active override for one field as superseded -- a single
 * UPDATE statement, already atomic on its own (no RPC needed; unlike
 * "replace," there is no second statement to coordinate). Never a hard
 * delete, so the removed override remains in history. A no-op (0 rows
 * affected) if the field had no active override.
 */
export async function removeManualEvidenceOverride(
  userCardId: string,
  fieldName: EvidenceFieldName,
): Promise<void> {
  const { error } = await supabase
    .from("manual_evidence_overrides")
    .update({ superseded_at: new Date().toISOString() })
    .eq("user_card_id", userCardId)
    .eq("field_name", fieldName)
    .is("superseded_at", null);

  if (error) throw error;
}

/**
 * Makes every field present in `overrides` active with its supplied value,
 * and supersedes any currently-active field NOT present in `overrides` --
 * the batch operation /cards/new's save cycle (V3.5A2) calls once per save
 * attempt with the page's whole local manualOverrides map (see
 * runSaveCycle in src/app/(app)/cards/new/page.tsx).
 *
 * Atomicity: each field's own transition (upsert-via-RPC or supersede-via-
 * UPDATE) is independently atomic (see those functions' own comments).
 * This function does NOT attempt cross-field atomicity -- a crash between
 * two fields' calls can leave some fields updated and others not, by
 * design, since each field is independent evidence and there is no product
 * requirement that a partial failure here roll back an unrelated field's
 * already-successful write. The caller (runSaveCycle) is built around this:
 * a rejected Promise.all here still leaves every already-applied field
 * change in place, and a subsequent retry only needs to (re)apply whatever
 * didn't succeed.
 *
 * Retry-safety / idempotence: before writing, each supplied field is
 * compared against its current active row (already fetched by
 * listManualEvidenceOverrides above). A field whose active value,
 * explanation, AND createdAt already match the supplied override is
 * skipped entirely -- no RPC call, no new history row -- so calling this
 * function again with an unchanged `overrides` map (e.g. a retry after a
 * sibling field failed, or after an unrelated post-creation step like
 * media/OCR failed) never creates a meaningless duplicate active version
 * for a field that already persisted correctly. createdAt is part of this
 * comparison (Vision Engine V3, Phase V3.5A2 pre-commit fix) so a
 * genuinely new manual action -- the user replacing an override with the
 * same value/explanation but a new createdAt -- is correctly treated as a
 * new historical version rather than silently deduped away; createdAt is
 * compared by instant (sameInstant), not raw string equality, since a
 * DB-round-tripped timestamptz string is not guaranteed to be
 * byte-identical to the local ISO string that produced it. A field whose
 * value/explanation/createdAt genuinely differs (or that has no active row
 * yet) is still written via upsertManualEvidenceOverride, preserving that
 * field's own history exactly as before.
 */
export async function replaceManualEvidenceOverrides(
  userCardId: string,
  overrides: ManualOverridesByField,
): Promise<void> {
  const active = await listManualEvidenceOverrides(userCardId);
  const overridesBag = overrides as Record<EvidenceFieldName, ManualOverride<unknown> | undefined>;
  const activeBag = active as Record<EvidenceFieldName, ManualOverride<unknown> | undefined>;
  const activeFieldNames = Object.keys(active) as EvidenceFieldName[];
  const suppliedFieldNames = Object.keys(overrides) as EvidenceFieldName[];
  const suppliedSet = new Set(suppliedFieldNames);

  await Promise.all([
    ...activeFieldNames
      .filter((fieldName) => !suppliedSet.has(fieldName))
      .map((fieldName) => removeManualEvidenceOverride(userCardId, fieldName)),
    ...suppliedFieldNames.map((fieldName) => {
      const override = overridesBag[fieldName];
      if (!override) return Promise.resolve();

      const currentActive = activeBag[fieldName];
      const alreadyIdentical =
        !!currentActive &&
        currentActive.value === override.value &&
        currentActive.explanation === override.explanation &&
        sameInstant(currentActive.createdAt, override.createdAt);
      if (alreadyIdentical) return Promise.resolve();

      // Same narrow, documented bridge cast as elsewhere in this file --
      // `fieldName` is a runtime-iterated EvidenceFieldName, not a single
      // literal K, so TypeScript cannot correlate it back to
      // EvidenceValueForField<K> here even though the correlation holds at
      // every real entry in `overridesBag`.
      const value = override.value as EvidenceValueForField<EvidenceFieldName>;
      return upsertManualEvidenceOverride(
        userCardId,
        fieldName,
        value,
        override.explanation,
        override.createdAt,
      );
    }),
  ]);
}

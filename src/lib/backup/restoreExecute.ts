// TheBinder Backup V2 -- Phase 4E: the restore execution boundary.
//
// This module owns exactly two things: the pure mapping from an already-
// validated BackupV2Manifest + an already-run BackupV2RestorePreflight into
// the exact JSON payload public.restore_backup_v2(p_payload jsonb) expects
// (buildBackupV2RestorePayload), and the one function that actually calls
// that RPC (executeBackupV2Restore). Deliberately a SEPARATE module from
// restorePreflight.ts: that module's whole design point is being provably
// read-only (see its own header comment) -- keeping the one function that
// performs the actual destructive mutation somewhere else means
// restorePreflight.ts's "nothing here can write" property stays true by
// inspection, not by convention.
//
// Neither function here does any catalog/grading resolution, any Storage
// operation, or any localStorage operation. restore_backup_v2 is the SOLE
// mutation boundary for a Backup V2 restore -- this module never writes to
// user_cards/locations/card_media/card_value_snapshots/
// manual_evidence_overrides directly; it only ever shapes and sends one
// RPC call.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import type { BackupV2Card, BackupV2Location, BackupV2Manifest, BackupV2Media, BackupV2ManualEvidenceOverride, BackupV2ValueSnapshot } from "@/lib/backup/v2";
import type { BackupV2RestorePreflight } from "@/lib/backup/restorePreflight";

// ---------------------------------------------------------------------------
// Payload types -- must stay in exact sync with restore_backup_v2's own
// documented payload shape (see the header comment of
// supabase/migrations/202609210001_backup_v2_atomic_restore.sql).
// ---------------------------------------------------------------------------

// Derived from BackupV2Card via Omit rather than hand-duplicated: every
// field the RPC actually restores (id, team, locationName, serialNumber,
// gradingStatus, condition, grade, certNumber, status, the money fields,
// quantity, notes, comps, createdAt, updatedAt) flows through automatically.
// The omitted fields are catalog identity/fallback evidence that only ever
// existed to let restorePreflight resolve a card -- they are not part of
// the RPC contract and are never sent. If BackupV2Card ever gains a new
// restorable field, it appears here for free; if it gains a new
// catalog-only field, this Omit list needs a matching, visible addition --
// the same drift-risk shape already used elsewhere in this codebase (e.g.
// v2.ts's own EVIDENCE_FIELD_NAMES comment).
export type BackupV2RestorePayloadCard = Omit<
  BackupV2Card,
  | "catalogCardId"
  | "catalogVariantId"
  | "playerName"
  | "year"
  | "setName"
  | "cardNumber"
  | "insert"
  | "parallel"
  | "variation"
  | "serialTotal"
  | "isRookie"
  | "isAutograph"
  | "isPatch"
  | "grader"
> & {
  resolvedCardId: number;
  resolvedCardVariantId: number | null;
  resolvedGradingCompanyId: number | null;
};

export type BackupV2RestorePayload = {
  version: 2;
  cards: BackupV2RestorePayloadCard[];
  locations: BackupV2Location[];
  media: BackupV2Media[];
  valueSnapshots: BackupV2ValueSnapshot[];
  manualEvidenceOverrides: BackupV2ManualEvidenceOverride[];
};

export type BackupV2RestoreResult = {
  restoredCards: number;
  restoredLocations: number;
  restoredMedia: number;
  restoredValueSnapshots: number;
  restoredManualEvidenceOverrides: number;
};

// ---------------------------------------------------------------------------
// Payload construction (pure -- no Supabase call, no I/O).
// ---------------------------------------------------------------------------

/**
 * Builds the exact restore_backup_v2 payload from an already-validated
 * manifest and an already-run preflight result. Refuses outright
 * (`canProceed !== true` throws, builds nothing) rather than ever producing
 * a partial/best-effort payload -- restore is all-or-nothing per the locked
 * product decision, and this function is the one place that could otherwise
 * be tempted to quietly drop a blocked card.
 *
 * Cards are read EXCLUSIVELY from `preflight.resolvedCards`, never from
 * `manifest.cards` -- each ResolvedBackupV2Card already carries its own
 * resolved `backupCard`, so no join/lookup by id is needed, and this
 * function never has to assume `resolvedCards` is ordered the same as (or
 * even the same length as) `manifest.cards` -- neither BackupV2RestorePreflight's
 * own type nor restorePreflight.ts's documentation promises that, so nothing
 * here relies on it. Locations/media/valueSnapshots/manualEvidenceOverrides
 * are untouched by preflight (see restorePreflight.ts's own scope) and pass
 * through from the manifest verbatim.
 *
 * Never performs catalog/grading resolution itself -- resolvedCardId/
 * resolvedCardVariantId/resolvedGradingCompanyId come only from what
 * preflight already resolved. Never sends manifest.profileId or
 * manifest.exportedAt (no counterpart in the RPC contract -- see the
 * migration's own header comment: ownership is derived exclusively from
 * auth.uid() server-side, never from anything in this payload).
 */
export function buildBackupV2RestorePayload(
  manifest: BackupV2Manifest,
  preflight: BackupV2RestorePreflight,
): BackupV2RestorePayload {
  if (!preflight.canProceed) {
    throw new Error(
      "buildBackupV2RestorePayload: refusing to build a restore payload -- preflight has blocking errors.",
    );
  }

  // Explicit positive field selection (list exactly what IS sent) rather
  // than destructure-and-discard the catalog/fallback fields -- avoids
  // "assigned but never used" noise entirely and matches this codebase's
  // existing style for this exact kind of shape mapping (see v2.ts's own
  // toBackupV2Card, which lists every field one by one rather than
  // destructuring). Every field named here has a direct counterpart in
  // BackupV2RestorePayloadCard's Omit<BackupV2Card, ...> type -- if that
  // Omit list ever changes, this call site needs a matching, visible edit.
  const cards: BackupV2RestorePayloadCard[] = preflight.resolvedCards.map((resolved) => {
    const c = resolved.backupCard;
    return {
      id: c.id,
      resolvedCardId: resolved.resolvedCardId,
      resolvedCardVariantId: resolved.resolvedCardVariantId,
      resolvedGradingCompanyId: resolved.resolvedGradingCompanyId,
      team: c.team,
      locationName: c.locationName,
      serialNumber: c.serialNumber,
      gradingStatus: c.gradingStatus,
      condition: c.condition,
      grade: c.grade,
      certNumber: c.certNumber,
      status: c.status,
      purchasePrice: c.purchasePrice,
      purchaseDate: c.purchaseDate,
      estimatedValue: c.estimatedValue,
      askingPrice: c.askingPrice,
      soldPrice: c.soldPrice,
      soldDate: c.soldDate,
      soldFees: c.soldFees,
      soldNotes: c.soldNotes,
      quantity: c.quantity,
      notes: c.notes,
      comps: c.comps,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });

  return {
    version: 2,
    cards,
    locations: manifest.locations,
    media: manifest.media,
    valueSnapshots: manifest.valueSnapshots,
    manualEvidenceOverrides: manifest.manualEvidenceOverrides,
  };
}

// ---------------------------------------------------------------------------
// RPC execution -- the sole mutation boundary for a Backup V2 restore.
// ---------------------------------------------------------------------------

/**
 * Calls public.restore_backup_v2 with an already-built payload and returns
 * its typed result. This is the ONLY function in the Backup V2 restore path
 * that mutates anything -- no Storage call, no localStorage call, no direct
 * write to user_cards/locations/card_media/card_value_snapshots/
 * manual_evidence_overrides anywhere here or in any caller. Uses the same
 * browser Supabase singleton (and the same plain, untyped `.rpc(...)` call
 * shape) every other RPC call in this codebase already uses (see
 * repositories/manualEvidenceOverrides.ts's replace_manual_evidence_override
 * call) -- there is no generated Database type in this project to type
 * against (see this phase's own audit), so this mirrors the codebase's
 * existing, already-proven pattern rather than inventing a new one.
 *
 * An error from Supabase is thrown, never swallowed or retried -- the
 * caller is responsible for catching it and deciding what the user sees;
 * this function makes no UI decisions. Ownership is never asserted here:
 * no profile id of any kind is part of `payload` (see
 * BackupV2RestorePayload above) or passed as a separate argument -- the
 * RPC derives it exclusively from the authenticated session's own
 * auth.uid(), carried automatically by the browser client on every request.
 */
export async function executeBackupV2Restore(
  payload: BackupV2RestorePayload,
  client: SupabaseClient = supabase,
): Promise<BackupV2RestoreResult> {
  const { data, error } = await client.rpc("restore_backup_v2", { p_payload: payload });

  if (error) throw error;

  return data as BackupV2RestoreResult;
}

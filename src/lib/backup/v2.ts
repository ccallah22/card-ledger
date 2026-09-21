// TheBinder Backup V2 -- data contract + pure validation (Phase 3
// refactor). Extracted verbatim (no behavior change) from
// src/app/(app)/cards/backup/page.tsx, which previously owned this logic
// alongside its React/UI code. This module owns exactly two things: the
// V2 manifest type contract, and the pure functions that produce/validate
// it. It deliberately does NOT own:
//   - React state or any UI/JSX
//   - file selection or export/import orchestration
//   - Supabase calls of any kind
//   - DOM access (no `document`, no Blob/URL download helpers)
//   - Storage access
//   - localStorage access (the legacy image-map system is V1-only and
//     stays in page.tsx)
// Every function below is pure: given the same input, it always produces
// the same output, with no side effects. `validateBackupV2Manifest` is
// the single public trust boundary -- the only function a caller (today,
// backup/page.tsx; a future Phase 4 restore path) needs to safely turn
// untrusted `unknown` JSON into a trusted BackupV2Manifest. The five
// `toBackupV2*` mapping functions are the export-side counterpart of that
// same contract, so they live here too rather than drifting out of sync
// with the validators that check their output shape.

import type { MyCard } from "@/lib/repositories/myCards";
import type {
  CardMedia,
  CardMediaSide,
  CardMediaProcessingStatus,
  JsonValue,
} from "@/lib/repositories/cardMedia";
import type { ValueSnapshotRow } from "@/lib/repositories/valueSnapshots";
import type { ManualEvidenceOverrideRow } from "@/lib/repositories/manualEvidenceOverrides";
import type { LocationRow } from "@/lib/repositories/locations";
import type { CardComp, CardCondition, CardStatus, GradingStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Backup V2 format types (Backup V2 architecture audit, Phase 2: metadata
// export). Every field was reconciled against current source-of-truth
// types (MyCard in myCards.ts, CardMedia in repositories/cardMedia.ts,
// ValueSnapshotRow in valueSnapshots.ts, ManualEvidenceOverrideRow in
// manualEvidenceOverrides.ts, LocationRow in locations.ts) -- see
// toBackupV2Card/toBackupV2Media/toBackupV2ValueSnapshot/
// toBackupV2ManualEvidenceOverride/toBackupV2Location below for the exact
// mapping each field comes from.
//
// `version` identifies the V2 schema generation; `backupMode` identifies
// whether THIS backup is metadata-only or a complete, photo-inclusive
// one -- resolving the exact ambiguity a version-number-only scheme would
// have created once a full, photo-inclusive exporter also exists and also
// says "version: 2" (see BackupV2Manifest.backupMode below). card_media
// ROWS are collection metadata in their own right (OCR/Vision results,
// slab status, processing state) even though the underlying Storage image
// bytes remain out of scope for "metadata" mode -- see BackupV2Media's own
// comment for exactly what is and isn't included.
// ---------------------------------------------------------------------------

export type BackupV2Manifest = {
  version: 2;
  // "metadata": cards + card_media rows (no image bytes) + value
  // snapshots + manual evidence override history + locations -- exactly
  // what this phase's exporter produces, always. "full" (photo-inclusive,
  // archive-based) is not implemented anywhere in this codebase yet --
  // nothing in this phase ever emits it.
  backupMode: "metadata" | "full";
  exportedAt: string;
  // Informational only -- NEVER authorization. A future V2 restore's real
  // ownership boundary is always the importing session's own
  // authenticated profile; this field exists only so a confirmation UI
  // can flag a cross-account restore to the user, never to grant access
  // to anything this field merely claims.
  profileId: string;

  cards: BackupV2Card[];
  media: BackupV2Media[];
  valueSnapshots: BackupV2ValueSnapshot[];
  manualEvidenceOverrides: BackupV2ManualEvidenceOverride[];
  locations: BackupV2Location[];
};

// Deliberately NOT `MyCard` itself: MyCard also carries derived/read-only
// fields (players, setId, setSlug, hasPersistedImage, image path fields)
// that don't belong in a portable backup record the way this
// card-identity shape needs them named, and this type's `id` is
// documented as PRESERVED on a future restore (design audit's UUID
// strategy recommendation) rather than the server-generated id MyCard.id
// merely happens to describe today.
export type BackupV2Card = {
  // Original user_cards.id -- preserved (not remapped) on a future restore.
  id: string;

  // Stable catalog identity first; free-text fallback fields always
  // included too, mirroring MyCardInput's own existing fallback-
  // resolution fields (see resolveCatalogIdsWithStages).
  catalogCardId?: number;
  catalogVariantId?: number;
  playerName: string;
  year?: string;
  setName: string;
  cardNumber?: string;
  insert?: string;
  parallel?: string;
  variation?: string;
  serialNumber?: number;
  serialTotal?: number;
  isRookie?: boolean;
  isAutograph?: boolean;
  isPatch?: boolean;

  team?: string;
  locationName?: string;

  gradingStatus: GradingStatus;
  condition?: CardCondition;
  grader?: string;
  grade?: string;
  certNumber?: string;

  status: CardStatus;

  purchasePrice?: number;
  purchaseDate?: string;
  estimatedValue?: number;
  askingPrice?: number;
  soldPrice?: number;
  soldDate?: string;
  soldFees?: number;
  soldNotes?: string;

  quantity: number;
  notes?: string;
  comps?: CardComp[];

  createdAt?: string;
  updatedAt?: string;
};

// Mirrors CardMedia (repositories/cardMedia.ts). `id` is not preserved --
// nothing else references a card_media row by its own id.
//
// STORAGE PATH RULE: originalPath/processedPath/thumbnailPath are
// deliberately NOT represented anywhere in this type. Those are live
// Supabase Storage destinations (see cardMediaStorage.ts's
// buildCardMediaObjectPath), not portable backup content -- exporting
// them as restorable identity would let a future restore treat a stale
// path string as if it still points at real, present bytes. This
// metadata-only manifest preserves the FACT that a card_media row exists
// for (userCardId, side) and its meaningful non-path metadata, without
// implying image bytes are contained (there is no archivePath at all in
// backupMode: "metadata" -- see the manifest's own comment). No image
// bytes are read or downloaded to produce this type.
//
// mediaType is also excluded: the column is a checked, currently
// single-valued field (`media_type in ('image')`, always "image" today),
// so it carries no information a metadata export needs to preserve.
export type BackupV2Media = {
  userCardId: string;
  side: CardMediaSide;
  isSlabbed: boolean;

  ocrOutput?: JsonValue | null;
  visionOutput?: JsonValue | null;
  catalogMatchVariantId?: number;
  confidenceScore?: number;
  imageContentHash?: string;
  processingStatus: CardMediaProcessingStatus;

  createdAt: string;
  updatedAt: string;
};

// Mirrors ValueSnapshotRow (repositories/valueSnapshots.ts). `id` is not
// preserved -- a pure append-only history row nothing else references by
// id.
export type BackupV2ValueSnapshot = {
  userCardId: string;
  marketValue: number;
  source?: string;
  recordedAt: string;
  createdAt: string;
};

// Mirrors ManualEvidenceOverrideRow (repositories/manualEvidenceOverrides.ts).
// Full history (not just the currently-active row) is included, per the
// design audit's recommendation -- supersededAt: null marks the active
// row for a given (userCardId, fieldName). `id` is not preserved.
// fieldName is typed as `string`, not the narrower EvidenceFieldName
// union, because the export read (listManualEvidenceOverrideHistoryForUserCards)
// deliberately returns raw, unvalidated rows for backup fidelity -- see
// that function's own comment.
export type BackupV2ManualEvidenceOverride = {
  userCardId: string;
  fieldName: string;
  value: unknown;
  explanation: string;
  createdAt: string;
  supersededAt: string | null;
};

// Mirrors LocationRow (repositories/locations.ts) -- explicit entities,
// not only inferred from card references, so an empty location or its
// description survives a restore. `id`/`profileId`/timestamps are not
// preserved -- a restore re-resolves locations by name via the existing
// findOrCreateLocation idiom, exactly as V1 already does.
export type BackupV2Location = {
  name: string;
  description?: string;
};

export function toBackupV2Card(c: MyCard): BackupV2Card {
  return {
    id: c.id,
    catalogCardId: c.catalogCardId,
    catalogVariantId: c.catalogVariantId,
    playerName: c.playerName,
    year: c.year || undefined,
    setName: c.setName,
    cardNumber: c.cardNumber,
    insert: c.insert,
    parallel: c.parallel,
    variation: c.variation,
    serialNumber: c.serialNumber,
    serialTotal: c.serialTotal,
    isRookie: c.isRookie,
    isAutograph: c.isAutograph,
    isPatch: c.isPatch,
    team: c.team,
    locationName: c.location,
    gradingStatus: c.gradingStatus,
    condition: c.condition,
    grader: c.grader,
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
}

export function toBackupV2Media(row: CardMedia): BackupV2Media {
  return {
    userCardId: row.userCardId,
    side: row.side,
    isSlabbed: row.isSlabbed,
    ocrOutput: row.ocrOutput,
    visionOutput: row.visionOutput,
    catalogMatchVariantId: row.catalogMatchId ?? undefined,
    confidenceScore: row.confidenceScore ?? undefined,
    imageContentHash: row.imageContentHash ?? undefined,
    processingStatus: row.processingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toBackupV2ValueSnapshot(row: ValueSnapshotRow): BackupV2ValueSnapshot {
  return {
    userCardId: row.user_card_id,
    marketValue: row.market_value,
    source: row.source ?? undefined,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  };
}

export function toBackupV2ManualEvidenceOverride(
  row: ManualEvidenceOverrideRow,
): BackupV2ManualEvidenceOverride {
  return {
    userCardId: row.userCardId,
    fieldName: row.fieldName,
    value: row.value,
    explanation: row.explanation,
    createdAt: row.createdAt,
    supersededAt: row.supersededAt,
  };
}

export function toBackupV2Location(row: LocationRow): BackupV2Location {
  return {
    name: row.name,
    description: row.description ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Backup V2 import validation (Phase 3): a selected V2 file is untrusted
// input. Nothing below ever does `parsed as BackupV2Manifest` and trusts
// it -- every function takes `unknown` and returns either a specific
// error string or (once every check anywhere in the manifest has passed)
// a value that's finally safe to treat as the real type. No database or
// Storage call happens anywhere in this section; the only authenticated
// read Phase 3 needs (the caller's own profile id, for the sameAccount
// comparison) is performed by the CALLER (backup/page.tsx's
// requireProfileId), never by anything in this module -- see
// validateBackupV2Manifest's own `currentProfileId` parameter below.
//
// Constraints enforced below are reconciled against REAL schema/domain
// constraints only -- see each check's own comment for where it comes
// from. Nothing here invents a tighter rule than the database or the
// current BackupV2* types actually have.
//
// Everything from here down to validateBackupV2Manifest's own closing
// brace is a PRIVATE implementation detail of this module, except the
// final validateBackupV2Manifest function itself (and the BackupV2DryRun/
// BackupV2ValidationResult types it returns) -- the primitive type guards
// and per-row validators are not exported, since nothing outside this
// module has ever needed to call them individually.
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidString(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

function isOptionalString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

function isTimestampString(v: unknown): boolean {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function isOptionalTimestampString(v: unknown): boolean {
  return v === undefined || isTimestampString(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isOptionalFiniteNumber(v: unknown): boolean {
  return v === undefined || isFiniteNumber(v);
}

function isOptionalInteger(v: unknown): boolean {
  return v === undefined || (typeof v === "number" && Number.isInteger(v));
}

function isOptionalBoolean(v: unknown): boolean {
  return v === undefined || typeof v === "boolean";
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// user_cards_grading_status_check (202607050001_user_collections.sql).
const GRADING_STATUSES: readonly string[] = ["RAW", "GRADED"];
// user_cards_status_check (202607050001_user_collections.sql).
const CARD_STATUSES: readonly string[] = ["HAVE", "WANT", "FOR_SALE", "SOLD"];
// CardCondition (types.ts) -- an application-level domain type, not a DB
// check constraint, but BackupV2Card.condition is typed to it, so a value
// outside this set is still a real structural defect for this format.
const CARD_CONDITIONS: readonly string[] = [
  "MINT",
  "NEAR_MINT_MINT",
  "NEAR_MINT",
  "EXCELLENT",
  "VERY_GOOD",
  "GOOD",
  "FAIR",
  "POOR",
];
// card_media_side_check (202607100002_vision_engine_v2_card_media.sql).
const CARD_MEDIA_SIDES: readonly string[] = ["front", "back", "none"];
// card_media_processing_status_check (202607100002_vision_engine_v2_card_media.sql).
const CARD_MEDIA_PROCESSING_STATUSES: readonly string[] = [
  "uploaded",
  "cropped",
  "ocr_complete",
  "vision_complete",
  "catalog_matched",
  "verified",
  "failed",
];
// manual_evidence_overrides_field_name_check
// (202608070001_manual_evidence_overrides.sql), matching
// manualEvidenceOverrides.ts's FIELD_VALUE_KINDS keys exactly -- if that
// set ever changes, this list needs updating too.
const EVIDENCE_FIELD_NAMES: readonly string[] = [
  "playerName",
  "teamName",
  "setName",
  "brand",
  "manufacturer",
  "year",
  "cardNumber",
  "cardName",
  "parallelText",
  "serialNumberText",
  "autographPresent",
  "memorabiliaPresent",
  "serialAreaVisible",
  "dominantColor",
  "borderColor",
  "orientation",
];

function validateBackupV2Comp(row: unknown, cardIndex: number, compIndex: number): string | null {
  const p = `cards[${cardIndex}].comps[${compIndex}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;
  if (typeof row.id !== "string" || row.id.trim() === "") return `${p}.id must be a non-empty string.`;
  if (!isFiniteNumber(row.price)) return `${p}.price must be a number.`;
  if (!isOptionalString(row.date)) return `${p}.date must be a string if present.`;
  if (!isOptionalString(row.source)) return `${p}.source must be a string if present.`;
  if (!isOptionalString(row.url)) return `${p}.url must be a string if present.`;
  if (!isOptionalString(row.notes)) return `${p}.notes must be a string if present.`;
  return null;
}

// Every field is reconciled against the CURRENT BackupV2Card type above --
// required vs optional matches that type exactly; enum-like fields
// (gradingStatus/status/condition) are checked against the real
// constraint each one actually has (see the constant lists above).
// Deliberately does NOT reject legitimate-but-unusual free text (player
// names, notes, grader names, etc.) -- only fields with a real type/enum
// constraint are constrained here.
function validateBackupV2Card(row: unknown, index: number): string | null {
  const p = `cards[${index}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;

  if (!isUuidString(row.id)) return `${p}.id is not a valid card id.`;
  if (!isOptionalInteger(row.catalogCardId)) return `${p}.catalogCardId must be an integer if present.`;
  if (!isOptionalInteger(row.catalogVariantId)) return `${p}.catalogVariantId must be an integer if present.`;
  if (typeof row.playerName !== "string") return `${p}.playerName must be a string.`;
  if (!isOptionalString(row.year)) return `${p}.year must be a string if present.`;
  if (typeof row.setName !== "string") return `${p}.setName must be a string.`;
  if (!isOptionalString(row.cardNumber)) return `${p}.cardNumber must be a string if present.`;
  if (!isOptionalString(row.insert)) return `${p}.insert must be a string if present.`;
  if (!isOptionalString(row.parallel)) return `${p}.parallel must be a string if present.`;
  if (!isOptionalString(row.variation)) return `${p}.variation must be a string if present.`;
  if (!isOptionalInteger(row.serialNumber)) return `${p}.serialNumber must be an integer if present.`;
  if (!isOptionalInteger(row.serialTotal)) return `${p}.serialTotal must be an integer if present.`;
  if (!isOptionalBoolean(row.isRookie)) return `${p}.isRookie must be a boolean if present.`;
  if (!isOptionalBoolean(row.isAutograph)) return `${p}.isAutograph must be a boolean if present.`;
  if (!isOptionalBoolean(row.isPatch)) return `${p}.isPatch must be a boolean if present.`;
  if (!isOptionalString(row.team)) return `${p}.team must be a string if present.`;
  if (!isOptionalString(row.locationName)) return `${p}.locationName must be a string if present.`;

  if (!GRADING_STATUSES.includes(row.gradingStatus as string)) {
    return `${p}.gradingStatus must be one of ${GRADING_STATUSES.join(", ")}.`;
  }
  if (row.condition !== undefined && !CARD_CONDITIONS.includes(row.condition as string)) {
    return `${p}.condition must be one of ${CARD_CONDITIONS.join(", ")} if present.`;
  }
  if (!isOptionalString(row.grader)) return `${p}.grader must be a string if present.`;
  if (!isOptionalString(row.grade)) return `${p}.grade must be a string if present.`;
  if (!isOptionalString(row.certNumber)) return `${p}.certNumber must be a string if present.`;

  if (!CARD_STATUSES.includes(row.status as string)) {
    return `${p}.status must be one of ${CARD_STATUSES.join(", ")}.`;
  }

  if (!isOptionalFiniteNumber(row.purchasePrice)) return `${p}.purchasePrice must be a number if present.`;
  if (!isOptionalString(row.purchaseDate)) return `${p}.purchaseDate must be a string if present.`;
  if (!isOptionalFiniteNumber(row.estimatedValue)) return `${p}.estimatedValue must be a number if present.`;
  if (!isOptionalFiniteNumber(row.askingPrice)) return `${p}.askingPrice must be a number if present.`;
  if (!isOptionalFiniteNumber(row.soldPrice)) return `${p}.soldPrice must be a number if present.`;
  if (!isOptionalString(row.soldDate)) return `${p}.soldDate must be a string if present.`;
  if (!isOptionalFiniteNumber(row.soldFees)) return `${p}.soldFees must be a number if present.`;
  if (!isOptionalString(row.soldNotes)) return `${p}.soldNotes must be a string if present.`;

  // quantity: user_cards.quantity is `integer not null` with no check
  // constraint beyond that (see 202607050001_user_collections.sql) -- no
  // positivity/range requirement is invented here that the schema itself
  // doesn't have.
  if (!Number.isInteger(row.quantity)) return `${p}.quantity must be an integer.`;
  if (!isOptionalString(row.notes)) return `${p}.notes must be a string if present.`;

  if (row.comps !== undefined) {
    if (!Array.isArray(row.comps)) return `${p}.comps must be an array if present.`;
    for (let i = 0; i < row.comps.length; i++) {
      const compError = validateBackupV2Comp(row.comps[i], index, i);
      if (compError) return compError;
    }
  }

  if (!isOptionalTimestampString(row.createdAt)) {
    return `${p}.createdAt must be a valid timestamp string if present.`;
  }
  if (!isOptionalTimestampString(row.updatedAt)) {
    return `${p}.updatedAt must be a valid timestamp string if present.`;
  }

  return null;
}

// Reconciled against the CURRENT BackupV2Media type. Deliberately does
// NOT check for archivePath/originalPath/processedPath/thumbnailPath --
// metadata-mode media rows never carry any of those (see BackupV2Media's
// own Storage Path Rule comment), so their absence is expected, not an
// error, and their presence (if some other producer ever added them) is
// simply ignored here, not rejected -- this validator only asserts what
// IS required of a metadata-mode row.
function validateBackupV2Media(row: unknown, index: number): string | null {
  const p = `media[${index}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;

  if (!isUuidString(row.userCardId)) return `${p}.userCardId is not a valid card id.`;
  if (!CARD_MEDIA_SIDES.includes(row.side as string)) {
    return `${p}.side must be one of ${CARD_MEDIA_SIDES.join(", ")}.`;
  }
  if (typeof row.isSlabbed !== "boolean") return `${p}.isSlabbed must be a boolean.`;

  // ocrOutput/visionOutput: any JSON value (or null/undefined) is valid
  // by construction -- everything here already came from JSON.parse, so
  // there is nothing to reject other than what the earlier isPlainObject
  // check on `row` itself already guarantees.

  if (!isOptionalInteger(row.catalogMatchVariantId)) {
    return `${p}.catalogMatchVariantId must be an integer if present.`;
  }
  if (row.confidenceScore !== undefined) {
    // card_media_confidence_score_check
    // (202607100002_vision_engine_v2_card_media.sql): null or 0-1 inclusive.
    if (!isFiniteNumber(row.confidenceScore) || row.confidenceScore < 0 || row.confidenceScore > 1) {
      return `${p}.confidenceScore must be a number between 0 and 1 if present.`;
    }
  }
  if (!isOptionalString(row.imageContentHash)) {
    return `${p}.imageContentHash must be a string if present.`;
  }
  if (!CARD_MEDIA_PROCESSING_STATUSES.includes(row.processingStatus as string)) {
    return `${p}.processingStatus must be one of ${CARD_MEDIA_PROCESSING_STATUSES.join(", ")}.`;
  }
  if (!isTimestampString(row.createdAt)) return `${p}.createdAt must be a valid timestamp string.`;
  if (!isTimestampString(row.updatedAt)) return `${p}.updatedAt must be a valid timestamp string.`;

  return null;
}

function validateBackupV2ValueSnapshot(row: unknown, index: number): string | null {
  const p = `valueSnapshots[${index}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;

  if (!isUuidString(row.userCardId)) return `${p}.userCardId is not a valid card id.`;
  if (!isFiniteNumber(row.marketValue)) return `${p}.marketValue must be a number.`;
  if (!isOptionalString(row.source)) return `${p}.source must be a string if present.`;
  if (!isTimestampString(row.recordedAt)) return `${p}.recordedAt must be a valid timestamp string.`;
  if (!isTimestampString(row.createdAt)) return `${p}.createdAt must be a valid timestamp string.`;

  return null;
}

// IMPORTANT: this is backup-fidelity data, not the live Add/Edit evidence
// UI's data -- listManualEvidenceOverrideHistoryForUserCards deliberately
// returns full history (active AND superseded) with no per-field value-
// shape validation, so this validator does the same: fieldName is checked
// against the real set the database enforces (EVIDENCE_FIELD_NAMES
// above), but `value` itself is only required to be present -- the
// stricter per-field kind matching the live UI applies
// (isValidValueForField in manualEvidenceOverrides.ts) is a UI-safety
// concern deliberately NOT re-applied here, so a legitimate historical row
// that predates a schema/kind change still validates successfully.
function validateBackupV2ManualEvidenceOverride(row: unknown, index: number): string | null {
  const p = `manualEvidenceOverrides[${index}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;

  if (!isUuidString(row.userCardId)) return `${p}.userCardId is not a valid card id.`;
  if (typeof row.fieldName !== "string" || !EVIDENCE_FIELD_NAMES.includes(row.fieldName)) {
    return `${p}.fieldName must be one of the supported evidence fields.`;
  }
  if (row.value === undefined) return `${p}.value is required.`;
  if (typeof row.explanation !== "string") return `${p}.explanation must be a string.`;
  if (!isTimestampString(row.createdAt)) return `${p}.createdAt must be a valid timestamp string.`;
  if (row.supersededAt !== null && !isTimestampString(row.supersededAt)) {
    return `${p}.supersededAt must be null or a valid timestamp string.`;
  }

  return null;
}

function validateBackupV2Location(row: unknown, index: number): string | null {
  const p = `locations[${index}]`;
  if (!isPlainObject(row)) return `${p} is not an object.`;

  if (typeof row.name !== "string") return `${p}.name must be a string.`;
  if (!isOptionalString(row.description)) return `${p}.description must be a string if present.`;

  return null;
}

// Result of a fully-validated V2 dry run -- never produced by mutating
// anything. `manifest` is the exact parsed content, now safe to treat as
// BackupV2Manifest because every check above passed. `sameAccount` is
// informational (see BackupV2Manifest.profileId's own comment) -- it is
// never used to accept or reject a file.
export type BackupV2DryRun = {
  manifest: BackupV2Manifest;
  sameAccount: boolean;
  counts: {
    cards: number;
    media: number;
    valueSnapshots: number;
    manualEvidenceOverrides: number;
    locations: number;
  };
  warnings: string[];
};

// "unsupported_mode" is deliberately distinct from "invalid": a
// backupMode: "full" file is a structurally-recognized V2 file (not
// malformed input) that this phase simply cannot inspect yet, because
// full/photo-inclusive V2 doesn't exist anywhere in this codebase --
// different from a genuinely broken/tampered file. Both block the same
// way in the UI (no confirmation, no mutation), but the message shown
// should not conflate the two.
export type BackupV2ValidationResult =
  | { ok: true; dryRun: BackupV2DryRun }
  | { ok: false; reason: "unsupported_mode"; message: string }
  | { ok: false; reason: "invalid"; message: string };

// The single public entry point every V2 file selection goes through.
// Validates the ENTIRE manifest -- top-level shape, every card/media/
// value-snapshot/manual-override/location row, every cross-reference
// between them, and the one real DB uniqueness rule a future restore
// would otherwise violate (card_media's (user_card_id, side) partial
// unique index) -- before ever returning `ok: true`. Performs no
// database or Storage call itself; `currentProfileId` is supplied by the
// caller (backup/page.tsx's handleFileSelected, via its existing
// requireProfileId), which is the only place anything authenticated is
// read -- this module never calls Supabase.
export function validateBackupV2Manifest(
  parsed: unknown,
  currentProfileId: string,
): BackupV2ValidationResult {
  const fail = (message: string): BackupV2ValidationResult => ({
    ok: false,
    reason: "invalid",
    message: `Invalid Backup V2: ${message}`,
  });

  if (!isPlainObject(parsed)) return fail("the file is not a JSON object.");
  if (parsed.version !== 2) return fail("version must be 2.");

  if (parsed.backupMode !== "metadata" && parsed.backupMode !== "full") {
    return fail('backupMode must be "metadata" or "full".');
  }
  if (parsed.backupMode === "full") {
    return {
      ok: false,
      reason: "unsupported_mode",
      message:
        "This is a full (photo-inclusive) Backup V2 file. Full Backup V2 restore is not supported yet -- only metadata-only V2 backups can currently be inspected.",
    };
  }

  if (!isTimestampString(parsed.exportedAt)) return fail("exportedAt must be a valid timestamp string.");
  // profileId is informational only (see BackupV2Manifest's own comment)
  // -- still structurally validated as a real profile id shape, never
  // used here to accept/reject the file based on WHOSE id it is.
  if (!isUuidString(parsed.profileId)) return fail("profileId must be a valid profile id.");

  if (!Array.isArray(parsed.cards)) return fail("cards must be an array.");
  if (!Array.isArray(parsed.media)) return fail("media must be an array.");
  if (!Array.isArray(parsed.valueSnapshots)) return fail("valueSnapshots must be an array.");
  if (!Array.isArray(parsed.manualEvidenceOverrides)) {
    return fail("manualEvidenceOverrides must be an array.");
  }
  if (!Array.isArray(parsed.locations)) return fail("locations must be an array.");

  const cardIds = new Set<string>();
  for (let i = 0; i < parsed.cards.length; i++) {
    const err = validateBackupV2Card(parsed.cards[i], i);
    if (err) return fail(err);
    const id = (parsed.cards[i] as BackupV2Card).id;
    if (cardIds.has(id)) return fail(`cards[${i}].id is a duplicate of an earlier card (id: ${id}).`);
    cardIds.add(id);
  }

  // card_media_user_card_media_type_side_key
  // (202607100002_vision_engine_v2_card_media.sql): at most one row per
  // (user_card_id, side) where side <> 'none' -- a real DB uniqueness
  // rule a future restore would violate, so it's validated now rather
  // than invented or skipped.
  const mediaKeys = new Set<string>();
  for (let i = 0; i < parsed.media.length; i++) {
    const err = validateBackupV2Media(parsed.media[i], i);
    if (err) return fail(err);
    const row = parsed.media[i] as BackupV2Media;
    if (!cardIds.has(row.userCardId)) {
      return fail(`media[${i}].userCardId does not reference a card in this backup.`);
    }
    if (row.side !== "none") {
      const key = `${row.userCardId}::${row.side}`;
      if (mediaKeys.has(key)) {
        return fail(
          `media[${i}] duplicates an earlier "${row.side}" media row for the same card, which TheBinder's schema does not allow.`,
        );
      }
      mediaKeys.add(key);
    }
  }

  for (let i = 0; i < parsed.valueSnapshots.length; i++) {
    const err = validateBackupV2ValueSnapshot(parsed.valueSnapshots[i], i);
    if (err) return fail(err);
    const row = parsed.valueSnapshots[i] as BackupV2ValueSnapshot;
    if (!cardIds.has(row.userCardId)) {
      return fail(`valueSnapshots[${i}].userCardId does not reference a card in this backup.`);
    }
  }

  for (let i = 0; i < parsed.manualEvidenceOverrides.length; i++) {
    const err = validateBackupV2ManualEvidenceOverride(parsed.manualEvidenceOverrides[i], i);
    if (err) return fail(err);
    const row = parsed.manualEvidenceOverrides[i] as BackupV2ManualEvidenceOverride;
    if (!cardIds.has(row.userCardId)) {
      return fail(`manualEvidenceOverrides[${i}].userCardId does not reference a card in this backup.`);
    }
  }

  for (let i = 0; i < parsed.locations.length; i++) {
    const err = validateBackupV2Location(parsed.locations[i], i);
    if (err) return fail(err);
  }

  // Location relationship check: a card's locationName must match a real
  // location entity in this same manifest. Matched case-insensitively,
  // mirroring findLocationByName's existing `.ilike("name", name)`
  // semantics (locations.ts) -- the same lookup a future restore would
  // use to resolve locationName back to a row.
  const locationNames = new Set(
    (parsed.locations as BackupV2Location[]).map((l) => l.name.trim().toLowerCase()),
  );
  for (let i = 0; i < parsed.cards.length; i++) {
    const card = parsed.cards[i] as BackupV2Card;
    const name = card.locationName?.trim();
    if (name && !locationNames.has(name.toLowerCase())) {
      return fail(`cards[${i}].locationName ("${card.locationName}") has no matching entry in locations.`);
    }
  }

  const manifest = parsed as BackupV2Manifest;
  const sameAccount = manifest.profileId === currentProfileId;

  const warnings: string[] = [];
  if (!sameAccount) {
    warnings.push("This backup was exported from a different TheBinder account.");
  }
  // backupMode is guaranteed "metadata" at this point (the "full" branch
  // above already returned) -- always true today, kept as an explicit
  // check rather than an unconditional push so this stays correct if a
  // "full" dry-run path is ever added later.
  if (manifest.backupMode === "metadata") {
    warnings.push(
      "This is a metadata-only backup -- it does not contain photo/image bytes. Card photos will need to be re-added after a future restore.",
    );
  }

  return {
    ok: true,
    dryRun: {
      manifest,
      sameAccount,
      counts: {
        cards: manifest.cards.length,
        media: manifest.media.length,
        valueSnapshots: manifest.valueSnapshots.length,
        manualEvidenceOverrides: manifest.manualEvidenceOverrides.length,
        locations: manifest.locations.length,
      },
      warnings,
    },
  };
}

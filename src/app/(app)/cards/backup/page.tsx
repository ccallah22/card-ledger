"use client";

import { useEffect, useMemo, useState } from "react";
import { type MyCard, type MyCardInput, listMyCards, createMyCard, deleteMyCards } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { loadImageMap, loadThumbnailMap, replaceImageMap, replaceThumbnailMap } from "@/lib/imageStore";
import { startTrace, captureError } from "@/lib/sentry";
import type { CardComp, CardCondition, CardStatus, GradingStatus } from "@/lib/types";
import { listLocations, type LocationRow } from "@/lib/repositories/locations";
import {
  listValueSnapshotsForUserCards,
  type ValueSnapshotRow,
} from "@/lib/repositories/valueSnapshots";
import {
  listManualEvidenceOverrideHistoryForUserCards,
  type ManualEvidenceOverrideRow,
} from "@/lib/repositories/manualEvidenceOverrides";
import {
  listCardMediaForUserCards,
  type CardMedia,
  type CardMediaSide,
  type CardMediaProcessingStatus,
  type JsonValue,
} from "@/lib/repositories/cardMedia";

// The exact shape TheBinder has shipped and exported as "version: 1" since
// the original Backup feature -- renamed from the old generic
// `BackupPayload` to make its version explicit now that a second format
// version number exists (see detectBackupVersion below). Fields,
// optionality, and serialized output are byte-for-byte unchanged from
// before this rename.
type BackupV1Payload = {
  version: 1;
  exportedAt: string;
  cards: MyCard[];
  images: Record<string, string>;
  thumbnails?: Record<string, string>;
};

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

type BackupV2Manifest = {
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
type BackupV2Card = {
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
type BackupV2Media = {
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
type BackupV2ValueSnapshot = {
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
type BackupV2ManualEvidenceOverride = {
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
type BackupV2Location = {
  name: string;
  description?: string;
};

function toBackupV2Card(c: MyCard): BackupV2Card {
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

function toBackupV2Media(row: CardMedia): BackupV2Media {
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

function toBackupV2ValueSnapshot(row: ValueSnapshotRow): BackupV2ValueSnapshot {
  return {
    userCardId: row.user_card_id,
    marketValue: row.market_value,
    source: row.source ?? undefined,
    recordedAt: row.recorded_at,
    createdAt: row.created_at,
  };
}

function toBackupV2ManualEvidenceOverride(
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

function toBackupV2Location(row: LocationRow): BackupV2Location {
  return {
    name: row.name,
    description: row.description ?? undefined,
  };
}

// Version dispatch must run BEFORE any format-specific structural
// validation (see handleFileSelected) -- deliberately does NOT infer V1
// merely because a `cards` array happens to be present, which was the
// old (pre-V2-aware) behavior this replaces. Any object whose `version`
// isn't exactly 1 or 2 -- including a missing version field entirely --
// is "unknown" and must be safely rejected, never guessed at.
function detectBackupVersion(parsed: unknown): 1 | 2 | "unknown" {
  if (!parsed || typeof parsed !== "object") return "unknown";
  const version = (parsed as { version?: unknown }).version;
  if (version === 1) return 1;
  if (version === 2) return 2;
  return "unknown";
}

async function requireProfileId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not logged in");
  return profile.id;
}

function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
  const keySet = new Set<keyof T>(keys);
  const entries = (Object.entries(obj) as [keyof T, T[keyof T]][]).filter(
    ([key]) => !keySet.has(key),
  );
  return Object.fromEntries(entries) as Omit<T, K>;
}

function cardToInput(c: MyCard): MyCardInput {
  return omit(c, ["id", "createdAt", "updatedAt"]);
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Backup Import safety: the validated, not-yet-applied contents of a
// selected V1 backup file. Explicitly V1-specific (not a generic
// "PendingImport") now that a second format exists -- a V2 file can never
// reach this state, see handleFileSelected's version dispatch below.
// Populated only once a file has been read, detected as version 1, and
// has passed the existing structural check (Array.isArray(parsed.cards))
// -- its mere existence is what gates the confirmation modal, so nothing
// in this shape is optional/partial. fileName is display-only context for
// the confirmation (see JSX below); it never affects import behavior.
type BackupV1PendingImport = {
  cards: MyCard[];
  images: Record<string, string>;
  thumbnails: Record<string, string>;
  fileName: string;
};

export default function BackupPage() {
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);
  // Backup V2 metadata export: separate loading flag from `importing` --
  // this is a read-only export, not the mutating import path, and must
  // never gate/disable the Import JSON control or vice versa.
  const [exportingV2, setExportingV2] = useState(false);
  // Backup Import safety: a non-null value means a file was selected and
  // passed validation, and the confirmation modal is showing -- see
  // handleFileSelected/confirmImport/cancelImport below. Nothing in
  // handleFileSelected ever calls deleteMyCards/createMyCard; those only
  // run from confirmImport, after the user explicitly clicks "Replace and
  // Import".
  const [pendingImport, setPendingImport] = useState<BackupV1PendingImport | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        setLoading(true);
        const profileId = await requireProfileId();
        const endTrace = startTrace("load-backup-cards");
        const data = await listMyCards(profileId);
        if (endTrace) endTrace();
        if (active) setCards(data);
      } catch (e) {
        captureError(e, { area: "backup-load" });
        const message = e instanceof Error ? e.message : "Failed to load cards.";
        if (active) setError(message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => {
    const images = loadImageMap();
    const thumbs = loadThumbnailMap();
    return {
      cards: cards.length,
      images: Object.keys(images).length,
      thumbnails: Object.keys(thumbs).length,
    };
  }, [cards]);

  async function handleExport() {
    setError("");
    setNotice("");
    const profileId = await requireProfileId();
    const endTrace = startTrace("export-backup");
    const data = await listMyCards(profileId);
    if (endTrace) endTrace();
    const images = loadImageMap();
    const thumbnails = loadThumbnailMap();
    // Export remains V1 in this phase -- unchanged payload shape, unchanged
    // "version: 1" literal, unchanged output. Nothing here generates a V2
    // backup yet.
    const payload: BackupV1Payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: data,
      images,
      thumbnails,
    };
    downloadJson(`thebinder-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setNotice("Backup exported.");
  }

  // Backup V2 metadata export (Phase 2): a separate, clearly-labeled
  // action from V1's "Export JSON" above -- does not touch or replace it.
  // Loads all five datasets (cards, card_media metadata, value snapshots,
  // manual evidence override history, locations), all read-only/RLS-
  // scoped, then maps them into a BackupV2Manifest tagged
  // backupMode: "metadata" and downloads it. Deliberately all-or-error:
  // if any dataset fails to load, the catch below runs and downloadJson
  // is never called -- no partially-populated V2 file is ever produced.
  // Contains no image-byte handling of any kind -- card_media ROWS are
  // included (OCR/Vision results, slab status, processing state), but no
  // Storage path, signed URL, download, or upload of any kind occurs
  // anywhere in this function (see BackupV2Media's own comment for the
  // Storage Path Rule this deliberately follows).
  async function handleExportV2Metadata() {
    setError("");
    setNotice("");
    setExportingV2(true);

    try {
      const profileId = await requireProfileId();
      const endTrace = startTrace("export-backup-v2-metadata");

      const cardRows = await listMyCards(profileId);
      const userCardIds = cardRows.map((c) => c.id);

      const [mediaRows, locationRows, valueSnapshotRows, overrideRows] = await Promise.all([
        listCardMediaForUserCards(userCardIds),
        listLocations(profileId),
        listValueSnapshotsForUserCards(userCardIds),
        listManualEvidenceOverrideHistoryForUserCards(userCardIds),
      ]);

      if (endTrace) endTrace();

      const manifest: BackupV2Manifest = {
        version: 2,
        backupMode: "metadata",
        exportedAt: new Date().toISOString(),
        profileId,
        cards: cardRows.map(toBackupV2Card),
        media: mediaRows.map(toBackupV2Media),
        valueSnapshots: valueSnapshotRows.map(toBackupV2ValueSnapshot),
        manualEvidenceOverrides: overrideRows.map(toBackupV2ManualEvidenceOverride),
        locations: locationRows.map(toBackupV2Location),
      };

      downloadJson(
        `thebinder-backup-v2-metadata-${new Date().toISOString().slice(0, 10)}.json`,
        manifest,
      );
      setNotice(
        `V2 metadata exported: ${manifest.cards.length} cards, ${manifest.media.length} media rows, ${manifest.valueSnapshots.length} value snapshots, ${manifest.manualEvidenceOverrides.length} manual overrides, ${manifest.locations.length} locations.`,
      );
    } catch (err) {
      captureError(err, { area: "backup-export-v2-metadata" });
      setError((err as Error).message || "Failed to export V2 metadata.");
    } finally {
      setExportingV2(false);
    }
  }

  // Backup Import safety: runs on every file selection. Reads + parses the
  // file, then dispatches on detectBackupVersion's result BEFORE any
  // format-specific structural validation runs -- version detection first,
  // format validation second, never the old "assume V1 because a `cards`
  // array exists" shortcut.
  //
  // Only a file that detects as version 1 AND passes V1's existing
  // structural check ever reaches setPendingImport (the only thing that
  // makes the confirmation modal appear) -- a version-2 file and an
  // unknown/missing-version file both return before that point, and
  // neither this function nor anything it calls ever invokes
  // deleteMyCards/createMyCard/replaceImageMap/replaceThumbnailMap. Only
  // confirmImport (reachable solely through that modal) mutates anything.
  async function handleFileSelected(file: File | null) {
    if (!file) return;
    setError("");
    setNotice("");

    let parsed: unknown;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      captureError(err, { area: "backup-import-validate" });
      setError((err as Error).message || "Failed to read backup file.");
      return;
    }

    const version = detectBackupVersion(parsed);

    if (version === "unknown") {
      setError("This doesn't look like a supported TheBinder backup file.");
      return;
    }

    if (version === 2) {
      // Phase 1 of the Backup V2 rollout: V2 files are recognized as a
      // valid, known format version, but V2 restore does not exist yet.
      // Explicitly refuse to proceed rather than attempting to interpret
      // V2 data with V1 logic (or vice versa) -- no confirmation is shown,
      // pendingImport is never set, and nothing is mutated.
      setError("Backup V2 files are recognized, but V2 restore is not available yet.");
      return;
    }

    // version === 1: preserve the existing V1 structural validation
    // exactly (Array.isArray(parsed.cards)), now reached only after an
    // explicit version check rather than being the default assumption.
    try {
      const v1 = parsed as Partial<BackupV1Payload>;

      if (!Array.isArray(v1.cards)) {
        throw new Error("Invalid backup file. Missing cards array.");
      }

      setPendingImport({
        cards: v1.cards as MyCard[],
        images: (v1.images ?? {}) as Record<string, string>,
        thumbnails: (v1.thumbnails ?? {}) as Record<string, string>,
        fileName: file.name,
      });
    } catch (err) {
      captureError(err, { area: "backup-import-validate" });
      setError((err as Error).message || "Failed to read backup file.");
    }
  }

  // Backup Import safety: closes the confirmation without touching the
  // collection. Guarded against firing while a confirmed import is
  // already running (the Cancel button is also disabled in that state --
  // see JSX below -- this is defense in depth, e.g. against the backdrop
  // click handler). The file input already resets its own value
  // synchronously in its onChange (see JSX), independent of this
  // function, so selecting the same file again after Cancel still fires
  // onChange and re-triggers validation/confirmation.
  function cancelImport() {
    if (importing) return;
    setPendingImport(null);
  }

  // Backup Import safety: this is the ONLY place that mutates the
  // collection -- the exact same delete-then-create sequence the old
  // handleImport ran, unchanged, just moved behind explicit confirmation
  // and reading from pendingImport instead of a freshly-parsed file.
  // Guarded on both pendingImport and importing so neither a missing
  // payload nor a second click (double submission) can start a second
  // run while one is already in flight.
  async function confirmImport() {
    if (!pendingImport || importing) return;
    setError("");
    setNotice("");
    setImporting(true);

    try {
      const endTrace = startTrace("import-backup");
      const { cards: nextCards, images, thumbnails } = pendingImport;

      const profileId = await requireProfileId();
      const existing = await listMyCards(profileId);
      if (existing.length) {
        await deleteMyCards(existing.map((c) => c.id));
      }
      // Restored cards get fresh server-generated ids, so the images/thumbnails
      // maps (keyed by the old id) need to be remapped to the new ones.
      const idMap = new Map<string, string>();
      const created: MyCard[] = [];
      for (const c of nextCards) {
        const row = await createMyCard(profileId, cardToInput(c));
        idMap.set(String(c.id), row.id);
        created.push(row);
      }

      const remap = (map: Record<string, string>) => {
        const next: Record<string, string> = {};
        for (const [oldId, value] of Object.entries(map)) {
          const newId = idMap.get(oldId);
          if (newId) next[newId] = value;
        }
        return next;
      };

      const imagesOk = replaceImageMap(remap(images));
      const thumbsOk = replaceThumbnailMap(remap(thumbnails));

      const imageMsg = imagesOk ? "" : " Some images were skipped due to storage limits.";
      const thumbMsg = thumbnails && !thumbsOk ? " Some thumbnails were skipped due to storage limits." : "";

      setCards(created);
      setNotice(`Backup imported: ${created.length} cards.${imageMsg}${thumbMsg}`.trim());
      setPendingImport(null);
      if (endTrace) endTrace();
    } catch (err) {
      captureError(err, { area: "backup-import" });
      setError((err as Error).message || "Failed to import backup.");
      // Close the confirmation on failure rather than leaving it open on
      // a payload that may have partially applied (see the report's
      // partial-restore note) -- surfaces the existing error banner
      // instead of a silent success, and prevents an accidental re-click
      // of "Replace and Import" from re-running against stale state. The
      // user can retry by selecting the file again.
      setPendingImport(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-10 pt-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-500 sm:text-zinc-900">Backup</h1>
        <p className="mt-1 text-sm text-zinc-700">
          Export a backup (cards + images) and restore it on another device.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
        <div className="text-sm text-zinc-900">
          Current data:{" "}
          <span className="font-medium text-zinc-900">
            {loading ? "Loading…" : summary.cards}
          </span>{" "}
          cards,{" "}
          <span className="font-medium text-zinc-900">{summary.images}</span> images,{" "}
          <span className="font-medium text-zinc-900">{summary.thumbnails}</span> thumbnails.
        </div>
        {/* Button-system Phase 3 (corrected): Export reads/downloads only
            (no mutation) -- an optional utility action, so .btn-secondary.
            Import's internal implementation deletes existing cards before
            recreating them (see confirmImport's deleteMyCards call
            below), but that's an implementation detail of a restore
            operation, not the user's intended action -- "Import JSON" is
            a normal import/restore entry point, not a Delete command, so
            it must not read as a destructive red button. Classified as
            .btn-normal: a real, whole-page operation, but this page has
            no single "principal" action the way e.g. Save Card does --
            Export and Import are two co-equal top-level actions, so
            neither claims .btn-primary. Selecting a file here only
            validates it (handleFileSelected) -- the actual replacement
            now requires an explicit confirmation (see the modal below and
            confirmImport), which is the destructive step. */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={handleExport} className="btn-secondary">
            Export JSON
          </button>
          {/* Backup V2 metadata export (Phase 2): temporary development/
              product scaffolding so the V2 format can be inspected/tested
              independently of V1 -- does not replace or change "Export
              JSON" above. Same .btn-secondary classification as V1 Export
              (read-only, optional/utility action). */}
          <button
            type="button"
            onClick={handleExportV2Metadata}
            disabled={exportingV2}
            className="btn-secondary"
          >
            {exportingV2 ? "Exporting…" : "Export V2 Metadata"}
          </button>
          <label className="btn-normal inline-flex cursor-pointer items-center gap-2">
            <span>{importing ? "Importing…" : "Import JSON"}</span>
            <input
              type="file"
              accept="application/json"
              disabled={importing}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0] ?? null;
                e.currentTarget.value = "";
                handleFileSelected(file);
              }}
              className="hidden"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-zinc-600">
          Import replaces your current card data.
        </p>
      </div>

      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {/* Backup Import safety: explicit confirmation gate, page-local
          (structurally similar to DeleteCardDialog.tsx, but this isn't
          card-delete-specific so it isn't forced into that component).
          Rendered only while pendingImport is set -- i.e. only after a
          file has been read and passed validation, never on a raw file
          selection. Cancel/backdrop click clear pendingImport without
          touching the collection; "Replace and Import" is the sole
          trigger for confirmImport's mutation. Both actions are disabled
          while importing so a second click (or a stray backdrop click)
          can't start a second run or close the dialog mid-mutation. */}
      {pendingImport ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
          onClick={cancelImport}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-import-confirm-title"
            className="w-full max-w-md rounded-2xl border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div id="backup-import-confirm-title" className="text-lg font-semibold">
              Replace current card data?
            </div>

            <div className="mt-1 text-sm text-zinc-600">
              Importing this backup will replace the card data currently in your Binder with
              the data from this backup.
              <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800">
                Selected file: {pendingImport.fileName} &middot; {pendingImport.cards.length} card
                {pendingImport.cards.length === 1 ? "" : "s"}
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelImport}
                disabled={importing}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmImport}
                disabled={importing}
                className="btn-destructive"
              >
                {importing ? "Importing…" : "Replace and Import"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { type MyCard, type MyCardInput, listMyCards, createMyCard, deleteMyCards } from "@/lib/repositories/myCards";
import { getCurrentProfile } from "@/lib/repositories/profiles";
import { loadImageMap, loadThumbnailMap, replaceImageMap, replaceThumbnailMap } from "@/lib/imageStore";
import { startTrace, captureError } from "@/lib/sentry";

type BackupPayload = {
  version: 1;
  exportedAt: string;
  cards: MyCard[];
  images: Record<string, string>;
  thumbnails?: Record<string, string>;
};

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
// selected backup file. Populated only once a file has been read and has
// passed the existing structural check (Array.isArray(parsed.cards)) --
// its mere existence is what gates the confirmation modal, so nothing in
// this shape is optional/partial. fileName is display-only context for
// the confirmation (see JSX below); it never affects import behavior.
type PendingImport = {
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
  // Backup Import safety: a non-null value means a file was selected and
  // passed validation, and the confirmation modal is showing -- see
  // handleFileSelected/confirmImport/cancelImport below. Nothing in
  // handleFileSelected ever calls deleteMyCards/createMyCard; those only
  // run from confirmImport, after the user explicitly clicks "Replace and
  // Import".
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

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
    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cards: data,
      images,
      thumbnails,
    };
    downloadJson(`thebinder-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setNotice("Backup exported.");
  }

  // Backup Import safety: runs on every file selection. Reads + parses +
  // validates only -- the exact same structural check the old
  // handleImport used (Array.isArray(parsed.cards)) -- and never calls
  // deleteMyCards/createMyCard/replaceImageMap/replaceThumbnailMap. On
  // success it stores the validated payload in pendingImport, which is
  // what makes the confirmation modal appear (see JSX below); it does NOT
  // touch the existing collection. On failure it shows the same error
  // behavior as before and leaves pendingImport null, so no confirmation
  // opens and nothing is mutated.
  async function handleFileSelected(file: File | null) {
    if (!file) return;
    setError("");
    setNotice("");

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<BackupPayload>;

      if (!parsed || !Array.isArray(parsed.cards)) {
        throw new Error("Invalid backup file. Missing cards array.");
      }

      setPendingImport({
        cards: parsed.cards as MyCard[],
        images: (parsed.images ?? {}) as Record<string, string>,
        thumbnails: (parsed.thumbnails ?? {}) as Record<string, string>,
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

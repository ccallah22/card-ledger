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

function cardToInput(c: MyCard): MyCardInput {
  const { id, createdAt, updatedAt, ...input } = c;
  return input;
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

export default function BackupPage() {
  const [notice, setNotice] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [importing, setImporting] = useState(false);
  const [cards, setCards] = useState<MyCard[]>([]);
  const [loading, setLoading] = useState(true);

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
      } catch (e: any) {
        captureError(e, { area: "backup-load" });
        if (active) setError(e?.message ?? "Failed to load cards.");
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

  async function handleImport(file: File | null) {
    if (!file) return;
    setError("");
    setNotice("");
    setImporting(true);

    try {
      const endTrace = startTrace("import-backup");
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<BackupPayload>;

      if (!parsed || !Array.isArray(parsed.cards)) {
        throw new Error("Invalid backup file. Missing cards array.");
      }

      const nextCards = parsed.cards as MyCard[];
      const images = (parsed.images ?? {}) as Record<string, string>;
      const thumbnails = (parsed.thumbnails ?? {}) as Record<string, string>;

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
      if (endTrace) endTrace();
    } catch (err) {
      captureError(err, { area: "backup-import" });
      setError((err as Error).message || "Failed to import backup.");
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
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleExport}
            className="rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            Export JSON
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-400 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50">
            <span>{importing ? "Importing…" : "Import JSON"}</span>
            <input
              type="file"
              accept="application/json"
              disabled={importing}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0] ?? null;
                e.currentTarget.value = "";
                handleImport(file);
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
    </div>
  );
}

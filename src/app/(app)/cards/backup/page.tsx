"use client";

import { useMemo, useState } from "react";
import type { SportsCard } from "@/lib/types";
import { loadCards, saveCards } from "@/lib/storage";
import { loadImageMap, replaceImageMap } from "@/lib/imageStore";
import { loadSharedImages, replaceSharedImages } from "@/lib/sharedImages";

type BackupPayload = {
  version: 1;
  exportedAt: string;
  cards: SportsCard[];
  images: Record<string, string>;
  sharedImages: Record<string, unknown>;
};

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

  const summary = useMemo(() => {
    const cards = loadCards();
    const images = loadImageMap();
    const sharedImages = loadSharedImages();
    return {
      cards: cards.length,
      images: Object.keys(images).length,
      sharedImages: Object.keys(sharedImages).length,
    };
  }, []);

  function handleExport() {
    setError("");
    setNotice("");
    const cards = loadCards();
    const images = loadImageMap();
    const sharedImages = loadSharedImages();
    const payload: BackupPayload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cards,
      images,
      sharedImages,
    };
    downloadJson(`thebindr-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
    setNotice("Backup exported.");
  }

  async function handleImport(file: File | null) {
    if (!file) return;
    setError("");
    setNotice("");
    setImporting(true);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<BackupPayload>;

      if (!parsed || !Array.isArray(parsed.cards)) {
        throw new Error("Invalid backup file. Missing cards array.");
      }

      const cards = parsed.cards as SportsCard[];
      const images = (parsed.images ?? {}) as Record<string, string>;
      const sharedImages = (parsed.sharedImages ?? {}) as Record<string, unknown>;

      saveCards(cards);
      const imagesOk = replaceImageMap(images);
      const sharedOk = replaceSharedImages(sharedImages as any);

      const imageMsg = imagesOk ? "" : " Some images were skipped due to storage limits.";
      const sharedMsg = sharedOk ? "" : " Shared images could not be restored.";

      setNotice(`Backup imported: ${cards.length} cards.${imageMsg}${sharedMsg}`.trim());
    } catch (err) {
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
          Export a full backup (cards + images + shared images) and restore it on another device.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-300 bg-white p-4 shadow-sm">
        <div className="text-sm text-zinc-900">
          Current data:{" "}
          <span className="font-medium text-zinc-900">{summary.cards}</span> cards,{" "}
          <span className="font-medium text-zinc-900">{summary.images}</span> images,{" "}
          <span className="font-medium text-zinc-900">{summary.sharedImages}</span> shared images.
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
          Import replaces your current local data on this device.
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

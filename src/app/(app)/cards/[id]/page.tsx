"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SportsCard, CardComp } from "@/lib/types";
import { loadCards, deleteCard, upsertCard, newId } from "@/lib/storage";
import { formatCurrency } from "@/lib/format";
import { buildCardFingerprint } from "@/lib/fingerprint";
import { getSharedImage, saveSharedImage } from "@/lib/sharedImages";
import { IMAGE_RULES, cropImageDataUrl, processImageFile, rotateImageDataUrl } from "@/lib/image";
import { REPORT_HIDE_THRESHOLD, REPORT_REASONS } from "@/lib/reporting";
import { loadImageForCard, removeImageForCard } from "@/lib/imageStore";

function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function parseLocalDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysSince(dateStr?: string): number | null {
  if (!dateStr) return null;
  const d = parseLocalDate(dateStr);
  if (!d) return null;
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.round(ms / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

function safeLabel(key: string) {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusLabel(s: string) {
  return s
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function buildEbaySoldUrl(card: SportsCard) {
  const parts = [
    card.year,
    card.setName,
    card.playerName,
    card.cardNumber ? `#${card.cardNumber}` : "",
    (card as any).variation ?? "",
    (card as any).insert ?? "",
    (card as any).parallel ?? "",
  ]
    .map((p) => String(p || "").trim())
    .filter(Boolean);
  const query = encodeURIComponent(parts.join(" "));
  return `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1`;
}

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [card, setCard] = useState<SportsCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCompForm, setShowCompForm] = useState(false);
  const [compPrice, setCompPrice] = useState("");
  const [compDate, setCompDate] = useState("");
  const [compUrl, setCompUrl] = useState("");
  const [compNotes, setCompNotes] = useState("");
  const [pendingImageUrl, setPendingImageUrl] = useState<string | null>(null);
  const [imageIsFront, setImageIsFront] = useState(true);
  const [imageIsSlabbed, setImageIsSlabbed] = useState(false);
  const [imageOwnerConfirm, setImageOwnerConfirm] = useState(false);
  const [imageShare, setImageShare] = useState(false);
  const [imageType, setImageType] = useState<
    "front" | "back" | "slab_front" | "slab_back"
  >("front");
  const [imageError, setImageError] = useState<string>("");
  const [imageCheckStatus, setImageCheckStatus] = useState<
    "idle" | "checking" | "accept" | "review" | "block"
  >("idle");
  const [cardPhotoConfirm, setCardPhotoConfirm] = useState(false);
  const [reportInfo, setReportInfo] = useState<{ reports: number; status?: string } | null>(
    null
  );
  const [cropData, setCropData] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [cropSource, setCropSource] = useState<{
    dataUrl: string;
    width: number;
    height: number;
  } | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotationBase, setCropRotationBase] = useState(0);
  const [cropRotationFine, setCropRotationFine] = useState(0);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const cropDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  const CROP_FRAME_W = 320;
  const CROP_FRAME_H = 448;
  const CROP_FRAME_PAD = 8;
  const CROP_BOX_W = CROP_FRAME_W - CROP_FRAME_PAD * 2;
  const CROP_BOX_H = CROP_FRAME_H - CROP_FRAME_PAD * 2;
  const CROP_ZOOM_MIN = 1;
  const CROP_ZOOM_MAX = 1.5;
  const CROP_ROTATION_FINE_MIN = -10;
  const CROP_ROTATION_FINE_MAX = 10;
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportReason, setReportReason] = useState<string>(REPORT_REASONS[0]);
  const [reportStatusMsg, setReportStatusMsg] = useState<string>("");

  useEffect(() => {
    const cards = loadCards();
    const found = cards.find((c: any) => String(c?.id) === String(id));
    setCard((found as SportsCard) ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    if (!card) return;
    setImageIsFront((card as any).imageIsFront ?? true);
    setImageIsSlabbed((card as any).imageIsSlabbed ?? false);
    setImageShare(!!(card as any).imageShared);
    setImageType((card as any).imageType ?? "front");
  }, [card]);

  const fingerprint = useMemo(() => {
    if (!card) return "";
    return buildCardFingerprint({
      year: card.year,
      setName: card.setName,
      cardNumber: card.cardNumber,
      playerName: card.playerName,
      team: card.team,
      insert: (card as any).insert ?? "",
      variation: (card as any).variation ?? "",
      parallel: (card as any).parallel ?? "",
    });
  }, [card]);

  const sharedImage = useMemo(
    () => (fingerprint ? getSharedImage(fingerprint) : null),
    [fingerprint]
  );

  useEffect(() => {
    if (!fingerprint) {
      setReportInfo(null);
      return;
    }
    fetch("/api/image-reports/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fingerprints: [fingerprint] }),
    })
      .then((r) => r.json())
      .then((data) => {
        const item = data?.[fingerprint];
        if (item) setReportInfo({ reports: item.reports ?? 0, status: item.status });
        else setReportInfo(null);
      })
      .catch(() => setReportInfo(null));
  }, [fingerprint]);

  const hideImage =
    !!reportInfo &&
    (reportInfo.status === "blocked" || reportInfo.reports >= REPORT_HIDE_THRESHOLD);

  const storedImage = card ? loadImageForCard(card.id) : null;
  const displayImage = hideImage
    ? ""
    : pendingImageUrl ?? storedImage ?? (card as any)?.imageUrl ?? sharedImage?.dataUrl ?? "";

  function clampCropOffset(
    next: { x: number; y: number },
    data: { width: number; height: number }
  ) {
    const baseScale = Math.max(CROP_BOX_W / data.width, CROP_BOX_H / data.height);
    const scale = baseScale * cropZoom;
    const scaledW = data.width * scale;
    const scaledH = data.height * scale;
    const maxX = Math.max(0, (scaledW - CROP_BOX_W) / 2);
    const maxY = Math.max(0, (scaledH - CROP_BOX_H) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  }

  useEffect(() => {
    if (!cropData) return;
    setCropOffset((prev) => clampCropOffset(prev, cropData));
  }, [cropZoom, cropData]);

  async function runImageCheck(dataUrl: string) {
    const res = await fetch("/api/image-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageDataUrl: dataUrl }),
    });
    const data = await res.json();
    if (!res.ok || data?.message) {
      setImageCheckStatus("review");
      return;
    }
    if (data.decision === "block") {
      setImageCheckStatus("block");
      setPendingImageUrl(null);
      setImageError(
        "This doesn’t look like a card photo. Please upload a picture of the card."
      );
      return;
    }
    setImageCheckStatus(data.decision === "review" ? "review" : "accept");
  }

  async function confirmCrop() {
    if (!cropData) return;
    const baseScale = Math.max(CROP_BOX_W / cropData.width, CROP_BOX_H / cropData.height);
    const scale = baseScale * cropZoom;
    const rawCropW = CROP_BOX_W / scale;
    const rawCropH = CROP_BOX_H / scale;
    const cropW = Math.min(cropData.width, rawCropW);
    const cropH = Math.min(cropData.height, rawCropH);
    const x = cropData.width / 2 + ((-CROP_BOX_W / 2 - cropOffset.x) / scale);
    const y = cropData.height / 2 + ((-CROP_BOX_H / 2 - cropOffset.y) / scale);
    const cropped = await cropImageDataUrl(cropData.dataUrl, {
      x: Math.max(0, Math.min(cropData.width - cropW, x)),
      y: Math.max(0, Math.min(cropData.height - cropH, y)),
      width: cropW,
      height: cropH,
    }, "image/webp", 0.92, { width: CROP_BOX_W, height: CROP_BOX_H });
    setPendingImageUrl(cropped);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
    setShowCrop(false);
    setCropData(null);
    setImageCheckStatus("checking");
    await runImageCheck(cropped);
  }

  async function applyCropRotation(nextBase: number, nextFine: number) {
    if (!cropSource) return;
    try {
      const totalRotation = nextBase + nextFine;
      const rotated = await rotateImageDataUrl(cropSource.dataUrl, totalRotation);
      const img = new Image();
      img.onload = () => {
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        setCropData({ dataUrl: rotated, width, height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(nextBase);
        setCropRotationFine(nextFine);
      };
      img.onerror = () => {
        setImageError("Failed to rotate image.");
      };
      img.src = rotated;
    } catch {
      setImageError("Failed to rotate image.");
    }
  }

  function handleImageFile(file: File | null) {
    if (!file) return;
    setImageError("");
    setImageCheckStatus("checking");
    processImageFile(file)
      .then(async (result) => {
        setCropSource({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropData({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropOffset({ x: 0, y: 0 });
        setCropZoom(1);
        setCropRotationBase(0);
        setCropRotationFine(0);
        setShowCrop(true);
      })
      .catch((err: Error) => {
        setImageCheckStatus("idle");
        setImageError(err.message || "Image failed validation.");
      });
  }

  function handleSaveImage() {
    if (!card) return;
    if ((pendingImageUrl || (card as any).imageUrl) && !cardPhotoConfirm) {
      setImageError("Please confirm this is a photo of the card (or slab).");
      return;
    }
    const nextUrl = pendingImageUrl ?? (card as any).imageUrl ?? undefined;
    const next: SportsCard = {
      ...card,
      imageUrl: nextUrl,
      imageIsFront,
      imageIsSlabbed,
      imageType,
      imageShared: imageShare && imageOwnerConfirm ? true : undefined,
      updatedAt: new Date().toISOString(),
    };
    upsertCard(next);
    setCard(next);
    if (imageShare && imageOwnerConfirm && nextUrl && fingerprint) {
      saveSharedImage({
        fingerprint,
        dataUrl: nextUrl,
        isFront: imageIsFront,
        isSlabbed: imageIsSlabbed,
        createdAt: new Date().toISOString(),
      });
    }
    setPendingImageUrl(null);
  }

  function handleRemoveImage() {
    if (!card) return;
    const next: SportsCard = {
      ...card,
      imageUrl: undefined,
      imageShared: undefined,
      updatedAt: new Date().toISOString(),
    };
    upsertCard(next);
    removeImageForCard(card.id);
    setCard(next);
    setPendingImageUrl(null);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setImageCheckStatus("idle");
    setCardPhotoConfirm(false);
    setReportStatusMsg("");
  }

  async function handleReportImage() {
    if (!fingerprint || !displayImage) return;
    setReportStatusMsg("");
    const res = await fetch("/api/image-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fingerprint,
        imageUrl: displayImage,
        reason: reportReason,
      }),
    });
    const data = await res.json();
    if (!res.ok || data?.message) {
      setReportStatusMsg("Report failed. Please try again.");
      return;
    }
    setReportInfo({ reports: data.reports ?? 0, status: data.status ?? "active" });
    setReportStatusMsg("Report submitted. Thank you.");
    setShowReportForm(false);
  }

  const computed = useMemo(() => {
    if (!card) return null;

    const status = card.status ?? "HAVE";
    const paid = asNumber(card.purchasePrice) ?? 0;
    const asking = asNumber((card as any).askingPrice);
    const sold = asNumber((card as any).soldPrice);

    const held = status === "WANT" || status === "SOLD" ? null : daysSince(card.purchaseDate);
    const net = typeof sold === "number" ? sold - paid : null;

    const serial =
      typeof (card as any).serialNumber === "number" &&
      typeof (card as any).serialTotal === "number"
        ? `${(card as any).serialNumber}/${(card as any).serialTotal}`
        : typeof (card as any).serialTotal === "number"
        ? `/${(card as any).serialTotal}`
        : "";

    return { status, paid, asking, sold, held, net, serial };
  }, [card]);

  function handleDelete() {
    if (!card) return;

    const ok = window.confirm(
      `Delete this card?\n\n${card.playerName} • ${card.year} • ${card.setName}${
        card.cardNumber ? ` #${card.cardNumber}` : ""
      }`
    );
    if (!ok) return;

    deleteCard(card.id);
    router.push("/cards");
  }

  function handleAddComp() {
    if (!card) return;
    const price = Number(compPrice);
    if (!Number.isFinite(price)) return;

    const nextComp: CardComp = {
      id: newId(),
      price,
      date: compDate || undefined,
      url: compUrl.trim() || undefined,
      notes: compNotes.trim() || undefined,
      source: compUrl.trim() ? "eBay" : "Manual",
    };

    const nextComps = [nextComp, ...((card as any).comps ?? [])];
    const now = new Date().toISOString();
    const next: SportsCard = { ...card, comps: nextComps, updatedAt: now };
    upsertCard(next);
    setCard(next);
    setCompPrice("");
    setCompDate("");
    setCompUrl("");
    setCompNotes("");
    setShowCompForm(false);
  }

  if (loading) return <div className="p-4">Loading...</div>;

  if (!card || !computed) {
    return (
      <div className="p-4 space-y-4">
        <h1 className="text-xl font-bold">Card not found</h1>
        <div className="text-xs text-gray-500">
          ID in URL: <span className="font-mono">{String(id)}</span>
        </div>
        <Link href="/cards" className="text-zinc-300 underline">
          Back to Binder
        </Link>
      </div>
    );
  }

  const location = (card as any).location as string | undefined;
  const comps = ((card as any).comps as CardComp[] | undefined) ?? [];

  const primaryRows: Array<{ label: string; value: any; format?: "currency" | "text" }> = [
    { label: "Player", value: card.playerName, format: "text" },
    { label: "Year", value: card.year, format: "text" },
    { label: "Set", value: card.setName, format: "text" },
    { label: "Card #", value: card.cardNumber ?? "", format: "text" },
    { label: "Team", value: card.team ?? "", format: "text" },

    { label: "Location", value: location ?? "", format: "text" },

    { label: "Variation", value: (card as any).variation ?? "", format: "text" },
    { label: "Insert", value: (card as any).insert ?? "", format: "text" },
    { label: "Parallel", value: (card as any).parallel ?? "", format: "text" },
    { label: "Serial", value: computed.serial, format: "text" },

    { label: "Condition", value: card.condition ?? "", format: "text" },
    { label: "Grader", value: (card as any).grader ?? "", format: "text" },
    { label: "Grade", value: (card as any).grade ?? "", format: "text" },

    { label: "Status", value: statusLabel(computed.status), format: "text" },
    { label: "Purchase date", value: card.purchaseDate ?? "", format: "text" },

    { label: "Paid", value: card.purchasePrice, format: "currency" },
    { label: "Asking", value: (card as any).askingPrice, format: "currency" },
    { label: "Sold", value: (card as any).soldPrice, format: "currency" },
  ];

  const primaryKeys = new Set(
    [
      "id",
      "playerName",
      "year",
      "setName",
      "cardNumber",
      "team",
      "location",
      "variation",
      "insert",
      "parallel",
      "serialNumber",
      "serialTotal",
      "condition",
      "grader",
      "grade",
      "status",
      "purchaseDate",
      "purchasePrice",
      "askingPrice",
      "soldPrice",
      "soldDate",
      "soldFees",
      "soldNotes",
      "notes",
      "comps",
      "imageUrl",
      "imageShared",
      "imageIsFront",
      "imageIsSlabbed",
      "imageType",
      "isRookie",
      "isAutograph",
      "isPatch",
      "createdAt",
      "updatedAt",
    ].map(String)
  );

  const extraEntries = Object.entries(card || {})
    .filter(([k, v]) => !primaryKeys.has(k) && v !== undefined && v !== null && String(v).trim() !== "")
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="p-4 space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight">
            {card.playerName}
            {card.cardNumber ? (
              <span className="ml-2 text-sm text-zinc-500">#{card.cardNumber}</span>
            ) : null}
          </h1>

          <div className="text-gray-600">
            {card.year ? `${card.year} ` : ""}
            {card.setName}
          </div>

          {location ? <div className="mt-1 text-sm text-zinc-500">{location}</div> : null}

          <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
            {(card as any).variation ? <MiniBadge>{(card as any).variation}</MiniBadge> : null}
            {(card as any).insert ? <MiniBadge>{(card as any).insert}</MiniBadge> : null}
            {(card as any).parallel ? <MiniBadge>{(card as any).parallel}</MiniBadge> : null}
            {computed.serial ? <MiniBadge>#{computed.serial}</MiniBadge> : null}
            {(card as any).isRookie ? <MiniBadge tone="blue">Rookie</MiniBadge> : null}
            {(card as any).isAutograph ? <MiniBadge tone="purple">Auto</MiniBadge> : null}
            {(card as any).isPatch ? <MiniBadge tone="amber">Patch</MiniBadge> : null}
          </div>

          {card.team ? <div className="mt-1 text-sm text-zinc-500">{card.team}</div> : null}
        </div>

        {/* ✅ Horizontal actions (no URL style, no Sold History button, Delete stays) */}
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <Link
            href="/cards"
            className="rounded-md border bg-white px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Back
          </Link>

          <button
            type="button"
            onClick={() => router.push(`/cards/${String(id)}/edit`)}
            className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
          >
            Edit
          </button>

          {computed.status !== "SOLD" ? (
            <button
              type="button"
              onClick={() => router.push(`/cards/${String(id)}/sold`)}
              className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
            >
              Mark as Sold
            </button>
          ) : null}

          <button
            type="button"
            onClick={handleDelete}
            className="rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="font-semibold">Card image</div>
        <div className="mt-3 grid gap-4 sm:grid-cols-[180px_1fr]">
          <div className="relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden">
            {displayImage ? (
              <img
                src={displayImage}
                alt={`${card.playerName} ${card.cardNumber ?? ""}`.trim()}
                className="h-full w-full object-contain"
              />
            ) : hideImage ? (
              <div className="text-xs text-zinc-500 text-center px-2">
                Image hidden (reported)
              </div>
            ) : (
              <div className="text-xs text-zinc-500 text-center px-2">No image</div>
            )}
            <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300/70" />
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <label className="rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
                Upload card photo (front/back)
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleImageFile(e.target.files?.[0] ?? null)}
                />
              </label>

              {sharedImage?.dataUrl && !(card as any).imageUrl ? (
                <button
                  type="button"
                  onClick={() => {
                    setPendingImageUrl(sharedImage.dataUrl);
                    setImageOwnerConfirm(false);
                    setImageShare(false);
                  }}
                  className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                >
                  Use community image
                </button>
              ) : null}

              {(pendingImageUrl || (card as any).imageUrl) ? (
                <button
                  type="button"
                  onClick={handleRemoveImage}
                  className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                >
                  Remove image
                </button>
              ) : null}
            </div>

            <div className="grid gap-2 text-xs text-zinc-600 sm:grid-cols-2">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="imageType"
                  value="front"
                  checked={imageType === "front"}
                  onChange={() => {
                    setImageType("front");
                    setImageIsFront(true);
                    setImageIsSlabbed(false);
                  }}
                />
                Front of card
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="imageType"
                  value="back"
                  checked={imageType === "back"}
                  onChange={() => {
                    setImageType("back");
                    setImageIsFront(false);
                    setImageIsSlabbed(false);
                  }}
                />
                Back of card
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="imageType"
                  value="slab_front"
                  checked={imageType === "slab_front"}
                  onChange={() => {
                    setImageType("slab_front");
                    setImageIsFront(true);
                    setImageIsSlabbed(true);
                  }}
                />
                Slab front
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="imageType"
                  value="slab_back"
                  checked={imageType === "slab_back"}
                  onChange={() => {
                    setImageType("slab_back");
                    setImageIsFront(false);
                    setImageIsSlabbed(true);
                  }}
                />
                Slab back
              </label>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={cardPhotoConfirm}
                onChange={(e) => setCardPhotoConfirm(e.target.checked)}
              />
              I confirm this is a photo of the card (or slab).
            </label>

            <div className="rounded-md border bg-zinc-50 p-2 text-xs text-zinc-600">
              <div className="font-medium text-zinc-800">Community reference (optional)</div>
              <div>This helps other collectors identify the exact card.</div>
              <div className="mt-2 flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={imageOwnerConfirm}
                    onChange={(e) => setImageOwnerConfirm(e.target.checked)}
                  />
                  I own this photo
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!imageOwnerConfirm || !(pendingImageUrl || (card as any).imageUrl)}
                    checked={imageShare}
                    onChange={(e) => setImageShare(e.target.checked)}
                  />
                  Allow as community reference
                </label>
              </div>
            </div>

            {imageError ? (
              <div className="text-xs text-red-600">{imageError}</div>
            ) : null}

            {imageCheckStatus === "checking" ? (
              <div className="text-xs text-zinc-500">Checking image…</div>
            ) : null}
            {imageCheckStatus === "review" ? (
              <div className="text-xs text-amber-600">
                Image needs review. Please confirm this is a card photo.
              </div>
            ) : null}
            {imageCheckStatus === "accept" ? (
              <div className="text-xs text-emerald-600">Image looks like a card.</div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSaveImage}
                className="rounded-md bg-[#2b323a] px-3 py-2 text-xs font-medium text-white hover:bg-[#242a32]"
              >
                Save image
              </button>
              {displayImage ? (
                <button
                  type="button"
                  onClick={() => setShowReportForm((v) => !v)}
                  className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                >
                  Report image
                </button>
              ) : null}
              <div className="text-xs text-zinc-500 self-center">
                {pendingImageUrl
                  ? "Previewing new image."
                  : (card as any).imageUrl
                  ? "Using your image."
                  : sharedImage?.dataUrl
                  ? "Community image (example)."
                  : "No image yet."}
              </div>
            </div>
            {showReportForm ? (
              <div className="rounded-md border bg-white p-2 text-xs text-zinc-600 space-y-2">
                <div className="font-medium">Report image</div>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full rounded-md border bg-white px-2 py-1 text-xs"
                >
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleReportImage}
                    className="rounded-md bg-[#2b323a] px-3 py-2 text-xs font-medium text-white hover:bg-[#242a32]"
                  >
                    Submit report
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowReportForm(false)}
                    className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {reportStatusMsg ? (
              <div className="text-xs text-zinc-500">{reportStatusMsg}</div>
            ) : null}
            <div className="text-xs text-zinc-500">
              Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB •
              Min {IMAGE_RULES.minWidth}×{IMAGE_RULES.minHeight}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4 space-y-2 bg-white">
        <div className="font-semibold">Card summary</div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <span className="text-gray-600">Paid:</span>{" "}
            <span className="font-semibold">{formatCurrency(computed.paid)}</span>
          </div>

          {typeof computed.asking === "number" ? (
            <div>
              <span className="text-gray-600">Asking:</span>{" "}
              <span className="font-semibold">{formatCurrency(computed.asking)}</span>
            </div>
          ) : null}

          {computed.status === "SOLD" && typeof computed.sold === "number" ? (
            <div>
              <span className="text-gray-600">Sold for:</span>{" "}
              <span className="font-semibold">{formatCurrency(computed.sold)}</span>
            </div>
          ) : null}

          {computed.status === "SOLD" && typeof computed.net === "number" ? (
            <div>
              <span className="text-gray-600">Net (sold - paid):</span>{" "}
              <span className="font-semibold">
                {formatCurrency(computed.net, { accounting: true })}
              </span>
            </div>
          ) : null}

          {computed.held !== null ? (
            <div>
              <span className="text-gray-600">Held:</span>{" "}
              <span className="font-semibold">{computed.held} days</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b px-4 py-3 font-semibold">Details</div>
        <div className="p-4 grid gap-3">
          {primaryRows
            .filter((r) => r.value !== undefined && r.value !== null && String(r.value).trim() !== "")
            .map((row) => {
              const display =
                row.format === "currency"
                  ? typeof row.value === "number"
                    ? formatCurrency(row.value)
                    : String(row.value ?? "")
                  : String(row.value);

              return (
                <div key={row.label} className="flex items-start justify-between gap-4">
                  <div className="text-gray-600">{row.label}</div>
                  <div className="text-right font-medium">{display}</div>
                </div>
              );
            })}
        </div>
      </div>

      {card.notes ? (
        <div className="rounded-xl border bg-white p-4">
          <div className="font-semibold mb-2">Notes</div>
          <div className="text-gray-700 whitespace-pre-wrap">{card.notes}</div>
        </div>
      ) : null}

      <div className="rounded-xl border bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <div className="font-semibold">Comps</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.open(buildEbaySoldUrl(card), "_blank", "noopener,noreferrer")}
              className="rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Search eBay sold
            </button>
            <button
              type="button"
              onClick={() => setShowCompForm((v) => !v)}
              className="rounded-md bg-[#2b323a] px-3 py-2 text-xs font-medium text-white hover:bg-[#242a32]"
            >
              {showCompForm ? "Cancel" : "Add comp"}
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {showCompForm ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-zinc-600">
                Sold price *
                <input
                  value={compPrice}
                  onChange={(e) => setCompPrice(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="e.g. 120"
                />
              </label>
              <label className="text-sm text-zinc-600">
                Sold date
                <input
                  type="date"
                  value={compDate}
                  onChange={(e) => setCompDate(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                />
              </label>
              <label className="text-sm text-zinc-600 sm:col-span-2">
                Link (optional)
                <input
                  value={compUrl}
                  onChange={(e) => setCompUrl(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="Paste eBay sold listing URL"
                />
              </label>
              <label className="text-sm text-zinc-600 sm:col-span-2">
                Notes (optional)
                <input
                  value={compNotes}
                  onChange={(e) => setCompNotes(e.target.value)}
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm text-zinc-900"
                  placeholder="Condition, grading, etc."
                />
              </label>
              <div className="sm:col-span-2">
                <button
                  type="button"
                  onClick={handleAddComp}
                  disabled={!Number.isFinite(Number(compPrice))}
                  className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32] disabled:opacity-50"
                >
                  Save comp
                </button>
              </div>
            </div>
          ) : null}

          {comps.length === 0 ? (
            <div className="text-sm text-zinc-500">No comps yet.</div>
          ) : (
            <div className="space-y-2 text-sm">
              {comps.map((comp) => (
                <div
                  key={comp.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <div className="font-medium">{formatCurrency(comp.price)}</div>
                  <div className="text-zinc-600">{comp.date || "—"}</div>
                  {comp.url ? (
                    <a
                      href={comp.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs text-zinc-300 underline"
                    >
                      Link
                    </a>
                  ) : (
                    <span className="text-xs text-zinc-400">No link</span>
                  )}
                  {comp.notes ? <div className="text-xs text-zinc-500">{comp.notes}</div> : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {extraEntries.length > 0 ? (
        <div className="rounded-xl border bg-white">
          <div className="border-b px-4 py-3 font-semibold">More details</div>
          <div className="p-4 grid gap-3">
            {extraEntries.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4">
                <div className="text-gray-600">{safeLabel(k)}</div>
                <div className="text-right font-medium">{String(v)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {showCrop && cropData ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setShowCrop(false);
            setCropData(null);
            setImageCheckStatus("idle");
          }}
        >
          <div
            className="w-full max-w-xl rounded-2xl border bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-lg font-semibold">Crop your card photo</div>
            <div className="mt-1 text-xs text-zinc-500">
              The image starts fill-to-frame to match your binder preview. Drag to crop or zoom in.
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[320px_1fr]">
              <div
                className="relative h-[448px] w-[320px] rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-2"
                onPointerDown={(e) => {
                  if (!cropData) return;
                  const target = e.target as HTMLElement;
                  if (!target.closest("[data-crop-viewport]")) return;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  cropDragRef.current = {
                    x: e.clientX,
                    y: e.clientY,
                    ox: cropOffset.x,
                    oy: cropOffset.y,
                  };
                }}
                onPointerMove={(e) => {
                  if (!cropData || !cropDragRef.current) return;
                  const dx = e.clientX - cropDragRef.current.x;
                  const dy = e.clientY - cropDragRef.current.y;
                  const next = clampCropOffset(
                    { x: cropDragRef.current.ox + dx, y: cropDragRef.current.oy + dy },
                    cropData
                  );
                  setCropOffset(next);
                }}
                onPointerUp={(e) => {
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  cropDragRef.current = null;
                }}
                onPointerCancel={(e) => {
                  (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
                  cropDragRef.current = null;
                }}
              >
                <div
                  data-crop-viewport
                  className="relative h-[432px] w-[304px] overflow-hidden rounded-md border border-zinc-200 bg-white/70"
                >
                  <img
                    src={cropData.dataUrl}
                    alt="Crop preview"
                    draggable={false}
                    className="absolute left-1/2 top-1/2 select-none max-w-none max-h-none"
                    style={{
                      width: cropData.width,
                      height: cropData.height,
                      transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) translate(-50%, -50%) scale(${
                        Math.max(CROP_BOX_W / cropData.width, CROP_BOX_H / cropData.height) * cropZoom
                      })`,
                    }}
                  />
                  <div className="pointer-events-none absolute inset-1 rounded-sm border border-white/40" />
                </div>
              </div>

              <div className="text-xs text-zinc-500">
                <div className="mb-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextBase = cropRotationBase - 90;
                      applyCropRotation(nextBase, cropRotationFine);
                    }}
                    className="rounded-md border bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                  >
                    Rotate Left
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextBase = cropRotationBase + 90;
                      applyCropRotation(nextBase, cropRotationFine);
                    }}
                    className="rounded-md border bg-white px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-50"
                  >
                    Rotate Right
                  </button>
                </div>
                <label className="mb-2 block text-zinc-600">Rotation</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={CROP_ROTATION_FINE_MIN}
                    max={CROP_ROTATION_FINE_MAX}
                    step={1}
                    value={cropRotationFine}
                    onChange={(e) => {
                      const nextFine = Number(e.target.value);
                      applyCropRotation(cropRotationBase, nextFine);
                    }}
                    className="w-full"
                  />
                  <span className="w-12 text-right">
                    {cropRotationBase + cropRotationFine}°
                  </span>
                </div>
                <label className="mb-2 mt-4 block text-zinc-600">Zoom</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={CROP_ZOOM_MIN}
                    max={CROP_ZOOM_MAX}
                    step={0.05}
                    value={cropZoom}
                    onChange={(e) => setCropZoom(Number(e.target.value))}
                    className="w-full"
                  />
                  <span className="w-10 text-right">{Math.round(cropZoom * 100)}%</span>
                </div>
                <div className="mt-3">Tip: drag the image to align it in the frame.</div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCrop(false);
                  setCropData(null);
                  setCropSource(null);
                  setImageCheckStatus("idle");
                }}
                className="rounded-md border bg-white px-3 py-2 text-sm hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  confirmCrop().catch((err: Error) => {
                    setImageCheckStatus("idle");
                    setImageError(err.message || "Image failed validation.");
                  });
                }}
                className="rounded-md bg-[#2b323a] px-3 py-2 text-sm font-medium text-white hover:bg-[#242a32]"
              >
                Use Crop
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="text-xs text-gray-500">
        ID in URL: <span className="font-mono">{String(id)}</span> • Stored card id:{" "}
        <span className="font-mono">{String(card.id)}</span>
      </div>
    </div>
  );
}

function MiniBadge({
  children,
  tone = "zinc",
}: {
  children: React.ReactNode;
  tone?: "zinc" | "blue" | "purple" | "amber";
}) {
  const cls =
    tone === "blue"
      ? "border-zinc-300 bg-zinc-100 text-zinc-200"
      : tone === "purple"
      ? "border-purple-200 bg-purple-50 text-purple-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-zinc-200 bg-white text-zinc-700";

  return <span className={`rounded-full border px-2 py-0.5 font-medium ${cls}`}>{children}</span>;
}

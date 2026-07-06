"use client";

import { IMAGE_RULES } from "@/lib/image";
import { REPORT_HIDE_THRESHOLD } from "@/lib/reporting";

export type CardImageUploaderProps = {
  imageUrl: string | null;
  setImageUrl: (v: string | null) => void;
  imageType: "front" | "back" | "slab_front" | "slab_back";
  setImageType: (v: "front" | "back" | "slab_front" | "slab_back") => void;
  setImageIsFront: (v: boolean) => void;
  setImageIsSlabbed: (v: boolean) => void;
  cardPhotoConfirm: boolean;
  setCardPhotoConfirm: (v: boolean) => void;
  imageOwnerConfirm: boolean;
  setImageOwnerConfirm: (v: boolean) => void;
  imageShare: boolean;
  setImageShare: (v: boolean) => void;
  imageError: string;
  imageCheckStatus: "idle" | "checking" | "accept" | "review" | "block";
  sharedImage: {
    fingerprint: string;
    dataUrl: string;
    isFront: boolean;
    isSlabbed: boolean;
    createdAt: string;
  } | null;
  reportInfo: { reports: number; status?: string } | null;
  fingerprint: string;
  onFileSelected: (file: File | null) => void;
};

export function CardImageUploader({
  imageUrl,
  setImageUrl,
  imageType,
  setImageType,
  setImageIsFront,
  setImageIsSlabbed,
  cardPhotoConfirm,
  setCardPhotoConfirm,
  imageOwnerConfirm,
  setImageOwnerConfirm,
  imageShare,
  setImageShare,
  imageError,
  imageCheckStatus,
  sharedImage,
  reportInfo,
  fingerprint,
  onFileSelected,
}: CardImageUploaderProps) {
  return (
    <div className="sm:col-span-2">
      <div className="text-sm font-medium text-zinc-900">Card image</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-[140px_1fr]">
        <div className="relative aspect-[2.5/3.5] rounded-md border bg-zinc-50 p-1 flex items-center justify-center overflow-hidden">
          {(() => {
            const hideCommunity =
              reportInfo &&
              (reportInfo.status === "blocked" ||
                reportInfo.reports >= REPORT_HIDE_THRESHOLD);
            const display = imageUrl || (!hideCommunity ? sharedImage?.dataUrl : "");
            if (display) {
              return (
                <img
                  src={display}
                  alt="Card"
                  className="h-full w-full object-contain"
                />
              );
            }
            if (hideCommunity) {
              return (
                <div className="text-[11px] text-zinc-500 text-center px-2">
                  Image hidden (reported)
                </div>
              );
            }
            return <div className="text-[11px] text-zinc-500 text-center px-2">No image</div>;
          })()}
          <div className="pointer-events-none absolute inset-2 rounded-sm border border-dashed border-zinc-300/70" />
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <label className="rounded-md border bg-white px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-50 cursor-pointer">
              Upload card photo (front/back)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
            </label>

            {sharedImage?.dataUrl &&
            !imageUrl &&
            !(
              reportInfo &&
              (reportInfo.status === "blocked" ||
                reportInfo.reports >= REPORT_HIDE_THRESHOLD)
            ) ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(sharedImage.dataUrl);
                  setImageOwnerConfirm(false);
                  setImageShare(false);
                }}
                className="rounded-md border bg-white px-3 py-2 text-xs font-medium hover:bg-zinc-50"
              >
                Use community image
              </button>
            ) : null}

            {imageUrl ? (
              <button
                type="button"
                onClick={() => {
                  setImageUrl(null);
                  setImageOwnerConfirm(false);
                  setImageShare(false);
                }}
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
            <div>
              Share a photo you took so others can see an example image for this exact card.
            </div>
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
                  disabled={!imageOwnerConfirm || !imageUrl}
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

          {fingerprint ? (
            <div className="mt-2 rounded-md border bg-zinc-50 p-2 text-[10px] text-zinc-600">
              Fingerprint: <span className="break-all">{fingerprint}</span>
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 text-xs text-zinc-500">
        {imageUrl
          ? "Using your image."
          : sharedImage?.dataUrl
          ? "Community image (example)."
          : "No image yet."}
      </div>
      <div className="mt-1 text-xs text-zinc-500">
        Allowed: JPG/PNG/WebP/HEIC • Max {Math.round(IMAGE_RULES.maxBytes / 1024 / 1024)}MB •
        Min {IMAGE_RULES.minWidth}×{IMAGE_RULES.minHeight}
      </div>
    </div>
  );
}

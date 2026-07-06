"use client";

import type { MutableRefObject } from "react";

type CropData = { dataUrl: string; width: number; height: number };
type CropOffset = { x: number; y: number };
type ImageCheckStatus = "idle" | "checking" | "accept" | "review" | "block";

export type CardImageCropModalProps = {
  show: boolean;
  cropData: CropData | null;
  setCropData: (v: CropData | null) => void;
  setCropSource: (v: CropData | null) => void;
  setShowCrop: (v: boolean) => void;
  setImageCheckStatus: (v: ImageCheckStatus) => void;
  setImageError: (v: string) => void;
  cropOffset: CropOffset;
  setCropOffset: (v: CropOffset) => void;
  cropDragRef: MutableRefObject<{ x: number; y: number; ox: number; oy: number } | null>;
  clampCropOffset: (next: CropOffset, data: { width: number; height: number }) => CropOffset;
  cropZoom: number;
  setCropZoom: (v: number) => void;
  cropRotationBase: number;
  cropRotationFine: number;
  applyCropRotation: (nextBase: number, nextFine: number) => Promise<void>;
  confirmCrop: () => Promise<void>;
  cropBoxWidth: number;
  cropBoxHeight: number;
  cropZoomMin: number;
  cropZoomMax: number;
  cropRotationFineMin: number;
  cropRotationFineMax: number;
};

export function CardImageCropModal({
  show,
  cropData,
  setCropData,
  setCropSource,
  setShowCrop,
  setImageCheckStatus,
  setImageError,
  cropOffset,
  setCropOffset,
  cropDragRef,
  clampCropOffset,
  cropZoom,
  setCropZoom,
  cropRotationBase,
  cropRotationFine,
  applyCropRotation,
  confirmCrop,
  cropBoxWidth,
  cropBoxHeight,
  cropZoomMin,
  cropZoomMax,
  cropRotationFineMin,
  cropRotationFineMax,
}: CardImageCropModalProps) {
  if (!show || !cropData) return null;

  return (
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
                    Math.max(cropBoxWidth / cropData.width, cropBoxHeight / cropData.height) * cropZoom
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
                min={cropRotationFineMin}
                max={cropRotationFineMax}
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
                min={cropZoomMin}
                max={cropZoomMax}
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
            className="btn-secondary"
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
            className="btn-primary"
          >
            Use Crop
          </button>
        </div>
      </div>
    </div>
  );
}

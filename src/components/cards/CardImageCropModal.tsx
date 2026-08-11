"use client";

import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { computeCoverScale } from "@/lib/cropGeometry";

type CropData = { dataUrl: string; width: number; height: number };
type CropOffset = { x: number; y: number };
type ImageCheckStatus = "idle" | "checking" | "accept" | "review" | "block";

// Vision Engine V3 responsive fix (Phase 1B): the crop box's actual pixel
// dimensions are fixed constants shared with useCardImageSlot.ts's
// CROP_FRAME_W/CROP_FRAME_H -- every crop calculation (clampCropOffset,
// confirmCrop, and this component's own fill-to-frame scale for the <img>)
// is anchored to that fixed coordinate system, and none of it is touched by
// this fix. On a viewport too narrow to fit a 320px-wide box (see
// cropBoxWrapperRef's ResizeObserver below), the box is visually shrunk via
// a pure CSS `transform: scale()` applied to the whole subtree -- this
// scales everything inside it (including the <img>'s own pixel-based
// transform) uniformly, so the displayed crop box and the exported crop
// stay in perfect correspondence at any display size. The one thing a
// visual-only scale does NOT do automatically is pointer-drag distances
// (PointerEvent.clientX/Y are always real screen pixels, unaffected by an
// ancestor's CSS transform) -- see onPointerMove below, which divides the
// raw screen-pixel delta by the same scale factor before handing it to the
// existing, unmodified clampCropOffset.
const CROP_FRAME_DISPLAY_WIDTH = 320;

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
  applyCropRotation: (nextBase: number, nextFine: number) => void;
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
  // Measures the wrapper's actual rendered width (available layout space,
  // which shrinks below 320px only on the narrowest phone viewports -- see
  // CROP_FRAME_DISPLAY_WIDTH's comment above) and derives a display-only
  // scale factor, capped at 1 so desktop/tablet (where the grid column is
  // already exactly 320px wide) renders byte-identically to before this
  // fix. Declared before the `show`/`cropData` early return below since
  // hooks must run unconditionally; the effect itself is a no-op while the
  // wrapper isn't mounted (ref.current is null).
  const cropBoxWrapperRef = useRef<HTMLDivElement | null>(null);
  const [cropDisplayScale, setCropDisplayScale] = useState(1);

  useLayoutEffect(() => {
    const el = cropBoxWrapperRef.current;
    if (!el) return;

    const updateScale = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) {
        setCropDisplayScale(Math.min(1, width / CROP_FRAME_DISPLAY_WIDTH));
      }
    };

    updateScale();

    const observer = new ResizeObserver(updateScale);
    observer.observe(el);
    return () => observer.disconnect();
  }, [show]);

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
        className="w-full max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl border bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-lg font-semibold">Crop your card photo</div>
        <div className="mt-1 text-xs text-zinc-500">
          The image starts fill-to-frame to match your binder preview. Drag to crop or zoom in.
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-[320px_1fr]">
          {/* Reserves the correctly-scaled layout footprint (up to the
              canonical 320x448 size, never larger) so the grid/modal never
              has to accommodate a wider box than actually fits -- this is
              what actually fixes the overflow. The inner box below keeps
              its full 320x448 canonical size and is visually scaled down
              to exactly fill this wrapper. */}
          <div
            ref={cropBoxWrapperRef}
            className="relative w-full max-w-[320px] aspect-[320/448]"
          >
            <div
              className="absolute left-0 top-0 h-[448px] w-[320px] origin-top-left rounded-md border border-zinc-200 bg-gradient-to-br from-white via-zinc-50 to-zinc-100 p-2"
              style={{ transform: `scale(${cropDisplayScale})` }}
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
                // Raw PointerEvent coordinates are always real screen
                // pixels, unaffected by this element's own CSS transform --
                // divide by the same scale factor so a drag maps 1:1 to the
                // crop box's internal (unscaled) coordinate space at any
                // display size, exactly matching full-scale behavior.
                const dx = (e.clientX - cropDragRef.current.x) / cropDisplayScale;
                const dy = (e.clientY - cropDragRef.current.y) / cropDisplayScale;
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
                    transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) translate(-50%, -50%) rotate(${
                      cropRotationBase + cropRotationFine
                    }deg) scale(${
                      computeCoverScale(
                        cropRotationBase + cropRotationFine,
                        cropData.width,
                        cropData.height,
                        cropBoxWidth,
                        cropBoxHeight
                      ) * cropZoom
                    })`,
                  }}
                />
                <div className="pointer-events-none absolute inset-1 rounded-sm border border-white/40" />
              </div>
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

"use client";

import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import {
  computeCoverScale,
  clampOffsetForRotation,
  normalizeAngleDeg,
  computeAnchoredOffset,
} from "@/lib/cropGeometry";

type CropData = { dataUrl: string; width: number; height: number };
type CropOffset = { x: number; y: number };
type ImageCheckStatus = "idle" | "checking" | "accept" | "review" | "block";

// Phase 1D2 gesture tuning. Tap/double-tap thresholds are in raw screen
// pixels/ms (measured at the pointer, before any display-scale conversion)
// since they're about human tap timing/precision, not crop geometry.
const TAP_MAX_MOVEMENT_PX = 12;
const TAP_MAX_DURATION_MS = 350;
const DOUBLE_TAP_MAX_INTERVAL_MS = 350;
const DOUBLE_TAP_MAX_DISTANCE_PX = 40;

type PinchBaseline = {
  pointerIds: [number, number];
  dist: number;
  angle: number;
  zoom: number;
  rotation: number;
  offset: CropOffset;
  midpoint: CropOffset; // frame-space (same coordinate system as cropOffset)
  center: { x: number; y: number }; // viewport's screen-space center, cached for the gesture's duration
};

type TapCandidate = {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
};

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
  // Phase 1D2: measures the inner 304x432 viewport's live on-screen center,
  // used to convert a pinch midpoint from screen pixels into the same
  // frame-centered coordinate space cropOffset already lives in.
  const cropViewportRef = useRef<HTMLDivElement | null>(null);
  const [cropDisplayScale, setCropDisplayScale] = useState(1);

  // Phase 1D2 gesture state. These are plain refs (not React state) because
  // gesture math must read/write against the *current* frame's values
  // synchronously, not whatever committed on the last render -- exactly the
  // same reasoning Phase 1D1's applyCropRotation already relies on for
  // rotation. None of this needs to trigger a re-render itself; the
  // setCropOffset/setCropZoom/applyCropRotation calls it makes do that.
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<PinchBaseline | null>(null);
  const tapCandidateRef = useRef<TapCandidate | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);

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

  // Restores centered image, rotation 0deg, and the default minimum zoom
  // that fills the crop frame (zoom=1 is exactly that scale -- see
  // computeCoverScale). Used by double-tap.
  function resetCrop() {
    setCropOffset({ x: 0, y: 0 });
    applyCropRotation(0, 0);
    setCropZoom(1);
  }

  // Recomputes offset/rotation/zoom from the active pinch gesture's fixed
  // baseline (captured once when the 2nd finger touched down) against the
  // two tracked pointers' current positions. Baseline-relative rather than
  // frame-to-frame incremental, so it can't accumulate drift over a long
  // gesture -- same approach as Phase 1D1's rotation-aware clamp math.
  function runPinchUpdate() {
    const baseline = pinchRef.current;
    if (!baseline || !cropData) return;
    const [id1, id2] = baseline.pointerIds;
    const pt1 = activePointersRef.current.get(id1);
    const pt2 = activePointersRef.current.get(id2);
    if (!pt1 || !pt2) return;

    const dist1 = Math.max(1, Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y));
    const angle1 = Math.atan2(pt2.y - pt1.y, pt2.x - pt1.x) * (180 / Math.PI);
    const midScreen = { x: (pt1.x + pt2.x) / 2, y: (pt1.y + pt2.y) / 2 };
    const p1Frame = {
      x: (midScreen.x - baseline.center.x) / cropDisplayScale,
      y: (midScreen.y - baseline.center.y) / cropDisplayScale,
    };

    const rotationDelta = normalizeAngleDeg(angle1 - baseline.angle);
    const newRotation = baseline.rotation + rotationDelta;
    const newZoom = Math.max(cropZoomMin, Math.min(cropZoomMax, baseline.zoom * (dist1 / baseline.dist)));

    const s0 =
      computeCoverScale(baseline.rotation, cropData.width, cropData.height, cropBoxWidth, cropBoxHeight) *
      baseline.zoom;
    const s1 =
      computeCoverScale(newRotation, cropData.width, cropData.height, cropBoxWidth, cropBoxHeight) * newZoom;

    const anchored = computeAnchoredOffset(baseline.midpoint, baseline.offset, p1Frame, rotationDelta, s1 / s0);
    const clamped = clampOffsetForRotation(
      anchored,
      cropData.width,
      cropData.height,
      cropBoxWidth,
      cropBoxHeight,
      newRotation,
      s1
    );

    setCropOffset(clamped);
    applyCropRotation(newRotation, 0);
    setCropZoom(newZoom);
  }

  function handleCropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!cropData) return;
    const target = e.target as HTMLElement;
    if (!target.closest("[data-crop-viewport]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      cropDragRef.current = { x: e.clientX, y: e.clientY, ox: cropOffset.x, oy: cropOffset.y };
      tapCandidateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startTime: Date.now(),
      };
    } else if (activePointersRef.current.size === 2) {
      // A 2nd finger joining always (re)starts the gesture baseline from
      // scratch -- simpler and safer than trying to carry over a 1-finger
      // drag baseline into a pinch/twist baseline.
      tapCandidateRef.current = null;
      cropDragRef.current = null;
      const rect = cropViewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const ids = Array.from(activePointersRef.current.keys());
      const p1 = activePointersRef.current.get(ids[0])!;
      const p2 = activePointersRef.current.get(ids[1])!;
      const dist = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
      const midScreen = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
      pinchRef.current = {
        pointerIds: [ids[0], ids[1]],
        dist,
        angle,
        zoom: cropZoom,
        rotation: cropRotationBase + cropRotationFine,
        offset: cropOffset,
        midpoint: {
          x: (midScreen.x - center.x) / cropDisplayScale,
          y: (midScreen.y - center.y) / cropDisplayScale,
        },
        center,
      };
    }
    // A 3rd+ simultaneous pointer is tracked (for bookkeeping on release)
    // but doesn't change gesture math -- only the original two fingers that
    // started the pinch drive it.
  }

  function handleCropPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!cropData || !activePointersRef.current.has(e.pointerId)) return;
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current) {
      runPinchUpdate();
      return;
    }
    if (cropDragRef.current && activePointersRef.current.size === 1) {
      // Raw PointerEvent coordinates are always real screen pixels,
      // unaffected by this element's own CSS transform -- divide by the
      // same scale factor so a drag maps 1:1 to the crop box's internal
      // (unscaled) coordinate space at any display size.
      const dx = (e.clientX - cropDragRef.current.x) / cropDisplayScale;
      const dy = (e.clientY - cropDragRef.current.y) / cropDisplayScale;
      const next = clampCropOffset(
        { x: cropDragRef.current.ox + dx, y: cropDragRef.current.oy + dy },
        cropData
      );
      setCropOffset(next);
    }
  }

  function handleCropPointerRelease(e: React.PointerEvent<HTMLDivElement>) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released (e.g. pointercancel) -- nothing to clean up here.
    }
    const wasPinching = pinchRef.current?.pointerIds.includes(e.pointerId);
    activePointersRef.current.delete(e.pointerId);

    if (wasPinching) {
      // 2 -> 1 finger: end the interaction cleanly rather than re-basing a
      // new pan from whichever finger remains. The user can just start a
      // fresh drag with a new pointerdown.
      pinchRef.current = null;
      cropDragRef.current = null;
    }

    if (activePointersRef.current.size === 0) {
      cropDragRef.current = null;
      pinchRef.current = null;

      const candidate = tapCandidateRef.current;
      tapCandidateRef.current = null;
      if (candidate && candidate.pointerId === e.pointerId) {
        const movement = Math.hypot(e.clientX - candidate.startX, e.clientY - candidate.startY);
        const duration = Date.now() - candidate.startTime;
        if (movement < TAP_MAX_MOVEMENT_PX && duration < TAP_MAX_DURATION_MS) {
          const last = lastTapRef.current;
          const now = Date.now();
          if (
            last &&
            now - last.time < DOUBLE_TAP_MAX_INTERVAL_MS &&
            Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_MAX_DISTANCE_PX
          ) {
            resetCrop();
            lastTapRef.current = null;
          } else {
            lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
          }
        } else {
          lastTapRef.current = null;
        }
      }
    }
  }

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
              // touch-action is scoped to just this interactive surface (not
              // the modal or the page) so the browser never steals a pan/
              // pinch/twist gesture that starts here -- no scroll, no
              // pinch-to-page-zoom, no pull-to-refresh -- while everything
              // outside this element (including the modal's own scroll
              // area) keeps its normal default touch behavior.
              style={{ transform: `scale(${cropDisplayScale})`, touchAction: "none" }}
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerRelease}
              onPointerCancel={handleCropPointerRelease}
              onLostPointerCapture={handleCropPointerRelease}
            >
              <div
                ref={cropViewportRef}
                data-crop-viewport
                className="relative h-[432px] w-[304px] overflow-hidden rounded-md border border-zinc-200 bg-white/70"
              >
                {/* cropData.dataUrl is an in-memory base64 data URL being
                    live-transformed (pan/zoom/rotate) via inline style below;
                    next/image is intentionally not used here. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
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

          {/* Desktop-only fallback controls (Phase 1D2): mobile relies on
              touch gestures instead -- see the gesture hint paragraph below
              the crop box, shown only below the sm breakpoint. Hiding this
              column on mobile rather than just its sliders means there's no
              leftover empty grid cell. */}
          <div className="hidden text-xs text-zinc-500 sm:block">
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

        <p className="mt-3 text-center text-xs text-zinc-500 sm:hidden">
          Drag to move &middot; Pinch to zoom &middot; Twist to rotate &middot; Double-tap to reset
        </p>

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

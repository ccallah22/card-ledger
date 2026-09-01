import { useRef, useState } from "react";
import { processImageFile, renderCroppedImage } from "@/lib/image";
import { computeCoverScale, clampOffsetForRotation } from "@/lib/cropGeometry";

type CropData = { dataUrl: string; width: number; height: number };

// Logical slot identity (front vs. back card photo). Architectural context
// only for now -- it does not change any image-check, crop, storage, or OCR
// behavior in this task. Not to be confused with the legacy `imageType`
// values ("front" | "back" | "slab_front" | "slab_back"), which remain
// exactly as they are until a later task replaces them.
export type CardImageSlotSide = "front" | "back";

const CROP_FRAME_W = 320;
const CROP_FRAME_H = 448;
const CROP_FRAME_PAD = 8;
const CROP_BOX_WIDTH = CROP_FRAME_W - CROP_FRAME_PAD * 2;
const CROP_BOX_HEIGHT = CROP_FRAME_H - CROP_FRAME_PAD * 2;
const CROP_ZOOM_MIN = 1;
const CROP_ZOOM_MAX = 1.5;
const CROP_ROTATION_FINE_MIN = -10;
const CROP_ROTATION_FINE_MAX = 10;

/**
 * Image upload + crop state for one independent image slot (e.g. the front
 * or back of a card): raw file selection and validation (handleImageFile),
 * the crop modal's pan/zoom/rotate state and math
 * (clampCropOffset/applyCropRotation), confirming a crop into the final
 * imageUrl (confirmCrop, which also runs the automated image content
 * check), plus the front/back/slabbed/community-share fields that travel
 * alongside the image. Shared-image lookup/reporting (fingerprint-based)
 * stays in the page since it isn't image-upload/crop state itself.
 *
 * This is a faithful extraction of the logic that used to live directly in
 * useCardImage -- only one slot (front) is instantiated by useCardImage
 * today, but the state/behavior here is per-slot so a second (back) slot
 * can reuse it later without duplication.
 */
export function useCardImageSlot(side: CardImageSlotSide) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageIsFront, setImageIsFront] = useState(true);
  const [imageIsSlabbed, setImageIsSlabbed] = useState(false);
  const [imageShare, setImageShare] = useState(false);
  const [imageOwnerConfirm, setImageOwnerConfirm] = useState(false);
  const [imageType, setImageType] = useState<
    "front" | "back" | "slab_front" | "slab_back"
  >("front");
  const [imageError, setImageError] = useState<string>("");
  const [imageCheckStatus, setImageCheckStatus] = useState<
    "idle" | "checking" | "accept" | "review" | "block"
  >("idle");
  const [cardPhotoConfirm, setCardPhotoConfirm] = useState(false);

  const [cropData, setCropData] = useState<CropData | null>(null);
  const [cropSource, setCropSource] = useState<CropData | null>(null);
  const [showCrop, setShowCrop] = useState(false);
  const [cropZoom, setCropZoom] = useState(1);
  const [cropRotationBase, setCropRotationBase] = useState(0);
  const [cropRotationFine, setCropRotationFine] = useState(0);
  // Raw pan position from the last explicit drag/pinch/reset. Not
  // necessarily legal for the CURRENT zoom/rotation: every other place that
  // moves the crop (drag, pinch, applyCropRotation, handleImageFile's
  // reset) already computes and stores an in-bounds value, but the plain
  // zoom slider in CardImageCropModal.tsx calls setCropZoom directly with
  // no accompanying offset re-clamp -- rawCropOffset can briefly go stale
  // right after that one path. The publicly exposed `cropOffset` below is
  // always the clamped projection of this value, recomputed live (see its
  // comment) instead of resynchronized via an effect.
  const [rawCropOffset, setRawCropOffset] = useState({ x: 0, y: 0 });
  const cropDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  function clampCropOffset(
    next: { x: number; y: number },
    data: { width: number; height: number }
  ) {
    const rotationDeg = cropRotationBase + cropRotationFine;
    const scale =
      computeCoverScale(rotationDeg, data.width, data.height, CROP_BOX_WIDTH, CROP_BOX_HEIGHT) *
      cropZoom;
    return clampOffsetForRotation(
      next,
      data.width,
      data.height,
      CROP_BOX_WIDTH,
      CROP_BOX_HEIGHT,
      rotationDeg,
      scale
    );
  }

  // Derived every render rather than synchronized via an effect: cropOffset
  // is always the nearest legal point to rawCropOffset for the CURRENT
  // zoom/rotation/image. This is what keeps the crop in-bounds when zoom
  // changes through the one path that doesn't already re-clamp itself (the
  // plain zoom slider) -- drag/pinch/rotation/reset all already pass an
  // already-legal value into setCropOffset, so clamping them again here is
  // a no-op; the slider case is the one this actually corrects, and it does
  // so on the SAME render zoom changes (no extra render pass, no flash of
  // an out-of-bounds crop, no effect/render loop possible). confirmCrop
  // below reads this same derived value, so what's exported always matches
  // what was last rendered.
  const cropOffset = cropData ? clampCropOffset(rawCropOffset, cropData) : rawCropOffset;

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
      setImageUrl(null);
      setImageError(
        "This doesn’t look like a card photo. Please upload a picture of the card."
      );
      return;
    }
    setImageCheckStatus(data.decision === "review" ? "review" : "accept");
  }

  async function confirmCrop() {
    if (!cropData) return;
    const rotationDeg = cropRotationBase + cropRotationFine;
    const scale =
      computeCoverScale(rotationDeg, cropData.width, cropData.height, CROP_BOX_WIDTH, CROP_BOX_HEIGHT) *
      cropZoom;
    const cropped = await renderCroppedImage(
      cropData.dataUrl,
      {
        offsetX: cropOffset.x,
        offsetY: cropOffset.y,
        rotationDeg,
        scale,
        outWidth: CROP_BOX_WIDTH,
        outHeight: CROP_BOX_HEIGHT,
      },
      "image/webp",
      0.92
    );
    setImageUrl(cropped);
    setImageOwnerConfirm(false);
    setImageShare(false);
    setCardPhotoConfirm(false);
    setShowCrop(false);
    setCropData(null);
    setImageCheckStatus("checking");
    await runImageCheck(cropped);
  }

  // Rotation is live state, not a rebaked bitmap: changing it just re-clamps
  // the existing pan/zoom against the new angle's cover-fit geometry (see
  // clampCropOffset), so the user's position/zoom is preserved across a
  // rotation change instead of being reset every time.
  function applyCropRotation(nextBase: number, nextFine: number) {
    if (!cropData) return;
    const rotationDeg = nextBase + nextFine;
    const scale =
      computeCoverScale(rotationDeg, cropData.width, cropData.height, CROP_BOX_WIDTH, CROP_BOX_HEIGHT) *
      cropZoom;
    setCropRotationBase(nextBase);
    setCropRotationFine(nextFine);
    setRawCropOffset((prev) => {
      const next = clampOffsetForRotation(
        prev,
        cropData.width,
        cropData.height,
        CROP_BOX_WIDTH,
        CROP_BOX_HEIGHT,
        rotationDeg,
        scale
      );
      // Preserve the previous object when the clamp is a no-op (common for
      // a small rotation nudge that doesn't push the offset out of bounds)
      // so this doesn't force a re-render when nothing actually changed.
      return next.x === prev.x && next.y === prev.y ? prev : next;
    });
  }

  function handleImageFile(file: File | null) {
    if (!file) return;
    setImageError("");
    setImageCheckStatus("checking");
    processImageFile(file)
      .then(async (result) => {
        setCropSource({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setCropData({ dataUrl: result.dataUrl, width: result.width, height: result.height });
        setRawCropOffset({ x: 0, y: 0 });
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

  return {
    side,

    imageUrl,
    setImageUrl,
    imageIsFront,
    setImageIsFront,
    imageIsSlabbed,
    setImageIsSlabbed,
    imageShare,
    setImageShare,
    imageOwnerConfirm,
    setImageOwnerConfirm,
    imageType,
    setImageType,
    imageError,
    setImageError,
    imageCheckStatus,
    setImageCheckStatus,
    cardPhotoConfirm,
    setCardPhotoConfirm,

    cropData,
    setCropData,
    cropSource,
    setCropSource,
    showCrop,
    setShowCrop,
    cropZoom,
    setCropZoom,
    cropRotationBase,
    cropRotationFine,
    cropOffset,
    setCropOffset: setRawCropOffset,
    cropDragRef,

    cropBoxWidth: CROP_BOX_WIDTH,
    cropBoxHeight: CROP_BOX_HEIGHT,
    cropZoomMin: CROP_ZOOM_MIN,
    cropZoomMax: CROP_ZOOM_MAX,
    cropRotationFineMin: CROP_ROTATION_FINE_MIN,
    cropRotationFineMax: CROP_ROTATION_FINE_MAX,

    clampCropOffset,
    applyCropRotation,
    confirmCrop,
    handleImageFile,
  };
}

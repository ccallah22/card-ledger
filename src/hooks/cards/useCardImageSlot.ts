import { useEffect, useRef, useState } from "react";
import { cropImageDataUrl, processImageFile, rotateImageDataUrl } from "@/lib/image";

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
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const cropDragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  function clampCropOffset(
    next: { x: number; y: number },
    data: { width: number; height: number }
  ) {
    const baseScale = Math.max(CROP_BOX_WIDTH / data.width, CROP_BOX_HEIGHT / data.height);
    const scale = baseScale * cropZoom;
    const scaledW = data.width * scale;
    const scaledH = data.height * scale;
    const maxX = Math.max(0, (scaledW - CROP_BOX_WIDTH) / 2);
    const maxY = Math.max(0, (scaledH - CROP_BOX_HEIGHT) / 2);
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
    const baseScale = Math.max(CROP_BOX_WIDTH / cropData.width, CROP_BOX_HEIGHT / cropData.height);
    const scale = baseScale * cropZoom;
    const rawCropW = CROP_BOX_WIDTH / scale;
    const rawCropH = CROP_BOX_HEIGHT / scale;
    const cropW = Math.min(cropData.width, rawCropW);
    const cropH = Math.min(cropData.height, rawCropH);
    const x = cropData.width / 2 + ((-CROP_BOX_WIDTH / 2 - cropOffset.x) / scale);
    const y = cropData.height / 2 + ((-CROP_BOX_HEIGHT / 2 - cropOffset.y) / scale);
    const cropped = await cropImageDataUrl(cropData.dataUrl, {
      x: Math.max(0, Math.min(cropData.width - cropW, x)),
      y: Math.max(0, Math.min(cropData.height - cropH, y)),
      width: cropW,
      height: cropH,
    }, "image/webp", 0.92, { width: CROP_BOX_WIDTH, height: CROP_BOX_HEIGHT });
    setImageUrl(cropped);
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
    setCropOffset,
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

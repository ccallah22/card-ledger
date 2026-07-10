import { useCardImageSlot } from "./useCardImageSlot";

/**
 * Image upload + crop state for the card creation form. This is now a thin
 * wrapper around a single "front" useCardImageSlot instance -- the legacy
 * single-image behavior (front/back/slab_front/slab_back all live on one
 * slot, selected via imageType) is unchanged. The returned shape is exactly
 * what callers received before this hook was split into
 * useCardImage/useCardImageSlot, so no caller needs to change.
 *
 * A second ("back") slot is not instantiated here yet -- that's a later
 * task once the UI is ready to expose it.
 */
export function useCardImage() {
  const primary = useCardImageSlot("front");

  return {
    imageUrl: primary.imageUrl,
    setImageUrl: primary.setImageUrl,
    imageIsFront: primary.imageIsFront,
    setImageIsFront: primary.setImageIsFront,
    imageIsSlabbed: primary.imageIsSlabbed,
    setImageIsSlabbed: primary.setImageIsSlabbed,
    imageShare: primary.imageShare,
    setImageShare: primary.setImageShare,
    imageOwnerConfirm: primary.imageOwnerConfirm,
    setImageOwnerConfirm: primary.setImageOwnerConfirm,
    imageType: primary.imageType,
    setImageType: primary.setImageType,
    imageError: primary.imageError,
    setImageError: primary.setImageError,
    imageCheckStatus: primary.imageCheckStatus,
    setImageCheckStatus: primary.setImageCheckStatus,
    cardPhotoConfirm: primary.cardPhotoConfirm,
    setCardPhotoConfirm: primary.setCardPhotoConfirm,

    cropData: primary.cropData,
    setCropData: primary.setCropData,
    cropSource: primary.cropSource,
    setCropSource: primary.setCropSource,
    showCrop: primary.showCrop,
    setShowCrop: primary.setShowCrop,
    cropZoom: primary.cropZoom,
    setCropZoom: primary.setCropZoom,
    cropRotationBase: primary.cropRotationBase,
    cropRotationFine: primary.cropRotationFine,
    cropOffset: primary.cropOffset,
    setCropOffset: primary.setCropOffset,
    cropDragRef: primary.cropDragRef,

    cropBoxWidth: primary.cropBoxWidth,
    cropBoxHeight: primary.cropBoxHeight,
    cropZoomMin: primary.cropZoomMin,
    cropZoomMax: primary.cropZoomMax,
    cropRotationFineMin: primary.cropRotationFineMin,
    cropRotationFineMax: primary.cropRotationFineMax,

    clampCropOffset: primary.clampCropOffset,
    applyCropRotation: primary.applyCropRotation,
    confirmCrop: primary.confirmCrop,
    handleImageFile: primary.handleImageFile,
  };
}

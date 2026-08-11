export type Offset = { x: number; y: number };

function toRadians(deg: number) {
  return (deg * Math.PI) / 180;
}

// Scale at which an `imgWidth`x`imgHeight` image, rotated by `rotationDeg`
// and centered, just fully covers an axis-aligned `frameWidth`x`frameHeight`
// frame (zero pan slack in at least one axis). This is the rotation-aware
// generalization of the classic `max(frameW/imgW, frameH/imgH)` cover-fit
// formula -- rotating the frame by -rotationDeg into the image's own axes
// gives a bounding box of size (frameW*|cos|+frameH*|sin|) x
// (frameW*|sin|+frameH*|cos|), which the image must contain. rotationDeg=0
// collapses back to the original formula exactly.
export function computeCoverScale(
  rotationDeg: number,
  imgWidth: number,
  imgHeight: number,
  frameWidth: number,
  frameHeight: number
) {
  const rad = toRadians(rotationDeg);
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const scaleX = (frameWidth * c + frameHeight * s) / imgWidth;
  const scaleY = (frameWidth * s + frameHeight * c) / imgHeight;
  return Math.max(scaleX, scaleY);
}

// Clamps a proposed image-center offset (screen-space px, frame-centered)
// so an `imgWidth`x`imgHeight` image -- rotated by `rotationDeg` and scaled
// by `scale` -- keeps fully covering the axis-aligned frame at every pan
// position. Rotating the offset into the image's own (unrotated) axes turns
// the valid region into a simple axis-aligned box there (independent u/v
// bounds), which is clamped and rotated back. At rotationDeg=0 this reduces
// to the original independent maxX/maxY clamp.
export function clampOffsetForRotation(
  offset: Offset,
  imgWidth: number,
  imgHeight: number,
  frameWidth: number,
  frameHeight: number,
  rotationDeg: number,
  scale: number
): Offset {
  const rad = toRadians(rotationDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cAbs = Math.abs(cos);
  const sAbs = Math.abs(sin);

  const imgHalfW = (imgWidth * scale) / 2;
  const imgHalfH = (imgHeight * scale) / 2;

  const maxU = Math.max(0, imgHalfW - (frameWidth / 2) * cAbs - (frameHeight / 2) * sAbs);
  const maxV = Math.max(0, imgHalfH - (frameWidth / 2) * sAbs - (frameHeight / 2) * cAbs);

  const u = offset.x * cos + offset.y * sin;
  const v = -offset.x * sin + offset.y * cos;

  const uc = Math.max(-maxU, Math.min(maxU, u));
  const vc = Math.max(-maxV, Math.min(maxV, v));

  return {
    x: uc * cos - vc * sin,
    y: uc * sin + vc * cos,
  };
}

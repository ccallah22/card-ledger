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

// Phase 1D2: pure helpers for two-finger pinch/twist gestures, built on the
// same rotation conventions as the functions above (positive degrees =
// clockwise, matching CSS `rotate()` / canvas `ctx.rotate()`).

// Normalizes a raw angle difference (e.g. atan2 output minus a baseline
// angle, both in degrees) into (-180, 180] so a twist crossing the +/-180
// boundary doesn't register as a sudden 360deg jump.
export function normalizeAngleDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function rotateVector(v: Offset, deg: number): Offset {
  const rad = toRadians(deg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

// Given a two-finger gesture's baseline (anchor frame-point p0 -- the pinch
// midpoint at gesture start, in the same frame-centered coordinate space as
// cropOffset -- plus the image offset at that moment) and its current state
// (current anchor frame-point p1, plus how much rotation/scale changed since
// baseline), returns the image offset that keeps the same underlying image
// content anchored under the fingers: focal-point-preserving pinch-zoom and
// twist, derived from requiring the image-local point under p0 to still be
// under p1 after applying the rotation/scale delta. Rotation-delta and
// scale-ratio are relative to the gesture's own baseline (not accumulated
// frame-to-frame), matching the stable-baseline approach used for twist
// generally. The result still needs to pass through clampOffsetForRotation
// before being committed -- this function only aims for a natural feel, the
// clamp is what guarantees no blank space is ever exposed.
export function computeAnchoredOffset(
  p0: Offset,
  offset0: Offset,
  p1: Offset,
  rotationDeltaDeg: number,
  scaleRatio: number
): Offset {
  const local = rotateVector({ x: p0.x - offset0.x, y: p0.y - offset0.y }, rotationDeltaDeg);
  return {
    x: p1.x - local.x * scaleRatio,
    y: p1.y - local.y * scaleRatio,
  };
}

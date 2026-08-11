export const IMAGE_RULES = {
  allowedTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  maxBytes: 10 * 1024 * 1024,
  minWidth: 600,
  minHeight: 800,
};

function readAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image."));
    img.src = src;
  });
}

export type RenderCropParams = {
  offsetX: number;
  offsetY: number;
  rotationDeg: number;
  scale: number;
  outWidth: number;
  outHeight: number;
};

// Renders the final crop export directly from the original (never rebaked)
// source image using one compound canvas transform -- translate to the
// image's center position (frame center + pan offset), rotate, then scale --
// applied in the same order as CardImageCropModal's live CSS preview
// transform. Because export and preview share the same transform chain and
// both read from the same untouched source bitmap, the exported pixels are
// guaranteed to match what the user saw, at any rotation angle.
export async function renderCroppedImage(
  dataUrl: string,
  params: RenderCropParams,
  outputType = "image/webp",
  quality = 0.92
) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(params.outWidth));
  canvas.height = Math.max(1, Math.floor(params.outHeight));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to process image.");

  ctx.translate(canvas.width / 2 + params.offsetX, canvas.height / 2 + params.offsetY);
  ctx.rotate((params.rotationDeg * Math.PI) / 180);
  ctx.scale(params.scale, params.scale);
  ctx.drawImage(img, -width / 2, -height / 2, width, height);
  return canvas.toDataURL(outputType, quality);
}

export async function processImageFile(file: File) {
  if (!IMAGE_RULES.allowedTypes.includes(file.type)) {
    throw new Error("Only JPG, PNG, WebP, or HEIC images are allowed.");
  }
  if (file.size > IMAGE_RULES.maxBytes) {
    throw new Error("Image is too large. Max size is 10 MB.");
  }

  const rawDataUrl = await readAsDataUrl(file);
  let img: HTMLImageElement;
  try {
    img = await loadImage(rawDataUrl);
  } catch (err) {
    if (file.type === "image/heic" || file.type === "image/heif") {
      throw new Error(
        "This browser can't decode HEIC yet. Please convert to JPG/PNG/WebP."
      );
    }
    throw err;
  }
  const width = img.naturalWidth || img.width;
  const height = img.naturalHeight || img.height;

  if (width < IMAGE_RULES.minWidth || height < IMAGE_RULES.minHeight) {
    throw new Error("Image is too small. Minimum is 600×800.");
  }

  // Strip metadata by re-encoding on a canvas.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to process image.");
  ctx.drawImage(img, 0, 0, width, height);

  const dataUrl = canvas.toDataURL("image/webp", 0.92);
  return { dataUrl, width, height };
}

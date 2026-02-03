import { supabase } from "./supabaseClient";

function fileExt(name: string) {
  const parts = name.split(".");
  return (parts.length > 1 ? parts.pop() : "jpg")?.toLowerCase() ?? "jpg";
}

async function imageFileToThumbnailBlob(file: File, maxSize = 256, quality = 0.75): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Image failed to load"));
      img.src = url;
    });

    const { width, height } = img;
    const scale = Math.min(maxSize / width, maxSize / height, 1);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");
    ctx.drawImage(img, 0, 0, w, h);

    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Thumbnail conversion failed"))),
        "image/jpeg",
        quality
      );
    });

    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadCardImageWithThumb(opts: {
  userId: string;
  cardId: string;
  file: File;
}) {
  const { userId, cardId, file } = opts;

  const originalPath = `${userId}/${cardId}.${fileExt(file.name)}`;

  const thumbBlob = await imageFileToThumbnailBlob(file, 256, 0.75);
  const thumbFile = new File([thumbBlob], `${cardId}.jpg`, { type: "image/jpeg" });
  const thumbPath = `${userId}/${cardId}.jpg`;

  const up1 = await supabase.storage.from("card-images").upload(originalPath, file, {
    upsert: true,
    contentType: file.type,
  });
  if (up1.error) throw up1.error;

  const up2 = await supabase.storage.from("card-thumbs").upload(thumbPath, thumbFile, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (up2.error) throw up2.error;

  return { image_path: originalPath, thumb_path: thumbPath };
}

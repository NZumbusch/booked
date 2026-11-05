/** A photo you took, as a JPEG file of at most `maxSide` px (own covers: see domain/photos PHOTO_PX). */
export async function fileToJpeg(file: Blob, maxSide: number): Promise<{ data: ArrayBuffer; type: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('That image couldn’t be read'))), 'image/jpeg', 0.85));
  return { data: await blob.arrayBuffer(), type: 'image/jpeg' };
}

/** Shrink an uploaded image to a small JPEG data URL so thousands of covers stay cheap to store. */
export async function fileToCoverDataUrl(file: File, maxSide = 600): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.8);
}

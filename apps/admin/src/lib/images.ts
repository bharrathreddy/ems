import { uploadFile } from './api';

/**
 * Shrinks photos in the browser before upload (longest side max 1920 px, JPEG ~85%).
 * Phone photos of 4-8 MB become ~300-600 KB, which saves hosting space and loads fast for parents.
 */
export async function resizeImage(file: File, max = 1920): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size < 900_000) return file;
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) });
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const keepPng = file.type === 'image/png' && file.size < 400_000; // logos with transparency
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), keepPng ? 'image/png' : 'image/jpeg', 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, keepPng ? '.png' : '.jpg'), { type: blob.type });
}

export async function uploadImage(path: string, file: File) {
  return uploadFile<{ id: string; url: string }>(path, await resizeImage(file));
}
export const fileUrl = (id?: string | null) => (id ? `/api/v1/files/${id}` : '');

/** A square, centred 640 px JPEG for student photos (ID-card style). */
export async function squarePhoto(file: File, size = 640): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) && file.type !== '') throw new Error('Choose a photo (JPG or PNG).');
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) throw new Error('This photo could not be read. Try another one, or take it again.');
  const side = Math.min(bitmap.width, bitmap.height);
  const out = Math.min(size, side);
  const canvas = Object.assign(document.createElement('canvas'), { width: out, height: out });
  // Keep the top part a little more (faces are usually in the upper half of a portrait photo).
  const sx = (bitmap.width - side) / 2;
  const sy = bitmap.height > bitmap.width ? Math.max(0, (bitmap.height - side) * 0.3) : 0;
  canvas.getContext('2d')!.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.88));
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

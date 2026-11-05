import type { Book } from './types';

/**
 * Your own cover photos live in their own store as real JPEG files, not inside the book record.
 * A book's `cover` then is a short reference: `photo:<id>`, where the id is derived from the
 * file's contents (the same photo always gets the same id, so copies never clash between devices).
 *
 * Older versions stored the photo itself in `cover` as a `data:` URL; those are converted on open.
 */
export const PHOTO_PREFIX = 'photo:';

/** A photo as it travels in backups and shared places (base64, since those are JSON). */
export interface PhotoFile {
  id: string;
  type: string;
  /** base64 of the file */
  data: string;
}

/** A photo as it is stored on the device. */
export interface StoredPhoto {
  id: string;
  type: string;
  data: ArrayBuffer;
  at: string;
}

/** Longest side of your own cover photos. */
export const PHOTO_PX = 1600;

export const isPhotoRef = (cover: string | undefined): cover is string => !!cover?.startsWith(PHOTO_PREFIX);
export const photoRef = (id: string) => `${PHOTO_PREFIX}${id}`;
export const photoIdOf = (cover: string | undefined) => (isPhotoRef(cover) ? cover.slice(PHOTO_PREFIX.length) : undefined);
export const isInlinePhoto = (cover: string | undefined): cover is string => !!cover?.startsWith('data:');

/** A cover you made yourself (a photo), as opposed to one from a catalogue. */
export const isOwnPhoto = (cover: string | undefined): boolean => isPhotoRef(cover) || isInlinePhoto(cover);

/** Ids of the photos these books use. */
export function photoIdsIn(books: Pick<Book, 'cover'>[]): Set<string> {
  const ids = new Set<string>();
  for (const b of books) {
    const id = photoIdOf(b.cover);
    if (id) ids.add(id);
  }
  return ids;
}

export function bytesToBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): ArrayBuffer {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

/** `data:image/jpeg;base64,…` → its bytes and type. */
export function decodeDataUrl(url: string): { data: ArrayBuffer; type: string } | undefined {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return undefined;
  const type = m[1] || 'image/jpeg';
  if (m[2]) return { data: base64ToBytes(m[3]), type };
  return { data: new TextEncoder().encode(decodeURIComponent(m[3])).buffer as ArrayBuffer, type };
}

/** Content id: the first 20 hex digits of the SHA-256 of the file. */
export async function photoIdFor(data: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash.slice(0, 10)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

import type { Book, Id } from '../domain/types';

/**
 * Finding a cover on Google Images: Booked opens the search, you long-press the right image and
 * share it back to Booked (installed app on Android), or copy it and tap "Paste image". Booked
 * remembers which book you were looking for, so the shared image lands there.
 */

const PENDING_KEY = 'booked.coverSearchFor';
const PENDING_MS = 60 * 60_000;

export function googleImagesUrl(book: Pick<Book, 'title' | 'authors' | 'isbn13' | 'isbn10'>, by: 'title' | 'isbn' = 'title'): string {
  const isbn = book.isbn13 ?? book.isbn10;
  const q = by === 'isbn' && isbn ? isbn : [book.title, book.authors[0], 'Buch Cover'].filter(Boolean).join(' ');
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(q)}`;
}

export function rememberCoverSearch(bookId: Id) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ id: bookId, at: Date.now() }));
  } catch {
    // not essential: the shared page then asks which book
  }
}

/** The book whose cover you went looking for in the last hour, if any. */
export function pendingCoverSearch(): Id | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { id: Id; at: number } | null;
    return v && Date.now() - v.at < PENDING_MS ? v.id : undefined;
  } catch {
    return undefined;
  }
}

export function forgetCoverSearch() {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // fine
  }
}

export interface Shared {
  image?: Blob;
  /** A link or text that came along (or instead of an image). */
  link?: string;
}

/** What was shared to Booked (kept by the service worker until picked up). */
export async function takeShared(): Promise<Shared> {
  if (typeof caches === 'undefined') return {};
  const cache = await caches.open('booked-shared');
  const [img, info] = await Promise.all([cache.match('shared-image'), cache.match('shared-info')]);
  const meta = info ? ((await info.json()) as { text?: string; url?: string; title?: string }) : undefined;
  const link = [meta?.url, meta?.text, meta?.title].map((s) => s?.match(/https?:\/\/\S+/)?.[0]).find(Boolean);
  return { image: img ? await img.blob() : undefined, link };
}

export async function clearShared() {
  if (typeof caches === 'undefined') return;
  await caches.delete('booked-shared');
}

/**
 * An image from the clipboard (long-press › "Copy image"), or an image address copied as text.
 * Throws a readable message if the browser can't read the clipboard.
 */
export async function pasteImage(): Promise<Blob | string | undefined> {
  if (!navigator.clipboard?.read) {
    const text = await navigator.clipboard?.readText?.();
    return text?.match(/^https?:\/\/\S+$/)?.[0];
  }
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  for (const item of items) {
    if (item.types.includes('text/plain')) {
      const text = await (await item.getType('text/plain')).text();
      const url = text.trim().match(/^https?:\/\/\S+$/)?.[0];
      if (url) return url;
    }
  }
  return undefined;
}

/** Load an image address directly (no CORS needed for an <img>): does it work and look like a cover? */
export function loadsAsImage(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(false), 10_000);
    img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 20 && img.naturalHeight > 20); };
    img.onerror = () => { clearTimeout(t); resolve(false); };
    img.src = url;
  });
}

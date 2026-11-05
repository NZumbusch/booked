import { displayTitle } from './book';
import type { Book } from './types';

/** Must-haves first, then newest first. */
export function sortWishes(books: Book[]): Book[] {
  return [...books].sort((a, b) => Number(!!b.mustHave) - Number(!!a.mustHave) || b.createdAt.localeCompare(a.createdAt));
}

/** The wishlist as plain text, to send to family (WhatsApp, Signal, email…). */
export function wishlistText(books: Book[], heading = 'My wishlist'): string {
  const lines = sortWishes(books).map((b) => {
    const details = [b.publisher, b.isbn13 ?? b.isbn10 ? `ISBN ${b.isbn13 ?? b.isbn10}` : undefined].filter(Boolean).join(', ');
    const note = b.notes?.trim() ? `\n   ${b.notes.trim().replace(/\s*\n\s*/g, ' ')}` : '';
    return `${b.mustHave ? '★' : '•'} ${displayTitle(b)}${b.authors.length ? ` – ${b.authors.join(', ')}` : ''}${details ? ` (${details})` : ''}${note}`;
  });
  const legend = books.some((b) => b.mustHave) ? '\n\n★ = most wanted' : '';
  return `${heading}\n\n${lines.join('\n')}${legend}`;
}

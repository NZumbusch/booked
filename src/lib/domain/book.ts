import type { Book, BookDraft, Id, IsoDate, Timestamp } from './types';
import { isbnKeys, normalizeIsbn } from './isbn';

/** Trim, drop empties, de-duplicate case-insensitively (keeps first spelling). */
export function cleanList(items: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items ?? []) {
    const item = raw.trim();
    const key = item.toLocaleLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

export function splitList(text: string): string[] {
  return cleanList(text.split(','));
}

function normalize(book: Book): Book {
  const title = book.title?.trim();
  if (!title) throw new Error('A book needs a title');
  const isbn = normalizeIsbn(book.isbn13 ?? '') ?? normalizeIsbn(book.isbn10 ?? '');
  const out: Book = {
    ...book,
    title,
    authors: cleanList(book.authors),
    genres: cleanList(book.genres),
    tags: cleanList(book.tags),
    collections: cleanList(book.collections),
    copies: Math.max(1, Math.round(book.copies || 1)),
    rating: book.rating ? Math.min(5, Math.max(1, Math.round(book.rating))) : undefined
  };
  if (isbn) {
    out.isbn13 = isbn.isbn13;
    out.isbn10 = isbn.isbn10;
  }
  if (out.subjects) out.subjects = cleanList(out.subjects);
  if (out.contributors) out.contributors = cleanList(out.contributors);
  return out;
}

export function createBook(draft: BookDraft, { id, now }: { id: Id; now: Timestamp }): Book {
  return normalize({
    authors: [],
    genres: [],
    tags: [],
    collections: [],
    status: 'unread',
    ownership: 'owned',
    signed: false,
    copies: 1,
    locationId: null,
    ...draft,
    id,
    createdAt: now,
    updatedAt: now
  } as Book);
}

/** Apply user edits. Identity and audit fields can't be overwritten. */
export function applyPatch(book: Book, patch: Partial<Book>, now: Timestamp): Book {
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = patch;
  return normalize({ ...book, ...rest, id: book.id, createdAt: book.createdAt, updatedAt: now });
}

export function findDuplicates(books: Book[], candidate: { id?: Id; isbn10?: string; isbn13?: string }): Book[] {
  const keys = isbnKeys(candidate);
  if (!keys.length) return [];
  return books.filter((b) => b.id !== candidate.id && isbnKeys(b).some((k) => keys.includes(k)));
}

export function isLent(book: Book): boolean {
  return !!book.lending?.to;
}

export function isOverdue(book: Book, today: IsoDate): boolean {
  return !!book.lending?.dueOn && book.lending.dueOn < today;
}

export function missingMetadata(book: Book): boolean {
  return !book.authors.length || !book.publishedYear || !(book.isbn13 || book.isbn10);
}

export function todayIso(): IsoDate {
  return new Date().toISOString().slice(0, 10);
}

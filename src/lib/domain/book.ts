import type { Book, BookDraft, Id, IsoDate, Lending, Timestamp } from './types';
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
    locationId: book.locationId ?? null,
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
  const next = normalize({ ...book, ...rest, id: book.id, createdAt: book.createdAt, updatedAt: now });
  // A field edited by hand no longer comes from its online source.
  // (Forms send the old provenance back unchanged, so only a *different* entry counts as fresh.)
  if (next.provenance) {
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const field = (b: Book, key: string) => (b as unknown as Record<string, unknown>)[key];
    const kept = Object.fromEntries(Object.entries(next.provenance).filter(([key, ref]) =>
      same(field(book, key), field(next, key)) || !same(ref, book.provenance?.[key])));
    next.provenance = Object.keys(kept).length ? kept : undefined;
  }
  return next;
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

/**
 * Patch that fills only the fields the book doesn't have yet, so a refresh from online
 * sources never overwrites the user's edits. Provenance is kept only for filled fields.
 */
export function fillMissing(book: Book, found: Partial<Book>): Partial<Book> {
  const empty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
  const patch: Record<string, unknown> = {};
  const provenance: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(found)) {
    if (key === 'provenance' || key === 'sources' || key === 'identifiers' || empty(value)) continue;
    if (!empty((book as unknown as Record<string, unknown>)[key])) continue;
    patch[key] = value;
    if (found.provenance?.[key]) provenance[key] = found.provenance[key];
  }
  if (found.identifiers) {
    const merged = { ...found.identifiers, ...book.identifiers };
    if (JSON.stringify(merged) !== JSON.stringify(book.identifiers ?? {})) patch.identifiers = merged;
  }
  if (!Object.keys(patch).length) return {};
  if (Object.keys(provenance).length) patch.provenance = { ...book.provenance, ...provenance };
  patch.sources = [...new Set([...(book.sources ?? []), ...(found.sources ?? [])])];
  return patch as Partial<Book>;
}

/** Title used for a book added before its details are known (e.g. fast batch scanning). */
export function placeholderTitle(isbn13: string): string {
  return `ISBN ${isbn13}`;
}

const COUNT_WORD = '(?:Bd|Bde|Bände|Bänden|Band|Vol|Vols|Volumes?|Tle|Teile?)';
// "(Werkausgabe, 5)", "(Reihe; Bd. 3)", "(Bd. 2)"
const TRAILING_NOTE = new RegExp(`\\s*\\((?:[^()]*[,;]\\s*\\d+|[^()]*\\b${COUNT_WORD}\\.?\\s*\\d+[^()]*)\\)\\s*$`, 'i');
// ". 3 Bd.", ", 2 Bde.", " 3 Bände"
const TRAILING_COUNT = new RegExp(`[.,:;]?\\s+\\d+\\s*${COUNT_WORD}\\.?\\s*$`, 'i');

/**
 * A title as it should be shown: the catalogue's volume-count and series notes are dropped
 * ("Das Prinzip Hoffnung. 3 Bd. (Werkausgabe, 5)" → "Das Prinzip Hoffnung"). Only for display; the stored title is unchanged.
 */
export function cleanTitle(title: string): string {
  let t = title.trim();
  for (let i = 0; i < 4; i++) {
    const before = t;
    t = t.replace(TRAILING_NOTE, '').replace(TRAILING_COUNT, '').replace(/[\s.,:;]+$/, '');
    if (t === before) break;
  }
  return t || title.trim();
}

/** Title for lists and headings: cleaned, plus the volume if one is set (to tell volumes apart). */
export function displayTitle(book: Pick<Book, 'title' | 'volume'>): string {
  const t = cleanTitle(book.title);
  return book.volume?.trim() ? `${t} · Vol. ${book.volume.trim()}` : t;
}

/** When the work was written or first published (not this edition): the year the timelines use. */
export function workYear(b: Pick<Book, 'writing' | 'firstPublishedYear' | 'publishedYear'>): number | undefined {
  return b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
}

/** Tag for books that no catalogue knew: they need their details typed in by hand. */
export const MANUAL_TAG = 'enter manually';

export function hasPlaceholderTitle(book: Pick<Book, 'title' | 'isbn13'>): boolean {
  return !!book.isbn13 && book.title === placeholderTitle(book.isbn13);
}

/**
 * Patch for background enrichment: fills empty fields (and a placeholder title) and clears
 * `pendingLookup`. Never touches values the user entered.
 */
export function enrichmentPatch(book: Book, found: Partial<Book>): Partial<Book> {
  const target = hasPlaceholderTitle(book) ? { ...book, title: '' } : book;
  const patch = fillMissing(target, found);
  return { ...patch, pendingLookup: undefined };
}

/** A loan starting today. */
export function lendingFrom(to: string, dueOn?: IsoDate): Lending {
  return { to: to.trim(), lentOn: todayIso(), dueOn: dueOn || undefined };
}

/** Distinct borrower names (case-insensitive), for suggestions. */
export function borrowers(books: Pick<Book, 'lending'>[]): string[] {
  return cleanList(books.map((b) => b.lending?.to ?? '')).sort((a, b) => a.localeCompare(b));
}

/** Draft for another physical copy of a book: same bibliographic data, fresh personal data. */
export function copyDraft(book: Book): BookDraft {
  const {
    id: _id, createdAt: _c, updatedAt: _u, locationId: _l, tags: _t, collections: _co, status: _s, rating: _r, startedOn: _so,
    finishedOn: _f, notes: _n, condition: _cd, purchasedOn: _p, price: _pr, signed: _sg, lending: _le, pendingLookup: _pl,
    copies: _cp, ownership: _o, ...biblio
  } = book;
  return { ...biblio, ownership: 'owned' };
}

import { splitList } from '../domain/book';
import { normalizeIsbn } from '../domain/isbn';
import type { BookDraft, BookFormat, IsoDate, Ownership, ReadingStatus } from '../domain/types';

/** Book fields a CSV column can be mapped to. */
export const IMPORT_FIELDS = {
  title: 'Title', subtitle: 'Subtitle', authors: 'Author(s)', firstName: 'Author first name', lastName: 'Author last name',
  isbn13: 'ISBN-13', isbn10: 'ISBN-10', publisher: 'Publisher', publishedYear: 'Year published', firstPublishedYear: 'First published',
  description: 'Description', pageCount: 'Pages', format: 'Format', language: 'Language', genres: 'Genres', subjects: 'Subjects',
  series: 'Series', seriesNumber: 'No. in series', edition: 'Edition', tags: 'Tags', collections: 'Collections', notes: 'Notes',
  rating: 'Rating', status: 'Reading status', startedOn: 'Started', finishedOn: 'Finished', price: 'Price', purchasedOn: 'Purchased',
  condition: 'Condition', copies: 'Copies', signed: 'Signed', ownership: 'Owned / wishlist', cover: 'Cover URL',
  location: 'Location (Place › Room)', place: 'Place', room: 'Room', shelf: 'Shelf',
  lentTo: 'Lent to', lentOn: 'Lent on', dueOn: 'Due'
} as const;
export type ImportField = keyof typeof IMPORT_FIELDS;

/** Header synonyms (normalized: lowercase letters/digits only), covering Libib, Goodreads and Booked exports. */
const SYNONYMS: Record<ImportField, string[]> = {
  title: ['title', 'name', 'booktitle', 'titel'], subtitle: ['subtitle', 'untertitel'],
  authors: ['creators', 'author', 'authors', 'writer', 'autor', 'autoren', 'creator'],
  firstName: ['firstname'], lastName: ['lastname'],
  isbn13: ['eanisbn13', 'isbn13', 'isbn', 'ean'], isbn10: ['upcisbn10', 'isbn10'],
  publisher: ['publisher', 'verlag'], publishedYear: ['publishdate', 'year', 'yearpublished', 'published', 'publicationyear', 'jahr'],
  firstPublishedYear: ['firstpublished', 'originalpublicationyear'], description: ['description', 'summary', 'beschreibung'],
  pageCount: ['length', 'pages', 'pagecount', 'numberofpages', 'seiten'], format: ['format', 'binding'],
  language: ['language', 'sprache'], genres: ['genres', 'genre', 'categories'], subjects: ['subjects'],
  series: ['series', 'reihe'], seriesNumber: ['seriesnumber'], edition: ['edition', 'auflage'],
  tags: ['tags', 'bookshelves', 'shelves'], collections: ['group', 'collection', 'collections'],
  notes: ['notes', 'privatenotes', 'comments', 'notizen'], rating: ['rating', 'myrating'],
  status: ['status', 'readstatus', 'exclusiveshelf'], startedOn: ['began', 'started', 'datestarted'],
  finishedOn: ['completed', 'dateread', 'finished', 'datefinished'], price: ['price', 'preis'],
  purchasedOn: ['purchasedate', 'purchased', 'dateacquired'], condition: ['condition', 'zustand'], copies: ['copies', 'owned copies'.replace(' ', '')],
  signed: ['signed'], ownership: ['ownership'], cover: ['coverurl', 'cover', 'image', 'imageurl'],
  location: ['location', 'standort'], place: ['locationplace', 'place'], room: ['locationroom', 'room'], shelf: ['locationshelf', 'shelf'],
  lentTo: ['lentto'], lentOn: ['lenton'], dueOn: ['dueon']
};

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Best-guess column → field mapping (each field used once). */
export function guessMapping(headers: string[]): (ImportField | '')[] {
  const used = new Set<ImportField>();
  // A plain "ISBN" column is the ISBN-10 when a dedicated ISBN-13 column exists (as in Goodreads exports).
  const hasIsbn13 = headers.some((h) => ['isbn13', 'eanisbn13'].includes(norm(h)));
  return headers.map((h) => {
    const key = norm(h);
    if (key === 'isbn' && hasIsbn13 && !used.has('isbn10')) {
      used.add('isbn10');
      return 'isbn10';
    }
    const field = (Object.keys(SYNONYMS) as ImportField[]).find((f) => !used.has(f) && SYNONYMS[f].includes(key));
    if (field) used.add(field);
    return field ?? '';
  });
}

// ---------------------------------------------------------------- value parsing

// Goodreads writes ISBNs as ="0441172717"; only that exact wrapper is removed.
const clean = (v: string) => v.trim().replace(/^="(.*)"$/, '$1').trim();
const num = (v: string) => {
  const n = Number(clean(v).replace(',', '.').replace(/[^\d.-]/g, ''));
  return clean(v) && Number.isFinite(n) ? n : undefined;
};

export function parseDate(v: string): IsoDate | undefined {
  const s = clean(v);
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function parseStatus(v: string): ReadingStatus | undefined {
  const s = norm(v);
  if (!s) return undefined;
  if (['completed', 'read', 'finished', 'gelesen', 'done'].includes(s)) return 'read';
  if (['inprogress', 'reading', 'currentlyreading', 'lese'].includes(s)) return 'reading';
  if (['abandoned', 'dnf', 'didnotfinish', 'abgebrochen'].includes(s)) return 'abandoned';
  if (['notbegun', 'unread', 'toread', 'ungelesen', 'wanttoread'].includes(s)) return 'unread';
  return undefined;
}

function parseFormat(v: string): BookFormat | undefined {
  const s = norm(v);
  if (!s) return undefined;
  if (s.includes('hard')) return 'hardcover';
  if (s.includes('paper') || s.includes('soft') || s.includes('taschenbuch')) return 'paperback';
  if (s.includes('ebook') || s.includes('kindle')) return 'ebook';
  if (s.includes('audio')) return 'audiobook';
  return 'other';
}

const yes = (v: string) => ['yes', 'true', '1', 'ja', 'x', 'signed'].includes(norm(v));

export interface ImportItem {
  draft: BookDraft;
  /** Place › room › shelf names (created if missing). */
  locationPath: string[];
}

export interface ImportResult {
  items: ImportItem[];
  skipped: { row: number; reason: string }[];
}

/** Convert data rows (without header) using a column mapping. */
export function rowsToImport(rows: string[][], mapping: (ImportField | '')[]): ImportResult {
  const items: ImportItem[] = [];
  const skipped: ImportResult['skipped'] = [];
  rows.forEach((row, i) => {
    const get = (f: ImportField) => {
      const idx = mapping.indexOf(f);
      return idx >= 0 ? clean(row[idx] ?? '') : '';
    };
    const isbn = normalizeIsbn(get('isbn13')) ?? normalizeIsbn(get('isbn10'));
    let authors = splitList(get('authors').replace(/\s*;\s*/g, ','));
    if (!authors.length && (get('firstName') || get('lastName'))) authors = [`${get('firstName')} ${get('lastName')}`.trim()];
    const title = get('title') || (isbn ? `ISBN ${isbn.isbn13}` : '');
    if (!title) {
      skipped.push({ row: i + 2, reason: 'no title or ISBN' });
      return;
    }
    const rating = num(get('rating'));
    const lentTo = get('lentTo');
    const draft: BookDraft = {
      title,
      subtitle: get('subtitle') || undefined,
      authors,
      isbn13: isbn?.isbn13,
      isbn10: isbn?.isbn10,
      publisher: get('publisher') || undefined,
      publishedYear: Number(get('publishedYear').match(/\d{4}/)?.[0]) || undefined,
      firstPublishedYear: Number(get('firstPublishedYear').match(/\d{4}/)?.[0]) || undefined,
      description: get('description') || undefined,
      pageCount: num(get('pageCount')),
      format: parseFormat(get('format')),
      language: get('language') || undefined,
      genres: splitList(get('genres')),
      subjects: splitList(get('subjects')),
      series: get('series') || undefined,
      seriesNumber: get('seriesNumber') || undefined,
      edition: get('edition') || undefined,
      tags: splitList(get('tags')).filter((t) => !['read', 'to-read', 'currently-reading'].includes(t)),
      collections: splitList(get('collections')),
      notes: get('notes') || undefined,
      rating: rating && rating > 0 ? rating : undefined,
      status: parseStatus(get('status')) ?? 'unread',
      startedOn: parseDate(get('startedOn')),
      finishedOn: parseDate(get('finishedOn')),
      price: num(get('price')),
      purchasedOn: parseDate(get('purchasedOn')),
      condition: get('condition') || undefined,
      copies: num(get('copies')) || 1,
      signed: yes(get('signed')),
      ownership: (norm(get('ownership')) === 'wishlist' ? 'wishlist' : 'owned') as Ownership,
      cover: /^https?:\/\//.test(get('cover')) ? get('cover') : undefined,
      lending: lentTo ? { to: lentTo, lentOn: parseDate(get('lentOn')) ?? new Date().toISOString().slice(0, 10), dueOn: parseDate(get('dueOn')) } : undefined
    };
    const path = get('location')
      ? get('location').split(/\s*(?:›|>|\/)\s*/).filter(Boolean)
      : [get('place'), get('room'), get('shelf')].filter(Boolean);
    items.push({ draft, locationPath: path.slice(0, 3) });
  });
  return { items, skipped };
}

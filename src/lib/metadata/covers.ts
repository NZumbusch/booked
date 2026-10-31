import { fold } from '../domain/query';
import type { Book } from '../domain/types';
import { getJson, type Fetcher } from './http';
import { gbSearch } from './googlebooks';
import { marcToIso, olSearch } from './openlibrary';
import type { ImageProbe } from './lookup';
import { titlesMatch } from './wikidata';

/**
 * Alternative covers for a book: every edition of the same work on Open Library (yours first:
 * same ISBN, then same language), plus Google Books editions. Thumbnails for the grid, a large
 * version to save.
 */
export interface CoverOption {
  /** Large image to use as the book's cover. */
  url: string;
  /** Small image for the picker grid. */
  thumb: string;
  /** e.g. "Suhrkamp · 2002 · German". */
  label: string;
  source: 'openlibrary' | 'googlebooks';
  /** Same ISBN as this book: very likely the cover on the shelf. */
  sameEdition?: boolean;
  sameLanguage?: boolean;
}

const OL = 'https://openlibrary.org';
const olCover = (id: number, size: 'M' | 'L') => `https://covers.openlibrary.org/b/id/${id}-${size}.jpg?default=false`;

interface Editions {
  entries?: {
    covers?: number[];
    publishers?: string[];
    publish_date?: string;
    languages?: { key: string }[];
    isbn_13?: string[];
    isbn_10?: string[];
  }[];
}

const LANG_NAME: Record<string, string> = { de: 'German', en: 'English', fr: 'French', es: 'Spanish', it: 'Italian', nl: 'Dutch' };

/** The Open Library work behind a book: from its identifiers, else a title/author search. */
async function workIdOf(book: Book, f: Fetcher): Promise<string | undefined> {
  if (book.identifiers?.olwork) return book.identifiers.olwork;
  const hits = await olSearch(`${book.title} ${book.authors[0] ?? ''}`.trim(), f, 5);
  const exact = hits.find((h) => fold(h.title) === fold(book.title));
  return (exact ?? hits.find((h) => titlesMatch(h.title, book.title)))?.olWorkId;
}

export async function olEditionCovers(book: Book, f: Fetcher): Promise<CoverOption[]> {
  const work = await workIdOf(book, f);
  if (!work) return [];
  // Classics have thousands of editions; the first 120 give plenty of choice and stay quick.
  const res = await getJson<Editions>(f, `${OL}/works/${work}/editions.json?limit=120`, { timeoutMs: 15000 });
  const isbns = new Set([book.isbn13, book.isbn10].filter(Boolean));
  const out: CoverOption[] = [];
  for (const e of res?.entries ?? []) {
    const id = e.covers?.find((c) => c > 0);
    if (!id) continue;
    const lang = e.languages?.[0] ? marcToIso(e.languages[0].key.split('/').pop()!) : undefined;
    const year = e.publish_date?.match(/\d{4}/)?.[0];
    out.push({
      url: olCover(id, 'L'), thumb: olCover(id, 'M'), source: 'openlibrary',
      label: [e.publishers?.[0], year, lang ? LANG_NAME[lang] ?? lang : undefined].filter(Boolean).join(' · '),
      sameEdition: [...(e.isbn_13 ?? []), ...(e.isbn_10 ?? [])].some((i) => isbns.has(i)),
      sameLanguage: !!lang && lang === book.language
    });
  }
  return out;
}

export async function googleCovers(book: Book, f: Fetcher, key?: string): Promise<CoverOption[]> {
  const q = `intitle:${book.title}${book.authors[0] ? ` inauthor:${book.authors[0]}` : ''}`;
  const hits = await gbSearch(q, f, key, 20);
  return hits
    .filter((h) => h.cover && titlesMatch(h.title, book.title))
    .map((h) => ({
      // Google serves a bigger rendition of the same thumbnail on request.
      url: `${h.cover}&fife=w800-h1200`, thumb: h.cover!, source: 'googlebooks' as const,
      label: [h.gb?.fields.publisher, h.year, h.gb?.fields.language ? LANG_NAME[h.gb.fields.language] ?? h.gb.fields.language : undefined].filter(Boolean).join(' · '),
      sameEdition: !!h.gb?.fields.isbn13 && h.gb.fields.isbn13 === book.isbn13,
      sameLanguage: !!h.gb?.fields.language && h.gb.fields.language === book.language
    }));
}

/** Both sources at once; a failing source just contributes nothing. Best matches first, no duplicates. */
export async function alternativeCovers(book: Book, f: Fetcher, key?: string): Promise<CoverOption[]> {
  const [ol, gb] = await Promise.allSettled([olEditionCovers(book, f), googleCovers(book, f, key)]);
  const all = [...(ol.status === 'fulfilled' ? ol.value : []), ...(gb.status === 'fulfilled' ? gb.value : [])];
  if (ol.status === 'rejected' && gb.status === 'rejected') throw ol.reason;
  const rank = (o: CoverOption) => (o.sameEdition ? 0 : o.sameLanguage ? 1 : 2);
  const seen = new Set<string>([book.cover ?? '']);
  return all
    .map((o, i) => ({ o, i }))
    .sort((a, b) => rank(a.o) - rank(b.o) || a.i - b.i)
    .map(({ o }) => o)
    .filter((o) => !seen.has(o.url) && !seen.has(o.thumb) && seen.add(o.url) && seen.add(o.thumb));
}

/**
 * Cover URLs that are looked up directly by ISBN, bypassing the catalogue search (which often
 * has no cover for new books): Open Library's edition cover, the German National Library's
 * cover service, and Google's by-ISBN image (last: it answers with a blank tile when it has none).
 */
export function isbnCoverUrls(book: Pick<Book, 'isbn13' | 'isbn10'>): { early: string[]; last: string[] } {
  const isbn = book.isbn13 ?? book.isbn10;
  if (!isbn) return { early: [], last: [] };
  return {
    early: [
      `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`,
      ...(book.isbn13 ? [`https://portal.dnb.de/opac/mvb/cover?isbn=${book.isbn13}`] : [])
    ],
    last: [`https://books.google.com/books/content?vid=ISBN${isbn}&printsec=frontcover&img=1&zoom=1`]
  };
}

/** First working cover for a book: by ISBN, then other editions of the same work, then Google's ISBN image. */
export async function findCover(book: Book, f: Fetcher, probe: ImageProbe, key?: string): Promise<string | undefined> {
  const { early, last } = isbnCoverUrls(book);
  for (const u of early) if (await probe(u)) return u;
  try {
    const options = await alternativeCovers(book, f, key);
    // Open Library answers 404 for a missing cover, so its covers are safe; Google may serve a blank tile.
    const ordered = [...options.filter((o) => o.source === 'openlibrary'), ...options.filter((o) => o.source !== 'openlibrary')];
    for (const o of ordered.slice(0, 6)) if (await probe(o.thumb)) return o.url;
  } catch {
    // catalogue unreachable: still try the last resort below
  }
  for (const u of last) if (await probe(u)) return u;
  return undefined;
}

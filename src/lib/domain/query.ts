import type { Book, Id } from './types';

export type SortKey = 'title' | 'author' | 'added' | 'year' | 'rating' | 'location' | 'pages';
export type SortDir = 'asc' | 'desc';

export const SORT_LABELS: Record<SortKey, string> = {
  title: 'Title',
  author: 'Author',
  added: 'Date added',
  year: 'Year',
  rating: 'Rating',
  location: 'Location',
  pages: 'Pages'
};

export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const haystacks = new WeakMap<Book, string>();

function haystack(book: Book): string {
  let h = haystacks.get(book);
  if (h === undefined) {
    h = fold(
      [
        book.title, book.subtitle, ...book.authors, book.isbn10, book.isbn13, ...book.tags,
        ...book.collections, ...book.genres, ...(book.subjects ?? []), ...(book.contributors ?? []),
        book.notes, book.publisher, book.series
      ].filter(Boolean).join('\n')
    );
    haystacks.set(book, h);
  }
  return h;
}

/** Every whitespace-separated token must appear somewhere. Hyphens are ignored so ISBNs match. */
export function matchesText(book: Book, query: string): boolean {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const h = haystack(book);
  return tokens.every((t) => h.includes(t) || (/^[\d-x]+$/.test(t) && h.includes(t.replace(/-/g, ''))));
}

const ARTICLE = /^(the|a|an|der|die|das|le|la|les|l'|el|il)\s+/i;
const titleKey = (b: Book) => fold(b.title.replace(ARTICLE, ''));
const surname = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return fold(parts[parts.length - 1] + ' ' + parts.slice(0, -1).join(' '));
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortBooks(
  books: readonly Book[],
  key: SortKey,
  dir: SortDir,
  locationLabel: (id: Id | null) => string = () => ''
): Book[] {
  const sign = dir === 'asc' ? 1 : -1;
  const text = (f: (b: Book) => string) => (a: Book, b: Book) => sign * collator.compare(f(a), f(b));
  // Numeric keys: missing values always sort last, regardless of direction.
  const num = (f: (b: Book) => number | undefined) => (a: Book, b: Book) => {
    const x = f(a), y = f(b);
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1;
    return sign * (x - y);
  };
  const cmp = {
    title: text(titleKey),
    author: text((b) => (b.authors[0] ? surname(b.authors[0]) : '￿')),
    added: text((b) => b.createdAt),
    year: num((b) => b.publishedYear),
    rating: num((b) => b.rating),
    pages: num((b) => b.pageCount),
    location: text((b) => locationLabel(b.locationId))
  }[key];
  const byTitle = text(titleKey);
  return [...books].sort((a, b) => cmp(a, b) || byTitle(a, b));
}

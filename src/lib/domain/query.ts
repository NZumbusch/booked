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
/** Sort keys are worked out once per book version (books are immutable: an edit is a new object). */
const titleKeys = new WeakMap<Book, string>();
const authorKeys = new WeakMap<Book, string>();
const titleKey = (b: Book) => {
  let k = titleKeys.get(b);
  if (k === undefined) titleKeys.set(b, (k = fold(b.title.replace(ARTICLE, ''))));
  return k;
};
const surname = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return fold(parts[parts.length - 1] + ' ' + parts.slice(0, -1).join(' '));
};
const authorKey = (b: Book) => {
  let k = authorKeys.get(b);
  if (k === undefined) authorKeys.set(b, (k = b.authors[0] ? surname(b.authors[0]) : '\uffff'));
  return k;
};

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortBooks(
  books: readonly Book[],
  key: SortKey,
  dir: SortDir,
  locationLabel: (id: Id | null) => string = () => ''
): Book[] {
  const sign = dir === 'asc' ? 1 : -1;
  // Each book's keys are computed once up front, not again in every comparison.
  type Row = { b: Book; t: string; k: string | number | undefined };
  const textKey: Partial<Record<SortKey, (b: Book) => string>> = {
    title: titleKey, author: authorKey, added: (b) => b.createdAt, location: (b) => locationLabel(b.locationId)
  };
  const numKey: Partial<Record<SortKey, (b: Book) => number | undefined>> = {
    year: (b) => b.publishedYear, rating: (b) => b.rating, pages: (b) => b.pageCount
  };
  const labels = new Map<Id | null, string>();
  const keyOf = textKey[key]
    ? key === 'location'
      ? (b: Book) => {
          if (!labels.has(b.locationId)) labels.set(b.locationId, locationLabel(b.locationId));
          return labels.get(b.locationId)!;
        }
      : textKey[key]!
    : numKey[key]!;
  const rows: Row[] = books.map((b) => ({ b, t: titleKey(b), k: keyOf(b) }));
  const byTitle = (x: Row, y: Row) => sign * collator.compare(x.t, y.t);
  const cmp = textKey[key]
    ? (x: Row, y: Row) => sign * collator.compare(x.k as string, y.k as string)
    : (x: Row, y: Row) => {
        // Numeric keys: missing values always sort last, regardless of direction.
        const a = x.k as number | undefined, c = y.k as number | undefined;
        if (a === undefined || c === undefined) return a === c ? 0 : a === undefined ? 1 : -1;
        return sign * (a - c);
      };
  return rows.sort((x, y) => cmp(x, y) || byTitle(x, y)).map((r) => r.b);
}

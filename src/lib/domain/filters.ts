import { isOverdue, missingMetadata } from './book';
import { descendantIds, labelOf, pathOf } from './locations';
import { fold, matchesText } from './query';
import type { Book, BookFormat, Id, IsoDate, Location, Ownership, ReadingStatus } from './types';

/** Everything the library can be filtered by. All conditions combine with AND; list values with OR. */
export interface BookFilter {
  q?: string;
  /** Location subtree, or 'none' for books without a location. */
  loc?: Id | 'none';
  authors?: string[];
  genres?: string[];
  tags?: string[];
  collections?: string[];
  status?: ReadingStatus[];
  formats?: BookFormat[];
  languages?: string[];
  ratingMin?: number;
  /** Year range on the edition year (falls back to first publication year). */
  yearFrom?: number;
  yearTo?: number;
  lending?: 'lent' | 'overdue';
  ownership?: Ownership;
  missing?: ('cover' | 'metadata')[];
}

export type FilterKey = keyof BookFilter;

// ---------------------------------------------------------------- URL encoding

const LISTS = {
  authors: 'author', genres: 'genre', tags: 'tag', collections: 'collection',
  status: 'status', formats: 'format', languages: 'lang', missing: 'missing'
} as const;
const SEP = '|'; // names may contain commas, but practically never a pipe

/** Filter → URL query params (only set values). */
export function filterToQuery(f: BookFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (f.q?.trim()) q.q = f.q.trim();
  if (f.loc) q.loc = f.loc;
  for (const [key, param] of Object.entries(LISTS)) {
    const values = f[key as keyof typeof LISTS] as string[] | undefined;
    if (values?.length) q[param] = values.join(SEP);
  }
  if (f.ratingMin) q.rating = String(f.ratingMin);
  if (f.yearFrom) q.from = String(f.yearFrom);
  if (f.yearTo) q.to = String(f.yearTo);
  if (f.lending) q.lent = f.lending;
  if (f.ownership) q.own = f.ownership;
  return q;
}

export function filterFromQuery(q: Record<string, string | undefined>): BookFilter {
  const f: BookFilter = {};
  const int = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  if (q.q) f.q = q.q;
  if (q.loc) f.loc = q.loc;
  for (const [key, param] of Object.entries(LISTS)) {
    const v = q[param];
    if (v) (f as Record<string, unknown>)[key] = v.split(SEP).filter(Boolean);
  }
  f.ratingMin = int(q.rating);
  f.yearFrom = int(q.from);
  f.yearTo = int(q.to);
  if (q.lent === 'lent' || q.lent === 'overdue') f.lending = q.lent;
  if (q.own === 'owned' || q.own === 'wishlist') f.ownership = q.own;
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as BookFilter;
}

export function isEmptyFilter(f: BookFilter): boolean {
  return Object.keys(filterToQuery(f)).length === 0;
}

// ---------------------------------------------------------------- matching

export interface FilterContext {
  locations: Location[];
  today: IsoDate;
}

const anyOf = (wanted: string[] | undefined, have: string[]) => {
  if (!wanted?.length) return true;
  const set = new Set(have.map(fold));
  return wanted.some((w) => set.has(fold(w)));
};

export function applyFilter(books: Book[], f: BookFilter, ctx: FilterContext): Book[] {
  const scope = f.loc && f.loc !== 'none' ? new Set(descendantIds(ctx.locations, f.loc)) : undefined;
  const known = new Set(ctx.locations.map((l) => l.id));
  return books.filter((b) => {
    if (f.loc === 'none' && b.locationId && known.has(b.locationId)) return false;
    if (scope && !(b.locationId && scope.has(b.locationId))) return false;
    if (!anyOf(f.authors, b.authors)) return false;
    if (!anyOf(f.genres, b.genres)) return false;
    if (!anyOf(f.tags, b.tags)) return false;
    if (!anyOf(f.collections, b.collections)) return false;
    if (f.status?.length && !f.status.includes(b.status)) return false;
    if (f.formats?.length && !(b.format && f.formats.includes(b.format))) return false;
    if (f.languages?.length && !(b.language && f.languages.includes(b.language))) return false;
    if (f.ratingMin && (b.rating ?? 0) < f.ratingMin) return false;
    const year = b.publishedYear ?? b.firstPublishedYear;
    if (f.yearFrom && !(year && year >= f.yearFrom)) return false;
    if (f.yearTo && !(year && year <= f.yearTo)) return false;
    if (f.lending === 'lent' && !b.lending) return false;
    if (f.lending === 'overdue' && !isOverdue(b, ctx.today)) return false;
    if (f.ownership && b.ownership !== f.ownership) return false;
    if (f.missing?.includes('cover') && b.cover) return false;
    if (f.missing?.includes('metadata') && !missingMetadata(b)) return false;
    return matchesText(b, f.q ?? '');
  });
}

// ---------------------------------------------------------------- chips

export interface Chip {
  key: FilterKey;
  /** For list filters: the single value this chip removes. */
  value?: string;
  label: string;
}

const STATUS: Record<ReadingStatus, string> = { unread: 'Unread', reading: 'Reading', read: 'Read', abandoned: 'Abandoned' };

export function filterChips(f: BookFilter, locations: Location[]): Chip[] {
  const chips: Chip[] = [];
  if (f.q) chips.push({ key: 'q', label: `“${f.q}”` });
  if (f.loc) chips.push({ key: 'loc', label: f.loc === 'none' ? 'No location' : labelOf(locations, f.loc) });
  const list = (key: FilterKey, values: string[] | undefined, fmt: (v: string) => string = (v) => v) =>
    values?.forEach((value) => chips.push({ key, value, label: fmt(value) }));
  list('authors', f.authors);
  list('genres', f.genres);
  list('tags', f.tags, (v) => `#${v}`);
  list('collections', f.collections, (v) => `▣ ${v}`);
  list('status', f.status, (v) => STATUS[v as ReadingStatus] ?? v);
  list('formats', f.formats);
  list('languages', f.languages, (v) => `Language: ${v}`);
  if (f.ratingMin) chips.push({ key: 'ratingMin', label: `★ ${f.ratingMin}+` });
  if (f.yearFrom || f.yearTo) {
    chips.push({ key: 'yearFrom', label: f.yearFrom && f.yearTo ? `${f.yearFrom}–${f.yearTo}` : f.yearFrom ? `from ${f.yearFrom}` : `until ${f.yearTo}` });
  }
  if (f.lending) chips.push({ key: 'lending', label: f.lending === 'overdue' ? 'Overdue' : 'Lent out' });
  if (f.ownership) chips.push({ key: 'ownership', label: f.ownership === 'wishlist' ? 'Wishlist' : 'Owned' });
  list('missing', f.missing, (v) => (v === 'cover' ? 'Missing cover' : 'Missing details'));
  return chips;
}

export function removeChip(f: BookFilter, chip: Chip): BookFilter {
  const next: BookFilter = { ...f };
  if (chip.key === 'yearFrom') {
    delete next.yearFrom;
    delete next.yearTo;
  } else if (chip.value !== undefined && Array.isArray(f[chip.key])) {
    const rest = (f[chip.key] as string[]).filter((v) => v !== chip.value);
    if (rest.length) (next as Record<string, unknown>)[chip.key] = rest;
    else delete next[chip.key];
  } else {
    delete next[chip.key];
  }
  return next;
}

/** Add a value to a list filter (no duplicates). */
export function addToFilter<K extends keyof typeof LISTS>(f: BookFilter, key: K, value: string): BookFilter {
  const current = (f[key] as string[] | undefined) ?? [];
  return current.includes(value) ? f : { ...f, [key]: [...current, value] };
}

// ---------------------------------------------------------------- grouping

export type GroupBy = 'none' | 'location' | 'author' | 'genre' | 'status';
export const GROUP_LABELS: Record<GroupBy, string> = {
  none: 'No grouping', location: 'Location', author: 'Author', genre: 'Genre', status: 'Status'
};

export interface Group {
  key: string;
  label: string;
  books: Book[];
}

/** Groups keep the incoming (sorted) book order. Books go into the group of their first author/genre. */
export function groupBooks(books: Book[], by: GroupBy, locations: Location[]): Group[] {
  if (by === 'none') return [{ key: 'all', label: '', books }];
  const groups = new Map<string, Group>();
  const put = (key: string, label: string, b: Book) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, label, books: [] }));
    g.books.push(b);
  };
  for (const b of books) {
    if (by === 'location') {
      // Group by room (place › room); shelves fold into their room to keep groups meaningful.
      const path = pathOf(locations, b.locationId).slice(0, 2);
      const last = path[path.length - 1];
      if (last) put(last.id, path.map((l) => l.name).join(' › '), b);
      else put('~none', 'No location', b);
    } else if (by === 'author') {
      put(b.authors[0] ? fold(b.authors[0]) : '~none', b.authors[0] ?? 'Unknown author', b);
    } else if (by === 'genre') {
      put(b.genres[0] ? fold(b.genres[0]) : '~none', b.genres[0] ?? 'No genre', b);
    } else {
      put(b.status, STATUS[b.status], b);
    }
  }
  const order: Record<string, number> = { reading: 0, unread: 1, read: 2, abandoned: 3 };
  return [...groups.values()].sort((a, b) => {
    if (by === 'status') return order[a.key] - order[b.key];
    if (a.key.startsWith('~') !== b.key.startsWith('~')) return a.key.startsWith('~') ? 1 : -1; // "none" last
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });
  });
}

/** Distinct values with counts, e.g. for filter pickers and the tags page. Sorted by name. */
export function facet(books: Book[], pick: (b: Book) => (string | undefined)[]): { value: string; count: number }[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const b of books) {
    for (const v of new Set(pick(b).filter((x): x is string => !!x))) {
      const key = fold(v);
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { value: v, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }));
}

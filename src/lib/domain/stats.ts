import { isOverdue } from './book';
import { facet } from './filters';
import { childrenOf } from './locations';
import type { Book, IsoDate, Location, ReadingStatus } from './types';

export interface Count {
  label: string;
  count: number;
  /** Optional link target (location id, author name…). */
  key?: string;
}

export interface LibraryStats {
  books: number;
  owned: number;
  wishlist: number;
  copies: number;
  pages: number;
  lent: number;
  overdue: number;
  value: number;
  authors: number;
  byStatus: Record<ReadingStatus, number>;
  byPlace: (Count & { rooms: Count[] })[];
  noLocation: number;
  topGenres: Count[];
  topAuthors: Count[];
  /** Books finished per year (by finish date), oldest first, with pages read. */
  readPerYear: { year: number; books: number; pages: number }[];
  /** Books added per year. */
  addedPerYear: { year: number; books: number }[];
  /** Books per decade of first publication. */
  byDecade: Count[];
}

export function computeStats(books: Book[], locations: Location[], today: IsoDate): LibraryStats {
  const owned = books.filter((b) => b.ownership === 'owned');
  const byStatus = { unread: 0, reading: 0, read: 0, abandoned: 0 } satisfies Record<ReadingStatus, number>;
  for (const b of owned) byStatus[b.status]++;

  // Location counts (owned books only; a wishlist book "lives" nowhere).
  const parent = new Map(locations.map((l) => [l.id, l.parentId]));
  const placeOf = (id: string | null) => {
    let cur = id;
    const chain: string[] = [];
    while (cur && parent.has(cur)) {
      chain.unshift(cur);
      cur = parent.get(cur) ?? null;
    }
    return chain;
  };
  const counts = new Map<string, number>();
  let noLocation = 0;
  for (const b of owned) {
    const chain = placeOf(b.locationId);
    if (!chain.length) noLocation++;
    for (const id of chain.slice(0, 2)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const byPlace = childrenOf(locations, null).map((p) => ({
    key: p.id, label: p.name, count: counts.get(p.id) ?? 0,
    rooms: childrenOf(locations, p.id).map((r) => ({ key: r.id, label: r.name, count: counts.get(r.id) ?? 0 }))
  }));

  const top = (pick: (b: Book) => string[], n: number): Count[] =>
    facet(owned, pick).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)).slice(0, n)
      .map(({ value, count }) => ({ label: value, count, key: value }));

  const perYear = new Map<number, { books: number; pages: number }>();
  for (const b of books) {
    if (b.status !== 'read' || !b.finishedOn) continue;
    const y = Number(b.finishedOn.slice(0, 4));
    const e = perYear.get(y) ?? { books: 0, pages: 0 };
    e.books++;
    e.pages += b.pageCount ?? 0;
    perYear.set(y, e);
  }
  const added = new Map<number, number>();
  for (const b of owned) {
    const y = Number(b.createdAt.slice(0, 4));
    added.set(y, (added.get(y) ?? 0) + 1);
  }
  const decades = new Map<number, number>();
  for (const b of owned) {
    const y = b.firstPublishedYear ?? b.publishedYear;
    if (y) decades.set(Math.floor(y / 10) * 10, (decades.get(Math.floor(y / 10) * 10) ?? 0) + 1);
  }

  return {
    books: books.length,
    owned: owned.length,
    wishlist: books.length - owned.length,
    copies: owned.reduce((n, b) => n + (b.copies || 1), 0),
    pages: owned.reduce((n, b) => n + (b.pageCount ?? 0), 0),
    lent: owned.filter((b) => b.lending).length,
    overdue: owned.filter((b) => isOverdue(b, today)).length,
    value: owned.reduce((n, b) => n + (b.price ?? 0), 0),
    authors: facet(owned, (b) => b.authors).length,
    byStatus,
    byPlace,
    noLocation,
    topGenres: top((b) => b.genres, 8),
    topAuthors: top((b) => b.authors, 10),
    readPerYear: [...perYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, v]) => ({ year, ...v })),
    addedPerYear: [...added.entries()].sort((a, b) => a[0] - b[0]).map(([year, n]) => ({ year, books: n })),
    byDecade: [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => ({ label: `${d}s`, count: n, key: String(d) }))
  };
}

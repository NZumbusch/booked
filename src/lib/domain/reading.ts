import { fold } from './query';
import { childrenOf, descendantIds } from './locations';
import type { Book, IsoDate, Location, ReadingStatus } from './types';

/**
 * Dates that follow from a status change, so nobody has to type them:
 * starting a book records the start date, finishing it the finish date.
 */
export function statusPatch(book: Pick<Book, 'status' | 'startedOn' | 'finishedOn' | 'currentPage'>, status: ReadingStatus, today: IsoDate): Partial<Book> {
  const patch: Partial<Book> = { status };
  if (status === 'reading' && !book.startedOn) patch.startedOn = today;
  if (status === 'read') {
    if (!book.finishedOn) patch.finishedOn = today;
    if (!book.startedOn) patch.startedOn = today;
    patch.currentPage = undefined;
  }
  if (status === 'unread') patch.currentPage = undefined;
  return patch;
}

/** Progress update; reaching the last page finishes the book. */
export function progressPatch(book: Pick<Book, 'status' | 'startedOn' | 'finishedOn' | 'pageCount' | 'currentPage'>, page: number, today: IsoDate): Partial<Book> {
  const p = Math.max(0, Math.round(page));
  if (book.pageCount && p >= book.pageCount) return statusPatch(book, 'read', today);
  return { ...(book.status === 'reading' ? {} : statusPatch(book, 'reading', today)), currentPage: p || undefined };
}

export interface ReadingStats {
  year: number;
  readThisYear: number;
  pagesThisYear: number;
  goal?: number;
  /** Books you should have finished by today to be on track. */
  expectedByNow?: number;
  /** Last 12 months, oldest first. */
  perMonth: { month: string; books: number; pages: number }[];
  /** Median days from start to finish (books with both dates). */
  medianDays?: number;
  /** Genres where you abandon most (min. 3 started). */
  abandonByGenre: { genre: string; rate: number; started: number }[];
}

export function readingStats(books: Book[], today: IsoDate, goal?: number): ReadingStats {
  const year = Number(today.slice(0, 4));
  const read = books.filter((b) => b.status === 'read' && b.finishedOn);
  const thisYear = read.filter((b) => b.finishedOn!.startsWith(String(year)));
  const dayOfYear = (Date.parse(today) - Date.UTC(year, 0, 1)) / 86400000 + 1;
  const months: string[] = [];
  const d = new Date(Date.UTC(year, Number(today.slice(5, 7)) - 1, 1));
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(m.toISOString().slice(0, 7));
  }
  const perMonth = months.map((month) => {
    const list = read.filter((b) => b.finishedOn!.startsWith(month));
    return { month, books: list.length, pages: list.reduce((n, b) => n + (b.pageCount ?? 0), 0) };
  });
  const durations = read
    .filter((b) => b.startedOn && b.startedOn <= b.finishedOn!)
    .map((b) => (Date.parse(b.finishedOn!) - Date.parse(b.startedOn!)) / 86400000)
    .sort((a, b) => a - b);
  const started = new Map<string, { genre: string; started: number; abandoned: number }>();
  for (const b of books.filter((x) => x.status === 'read' || x.status === 'abandoned' || x.status === 'reading')) {
    for (const g of b.genres) {
      const e = started.get(fold(g)) ?? { genre: g, started: 0, abandoned: 0 };
      e.started++;
      if (b.status === 'abandoned') e.abandoned++;
      started.set(fold(g), e);
    }
  }
  return {
    year,
    readThisYear: thisYear.length,
    pagesThisYear: thisYear.reduce((n, b) => n + (b.pageCount ?? 0), 0),
    goal,
    expectedByNow: goal ? Math.floor((goal * dayOfYear) / (year % 4 === 0 ? 366 : 365)) : undefined,
    perMonth,
    medianDays: durations.length ? Math.round(durations[Math.floor((durations.length - 1) / 2)]) : undefined,
    abandonByGenre: [...started.values()]
      .filter((e) => e.started >= 3 && e.abandoned > 0)
      .map((e) => ({ genre: e.genre, rate: e.abandoned / e.started, started: e.started }))
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 5)
  };
}

/** How wide the library is: original languages and centuries of writing. */
export function breadth(books: Book[]): { languages: { code: string; count: number }[]; centuries: { century: number; count: number }[] } {
  const langs = new Map<string, number>();
  const cents = new Map<number, number>();
  for (const b of books) {
    const lang = b.originalLanguage ?? b.language;
    if (lang) langs.set(lang, (langs.get(lang) ?? 0) + 1);
    const y = b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
    if (y) cents.set(Math.floor((y - 1) / 100) + 1, (cents.get(Math.floor((y - 1) / 100) + 1) ?? 0) + 1);
  }
  return {
    languages: [...langs.entries()].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count),
    centuries: [...cents.entries()].map(([century, count]) => ({ century, count })).sort((a, b) => a.century - b.century)
  };
}

/** What each room is mostly about: its top topics with their share of the room's books. */
export function roomProfiles(books: Book[], locations: Location[]): { id: string; label: string; total: number; top: { topic: string; share: number }[] }[] {
  const rooms = childrenOf(locations, null).flatMap((p) => childrenOf(locations, p.id).map((r) => ({ r, label: `${p.name} › ${r.name}` })));
  return rooms
    .map(({ r, label }) => {
      const inside = new Set(descendantIds(locations, r.id));
      const here = books.filter((b) => b.locationId && inside.has(b.locationId));
      const counts = new Map<string, { topic: string; n: number }>();
      for (const b of here) {
        for (const t of new Set([...b.genres, ...(b.subjects ?? []).slice(0, 4)])) {
          const e = counts.get(fold(t)) ?? { topic: t, n: 0 };
          e.n++;
          counts.set(fold(t), e);
        }
      }
      const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((e) => ({ topic: e.topic, share: e.n / here.length }));
      return { id: r.id, label, total: here.length, top };
    })
    .filter((x) => x.total >= 3 && x.top.length);
}

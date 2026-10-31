import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { breadth, progressPatch, readingStats, roomProfiles, statusPatch } from './reading';
import type { Location } from './types';

const now = '2026-10-31T10:00:00.000Z';
const mk = (id: string, d: Parameters<typeof createBook>[0]) => createBook(d, { id, now });

describe('status and progress', () => {
  it('fills dates when starting and finishing', () => {
    expect(statusPatch({ status: 'unread' }, 'reading', '2026-10-31')).toEqual({ status: 'reading', startedOn: '2026-10-31' });
    expect(statusPatch({ status: 'reading', startedOn: '2026-10-01', currentPage: 50 }, 'read', '2026-10-31'))
      .toEqual({ status: 'read', finishedOn: '2026-10-31', currentPage: undefined });
    expect(statusPatch({ status: 'read', startedOn: 'a', finishedOn: 'b' }, 'read', 'x')).toEqual({ status: 'read', currentPage: undefined });
  });
  it('starts the book on first progress and finishes it on the last page', () => {
    expect(progressPatch({ status: 'unread', pageCount: 300 }, 40, '2026-10-31')).toEqual({ status: 'reading', startedOn: '2026-10-31', currentPage: 40 });
    expect(progressPatch({ status: 'reading', startedOn: 'x', pageCount: 300 }, 120, 'y')).toEqual({ currentPage: 120 });
    expect(progressPatch({ status: 'reading', startedOn: 'x', pageCount: 300 }, 300, '2026-11-02')).toMatchObject({ status: 'read', finishedOn: '2026-11-02' });
  });
});

describe('readingStats', () => {
  const books = [
    mk('1', { title: 'A', status: 'read', startedOn: '2026-01-01', finishedOn: '2026-01-11', pageCount: 200, genres: ['Novel'] }),
    mk('2', { title: 'B', status: 'read', startedOn: '2026-03-01', finishedOn: '2026-03-31', pageCount: 100, genres: ['Novel'] }),
    mk('3', { title: 'C', status: 'read', finishedOn: '2025-12-20', genres: ['Novel'] }),
    mk('4', { title: 'D', status: 'abandoned', genres: ['Novel'] }),
    mk('5', { title: 'E', status: 'unread', genres: ['Novel'] })
  ];
  const s = readingStats(books, '2026-10-31', 12);
  it('counts this year, pages, goal pace and median duration', () => {
    expect(s).toMatchObject({ year: 2026, readThisYear: 2, pagesThisYear: 300, goal: 12, expectedByNow: 9, medianDays: 10 });
  });
  it('covers the last 12 months', () => {
    expect(s.perMonth).toHaveLength(12);
    expect(s.perMonth[0].month).toBe('2025-11');
    expect(s.perMonth.find((m) => m.month === '2025-12')?.books).toBe(1);
  });
  it('finds genres you tend to abandon', () => {
    expect(s.abandonByGenre).toEqual([{ genre: 'Novel', rate: 0.25, started: 4 }]);
  });
});

describe('breadth and rooms', () => {
  it('counts original languages and centuries', () => {
    const b = breadth([mk('a', { title: 'x', originalLanguage: 'de', language: 'en', firstPublishedYear: 1927 }), mk('b', { title: 'y', language: 'en', publishedYear: 2001 }), mk('c', { title: 'z', language: 'en', firstPublishedYear: 1900 })]);
    expect(b.languages).toEqual([{ code: 'en', count: 2 }, { code: 'de', count: 1 }]);
    expect(b.centuries).toEqual([{ century: 19, count: 1 }, { century: 20, count: 1 }, { century: 21, count: 1 }]);
  });
  it('profiles rooms by their dominant topics', () => {
    const t = now;
    const locs: Location[] = [{ id: 'p', kind: 'place', name: 'Flat', parentId: null, order: 0, createdAt: t, updatedAt: t }, { id: 'r', kind: 'room', name: 'Study', parentId: 'p', order: 0, createdAt: t, updatedAt: t }];
    const books = ['History', 'History', 'Poetry'].map((g, i) => mk(String(i), { title: String(i), genres: [g], locationId: 'r' }));
    expect(roomProfiles(books, locs)).toEqual([{ id: 'r', label: 'Flat › Study', total: 3, top: [{ topic: 'History', share: 2 / 3 }, { topic: 'Poetry', share: 1 / 3 }] }]);
  });
});

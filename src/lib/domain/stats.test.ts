import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { computeStats } from './stats';
import type { Location } from './types';

const now = '2026-10-30T10:00:00.000Z';
const loc = (id: string, kind: Location['kind'], parentId: string | null, name: string): Location =>
  ({ id, kind, name, parentId, order: 0, createdAt: now, updatedAt: now });
const locations = [loc('A', 'place', null, 'Flat A'), loc('L', 'room', 'A', 'Living'), loc('S', 'shelf', 'L', 'Top')];

describe('computeStats', () => {
  const books = [
    createBook({ title: '1', authors: ['X'], genres: ['Novel'], status: 'read', finishedOn: '2025-03-01', pageCount: 100, locationId: 'S', price: 10, firstPublishedYear: 1965 }, { id: '1', now }),
    createBook({ title: '2', authors: ['X', 'Y'], genres: ['Novel', 'SF'], status: 'read', finishedOn: '2026-01-01', pageCount: 200, copies: 2, lending: { to: 'S', lentOn: '2026-01-01', dueOn: '2026-02-01' } }, { id: '2', now }),
    createBook({ title: '3', authors: ['Z'], ownership: 'wishlist' }, { id: '3', now })
  ];
  const s = computeStats(books, locations, '2026-10-30');

  it('counts totals over owned books', () => {
    expect(s).toMatchObject({ books: 3, owned: 2, wishlist: 1, copies: 3, pages: 300, lent: 1, overdue: 1, value: 10, authors: 2 });
    expect(s.byStatus).toEqual({ unread: 0, reading: 0, read: 2, abandoned: 0 });
  });
  it('counts places and rooms including shelves', () => {
    expect(s.byPlace).toEqual([{ key: 'A', label: 'Flat A', count: 1, rooms: [{ key: 'L', label: 'Living', count: 1 }] }]);
    expect(s.noLocation).toBe(1);
  });
  it('ranks authors and genres', () => {
    expect(s.topAuthors[0]).toEqual({ label: 'X', count: 2, key: 'X' });
    expect(s.topGenres.map((g) => g.label)).toEqual(['Novel', 'SF']);
  });
  it('tracks reading per year and decades', () => {
    expect(s.readPerYear).toEqual([{ year: 2025, books: 1, pages: 100 }, { year: 2026, books: 1, pages: 200 }]);
    expect(s.byDecade).toEqual([{ label: '1960s', count: 1, key: '1960' }]);
  });
});

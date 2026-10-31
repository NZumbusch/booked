import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import type { Location } from '../domain/types';
import { parseCsv, toCsv } from './csv';
import { guessMapping, parseDate, parseStatus, rowsToImport } from './import';
import { LIBIB_COLUMNS, libibRows } from './libib';

const now = '2026-10-30T10:00:00.000Z';
const loc = (id: string, kind: Location['kind'], parentId: string | null, name: string): Location =>
  ({ id, kind, name, parentId, order: 0, createdAt: now, updatedAt: now });
const locations = [loc('A', 'place', null, 'Flat A'), loc('L', 'room', 'A', 'Living room')];

describe('Libib export', () => {
  const book = createBook({
    title: 'Dune', authors: ['Frank Herbert', 'Someone Else'], isbn13: '9780441172719', status: 'read', rating: 5,
    tags: ['sf', 'classic'], collections: ['Favourites'], locationId: 'L', pageCount: 535, notes: 'Great, "really"'
  }, { id: '1', now });

  it('starts with Libib columns in Libib order', () => {
    const [header, row] = libibRows([book], locations);
    expect(header.slice(0, LIBIB_COLUMNS.length)).toEqual([...LIBIB_COLUMNS]);
    const v = (col: string) => row[header.indexOf(col)];
    expect(v('creators')).toBe('Frank Herbert, Someone Else');
    expect(v('first_name')).toBe('Frank');
    expect(v('last_name')).toBe('Herbert');
    expect(v('status')).toBe('Completed');
    expect(v('ean_isbn13')).toBe('9780441172719');
    expect(v('upc_isbn10')).toBe('0441172717');
    expect(v('length')).toBe('535');
    expect(v('location')).toBe('Flat A › Living room');
  });

  it('round-trips through CSV import', () => {
    const csv = toCsv(libibRows([book], locations));
    const [header, ...rows] = parseCsv(csv);
    const { items, skipped } = rowsToImport(rows, guessMapping(header));
    expect(skipped).toEqual([]);
    expect(items[0].locationPath).toEqual(['Flat A', 'Living room']);
    expect(items[0].draft).toMatchObject({
      title: 'Dune', authors: ['Frank Herbert', 'Someone Else'], isbn13: '9780441172719', status: 'read', rating: 5,
      tags: ['sf', 'classic'], collections: ['Favourites'], pageCount: 535, notes: 'Great, "really"'
    });
  });
});

describe('CSV import', () => {
  it('maps Goodreads exports', () => {
    const header = ['Book Id', 'Title', 'Author', 'ISBN', 'ISBN13', 'My Rating', 'Date Read', 'Exclusive Shelf', 'Bookshelves'];
    const mapping = guessMapping(header);
    expect(mapping).toEqual(['', 'title', 'authors', 'isbn10', 'isbn13', 'rating', 'finishedOn', 'status', 'tags']);
    // Goodreads puts the ISBN-10 in "ISBN" and ISBN-13 in "ISBN13": both are normalized, so it doesn't matter.
    const { items } = rowsToImport([['1', 'Dune', 'Frank Herbert', '="0441172717"', '="9780441172719"', '0', '2024/05/01', 'read', 'to-read, scifi']], mapping);
    expect(items[0].draft).toMatchObject({ isbn13: '9780441172719', status: 'read', finishedOn: '2024-05-01', tags: ['scifi'] });
    expect(items[0].draft.rating).toBeUndefined();
  });

  it('builds the location from separate place/room columns', () => {
    const { items } = rowsToImport([['X', 'Flat B', 'Kitchen']], ['title', 'place', 'room']);
    expect(items[0].locationPath).toEqual(['Flat B', 'Kitchen']);
  });

  it('skips rows without title or ISBN and keeps ISBN-only rows', () => {
    const { items, skipped } = rowsToImport([['', ''], ['', '9780441172719']], ['title', 'isbn13']);
    expect(skipped).toEqual([{ row: 2, reason: 'no title or ISBN' }]);
    expect(items[0].draft.title).toBe('ISBN 9780441172719');
  });

  it('parses dates and statuses in common spellings', () => {
    expect(parseDate('31.12.2020')).toBe('2020-12-31');
    expect(parseDate('2020/1/5')).toBe('2020-01-05');
    expect(parseDate('soon')).toBeUndefined();
    expect(parseStatus('Not begun')).toBe('unread');
    expect(parseStatus('currently-reading')).toBe('reading');
    expect(parseStatus('DNF')).toBe('abandoned');
  });
});

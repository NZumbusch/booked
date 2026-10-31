import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import {
  addToFilter, applyFilter, facet, filterChips, filterFromQuery, filterToQuery, groupBooks, isEmptyFilter, removeChip,
  type BookFilter
} from './filters';
import type { Location } from './types';

const now = '2026-10-30T10:00:00.000Z';
const t = now;
const loc = (id: string, kind: Location['kind'], parentId: string | null, name: string): Location =>
  ({ id, kind, name, parentId, order: 0, createdAt: t, updatedAt: t });
const locations = [loc('A', 'place', null, 'Flat A'), loc('L', 'room', 'A', 'Living'), loc('S', 'shelf', 'L', 'Top'), loc('B', 'place', null, 'Flat B')];

const books = [
  createBook({ title: 'Dune', authors: ['Frank Herbert'], genres: ['Science fiction'], tags: ['classic'], status: 'read', rating: 5,
    format: 'paperback', language: 'en', publishedYear: 1965, locationId: 'S', cover: 'x', isbn13: '9780441172719' }, { id: '1', now }),
  createBook({ title: 'Steppenwolf', authors: ['Hermann Hesse'], genres: ['Novel'], collections: ['German'], status: 'unread',
    language: 'de', publishedYear: 1927, locationId: 'B', lending: { to: 'Sam', lentOn: '2026-01-01', dueOn: '2026-02-01' } }, { id: '2', now }),
  createBook({ title: 'Wish', authors: ['Frank Herbert'], ownership: 'wishlist', isbn13: '9780306406157' }, { id: '3', now })
];
const ctx = { locations, today: '2026-10-30' };
const ids = (f: BookFilter) => applyFilter(books, f, ctx).map((b) => b.id);

describe('applyFilter', () => {
  it('returns everything for an empty filter', () => expect(ids({})).toEqual(['1', '2', '3']));
  it('filters by location subtree and by no location', () => {
    expect(ids({ loc: 'A' })).toEqual(['1']);
    expect(ids({ loc: 'L' })).toEqual(['1']);
    expect(ids({ loc: 'none' })).toEqual(['3']);
  });
  it('matches list values case-insensitively, OR within a list', () => {
    expect(ids({ authors: ['frank herbert'] })).toEqual(['1', '3']);
    expect(ids({ genres: ['Novel', 'Science fiction'] })).toEqual(['1', '2']);
    expect(ids({ tags: ['classic'] })).toEqual(['1']);
    expect(ids({ collections: ['German'] })).toEqual(['2']);
  });
  it('combines conditions with AND', () => {
    expect(ids({ authors: ['Frank Herbert'], ownership: 'owned' })).toEqual(['1']);
  });
  it('filters status, format, language, rating, years', () => {
    expect(ids({ status: ['unread'] })).toEqual(['2', '3']);
    expect(ids({ formats: ['paperback'] })).toEqual(['1']);
    expect(ids({ languages: ['de'] })).toEqual(['2']);
    expect(ids({ ratingMin: 4 })).toEqual(['1']);
    expect(ids({ yearFrom: 1900, yearTo: 1950 })).toEqual(['2']);
  });
  it('filters lending and missing data', () => {
    expect(ids({ lending: 'lent' })).toEqual(['2']);
    expect(ids({ lending: 'overdue' })).toEqual(['2']);
    expect(ids({ missing: ['cover'] })).toEqual(['2', '3']);
    expect(ids({ missing: ['metadata'] })).toEqual(['2', '3']);
  });
  it('combines with text search', () => expect(ids({ q: 'dune', loc: 'A' })).toEqual(['1']));
});

describe('URL round trip', () => {
  it('encodes and decodes every field', () => {
    const f: BookFilter = {
      q: 'x', loc: 'A', authors: ['A, B', 'C'], genres: ['G'], tags: ['t'], collections: ['c'], status: ['read', 'unread'],
      formats: ['ebook'], languages: ['en'], ratingMin: 3, yearFrom: 1900, yearTo: 2000, lending: 'overdue', ownership: 'wishlist',
      missing: ['cover']
    };
    expect(filterFromQuery(filterToQuery(f))).toEqual(f);
  });
  it('keeps names containing the separator intact', () => {
    const f: BookFilter = { tags: ['sci-fi|fantasy', 'back\\slash', 'plain'] };
    expect(filterFromQuery(filterToQuery(f))).toEqual(f);
  });
  it('ignores junk', () => {
    expect(filterFromQuery({ rating: 'abc', lent: 'maybe', own: 'x', sort: 'title' })).toEqual({});
    expect(isEmptyFilter({ q: '  ' })).toBe(true);
  });
});

describe('chips', () => {
  it('describes and removes single values', () => {
    const f: BookFilter = { loc: 'L', tags: ['a', 'b'], yearFrom: 1900, yearTo: 2000 };
    const chips = filterChips(f, locations);
    expect(chips.map((c) => c.label)).toEqual(['Flat A › Living', '#a', '#b', '1900–2000']);
    expect(removeChip(f, chips[1])).toEqual({ loc: 'L', tags: ['b'], yearFrom: 1900, yearTo: 2000 });
    expect(removeChip(f, chips[3])).toEqual({ loc: 'L', tags: ['a', 'b'] });
    expect(removeChip({ tags: ['a'] }, { key: 'tags', value: 'a', label: '' })).toEqual({});
  });
  it('adds values without duplicates', () => {
    expect(addToFilter({ tags: ['a'] }, 'tags', 'a')).toEqual({ tags: ['a'] });
    expect(addToFilter({}, 'tags', 'a')).toEqual({ tags: ['a'] });
  });
});

describe('groupBooks', () => {
  it('groups by room, folding shelves in, with "No location" last', () => {
    const g = groupBooks(books, 'location', locations);
    expect(g.map((x) => [x.label, x.books.length])).toEqual([['Flat A › Living', 1], ['Flat B', 1], ['No location', 1]]);
  });
  it('groups by status in reading order', () => {
    expect(groupBooks(books, 'status', locations).map((x) => x.label)).toEqual(['Unread', 'Read']);
  });
  it('groups by author and genre', () => {
    expect(groupBooks(books, 'author', locations).map((x) => x.label)).toEqual(['Frank Herbert', 'Hermann Hesse']);
    expect(groupBooks(books, 'genre', locations).map((x) => x.label)).toEqual(['Novel', 'Science fiction', 'No genre']);
  });
});

describe('facet', () => {
  it('counts values case-insensitively', () => {
    expect(facet(books, (b) => b.authors)).toEqual([{ value: 'Frank Herbert', count: 2 }, { value: 'Hermann Hesse', count: 1 }]);
  });
});

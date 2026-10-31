import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { fold, matchesText, sortBooks } from './query';

const now = '2026-10-30T10:00:00.000Z';
const mk = (id: string, d: Parameters<typeof createBook>[0], createdAt = now) => createBook(d, { id, now: createdAt });

const books = [
  mk('1', { title: 'Les Misérables', authors: ['Victor Hugo'], publishedYear: 1862, rating: 4, pageCount: 1400, tags: ['classic'] }),
  mk('2', { title: 'Dune', authors: ['Frank Herbert'], publishedYear: 1965, isbn13: '9780306406157', notes: 'gift from Mum' }),
  mk('3', { title: 'a Clockwork Orange', authors: ['Anthony Burgess'], publishedYear: 1962, rating: 5 }, '2026-10-31T00:00:00.000Z')
];

describe('text search', () => {
  it('folds accents and case', () => {
    expect(fold('Misérables')).toBe('miserables');
  });
  it('matches every token across fields', () => {
    const ids = (q: string) => books.filter((b) => matchesText(b, q)).map((b) => b.id);
    expect(ids('miserables hugo')).toEqual(['1']);
    expect(ids('herbert')).toEqual(['2']);
    expect(ids('978-0306406157')).toEqual(['2']);
    expect(ids('classic')).toEqual(['1']);
    expect(ids('mum')).toEqual(['2']);
    expect(ids('')).toEqual(['1', '2', '3']);
    expect(ids('zzz')).toEqual([]);
    const translated = createBook({ title: 'X', contributors: ['Anna Translator (translator)'], subjects: ['Ecology'] }, { id: 't', now });
    expect(matchesText(translated, 'translator ecology')).toBe(true);
  });
});

describe('sortBooks', () => {
  const ids = (key: Parameters<typeof sortBooks>[1], dir: 'asc' | 'desc' = 'asc') => sortBooks(books, key, dir).map((b) => b.id);
  it('sorts by title ignoring leading articles', () => {
    expect(ids('title')).toEqual(['3', '2', '1']);
  });
  it('sorts by author surname', () => {
    expect(ids('author')).toEqual(['3', '2', '1']);
  });
  it('sorts by numbers with blanks last', () => {
    expect(ids('rating', 'desc')).toEqual(['3', '1', '2']);
    expect(ids('rating', 'asc')).toEqual(['1', '3', '2']);
    expect(ids('year')).toEqual(['1', '3', '2']);
  });
  it('sorts by date added', () => {
    expect(ids('added', 'desc')[0]).toBe('3');
  });
  it('sorts by location label when provided', () => {
    const label = (id: string | null) => ({ a: 'B', b: 'A' })[id as 'a' | 'b'] ?? '';
    const withLoc = [{ ...books[0], locationId: 'a' }, { ...books[1], locationId: 'b' }];
    expect(sortBooks(withLoc, 'location', 'asc', label).map((b) => b.id)).toEqual(['2', '1']);
  });
});

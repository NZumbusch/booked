import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { booksOnTopic, buildIndex, oddOneOut, similarTo, topTopics } from './similar';

const now = '2026-10-31T10:00:00.000Z';
const b = (id: string, d: Parameters<typeof createBook>[0]) => createBook(d, { id, now });
const books = [
  b('steppenwolf', { title: 'Steppenwolf', authors: ['Hermann Hesse'], subjects: ['Identity', 'Psychology'], genres: ['Novel'], firstPublishedYear: 1927 }),
  b('siddhartha', { title: 'Siddhartha', authors: ['Hermann Hesse'], subjects: ['Spirituality', 'Identity'], genres: ['Novel'], firstPublishedYear: 1922 }),
  b('magic', { title: 'Der Zauberberg', authors: ['Thomas Mann'], subjects: ['Identity', 'Illness'], genres: ['Novel'], firstPublishedYear: 1924 }),
  b('dune', { title: 'Dune', authors: ['Frank Herbert'], subjects: ['Ecology', 'Desert'], genres: ['Science fiction'], series: 'Dune', firstPublishedYear: 1965 }),
  b('messiah', { title: 'Dune Messiah', authors: ['Frank Herbert'], subjects: ['Ecology'], genres: ['Science fiction'], series: 'Dune', firstPublishedYear: 1969 }),
  b('cook', { title: 'Kochbuch', authors: ['Anna Koch'], subjects: ['Cooking'], genres: ['Cookbook'] })
];
const index = buildIndex(books);

describe('similarTo', () => {
  it('ranks same author/series and shared rare topics highest, with reasons', () => {
    const m = similarTo('steppenwolf', index);
    expect(m[0]).toMatchObject({ id: 'siddhartha' });
    expect(m[0].reasons).toContain('same author');
    expect(m.map((x) => x.id)).toContain('magic'); // shared topic + era
    expect(m.map((x) => x.id)).not.toContain('cook');
    expect(similarTo('dune', index)[0]).toMatchObject({ id: 'messiah' });
  });
  it('returns nothing for unknown books', () => {
    expect(similarTo('nope', index)).toEqual([]);
  });
});

describe('library-wide', () => {
  it('finds the odd one out', () => {
    expect(oddOneOut(books, index)?.id).toBe('cook');
  });
  it('lists topics and the books on a topic', () => {
    expect(topTopics(books).slice(0, 2)).toEqual([{ name: 'Identity', count: 3 }, { name: 'Novel', count: 3 }]);
    expect(booksOnTopic(books, 'ecology').map((x) => x.id)).toEqual(['dune', 'messiah']);
  });
});

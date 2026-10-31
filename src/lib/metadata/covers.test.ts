import { describe, expect, it } from 'vitest';
import type { Book } from '../domain/types';
import { alternativeCovers } from './covers';
import { fakeFetch } from './testing';

const book = {
  id: 'b1', title: 'Der Steppenwolf', authors: ['Hermann Hesse'], isbn13: '9783518366752', language: 'de',
  identifiers: { olwork: 'OL1W' }, cover: 'https://covers.openlibrary.org/b/id/1-L.jpg?default=false'
} as unknown as Book;

const editions = {
  entries: [
    { covers: [1], publishers: ['Suhrkamp'], publish_date: '1974', languages: [{ key: '/languages/ger' }] }, // the current cover
    { covers: [2], publishers: ['Penguin'], publish_date: '1965', languages: [{ key: '/languages/eng' }] },
    { covers: [-1], publishers: ['No cover'] },
    { covers: [3], publishers: ['Suhrkamp'], publish_date: '2001', languages: [{ key: '/languages/ger' }] },
    { covers: [4], publishers: ['Suhrkamp'], publish_date: '1982', isbn_13: ['9783518366752'] }
  ]
};
const google = {
  items: [
    { id: 'g1', volumeInfo: { title: 'Der Steppenwolf', authors: ['Hermann Hesse'], publisher: 'Fischer', publishedDate: '2012', language: 'de', imageLinks: { thumbnail: 'http://books.google.com/books/content?id=g1&zoom=1' } } },
    { id: 'g2', volumeInfo: { title: 'Siddhartha', imageLinks: { thumbnail: 'http://books.google.com/books/content?id=g2&zoom=1' } } }
  ]
};

describe('alternativeCovers', () => {
  it('lists other editions: this edition first, then the same language, then the rest; no current cover, no blanks', async () => {
    const out = await alternativeCovers(book, fakeFetch({ '/works/OL1W/editions.json': editions, googleapis: google }));
    expect(out.map((o) => o.label)).toEqual(['Suhrkamp · 1982', 'Suhrkamp · 2001 · German', 'Fischer · 2012 · German', 'Penguin · 1965 · English']);
    expect(out[0].sameEdition).toBe(true);
    expect(out[0].url).toBe('https://covers.openlibrary.org/b/id/4-L.jpg?default=false');
    expect(out[0].thumb).toContain('-M.jpg');
  });

  it('only takes Google results for the same title, in a bigger size', async () => {
    const out = await alternativeCovers(book, fakeFetch({ googleapis: google }));
    expect(out).toHaveLength(1);
    expect(out[0].url).toMatch(/^https:.*id=g1.*fife=w800/);
  });

  it('finds the work by title when the book has no Open Library id', async () => {
    const calls: string[] = [];
    const noId = { ...book, identifiers: {} } as Book;
    const out = await alternativeCovers(noId, fakeFetch({
      'search.json': { docs: [{ key: '/works/OL9W', title: 'Steppenwolf' }, { key: '/works/OL1W', title: 'Der Steppenwolf' }] },
      '/works/OL1W/editions.json': editions
    }, calls));
    expect(calls.some((c) => c.includes('/works/OL1W/editions'))).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });

  it('fails only when every source fails', async () => {
    await expect(alternativeCovers(book, fakeFetch({ openlibrary: 500, googleapis: 500 }))).rejects.toThrow();
    await expect(alternativeCovers(book, fakeFetch({ openlibrary: 500 }))).resolves.toEqual([]);
  });
});

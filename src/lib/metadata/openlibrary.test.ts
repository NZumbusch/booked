import { describe, expect, it } from 'vitest';
import edition from './fixtures/ol-edition.json';
import work from './fixtures/ol-work.json';
import author from './fixtures/ol-author.json';
import searchIsbn from './fixtures/ol-search-isbn.json';
import searchTitle from './fixtures/ol-search-title.json';
import { fakeFetch } from './testing';
import { olByIsbn, olSearch, olWork, cleanSubjects } from './openlibrary';

const routes = {
  '/isbn/9780441172719.json': edition,
  '/works/OL893414W.json': work,
  '/authors/OL79034A.json': author,
  'search.json?isbn=9780441172719': searchIsbn
};

describe('Open Library by ISBN', () => {
  it('combines edition, work, search and author records', async () => {
    const r = await olByIsbn('9780441172719', fakeFetch(routes));
    expect(r).toBeDefined();
    const f = r!.result.fields;
    expect(f).toMatchObject({
      title: 'Dune',
      authors: ['Frank Herbert'],
      publisher: 'Ace Books',
      publishedYear: 1987,
      firstPublishedYear: 1965,
      pageCount: 535,
      language: 'en',
      edition: 'Ace ed.',
      series: 'Dune chronicles -- bk. 1',
      cover: 'https://covers.openlibrary.org/b/id/15166231-L.jpg?default=false'
    });
    expect(f.description).toMatch(/^Set on the desert planet Arrakis/);
    expect(f.subjects).toContain('Science fiction');
    expect(f.subjects!.some((s) => s.includes(':'))).toBe(false);
    expect(f.identifiers).toMatchObject({ olid: 'OL22597282M', olwork: 'OL893414W', goodreads: '1022859' });
    expect(r!.result.url).toBe('https://openlibrary.org/books/OL22597282M');
    expect(r!.workId).toBe('OL893414W');
    expect(r!.authorQids).toEqual(['Q7934']);
  });

  it('returns undefined when the ISBN is unknown', async () => {
    expect(await olByIsbn('9780000000002', fakeFetch({}))).toBeUndefined();
  });

  it('still works when only the search index knows the book', async () => {
    const r = await olByIsbn('9780441172719', fakeFetch({ 'search.json?isbn=9780441172719': searchIsbn }));
    expect(r!.result.fields).toMatchObject({ title: 'Dune', authors: ['Frank Herbert'], firstPublishedYear: 1965 });
    expect(r!.result.fields.cover).toBe('https://covers.openlibrary.org/b/id/11481354-L.jpg?default=false');
  });
});

describe('Open Library search', () => {
  it('maps search docs to candidates', async () => {
    const hits = await olSearch('der steppenwolf hesse', fakeFetch({ 'search.json?q=': searchTitle }));
    expect(hits[0]).toMatchObject({
      title: 'Der Steppenwolf', authors: ['Hermann Hesse'], year: 1927, olWorkId: 'OL872773W',
      cover: 'https://covers.openlibrary.org/b/id/3221083-M.jpg?default=false', source: 'openlibrary'
    });
  });

  it('fetches work-level details for a candidate', async () => {
    const r = await olWork('OL893414W', fakeFetch(routes));
    expect(r!.result.fields.description).toMatch(/Arrakis/);
    expect(r!.authorQids).toEqual(['Q7934']);
  });
});

describe('cleanSubjects', () => {
  it('drops machine tags and bestseller noise, keeps order, limits count', () => {
    expect(cleanSubjects(['Fiction', 'nyt:foo=1', 'award:x', 'New York Times bestseller', 'fiction', 'Science fiction',
      'Science-fiction', 'Large type books', 'Hugo Award Winner', 'Long Now Manual for Civilization', 'Ecology']))
      .toEqual(['Fiction', 'Science fiction', 'Ecology']);
  });
});

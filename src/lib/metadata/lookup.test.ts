import { describe, expect, it } from 'vitest';
import edition from './fixtures/ol-edition.json';
import work from './fixtures/ol-work.json';
import author from './fixtures/ol-author.json';
import searchIsbn from './fixtures/ol-search-isbn.json';
import searchTitle from './fixtures/ol-search-title.json';
import gb from './fixtures/gb-isbn.json';
import wdWork from './fixtures/wd-work-dune.json';
import wdAuthor from './fixtures/wd-author-herbert.json';
import type { Fetcher } from './http';
import { lookupIsbn, mergeResults, searchBooks } from './lookup';

/** Image probe for tests: every cover loads. */
const allLoad = async () => true;

function world(overrides: Record<string, unknown> = {}): Fetcher {
  const defaults: Record<string, unknown> = {
    'openlibrary.org/isbn/9780441172719.json': edition,
    'openlibrary.org/works/OL893414W.json': work,
    'openlibrary.org/authors/OL79034A.json': author,
    'search.json?isbn=9780441172719': searchIsbn,
    'search.json?q=': searchTitle,
    'googleapis.com/books/v1/volumes?q=isbn:9780441172719': gb
  };
  // Overrides are matched first so a broad key ("googleapis.com") can shadow specific defaults.
  const routes: Record<string, unknown> = { ...overrides };
  for (const [k, v] of Object.entries(defaults)) if (!(k in routes)) routes[k] = v;
  return async (url) => {
    if (url.includes('query.wikidata.org')) {
      if (routes.wikidata === 'down') return new Response('', { status: 503 });
      const q = decodeURIComponent(url.split('query=')[1]);
      return new Response(JSON.stringify(q.includes('wdt:P19') ? wdAuthor : wdWork));
    }
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key && routes[key];
    if (body === 'offline') throw new TypeError('Failed to fetch');
    if (typeof body === 'number') return new Response('', { status: body });
    if (!body) return new Response('', { status: 404 });
    return new Response(JSON.stringify(body));
  };
}

describe('lookupIsbn', () => {
  it('merges Open Library, Google Books and Wikidata, keeping provenance', async () => {
    const r = await lookupIsbn('978-0-441-17271-9', world(), allLoad);
    expect(r.status).toBe('found');
    const d = r.draft;
    expect(d).toMatchObject({
      title: 'Dune',
      authors: ['Frank Herbert'],
      isbn13: '9780441172719',
      isbn10: '0441172717',
      publisher: 'Ace Books', // edition-specific data from Open Library wins
      publishedYear: 1987,
      firstPublishedYear: 1965,
      language: 'en',
      sources: ['openlibrary', 'googlebooks', 'wikidata']
    });
    expect(d.genres).toEqual(expect.arrayContaining(['Fiction', 'Science Fiction', 'planetary romance']));
    expect(d.identifiers).toMatchObject({ olid: 'OL22597282M', gbid: 'B1hSG45JCX4C', wikidata: 'Q190192' });
    expect(d.writing?.place?.label).toBe('Tacoma');
    expect(d.provenance?.title).toEqual({ source: 'openlibrary', url: 'https://openlibrary.org/books/OL22597282M' });
    expect(d.provenance?.genres?.source).toBe('googlebooks');
    expect(d.provenance?.writing?.note).toMatch(/Birthplace/);
  });

  it('falls back to the Google cover when Open Library has none', async () => {
    const probe = async (url: string) => !url.includes('openlibrary');
    const r = await lookupIsbn('9780441172719', world(), probe);
    expect(r.draft.cover).toMatch(/books\.google\.com/);
    expect(r.draft.provenance?.cover?.source).toBe('googlebooks');
  });

  it('leaves the cover empty when no image loads', async () => {
    const r = await lookupIsbn('9780441172719', world(), async () => false);
    expect(r.draft.cover).toBeUndefined();
  });

  it('works when Google Books is over quota', async () => {
    const r = await lookupIsbn('9780441172719', world({ 'googleapis.com': 429 }), allLoad);
    expect(r.status).toBe('found');
    expect(r.draft.sources).toEqual(['openlibrary', 'wikidata']);
    expect(r.warnings).toEqual(['Google Books: HTTP 429']);
  });

  it('works when Wikidata is down', async () => {
    const r = await lookupIsbn('9780441172719', world({ wikidata: 'down' }), allLoad);
    expect(r.status).toBe('found');
    expect(r.draft.writing).toBeUndefined();
  });

  it('reports not found with the ISBN prefilled', async () => {
    const r = await lookupIsbn('9780306406157', world(), allLoad);
    expect(r).toMatchObject({ status: 'notfound', draft: { isbn13: '9780306406157', isbn10: '0306406152' } });
  });

  it('reports offline separately from not found', async () => {
    const r = await lookupIsbn('9780441172719', world({ 'openlibrary.org': 'offline', 'googleapis.com': 'offline' }), allLoad);
    expect(r.status).toBe('error');
    expect(r.draft.isbn13).toBe('9780441172719');
  });

  it('rejects invalid ISBNs', async () => {
    await expect(lookupIsbn('123', world(), allLoad)).rejects.toThrow(/ISBN/);
  });
});

describe('mergeResults', () => {
  it('takes the first non-empty value per field and unions genres', () => {
    const d = mergeResults([
      { source: 'openlibrary', fields: { title: 'A', genres: [], pageCount: undefined } },
      { source: 'googlebooks', fields: { title: 'B', pageCount: 10, genres: ['X'] } },
      { source: 'wikidata', fields: { genres: ['x', 'Y'], firstPublishedYear: 1900 } }
    ]);
    expect(d).toMatchObject({ title: 'A', pageCount: 10, genres: ['X', 'Y'], firstPublishedYear: 1900 });
    expect(d.provenance?.pageCount?.source).toBe('googlebooks');
  });

  it('prefers Wikidata for the first publication year', () => {
    const d = mergeResults([
      { source: 'openlibrary', fields: { firstPublishedYear: 1966 } },
      { source: 'wikidata', fields: { firstPublishedYear: 1965 } }
    ]);
    expect(d.firstPublishedYear).toBe(1965);
  });
});

describe('searchBooks', () => {
  it('searches Open Library', async () => {
    const hits = await searchBooks('steppenwolf', world());
    expect(hits[0].title).toBe('Der Steppenwolf');
  });

  it('falls back to Google Books', async () => {
    const hits = await searchBooks('dune', world({ 'search.json?q=': 'offline', 'volumes?q=dune': gb }));
    expect(hits[0]).toMatchObject({ title: 'Dune', source: 'googlebooks' });
  });
});

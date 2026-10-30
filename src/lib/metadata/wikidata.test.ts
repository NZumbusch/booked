import { describe, expect, it } from 'vitest';
import workDune from './fixtures/wd-work-dune.json';
import workSteppenwolf from './fixtures/wd-work-steppenwolf.json';
import authorHerbert from './fixtures/wd-author-herbert.json';
import authorHesse from './fixtures/wd-author-hesse.json';
import type { Fetcher } from './http';
import { authorQuery, parsePoint, wdEnrich, workQuery } from './wikidata';

/** Answers SPARQL requests: author queries (birthplace) vs. work queries. */
function sparqlFetch(work: unknown, author: unknown): Fetcher {
  return async (url) => {
    const query = decodeURIComponent(url.split('query=')[1]);
    const body = query.includes('wdt:P19') ? author : work;
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

const empty = { results: { bindings: [] } };

describe('Wikidata queries', () => {
  it('builds a work query by Open Library id and/or author + title', () => {
    const q = workQuery('OL872773W', ['Q25973'], 'Der Steppenwolf')!;
    expect(q).toContain('wdt:P648 "OL872773W"');
    expect(q).toContain('"Der Steppenwolf"@de');
    expect(q).toContain('UNION');
    expect(workQuery(undefined, [], 'X')).toBeUndefined();
  });

  it('refuses injected ids', () => {
    expect(workQuery('OL1W"} DROP', ['Q1 }'], undefined)).toBeUndefined();
    expect(authorQuery(['wd:Q1'])).toBeUndefined();
  });

  it('escapes titles', () => {
    expect(workQuery(undefined, ['Q1'], 'He said "hi"')).toContain('"He said \\"hi\\""@en');
  });

  it('parses WKT points', () => {
    expect(parsePoint('Point(8.7375 48.714444444)', 'Calw')).toEqual({ lon: 8.7375, lat: 48.714444444, label: 'Calw' });
    expect(parsePoint(undefined)).toBeUndefined();
  });
});

describe('wdEnrich', () => {
  it('Dune: publication country only → uses the author’s home town instead, with an honest note', async () => {
    const r = (await wdEnrich({ authorQids: ['Q7934'], title: 'Dune' }, sparqlFetch(workDune, authorHerbert)))!;
    expect(r.fields.identifiers).toEqual({ wikidata: 'Q190192' });
    expect(r.fields.firstPublishedYear).toBe(1965);
    expect(r.fields.writing).toMatchObject({ placeBasis: 'author', place: { label: 'Tacoma', lat: 47.2525, lon: -122.4475 } });
    expect(r.provenance!.writing).toMatchObject({ source: 'wikidata', url: 'https://www.wikidata.org/wiki/Q7934' });
    expect(r.provenance!.writing.note).toMatch(/Birthplace of Frank Herbert/);
    expect(r.fields.genres).toContain('science fiction');
    expect(r.fields.genres).not.toContain('action film');
  });

  it('Steppenwolf: writing year from inception, original language', async () => {
    const r = (await wdEnrich({ olWorkId: 'OL872773W', authorQids: ['Q25973'] }, sparqlFetch(workSteppenwolf, authorHesse)))!;
    expect(r.fields).toMatchObject({ firstPublishedYear: 1927, originalLanguage: 'de', identifiers: { wikidata: 'Q217073' } });
    expect(r.fields.writing).toMatchObject({ year: 1920, placeBasis: 'author', place: { label: 'Calw' } });
  });

  it('prefers the location of creation when recorded', async () => {
    const work = { results: { bindings: [{
      work: { value: 'http://www.wikidata.org/entity/Q1' }, sitelinks: { value: '3' },
      creationPlace: { value: 'http://www.wikidata.org/entity/Q90' }, creationPlaceLabel: { value: 'Paris' },
      creationCoord: { value: 'Point(2.35 48.85)' },
      pubPlace: { value: 'http://www.wikidata.org/entity/Q64' }, pubPlaceLabel: { value: 'Berlin' },
      pubCoord: { value: 'Point(13.4 52.5)' }, pubIsCountry: { value: 'false' }
    }] } };
    const r = (await wdEnrich({ authorQids: ['Q2'], title: 'X' }, sparqlFetch(work, authorHesse)))!;
    expect(r.fields.writing).toMatchObject({ placeBasis: 'written', place: { label: 'Paris' } });
    expect(r.provenance!.writing.note).toMatch(/location of creation/);
  });

  it('uses a publication city over the author’s birthplace', async () => {
    const work = { results: { bindings: [{
      work: { value: 'http://www.wikidata.org/entity/Q1' },
      pubPlace: { value: 'http://www.wikidata.org/entity/Q64' }, pubPlaceLabel: { value: 'Berlin' },
      pubCoord: { value: 'Point(13.4 52.5)' }, pubIsCountry: { value: 'false' }
    }] } };
    const r = (await wdEnrich({ authorQids: ['Q2'], title: 'X' }, sparqlFetch(work, authorHesse)))!;
    expect(r.fields.writing).toMatchObject({ placeBasis: 'published', place: { label: 'Berlin' } });
  });

  it('returns undefined when nothing is known', async () => {
    expect(await wdEnrich({ authorQids: ['Q1'], title: 'Nope' }, sparqlFetch(empty, empty))).toBeUndefined();
    expect(await wdEnrich({ authorQids: [] }, sparqlFetch(empty, empty))).toBeUndefined();
  });
});

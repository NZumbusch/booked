import { describe, expect, it } from 'vitest';
import works from './fixtures/wd-k-works.json';
import series from './fixtures/wd-k-series.json';
import authors from './fixtures/wd-k-authors.json';
import byName from './fixtures/wd-k-byname.json';
import hesseDe from './fixtures/wp-de-hesse.json';
import type { Fetcher } from './http';
import { bioLanguage, fetchWorks, findAuthorId, parseAuthors, parseSeries, parseWorks, wikipediaSummary, worksQuery } from './knowledge';

type Rows = Parameters<typeof parseWorks>[0];

describe('works', () => {
  const w = parseWorks(works.results.bindings as Rows);
  it('reads series with position, settings with coordinates, sources, subjects, movements', () => {
    expect(w.get('Q190192')?.series).toEqual([{ id: 'Q6095696', label: 'Der Wüstenplanet', position: '1' }]);
    expect(w.get('Q6511')?.basedOn).toEqual([{ id: 'Q35160', label: 'Odyssee' }]);
    const dublin = w.get('Q6511')?.settings.find((s) => s.label === 'Dublin');
    expect(dublin?.point).toEqual({ lat: 53.349722222, lon: -6.260277777, label: 'Dublin' });
    expect(w.get('Q190192')?.settings.find((s) => s.label === 'Arrakis')?.point).toBeUndefined(); // fictional place
    expect(w.get('Q217073')?.movements.map((m) => m.label)).toEqual(['existentialism']);
    expect(w.get('Q190192')?.subjects.map((s) => s.label)).toContain('Ökologie');
    expect(w.get('Q190192')?.awards.map((a) => a.label)).toContain('Hugo Award for Best Novel');
    expect(w.get('Q190192')?.authors).toEqual([{ id: 'Q7934', label: 'Frank Herbert' }]);
  });
  it('refuses invalid ids in queries', () => {
    expect(worksQuery(['Q1', 'x } DROP'])).toContain('wd:Q1 }');
    expect(worksQuery(['Q1', 'x } DROP'])).not.toContain('DROP');
  });
});

describe('series', () => {
  it('lists the volumes in order', () => {
    const s = parseSeries(series.results.bindings as Rows)!;
    expect(s.slice(0, 3).map((x) => [x.position, x.label])).toEqual([['1', 'Der Wüstenplanet'], ['2', 'Dune Messiah'], ['3', 'Children of Dune']]);
    expect(s.at(-1)?.position).toBeUndefined();
  });

  it('attaches the series volumes to each work when fetching', async () => {
    const f: Fetcher = async (url) => {
      const q = decodeURIComponent(url.split('query=')[1]);
      return new Response(JSON.stringify(q.includes('?series ?work') ? series : works));
    };
    const res = await fetchWorks(['Q190192', 'Q999'], f);
    expect(res.get('Q190192')?.seriesWorks?.length).toBe(7);
    expect(res.get('Q999')).toMatchObject({ id: 'Q999', series: [] }); // unknown: cached as empty
  });
});

describe('authors', () => {
  const a = parseAuthors(authors.results.bindings as Rows);
  it('reads life, languages, influences and Wikipedia titles', () => {
    const hesse = a.get('Q25973')!;
    expect(hesse).toMatchObject({ label: 'Hermann Hesse', born: '1877-07-02', died: '1962-08-09', languages: ['de'] });
    expect(hesse.wikipedia).toEqual({ de: 'Hermann_Hesse', en: 'Hermann_Hesse' });
    expect(hesse.influencedBy.map((x) => x.label)).toContain('Pietismus');
    expect(new Set(hesse.influenced.map((x) => x.id)).size).toBe(hesse.influenced.length); // no duplicates
    expect(a.get('Q7934')?.languages).toEqual(['en']);
  });

  it('picks the bio language: own if de/en, else German, else English', () => {
    expect(bioLanguage({ languages: ['de'], wikipedia: { de: 'x', en: 'y' } })).toBe('de');
    expect(bioLanguage({ languages: ['en'], wikipedia: { de: 'x', en: 'y' } })).toBe('en');
    expect(bioLanguage({ languages: ['ru'], wikipedia: { de: 'x', en: 'y' } })).toBe('de');
    expect(bioLanguage({ languages: ['ru'], wikipedia: { en: 'y' } })).toBe('en');
    expect(bioLanguage({ languages: ['en'], wikipedia: { de: 'x' } })).toBe('de');
    expect(bioLanguage({ languages: [], wikipedia: {} })).toBeUndefined();
  });

  it('finds an author by name', async () => {
    expect(await findAuthorId('Hermann Hesse', async () => new Response(JSON.stringify(byName)))).toBe('Q25973');
  });

  it('fetches a Wikipedia summary', async () => {
    const calls: string[] = [];
    const s = await wikipediaSummary('de', 'Hermann Hesse', async (url) => { calls.push(url); return new Response(JSON.stringify(hesseDe)); });
    expect(calls[0]).toBe('https://de.wikipedia.org/api/rest_v1/page/summary/Hermann_Hesse');
    expect(s).toMatchObject({ title: 'Hermann Hesse', lang: 'de' });
    expect(s?.extract).toMatch(/Schriftsteller/);
    expect(s?.thumbnail).toMatch(/upload\.wikimedia\.org/);
  });
});

describe('influences: people vs ideas', () => {
  it('marks which influences are people', () => {
    const a = parseAuthors(authors.results.bindings as Rows).get('Q25973')!;
    expect(a.influencedBy.find((i) => i.label === 'Pietismus')?.person).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import worksFixture from '../metadata/fixtures/wd-k-works.json';
import seriesFixture from '../metadata/fixtures/wd-k-series.json';
import authorsFixture from '../metadata/fixtures/wd-k-authors.json';
import { parseAuthors, parseSeries, parseWorks, type WorkKnowledge } from '../metadata/knowledge';
import { createBook } from './book';
import { connectionsOf, influences, seriesStatus, sharedGroups } from './connections';

type Rows = Parameters<typeof parseWorks>[0];
const now = '2026-10-31T10:00:00.000Z';
const b = (id: string, title: string, wikidata?: string) => createBook({ title, identifiers: wikidata ? { wikidata } : undefined }, { id, now });

const works = parseWorks(worksFixture.results.bindings as Rows);
works.get('Q190192')!.seriesWorks = parseSeries(seriesFixture.results.bindings as Rows);
const authors = parseAuthors(authorsFixture.results.bindings as Rows);

describe('connections', () => {
  const dune = b('1', 'Dune', 'Q190192');
  const messiah = b('2', 'Dune Messiah');
  const dune2 = b('3', 'Dune (second copy)', 'Q190192');
  const ulysses = b('4', 'Ulysses', 'Q6511');
  const odyssey = b('5', 'Odyssee', 'Q35160');
  const library = [dune, messiah, dune2, ulysses, odyssey];

  it('finds series progress, matching owned volumes by id or title', () => {
    const [s] = seriesStatus(library, works);
    expect(s.label).toBe('Der Wüstenplanet');
    expect(s.volumes.map((v) => [v.position, !!v.owned])).toEqual([
      ['1', true], ['2', true], ['3', false], ['4', false], ['5', false], ['6', false]
    ]);
    expect(s.missing).toBe(4);
  });

  it('groups books sharing something, counting copies of a work once', () => {
    // A synthetic second Dublin novel shares the setting with Ulysses.
    const dubliners = b('6', 'Dubliners', 'Q1000');
    const w = new Map(works);
    w.set('Q1000', { id: 'Q1000', series: [], basedOn: [], subjects: [], settings: [{ id: 'Q1761', label: 'Dublin' }], awards: [], movements: [], authors: [] } as WorkKnowledge);
    const groups = sharedGroups([...library, dubliners], w);
    expect(groups.map((g) => [g.kind, g.label, g.books.map((x) => x.title)])).toEqual([['setting', 'Dublin', ['Ulysses', 'Dubliners']]]);
    expect(connectionsOf(dubliners, [...library, dubliners], w)[0].others.map((x) => x.title)).toEqual(['Ulysses']);
  });

  it('lists influences on your authors', () => {
    const inf = influences(works, authors, library);
    expect(inf.filter((i) => i.author.label === 'Frank Herbert').length).toBeGreaterThanOrEqual(0);
    expect(inf.every((i) => i.byOwned === false)).toBe(true);
  });
});

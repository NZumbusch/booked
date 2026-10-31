import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import works from '../metadata/fixtures/wd-k-works.json';
import series from '../metadata/fixtures/wd-k-series.json';
import authors from '../metadata/fixtures/wd-k-authors.json';
import { DexieRepository } from '../storage/dexie-repository';
import { KnowledgeStore } from './knowledge';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;
let calls: string[];
beforeEach(async () => {
  repo = new DexieRepository(`kn-${n++}`);
  lib = await Library.open(repo);
  calls = [];
  vi.stubGlobal('fetch', async (url: string) => {
    const q = decodeURIComponent(url.split('query=')[1] ?? '');
    calls.push(q.includes('?series ?work') ? 'series' : q.includes('?a ?aLabel') ? 'authors' : 'works');
    return new Response(JSON.stringify(q.includes('?series ?work') ? series : q.includes('?a ?aLabel') ? authors : works));
  });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await repo.destroy();
});

describe('KnowledgeStore', () => {
  it('fetches works, series and authors once, then serves from the device cache', async () => {
    await lib.addBook({ title: 'Dune', identifiers: { wikidata: 'Q190192' } });
    await lib.addBook({ title: 'Steppenwolf', identifiers: { wikidata: 'Q217073' } });
    await lib.addBook({ title: 'No id' });
    const k = new KnowledgeStore(lib);
    await k.refresh();
    expect(calls).toEqual(['works', 'series', 'authors']);
    const s = get(k.state);
    expect(s.works.get('Q190192')?.seriesWorks?.length).toBe(7);
    expect(s.authors.get('Q25973')?.label).toBe('Hermann Hesse');
    expect(s.coverage).toEqual({ known: 2, total: 3 });

    await k.refresh();
    expect(calls).toHaveLength(3); // nothing new

    const reopened = new KnowledgeStore(lib); // e.g. after an app restart
    await reopened.refresh();
    expect(calls).toHaveLength(3);
    expect(get(reopened.state).works.size).toBeGreaterThan(0);
  });
});

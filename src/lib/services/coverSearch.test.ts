import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import bloch from '../metadata/fixtures/dnb-bloch-stw554.xml?raw';
import { DexieRepository } from '../storage/dexie-repository';
import { booksWithoutSeries, fillMissingSeries } from './coverSearch';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;
beforeEach(async () => {
  repo = new DexieRepository(`coversearch-${n++}`);
  lib = await Library.open(repo);
});
afterEach(() => repo.destroy());

const opts = (fetcher: typeof fetch, checked = new Set<string>()) =>
  ({ context: {} as never, fetcher, seriesChecked: checked });

describe('fillMissingSeries', () => {
  it('reads the series from the catalogue for books that have none, once', async () => {
    const a = await lib.addBook({ title: 'Das Prinzip Hoffnung', isbn13: '9783518281543' });
    const b = await lib.addBook({ title: 'Mine', isbn13: '9780306406157', series: 'Own series' });
    const c = await lib.addBook({ title: 'No ISBN' });
    let calls = 0;
    const checked = new Set<string>();
    const f = (async () => {
      calls++;
      return new Response(bloch);
    }) as typeof fetch;
    expect(booksWithoutSeries(lib.state.books).map((x) => x.id)).toEqual([a.id]);

    const found = await fillMissingSeries(lib, opts(f, checked), () => {});
    expect(found).toBe(1);
    expect(lib.book(a.id)).toMatchObject({ series: 'Suhrkamp-Taschenbuch Wissenschaft', seriesNumber: '554' });
    expect(lib.book(b.id)?.series).toBe('Own series');
    expect(lib.book(c.id)?.series).toBeUndefined();
    expect(calls).toBe(1);

    await fillMissingSeries(lib, opts(f, checked), () => {});
    expect(calls).toBe(1); // already answered: not asked again
  });

  it('leaves a book without a catalogue record alone', async () => {
    const a = await lib.addBook({ title: 'Obscure', isbn13: '9780306406157' });
    const none = (async () => new Response('<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>')) as typeof fetch;
    expect(await fillMissingSeries(lib, opts(none), () => {})).toBe(0);
    expect(lib.book(a.id)?.series).toBeUndefined();
  });
});

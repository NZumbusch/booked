import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';
import { CoverCache, type Processor } from './cache';
import type { ConnectionInfo } from './policy';

let repo: DexieRepository;
let lib: Library;
let n = 0;
let calls: { url: string; size: string; shrink: boolean }[];
let conn: ConnectionInfo | undefined;
let fail = new Set<string>();

/** Fake processor: source images are 600px tall; "stores" a buffer of size px/10 bytes. */
const processor: Processor = async ({ url, size, stored }) => {
  calls.push({ url, size, shrink: !!stored });
  if (fail.has(url)) throw new Error('404');
  const target = { small: 360, medium: 540, large: 900, xl: 1350 }[size];
  const px = Math.min(600, target);
  return {
    data: new ArrayBuffer(px), type: 'image/jpeg', w: Math.round(px * 0.66), h: px, sourcePx: 600,
    analysis: { color: [200, 40, 30], hue: 4, saturation: 0.7, lightness: 0.45, palette: [], contrast: 0.3 }
  };
};

let cache: CoverCache;
beforeEach(async () => {
  repo = new DexieRepository(`cc-${n}`);
  lib = await Library.open(repo);
  calls = [];
  conn = { type: 'wifi' };
  fail = new Set();
  cache = new CoverCache(lib, processor, () => conn, `covers-${n++}`);
});
afterEach(async () => {
  await cache.destroy();
  await repo.destroy();
});

const add = (cover: string) => lib.addBook({ title: cover, cover });

describe('CoverCache', () => {
  it('downloads each cover once on Wi-Fi, newest first, and reports progress', async () => {
    await add('https://c/a.jpg');
    await add('https://c/b.jpg');
    await lib.addBook({ title: 'no cover' });
    await cache.run();
    expect(calls.map((c) => c.url).sort()).toEqual(['https://c/a.jpg', 'https://c/b.jpg']);
    cache.publish();
    expect(get(cache.status)).toMatchObject({ total: 2, cached: 2, current: 2, bytes: 1080, decision: 'yes' });
    expect(cache.meta('https://c/a.jpg')).toMatchObject({ px: 540, nice: true, analysis: { hue: 4 } });
    await cache.run();
    expect(calls).toHaveLength(2); // nothing new
  });

  it('waits for Wi-Fi by default, and asks when the device can’t tell', async () => {
    await add('https://c/a.jpg');
    conn = { type: 'cellular' };
    await cache.run();
    expect(calls).toHaveLength(0);
    conn = undefined; // iPhone: unknown
    await cache.run();
    expect(calls).toHaveLength(0);
    cache.publish();
    expect(get(cache.status).decision).toBe('ask');
    await cache.run(true); // user tapped "Download now"
    expect(calls).toHaveLength(1);
  });

  it('never downloads when off or on data saver, even when asked', async () => {
    await add('https://c/a.jpg');
    await lib.updateSettings({ covers: { mode: 'off' } });
    await cache.run(true);
    conn = { type: 'wifi', saveData: true };
    await lib.updateSettings({ covers: { mode: 'any' } });
    await cache.run(true);
    expect(calls).toHaveLength(0);
  });

  it('upgrades when a bigger size is chosen (if the source has more), shrinks locally when smaller', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    await lib.updateSettings({ covers: { size: 'large' } });
    await cache.run();
    expect(calls.at(-1)).toMatchObject({ size: 'large', shrink: false });
    expect(cache.meta('https://c/a.jpg')?.px).toBe(600); // the source only has 600px: no upscaling
    await cache.run();
    expect(calls).toHaveLength(2); // and no endless re-downloads
    await lib.updateSettings({ covers: { size: 'small' } });
    await cache.run();
    expect(calls.at(-1)).toMatchObject({ size: 'small', shrink: true });
    expect(cache.meta('https://c/a.jpg')?.px).toBe(360);
  });

  it('remembers failures and retries only after a day', async () => {
    await add('https://c/broken.jpg');
    fail.add('https://c/broken.jpg');
    await cache.run();
    await cache.run();
    expect(calls).toHaveLength(1);
    cache.publish();
    expect(get(cache.status).failed).toBe(1);
  });

  it('clears everything', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    await cache.clear();
    expect(cache.meta('https://c/a.jpg')).toBeUndefined();
  });
});

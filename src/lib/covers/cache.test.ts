import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';
import { CoverCache, HttpError, type Processor } from './cache';
import type { ConnectionInfo } from './policy';

let repo: DexieRepository;
let lib: Library;
let n = 0;
let calls: { url: string; size: string; shrink: boolean; want: string }[];
let conn: ConnectionInfo | undefined;
let fail = new Set<string>();
let gone = new Set<string>(); // 404s
let gate: Promise<void> | undefined;

/** Fake processor: source images are 600px tall; "stores" a buffer of size px/10 bytes. */
const processor: Processor = async ({ url, size, stored, want }) => {
  calls.push({ url, size, shrink: !!stored, want });
  if (url.includes('slow') && gate) await gate;
  if (gone.has(url)) throw new HttpError(404);
  if (fail.has(url)) throw new Error('rate limited');
  const target = { small: 360, medium: 540, large: 900, xl: 1350 }[size];
  const px = Math.min(600, target);
  const thumb = { data: new ArrayBuffer(100), type: 'image/jpeg', w: 66, h: 100 };
  return {
    thumb,
    full: want === 'full' ? { data: new ArrayBuffer(px), type: 'image/jpeg', w: Math.round(px * 0.66), h: px } : undefined,
    sourcePx: 600,
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
  gone = new Set();
  gate = undefined;
  await lib.updateSettings({ covers: { full: 'all' } }); // the large image for every book (the default)
  cache = new CoverCache(lib, processor, () => conn, `covers-${n++}`);
});
afterEach(async () => {
  vi.useRealTimers();
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
    expect(get(cache.status)).toMatchObject({ total: 2, cached: 2, current: 2, bytes: 1280, decision: 'yes' });
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

  it('downloads on mobile data once the user confirms it, but never when off', async () => {
    await add('https://c/a.jpg');
    conn = { type: 'cellular' };
    await cache.run(true);
    expect(calls).toHaveLength(0);
    await lib.updateSettings({ covers: { full: 'all', mode: 'off' } });
    await cache.run('mobile');
    expect(calls).toHaveLength(0);
    await lib.updateSettings({ covers: { full: 'all', mode: 'wifi' } });
    await cache.run('mobile');
    expect(calls).toHaveLength(1);
  });

  it('never downloads when off or on data saver, even when asked', async () => {
    await add('https://c/a.jpg');
    await lib.updateSettings({ covers: { full: 'all', mode: 'off' } });
    await cache.run(true);
    conn = { type: 'wifi', saveData: true };
    await lib.updateSettings({ covers: { full: 'all', mode: 'any' } });
    await cache.run(true);
    expect(calls).toHaveLength(0);
  });

  it('upgrades when a bigger size is chosen (if the source has more), shrinks locally when smaller', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    await lib.updateSettings({ covers: { full: 'all', size: 'large' } });
    await cache.run();
    expect(calls.at(-1)).toMatchObject({ size: 'large', shrink: false });
    expect(cache.meta('https://c/a.jpg')?.px).toBe(600); // the source only has 600px: no upscaling
    await cache.run();
    expect(calls).toHaveLength(2); // and no endless re-downloads
    await lib.updateSettings({ covers: { full: 'all', size: 'small' } });
    await cache.run();
    expect(calls.at(-1)).toMatchObject({ size: 'small', shrink: true });
    expect(cache.meta('https://c/a.jpg')?.px).toBe(360);
  });

  it('remembers failures: a hiccup is retried after a minute, a missing image (404) only after a day', async () => {
    await add('https://c/broken.jpg');
    fail.add('https://c/broken.jpg');
    await cache.run();
    await cache.run();
    expect(calls).toHaveLength(1);
    cache.publish();
    expect(get(cache.status).failed).toBe(1);
    // a transient failure (rate limit, no connection) is tried again soon
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 60_000 });
    await cache.run();
    expect(calls).toHaveLength(2);
    vi.useRealTimers();
  });

  it('does not retry a missing image (404) the same day', async () => {
    await add('https://c/gone.jpg');
    gone.add('https://c/gone.jpg');
    await cache.run();
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 2 * 3600_000 });
    await cache.run();
    expect(calls).toHaveLength(1);
    vi.setSystemTime(Date.now() + 25 * 3600_000);
    await cache.run();
    expect(calls).toHaveLength(2);
  });

  it('picks up a cover that appears while a run is going, instead of waiting for the next change', async () => {
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));
    await add('https://c/slow.jpg');
    const first = cache.run();
    await vi.waitFor(() => expect(calls.some((c) => c.url.includes('slow'))).toBe(true));
    await add('https://c/late.jpg');
    cache.run(); // the library changed mid-run
    release();
    await first;
    expect(calls.map((c) => c.url).sort()).toEqual(['https://c/late.jpg', 'https://c/slow.jpg']);
    expect(cache.has('https://c/late.jpg')).toBe(true);
  });

  it('warm: saves the small image of a cover on screen right away, even on mobile data, but not when off', async () => {
    conn = { type: 'cellular' };
    cache.warm('https://c/a.jpg');
    await vi.waitFor(() => expect(cache.has('https://c/a.jpg')).toBe(true));
    expect(calls.at(-1)).toMatchObject({ url: 'https://c/a.jpg', want: 'thumb' });
    await lib.updateSettings({ covers: { mode: 'off' } });
    cache.warm('https://c/b.jpg');
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => c.url.includes('b.jpg'))).toHaveLength(0);
  });

  it('clears everything', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    await cache.clear();
    expect(cache.meta('https://c/a.jpg')).toBeUndefined();
  });

  it('saves a small and a large image in one download, and makes the small one on the device for older entries', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    expect(cache.meta('https://c/a.jpg')).toMatchObject({ px: 540, tpx: 100 });
    expect(calls).toHaveLength(1);
    expect(calls[0].want).toBe('full');
    // an entry saved before small images existed: only the large one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = (cache as any).db;
    await db.covers.put({ url: 'https://c/old.jpg', data: new ArrayBuffer(540), type: 'image/jpeg', w: 356, h: 540, px: 540, sourcePx: 600, bytes: 540, at: 1 });
    await add('https://c/old.jpg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fresh = new CoverCache(lib, processor, () => conn, (db as any).name);
    await fresh.run();
    expect(calls.at(-1)).toMatchObject({ url: 'https://c/old.jpg', want: 'thumb', shrink: true });
    expect(fresh.meta('https://c/old.jpg')).toMatchObject({ px: 540, tpx: 100 }); // large one kept
  });
});

describe('CoverCache: large images only when a book is opened (optional)', () => {
  beforeEach(async () => {
    await lib.updateSettings({ covers: { full: 'detail' } });
  });

  it('downloads only the small image for every book', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    expect(calls.map((c) => c.want)).toEqual(['thumb']);
    expect(cache.meta('https://c/a.jpg')).toMatchObject({ tpx: 100 });
    expect(cache.meta('https://c/a.jpg')?.px).toBeUndefined();
    expect(cache.has('https://c/a.jpg')).toBe(true);
    cache.publish();
    expect(get(cache.status)).toMatchObject({ total: 1, cached: 1, current: 1, bytes: 100 });
    await cache.run();
    expect(calls).toHaveLength(1); // nothing more to do
  });

  it('fetches the large image when asked (opening a book), once, keeping the small one', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    await Promise.all([cache.ensureFull('https://c/a.jpg'), cache.ensureFull('https://c/a.jpg')]);
    expect(calls.filter((c) => c.want === 'full')).toHaveLength(1);
    expect(cache.meta('https://c/a.jpg')).toMatchObject({ px: 540, tpx: 100 });
    await cache.ensureFull('https://c/a.jpg');
    expect(calls).toHaveLength(2);
    // and the next background run doesn't download it again
    await cache.run();
    expect(calls).toHaveLength(2);
  });

  it('does not retry a failed large image in the same session', async () => {
    await add('https://c/a.jpg');
    await cache.run();
    fail.add('https://c/a.jpg');
    await cache.ensureFull('https://c/a.jpg');
    await cache.ensureFull('https://c/a.jpg');
    expect(calls.filter((c) => c.want === 'full')).toHaveLength(1);
    expect(cache.has('https://c/a.jpg')).toBe(true); // the small image stays
  });
});

describe('CoverCache: status report', () => {
  it('counts saved, failed and missing covers with the technical reason, and retries on request', async () => {
    await add('https://c/ok.jpg');
    await add('https://c/limited.jpg');
    await add('https://c/gone.jpg');
    await lib.addBook({ title: 'no cover' });
    await lib.addBook({ title: 'own photo', cover: 'data:image/jpeg;base64,AAAA' });
    fail.add('https://c/limited.jpg');
    gone.add('https://c/gone.jpg');
    await cache.run();
    const r = cache.diagnose(lib.state.books);
    expect(r).toMatchObject({ books: 5, noCover: 1, ownPhotos: 1, urls: 3, saved: 1, large: 1, failed: 2, blank: 0, notYet: 0 });
    const limited = r.items.find((i) => i.url.includes('limited'))!;
    expect(limited).toMatchObject({ kind: 'failed', error: 'Error: rate limited', failures: 1 });
    expect(limited.nextTry! - limited.failedAt!).toBe(60_000);
    expect(r.items.find((i) => i.url.includes('gone'))?.error).toBe('HTTP 404');
    // retry one: it is tried again at once
    fail.delete('https://c/limited.jpg');
    expect(cache.retryFailed(['https://c/limited.jpg'])).toBe(1);
    await cache.run();
    expect(cache.diagnose(lib.state.books)).toMatchObject({ saved: 2, failed: 1 });
  });
});

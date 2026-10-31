import Dexie, { type Table } from 'dexie';
import { helperUrlOf } from '../config';
import { writable, type Readable } from 'svelte/store';
import type { Library } from '../services/library';
import { analyzePixels, isCoverShape, isNiceCover, looksLikePlaceholder, type CoverAnalysis } from './colors';
import { currentConnection, downloadDecision, type CacheMode, type ConnectionInfo } from './policy';
import { COVER_SIZES, DEFAULT_COVER_SIZE, sourceUrl, type CoverSize } from './sizes';

/** One cached cover (keyed by the URL stored on the book). */
export interface CoverEntry {
  url: string;
  /** The large image (resolution per setting). Optional: in "detail" mode it is only fetched when a book is opened. */
  data?: ArrayBuffer;
  type?: string;
  /** The small image every normal view uses (grids, lists, the wall): a few KB instead of tens. */
  thumb?: ArrayBuffer;
  thumbType?: string;
  tpx?: number;
  tbytes?: number;
  /** Stored image size. */
  w?: number;
  h?: number;
  /** Longest side as stored, and as available at the source (we never upscale). */
  px?: number;
  sourcePx?: number;
  bytes?: number;
  analysis?: CoverAnalysis;
  nice?: boolean;
  /** Failed downloads are retried after a day. */
  failedAt?: number;
  /** How many downloads failed in a row: the wait before the next try grows (1 min, 5 min, 30 min, 3 h, a day). */
  failures?: number;
  /** The source only had a blank "image not available" tile. */
  placeholder?: boolean;
  at: number;
}
export type CoverMeta = Omit<CoverEntry, 'data' | 'thumb'>;

/** Longest side of the small image. */
export const THUMB_PX = 300;

class CoverDb extends Dexie {
  covers!: Table<CoverEntry, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ covers: 'url, at' });
  }
}

export interface Rendered {
  data: ArrayBuffer;
  type: string;
  w: number;
  h: number;
}

export interface Processed {
  /** The large image; absent when only the small one was asked for. */
  full?: Rendered;
  thumb: Rendered;
  sourcePx: number;
  analysis: CoverAnalysis;
}

/**
 * Turns a cover URL (or a previously stored image) into resized JPEGs plus colour analysis:
 * `want: 'thumb'` gives only the small image, `'full'` both.
 */
export type Processor = (input: {
  url: string;
  size: CoverSize;
  want: 'thumb' | 'full';
  proxy?: string;
  stored?: ArrayBuffer;
  storedType?: string;
}) => Promise<Processed>;

export interface CacheStatus {
  mode: CacheMode;
  size: CoverSize;
  decision: 'yes' | 'no' | 'ask';
  /** Covers on books. */
  total: number;
  /** Cached (any size). */
  cached: number;
  /** Cached at the chosen size (or the best the source has). */
  current: number;
  bytes: number;
  running: boolean;
  failed: number;
}

const DAY = 86400000;
/** Waits after the 1st, 2nd… failed download. A missing image (404) or a blank tile waits a day right away. */
const RETRY_WAIT = [60_000, 5 * 60_000, 30 * 60_000, 3 * 3600_000, DAY];

/** Small LRU of object URLs / bitmaps so thousands of covers don't sit in memory. */
class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number, private evict: (v: V) => void) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: string, v: V) {
    this.map.set(k, v);
    while (this.map.size > this.max) {
      const [oldK, oldV] = this.map.entries().next().value as [string, V];
      this.map.delete(oldK);
      this.evict(oldV);
    }
  }
  delete(k: string) {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.evict(v);
    }
  }
  clear() {
    for (const v of this.map.values()) this.evict(v);
    this.map.clear();
  }
}

/**
 * Local cover cache: downloads every book cover once (respecting the Wi-Fi setting), stores a
 * resized JPEG with its colour analysis, and serves them offline to the UI and the cover wall.
 */
export class CoverCache {
  private db: CoverDb;
  private index = new Map<string, CoverMeta>();
  private status$ = writable<CacheStatus>({
    mode: 'wifi', size: DEFAULT_COVER_SIZE, decision: 'no', total: 0, cached: 0, current: 0, bytes: 0, running: false, failed: 0
  });
  private loaded: Promise<void>;
  private running: Promise<void> | undefined;
  // Object URLs may still be in use by covers on screen: give them time before they are released.
  private urls = new Lru<string>(300, (u) => void setTimeout(() => URL.revokeObjectURL(u), 60_000));
  private bitmaps = new Lru<ImageBitmap>(500, (b) => b.close?.());
  /** Bumped whenever covers change, so views can redraw. */
  version = writable(0);

  constructor(
    private lib: Library,
    private process: Processor,
    private connection: () => ConnectionInfo | undefined = currentConnection,
    dbName = 'booked-covers'
  ) {
    this.db = new CoverDb(dbName);
    this.loaded = this.db.covers.toCollection().each((e) => {
      const { data: _d, ...meta } = e;
      this.index.set(e.url, meta);
    }).then(() => this.publish());
  }

  get status(): Readable<CacheStatus> {
    return this.status$;
  }

  get mode(): CacheMode {
    return this.lib.state.settings.covers?.mode ?? 'wifi';
  }

  get size(): CoverSize {
    return this.lib.state.settings.covers?.size ?? DEFAULT_COVER_SIZE;
  }

  /** 'all' (default): small and large images are saved for every book, so everything works offline. 'detail': large images are only fetched when a book is opened (saves space and data). */
  get fullMode(): 'detail' | 'all' {
    return this.lib.state.settings.covers?.full ?? 'all';
  }

  /** Is there any saved image (small or large) for this cover? */
  has(url: string | undefined): boolean {
    const e = url ? this.index.get(url) : undefined;
    return !!(e?.px || e?.tpx);
  }

  /** Cover URLs in the library, newest books first (those are likeliest to be looked at). */
  private wanted(): string[] {
    const seen = new Set<string>();
    return [...this.lib.state.books]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => b.cover)
      .filter((u): u is string => !!u && !seen.has(u) && !!seen.add(u));
  }

  private waitAfter(e: CoverMeta): number {
    return e.placeholder ? DAY : RETRY_WAIT[Math.min(Math.max((e.failures ?? 1) - 1, 0), RETRY_WAIT.length - 1)];
  }

  /** Remember a failed download; a transient problem (rate limit, no connection) is retried soon, not tomorrow. */
  private async recordFailure(url: string, e: unknown) {
    const prev = this.index.get(url);
    if (prev?.px || prev?.tpx) return; // something usable is saved already
    const permanent = e instanceof PlaceholderError || (e instanceof HttpError && (e.status === 404 || e.status === 410));
    const failed: CoverEntry = {
      ...(prev ?? { url }), failedAt: Date.now(), at: Date.now(),
      failures: permanent ? RETRY_WAIT.length : (prev?.failures ?? 0) + 1,
      ...(e instanceof PlaceholderError ? { placeholder: true } : {})
    };
    await this.db.covers.put(failed);
    this.index.set(url, failed);
  }

  /** Does this cover need (re)processing? 'thumb' = only the small copy is missing (made on the device, no download). */
  private needs(url: string, now: number): 'download' | 'shrink' | 'thumb' | false {
    const e = this.index.get(url);
    if (!e || (!e.px && !e.tpx)) return e?.failedAt && now - e.failedAt < this.waitAfter(e) ? false : 'download';
    if (!e.tpx) return 'thumb';
    if (this.fullMode === 'detail') return false;
    const target = COVER_SIZES[this.size].px;
    if (!e.px) return 'download';
    if (e.px > target * 1.05) return 'shrink';
    if (e.px < target * 0.95 && (e.sourcePx ?? 0) > e.px * 1.05) return 'download';
    return false;
  }

  publish() {
    const wanted = this.wanted();
    const now = Date.now();
    let cached = 0, current = 0, bytes = 0, failed = 0;
    for (const u of wanted) {
      const e = this.index.get(u);
      if (e?.px || e?.tpx) {
        cached++;
        bytes += (e.bytes ?? 0) + (e.tbytes ?? 0);
        if (!this.needs(u, now)) current++;
      } else if (e?.failedAt) failed++;
    }
    this.status$.update((s) => ({
      ...s, mode: this.mode, size: this.size, decision: downloadDecision(this.mode, this.connection(), navigator.onLine),
      total: wanted.length, cached, current, bytes, failed
    }));
  }

  /** The source gave us nothing usable: only a "not available" tile, or an image that isn't book-shaped (a title-page scan…). */
  isBroken(url: string | undefined): boolean {
    const e = url && !url.startsWith('data:') ? this.index.get(url) : undefined;
    return !!e && ((!e.px && !!e.placeholder) || (!!e.px && !isCoverShape(e.w ?? 0, e.h ?? 0)));
  }

  /** Forget a failed download so it is tried again on the next run. */
  retry(url: string): void {
    const e = this.index.get(url);
    if (e && !e.px) {
      this.index.delete(url);
      void this.db.covers.delete(url);
    }
  }

  meta(url: string | undefined): CoverMeta | undefined {
    return url ? this.index.get(url) : undefined;
  }

  /** Measured average for storage estimates. */
  measured(): { bytes: number; covers: number; px: number } | undefined {
    const done = [...this.index.values()].filter((e) => e.px && e.bytes);
    if (!done.length) return undefined;
    return { bytes: done.reduce((n, e) => n + e.bytes!, 0), covers: done.length, px: Math.round(done.reduce((n, e) => n + e.px!, 0) / done.length) };
  }

  /**
   * Download/resize what's missing.
   * - `true`: the user tapped "Download now" (answers the can't-tell-if-Wi-Fi question).
   * - `'mobile'`: the user confirmed downloading on mobile data (overrides "Wi-Fi only" and data saver).
   * Never downloads when offline or when saving covers is turned off.
   */
  run(force: boolean | 'mobile' = false): Promise<void> {
    if (this.running) {
      // Covers changed while a run is going: do another round afterwards instead of waiting for the next change.
      this.rerun = this.rerun === 'mobile' || force === 'mobile' ? 'mobile' : this.rerun || force;
      return this.running;
    }
    this.running = (async () => {
      let f = force;
      for (let round = 0; round < 5; round++) {
        this.rerun = undefined;
        await this.doRun(f);
        if (this.rerun === undefined) break;
        f = this.rerun;
      }
    })().finally(() => {
      this.running = undefined;
      this.status$.update((s) => ({ ...s, running: false }));
      this.publish();
      this.scheduleRetry();
    });
    return this.running;
  }

  private rerun: boolean | 'mobile' | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  /** Come back when the first failed cover is due for another try. */
  private scheduleRetry() {
    clearTimeout(this.retryTimer);
    const now = Date.now();
    let due = Infinity;
    for (const u of this.wanted()) {
      const e = this.index.get(u);
      if (e?.failedAt && !e.px && !e.tpx) due = Math.min(due, e.failedAt + this.waitAfter(e));
    }
    if (due < Infinity && due - now < DAY) this.retryTimer = setTimeout(() => this.run().catch(() => {}), Math.max(5000, due - now + 500));
  }

  // ---- covers on screen: saved first, right away

  private warming = new Set<string>();
  private warmQueue: string[] = [];
  private warmActive = 0;
  private bumpTimer: ReturnType<typeof setTimeout> | undefined;

  private bumpSoon() {
    if (this.bumpTimer) return;
    this.bumpTimer = setTimeout(() => {
      this.bumpTimer = undefined;
      this.publish();
      this.version.update((v) => v + 1);
    }, 250);
  }

  /**
   * A cover is on screen but not saved yet: fetch its small image now, ahead of the background run
   * (a few at a time), on any connection (it is only a few KB). Quiet when saving is off, the device
   * is offline or on data saver, or it failed recently.
   */
  warm(url: string | undefined): void {
    if (!url || url.startsWith('data:') || this.has(url) || this.warming.has(url) || this.mode === 'off') return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    if (this.connection()?.saveData) return;
    const e = this.index.get(url);
    if (e?.failedAt && Date.now() - e.failedAt < this.waitAfter(e)) return;
    this.warming.add(url);
    this.warmQueue.push(url);
    this.pumpWarm();
  }

  private pumpWarm() {
    while (this.warmActive < 3 && this.warmQueue.length) {
      const url = this.warmQueue.shift()!;
      this.warmActive++;
      this.warmOne(url).finally(() => {
        this.warmActive--;
        this.warming.delete(url);
        this.pumpWarm();
      });
    }
  }

  private async warmOne(url: string) {
    await this.loaded;
    if (this.has(url)) return;
    const proxy = this.lib.state.settings.covers?.helper === 'off' ? undefined : helperUrlOf(this.lib.state.settings);
    try {
      await this.save(url, await this.process({ url, size: this.size, want: 'thumb', proxy }), undefined);
    } catch (e) {
      await this.recordFailure(url, e);
    }
    this.bumpSoon();
  }

  private allowed(force: boolean | 'mobile'): boolean {
    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (force === 'mobile') return online && this.mode !== 'off';
    const d = downloadDecision(this.mode, this.connection(), online);
    return d === 'yes' || (force === true && d === 'ask');
  }

  private async doRun(force: boolean | 'mobile') {
    await this.loaded;
    const now = Date.now();
    const queue = this.wanted().filter((u) => this.needs(u, now));
    if (!queue.length) return;
    this.status$.update((s) => ({ ...s, running: true }));
    // The helper only carries covers the browser can't read directly (no CORS, e.g. Google Books), and only as small images.
    const proxy = this.lib.state.settings.covers?.helper === 'off' ? undefined : helperUrlOf(this.lib.state.settings);
    let i = 0;
    const worker = async () => {
      while (i < queue.length) {
        const url = queue[i++];
        const kind = this.needs(url, Date.now());
        if (!kind) continue;
        if (kind === 'download' && !this.allowed(force)) return; // e.g. left Wi-Fi: stop quietly
        const prev = kind === 'download' && !this.index.get(url)?.px ? undefined : await this.db.covers.get(url);
        const local = kind === 'shrink' || kind === 'thumb';
        try {
          const want = this.fullMode === 'all' && kind !== 'thumb' ? 'full' : 'thumb';
          const p = await this.process({ url, size: this.size, want, proxy, stored: local ? prev?.data : undefined, storedType: prev?.type });
          await this.save(url, p, kind === 'download' ? undefined : prev);
        } catch (e) {
          await this.recordFailure(url, e);
        }
        if (i % 10 === 0) {
          this.publish();
          this.version.update((v) => v + 1);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.version.update((v) => v + 1);
  }

  /** Store a processed cover, keeping what was saved before for the parts that weren't redone. */
  private async save(url: string, p: Processed, prev?: CoverEntry) {
    const big = p.full;
    const entry: CoverEntry = {
      url,
      data: big?.data ?? prev?.data, type: big?.type ?? prev?.type,
      px: big ? Math.max(big.w, big.h) : prev?.px,
      bytes: big ? big.data.byteLength : prev?.bytes,
      thumb: p.thumb.data, thumbType: p.thumb.type, tpx: Math.max(p.thumb.w, p.thumb.h), tbytes: p.thumb.data.byteLength,
      w: big?.w ?? prev?.w ?? p.thumb.w, h: big?.h ?? prev?.h ?? p.thumb.h,
      // A local re-render keeps knowing how big the source was (to grow again later).
      sourcePx: prev?.sourcePx ? Math.max(prev.sourcePx, p.sourcePx) : p.sourcePx,
      analysis: p.analysis, nice: isNiceCover(big?.w ?? p.thumb.w, big?.h ?? p.thumb.h, p.analysis.contrast), at: Date.now()
    };
    await this.db.covers.put(entry);
    const { data: _d, thumb: _t, ...meta } = entry;
    this.index.set(url, meta);
    this.dropUrl(url);
    this.bitmaps.delete(url);
  }

  private fullJobs = new Map<string, Promise<void>>();
  private fullFailed = new Set<string>();

  /**
   * The large image for one cover, fetched now (a book was opened). Quiet if it is already saved,
   * the device is offline, or it failed before in this session.
   */
  ensureFull(url: string | undefined): Promise<void> {
    if (!url || url.startsWith('data:') || this.index.get(url)?.px || this.fullFailed.has(url)) return Promise.resolve();
    if (this.mode === 'off' || (typeof navigator !== 'undefined' && !navigator.onLine)) return Promise.resolve();
    const running = this.fullJobs.get(url);
    if (running) return running;
    const job = (async () => {
      await this.loaded;
      const prev = await this.db.covers.get(url);
      const proxy = this.lib.state.settings.covers?.helper === 'off' ? undefined : helperUrlOf(this.lib.state.settings);
      try {
        const p = await this.process({ url, size: this.size, want: 'full', proxy });
        await this.save(url, p, prev);
        this.publish();
        this.version.update((v) => v + 1);
      } catch {
        this.fullFailed.add(url);
      }
    })().finally(() => this.fullJobs.delete(url));
    this.fullJobs.set(url, job);
    return job;
  }

  /** Forget the object URLs of a cover (e.g. the browser says it can't load it), so the next `objectUrl` makes fresh ones. */
  dropUrl(url: string | undefined): void {
    if (!url) return;
    this.urls.delete(`thumb:${url}`);
    this.urls.delete(`full:${url}`);
  }

  /**
   * An object URL for a saved cover, or undefined (→ use the network URL).
   * 'thumb' (default) is the small image for grids and lists; 'full' only exists once the large one is saved.
   */
  async objectUrl(url: string | undefined, variant: 'thumb' | 'full' = 'thumb'): Promise<string | undefined> {
    const meta = url ? this.index.get(url) : undefined;
    if (!url || !(meta?.px || meta?.tpx)) return undefined;
    if (variant === 'full' && !meta.px) return undefined;
    const key = `${variant}:${url}`;
    const hit = this.urls.get(key);
    if (hit) return hit;
    const e = await this.db.covers.get(url);
    const [data, type] = variant === 'full' || !e?.thumb ? [e?.data, e?.type] : [e.thumb, e.thumbType];
    if (!data) return undefined;
    const objectUrl = URL.createObjectURL(new Blob([data], { type: type ?? 'image/jpeg' }));
    this.urls.set(key, objectUrl);
    return objectUrl;
  }

  /** A decoded bitmap for canvas drawing (cover wall): the small image, which is plenty for tiles and far lighter to keep in memory. */
  async bitmap(url: string): Promise<ImageBitmap | undefined> {
    const hit = this.bitmaps.get(url);
    if (hit) return hit;
    const e = await this.db.covers.get(url);
    const data = e?.thumb ?? e?.data;
    if (!data) return undefined;
    const bmp = await createImageBitmap(new Blob([data], { type: (e?.thumb ? e.thumbType : e?.type) ?? 'image/jpeg' }));
    this.bitmaps.set(url, bmp);
    return bmp;
  }

  async clear(): Promise<void> {
    await this.db.covers.clear();
    this.index.clear();
    this.urls.clear();
    this.bitmaps.clear();
    this.publish();
    this.version.update((v) => v + 1);
  }

  /** For tests. */
  async destroy() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.bumpTimer);
    await this.db.delete();
  }
}

// ------------------------------------------------------------- browser image processing

/** The source answered with an error status. */
export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

/** The source answered, but only with a blank "image not available" tile. */
export class PlaceholderError extends Error {
  constructor() {
    super('placeholder image');
  }
}

/** Where to get the image: the size we want, then the URL as stored (Google has no large image for many books but a small real one). */
export function sourceCandidates(url: string, size: CoverSize): string[] {
  return [...new Set([sourceUrl(url, size), url])];
}

async function fetchDirect(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new HttpError(res.status);
  return res.blob();
}

async function fetchViaHelper(url: string, proxy: string): Promise<Blob> {
  const res = await fetch(`${proxy.replace(/\/+$/, '')}/img?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new HttpError(res.status);
  return res.blob();
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The real processor: fetch, never upscale, resize to the chosen size, JPEG, analyse colours. */
export const browserProcessor: Processor = async ({ url, size, want, proxy, stored, storedType }) => {
  if (stored) return processBlob(new Blob([stored], { type: storedType ?? 'image/jpeg' }), size, want);
  // The small image doesn't need a big source: ask for the small rendition first.
  const candidates = want === 'thumb' ? [...new Set([sourceUrl(url, 'small'), url])] : sourceCandidates(url, size);
  let last: unknown = new Error('no image');
  // 1. Straight from the source to this device (the helper isn't involved).
  for (const candidate of candidates) {
    try {
      const done = await processBlob(await fetchDirect(candidate), size, want);
      if (looksLikePlaceholder(done.analysis) && !url.startsWith('data:')) {
        last = new PlaceholderError();
        continue; // try the smaller rendition before giving up
      }
      return done;
    } catch (e) {
      last = e;
    }
  }
  // 2. The source doesn't allow that: the helper passes on the small stored image, once (never the large one).
  if (proxy && !url.startsWith('data:') && !(last instanceof PlaceholderError)) {
    const done = await processBlob(await fetchViaHelper(url, proxy), size, want);
    if (looksLikePlaceholder(done.analysis)) throw new PlaceholderError();
    return done;
  }
  throw last;
};

/** Draw the image scaled so its longest side is at most `max` px (never upscaled), as a JPEG. */
async function render(bmp: ImageBitmap, max: number): Promise<Rendered> {
  const sourcePx = Math.max(bmp.width, bmp.height);
  const scale = Math.min(1, max / sourcePx);
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const out = canvas(w, h);
  const ctx = out.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  const jpeg = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.82));
  return { data: await jpeg.arrayBuffer(), type: 'image/jpeg', w, h };
}

async function processBlob(blob: Blob, size: CoverSize, want: 'thumb' | 'full'): Promise<Processed> {
  const bmp = await createImageBitmap(blob);
  try {
    const sample = canvas(24, 36).getContext('2d', { willReadFrequently: true })!;
    sample.drawImage(bmp, 0, 0, 24, 36);
    const analysis = analyzePixels(sample.getImageData(0, 0, 24, 36).data);
    return {
      thumb: await render(bmp, THUMB_PX),
      full: want === 'full' ? await render(bmp, COVER_SIZES[size].px) : undefined,
      sourcePx: Math.max(bmp.width, bmp.height),
      analysis
    };
  } finally {
    bmp.close?.();
  }
}

/** Size and dominant colours of the image at a URL (small sample; for comparing covers, not stored). */
export async function sampleImage(url: string): Promise<{ analysis: CoverAnalysis; w: number; h: number }> {
  // Always direct: comparing candidate covers must never go through the helper (that would be many images per book).
  const bmp = await createImageBitmap(await fetchDirect(url));
  try {
    const sample = canvas(24, 36).getContext('2d', { willReadFrequently: true })!;
    sample.drawImage(bmp, 0, 0, 24, 36);
    return { analysis: analyzePixels(sample.getImageData(0, 0, 24, 36).data), w: bmp.width, h: bmp.height };
  } finally {
    bmp.close?.();
  }
}

export async function sampleColors(url: string): Promise<CoverAnalysis> {
  return (await sampleImage(url)).analysis;
}

/** How far apart two covers look (0 = same dominant colour and lightness). */
export function lookDistance(a: CoverAnalysis, b: CoverAnalysis): number {
  const d = (x: number[], y: number[]) => Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) / 441;
  return d(a.color, b.color) + 0.5 * Math.abs(a.lightness - b.lightness) + 0.3 * Math.abs(a.contrast - b.contrast) * 4;
}

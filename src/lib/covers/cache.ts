import Dexie, { type Table } from 'dexie';
import { writable, type Readable } from 'svelte/store';
import type { Library } from '../services/library';
import { analyzePixels, isNiceCover, type CoverAnalysis } from './colors';
import { currentConnection, downloadDecision, type CacheMode, type ConnectionInfo } from './policy';
import { COVER_SIZES, DEFAULT_COVER_SIZE, sourceUrl, type CoverSize } from './sizes';

/** One cached cover (keyed by the URL stored on the book). */
export interface CoverEntry {
  url: string;
  data?: ArrayBuffer;
  type?: string;
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
  at: number;
}
export type CoverMeta = Omit<CoverEntry, 'data'>;

class CoverDb extends Dexie {
  covers!: Table<CoverEntry, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({ covers: 'url, at' });
  }
}

export interface Processed {
  data: ArrayBuffer;
  type: string;
  w: number;
  h: number;
  sourcePx: number;
  analysis: CoverAnalysis;
}

/** Turns a cover URL (or a previously stored image) into a resized JPEG plus colour analysis. */
export type Processor = (input: { url: string; size: CoverSize; proxy?: string; stored?: ArrayBuffer; storedType?: string }) => Promise<Processed>;

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
  private urls = new Lru<string>(300, (u) => URL.revokeObjectURL(u));
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

  /** Cover URLs in the library, newest books first (those are likeliest to be looked at). */
  private wanted(): string[] {
    const seen = new Set<string>();
    return [...this.lib.state.books]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => b.cover)
      .filter((u): u is string => !!u && !seen.has(u) && !!seen.add(u));
  }

  /** Does this cover need (re)processing for the chosen size? */
  private needs(url: string, now: number): 'download' | 'shrink' | false {
    const e = this.index.get(url);
    const target = COVER_SIZES[this.size].px;
    if (!e || !e.px) return e?.failedAt && now - e.failedAt < DAY ? false : 'download';
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
      if (e?.px) {
        cached++;
        bytes += e.bytes ?? 0;
        if (!this.needs(u, now)) current++;
      } else if (e?.failedAt) failed++;
    }
    this.status$.update((s) => ({
      ...s, mode: this.mode, size: this.size, decision: downloadDecision(this.mode, this.connection(), navigator.onLine),
      total: wanted.length, cached, current, bytes, failed
    }));
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
   * Download/resize what's missing. `force` = the user tapped "Download now" (skips the
   * can't-tell-if-Wi-Fi question, but never overrides "off" or data saver).
   */
  run(force = false): Promise<void> {
    this.running ??= this.doRun(force).finally(() => {
      this.running = undefined;
      this.status$.update((s) => ({ ...s, running: false }));
      this.publish();
    });
    return this.running;
  }

  private allowed(force: boolean): boolean {
    const d = downloadDecision(this.mode, this.connection(), typeof navigator === 'undefined' || navigator.onLine);
    return d === 'yes' || (force && d === 'ask');
  }

  private async doRun(force: boolean) {
    await this.loaded;
    const now = Date.now();
    const queue = this.wanted().filter((u) => this.needs(u, now));
    if (!queue.length) return;
    this.status$.update((s) => ({ ...s, running: true }));
    const proxy = this.lib.state.settings.sync?.helperUrl;
    let i = 0;
    const worker = async () => {
      while (i < queue.length) {
        const url = queue[i++];
        const kind = this.needs(url, Date.now());
        if (!kind) continue;
        if (kind === 'download' && !this.allowed(force)) return; // e.g. left Wi-Fi: stop quietly
        const stored = kind === 'shrink' ? await this.db.covers.get(url) : undefined;
        try {
          const p = await this.process({ url, size: this.size, proxy, stored: stored?.data, storedType: stored?.type });
          // A local shrink keeps knowing how big the source was (to grow again later).
          const sourcePx = kind === 'shrink' ? Math.max(this.index.get(url)?.sourcePx ?? 0, p.sourcePx) : p.sourcePx;
          const entry: CoverEntry = {
            url, data: p.data, type: p.type, w: p.w, h: p.h, px: Math.max(p.w, p.h), sourcePx,
            bytes: p.data.byteLength, analysis: p.analysis, nice: isNiceCover(p.w, p.h, p.analysis.contrast), at: Date.now()
          };
          await this.db.covers.put(entry);
          const { data: _d, ...meta } = entry;
          this.index.set(url, meta);
          this.urls.delete(url);
          this.bitmaps.delete(url);
        } catch {
          const failed: CoverEntry = { ...(this.index.get(url) ?? { url }), failedAt: Date.now(), at: Date.now() };
          if (!failed.px) {
            await this.db.covers.put(failed);
            this.index.set(url, failed);
          }
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

  /** An object URL for a cached cover (or undefined → use the network URL). */
  async objectUrl(url: string | undefined): Promise<string | undefined> {
    if (!url || !this.index.get(url)?.px) return undefined;
    const hit = this.urls.get(url);
    if (hit) return hit;
    const e = await this.db.covers.get(url);
    if (!e?.data) return undefined;
    const objectUrl = URL.createObjectURL(new Blob([e.data], { type: e.type ?? 'image/jpeg' }));
    this.urls.set(url, objectUrl);
    return objectUrl;
  }

  /** A decoded bitmap for canvas drawing (cover wall). */
  async bitmap(url: string): Promise<ImageBitmap | undefined> {
    const hit = this.bitmaps.get(url);
    if (hit) return hit;
    const e = await this.db.covers.get(url);
    if (!e?.data) return undefined;
    const bmp = await createImageBitmap(new Blob([e.data], { type: e.type ?? 'image/jpeg' }));
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
    await this.db.delete();
  }
}

// ------------------------------------------------------------- browser image processing

async function fetchImage(url: string, proxy?: string): Promise<Blob> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.blob();
  } catch (e) {
    // Hosts without CORS (Google Books): go through the user's own helper if there is one.
    if (!proxy || url.startsWith('data:')) throw e;
    const res = await fetch(`${proxy.replace(/\/+$/, '')}/img?url=${encodeURIComponent(url)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.blob();
  }
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** The real processor: fetch, never upscale, resize to the chosen size, JPEG, analyse colours. */
export const browserProcessor: Processor = async ({ url, size, proxy, stored, storedType }) => {
  const blob = stored ? new Blob([stored], { type: storedType ?? 'image/jpeg' }) : await fetchImage(sourceUrl(url, size), proxy);
  const bmp = await createImageBitmap(blob);
  try {
    const sourcePx = Math.max(bmp.width, bmp.height);
    const scale = Math.min(1, COVER_SIZES[size].px / sourcePx);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const out = canvas(w, h);
    const ctx = out.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    const jpeg = await new Promise<Blob>((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.82));
    const sample = canvas(24, 36).getContext('2d', { willReadFrequently: true })!;
    sample.drawImage(bmp, 0, 0, 24, 36);
    const analysis = analyzePixels(sample.getImageData(0, 0, 24, 36).data);
    return { data: await jpeg.arrayBuffer(), type: 'image/jpeg', w, h, sourcePx: stored ? Math.max(sourcePx, 0) : sourcePx, analysis };
  } finally {
    bmp.close?.();
  }
};

import { fold } from '../domain/query';
import type { Book } from '../domain/types';
import { lookDistance, sampleImage } from '../covers/cache';
import { isCoverShape, looksLikePlaceholder, type CoverAnalysis } from '../covers/colors';
import { alternativeCovers, findCover, isbnCoverUrls } from '../metadata/covers';
import type { Fetcher } from '../metadata/http';
import type { ImageProbe } from '../metadata/lookup';

/** Volumes of a series should look alike (same colour scheme); beyond this distance a cover is not a match. */
export const LOOK_LIMIT = 0.35;

export interface Candidate {
  url: string;
  thumb: string;
}

export interface SeriesCoverContext {
  fetcher?: Fetcher;
  key?: string;
  probe: ImageProbe;
  /** Colours of the covers of the other volumes (saved on this device). */
  siblings: (book: Book) => CoverAnalysis[];
  /** For tests. */
  candidates?: (book: Book) => Promise<Candidate[]>;
  sample?: typeof sampleImage;
}

/**
 * What a book belongs to: its series, else the publisher's paperback line. A line only counts
 * for cover matching if its covers really look alike (see `isUniform`).
 */
export function groupOf(b: Pick<Book, 'series' | 'line'>): { key: string; kind: 'series' | 'line' } | undefined {
  if (b.series) return { key: `s:${fold(b.series)}`, kind: 'series' };
  if (b.line) return { key: `l:${fold(b.line)}`, kind: 'line' };
  return undefined;
}

/** A paperback line is worth matching to only when most of its covers share a colour scheme (Reclam yellow, stw dark blue). */
export const LINE_UNIFORM = 0.3;
export function isUniform(looks: CoverAnalysis[]): boolean {
  const sample = looks.slice(0, 30);
  if (sample.length < 3) return false;
  let sum = 0, pairs = 0;
  for (let i = 0; i < sample.length; i++) for (let j = i + 1; j < sample.length; j++) {
    sum += lookDistance(sample[i], sample[j]);
    pairs++;
  }
  return sum / pairs <= LINE_UNIFORM;
}

/** The cover colours of the other books in the same series (or a uniform-looking paperback line). */
export function siblingLooks(books: Book[], book: Book, analysisOf: (cover: string) => CoverAnalysis | undefined): CoverAnalysis[] {
  const g = groupOf(book);
  if (!g) return [];
  const looks = books
    .filter((b) => b.id !== book.id && groupOf(b)?.key === g.key && b.cover)
    .map((b) => analysisOf(b.cover!))
    .filter((a): a is CoverAnalysis => !!a && !looksLikePlaceholder(a));
  return g.kind === 'line' && !isUniform(looks) ? [] : looks;
}

async function defaultCandidates(book: Book, ctx: SeriesCoverContext): Promise<Candidate[]> {
  const f = ctx.fetcher ?? fetch.bind(globalThis);
  const { early, last } = isbnCoverUrls(book);
  const out: Candidate[] = [...early, ...last].map((u) => ({ url: u, thumb: u }));
  try {
    const options = await alternativeCovers(book, f, ctx.key);
    out.push(...options.slice(0, 40).map((o) => ({ url: o.url, thumb: o.thumb })));
  } catch {
    // catalogues unreachable: the ISBN covers still count
  }
  return out;
}

/**
 * The candidate cover that looks most like the other volumes of the series (colours, brightness),
 * or undefined if nothing is close enough. Skips wide scans and blank tiles.
 */
export async function matchingCover(book: Book, reference: CoverAnalysis[], ctx: SeriesCoverContext): Promise<string | undefined> {
  if (!reference.length) return undefined;
  const list = await (ctx.candidates ?? ((b) => defaultCandidates(b, ctx)))(book);
  const sample = ctx.sample ?? sampleImage;
  let best: { url: string; d: number } | undefined;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const c = list[i++];
      try {
        const { analysis, w, h } = await sample(c.thumb);
        if (!isCoverShape(w, h) || looksLikePlaceholder(analysis)) continue;
        const d = Math.min(...reference.map((r) => lookDistance(analysis, r)));
        if (!best || d < best.d) best = { url: c.url, d };
      } catch {
        // can't read this image (no CORS, offline…): skip it
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return best && best.d <= LOOK_LIMIT && (await ctx.probe(best.url)) ? best.url : undefined;
}

/** A cover for a book: one that matches its series if the series has covers already, else the best available. */
export async function coverFor(book: Book, ctx: SeriesCoverContext): Promise<string | undefined> {
  const reference = ctx.siblings(book);
  if (reference.length) {
    const match = await matchingCover(book, reference, ctx);
    if (match) return match;
  }
  return findCover(book, ctx.fetcher ?? fetch.bind(globalThis), ctx.probe, ctx.key);
}

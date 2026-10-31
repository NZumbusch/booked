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
  proxy?: string;
  probe: ImageProbe;
  /** Colours of the covers of the other volumes (saved on this device). */
  siblings: (book: Book) => CoverAnalysis[];
  /** For tests. */
  candidates?: (book: Book) => Promise<Candidate[]>;
  sample?: typeof sampleImage;
}

export const seriesOf = (b: Pick<Book, 'series'>) => (b.series ? fold(b.series) : undefined);

/** The cover colours of the other books in the same series. */
export function siblingLooks(books: Book[], book: Book, analysisOf: (cover: string) => CoverAnalysis | undefined): CoverAnalysis[] {
  const key = seriesOf(book);
  if (!key) return [];
  return books
    .filter((b) => b.id !== book.id && seriesOf(b) === key && b.cover)
    .map((b) => analysisOf(b.cover!))
    .filter((a): a is CoverAnalysis => !!a && !looksLikePlaceholder(a));
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
        const { analysis, w, h } = await sample(c.thumb, ctx.proxy);
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

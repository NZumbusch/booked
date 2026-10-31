import type { Book } from '../domain/types';
import { dnbByIsbn } from '../metadata/dnb';
import type { Fetcher } from '../metadata/http';
import type { Library } from './library';
import { coverFor, type SeriesCoverContext } from './seriesCovers';

export interface CoverSearchProgress {
  /** "series": reading series and volume numbers from the catalogue first; "covers": then looking for covers. */
  phase?: 'series' | 'covers';
  done: number;
  total: number;
  found: number;
  /** Title being searched right now. */
  current?: string;
}

export interface CoverSearchOptions {
  /** How to look for covers (catalogue access, and the look of the series a book belongs to). */
  context: SeriesCoverContext;
  signal?: AbortSignal;
  onProgress?: (p: CoverSearchProgress) => void;
  /** Also redo books whose saved cover turned out to be broken or a blank tile. */
  isBroken?: (cover: string) => boolean;
  /** Which books were already checked for a series (so each book is asked once). */
  seriesChecked?: { has: (id: string) => boolean; add: (id: string) => void };
  /** For tests. */
  fetcher?: Fetcher;
}

/** Books that may still be missing their series: they have an ISBN and no series yet. */
export function booksWithoutSeries(books: Book[], checked?: { has: (id: string) => boolean }): Book[] {
  return books.filter((b) => !b.series && (b.isbn13 || b.isbn10) && !checked?.has(b.id));
}

/**
 * Asks the German National Library for the series (and number) of books that have none, one
 * after another. Only fills what is empty; a book without a record is left alone and not asked again.
 */
export async function fillMissingSeries(lib: Library, opts: CoverSearchOptions, report: (p: CoverSearchProgress) => void): Promise<number> {
  const f = opts.fetcher ?? fetch.bind(globalThis);
  const todo = booksWithoutSeries(lib.state.books, opts.seriesChecked);
  const progress: CoverSearchProgress = { phase: 'series', done: 0, total: todo.length, found: 0 };
  report({ ...progress });
  for (const b of todo) {
    if (opts.signal?.aborted) break;
    report({ ...progress, current: b.title });
    try {
      const r = await dnbByIsbn((b.isbn13 ?? b.isbn10)!, f);
      opts.seriesChecked?.add(b.id);
      const { series, seriesNumber } = r?.fields ?? {};
      if (series && lib.book(b.id)) {
        await lib.enrichBook(b.id, { series, ...(seriesNumber && !b.seriesNumber ? { seriesNumber } : {}) });
        progress.found++;
      }
    } catch {
      // DNB unreachable for this one: try again next time
    }
    progress.done++;
    report({ ...progress });
  }
  return progress.found;
}

/** Books worth searching a cover for: none at all, or a cover known to be unusable. */
export function booksWithoutCover(books: Book[], isBroken?: (cover: string) => boolean): Book[] {
  return books.filter((b) => !b.cover || (!b.cover.startsWith('data:') && !!isBroken?.(b.cover)));
}

/**
 * Looks for a cover for every book without one, one after another (so the catalogues aren't
 * hammered). Safe to stop: every cover found is saved right away.
 */
export async function findMissingCovers(lib: Library, opts: CoverSearchOptions): Promise<CoverSearchProgress> {
  // Series first: covers of a series are then chosen to match each other.
  await fillMissingSeries(lib, opts, (p) => opts.onProgress?.(p));
  const todo = booksWithoutCover(lib.state.books, opts.isBroken);
  const progress: CoverSearchProgress = { phase: 'covers', done: 0, total: todo.length, found: 0 };
  opts.onProgress?.({ ...progress });
  for (const b of todo) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ ...progress, current: b.title });
    try {
      const cover = await coverFor(b, opts.context);
      if (cover && lib.book(b.id)) {
        await lib.enrichBook(b.id, { cover });
        progress.found++;
      }
    } catch {
      // one book failing must not stop the rest
    }
    progress.done++;
    opts.onProgress?.({ ...progress });
  }
  opts.onProgress?.({ ...progress });
  return progress;
}

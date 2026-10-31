import type { Book } from '../domain/types';
import { findCover } from '../metadata/covers';
import { browserProbe, type ImageProbe } from '../metadata/lookup';
import type { Library } from './library';

export interface CoverSearchProgress {
  done: number;
  total: number;
  found: number;
  /** Title being searched right now. */
  current?: string;
}

export interface CoverSearchOptions {
  key?: string;
  signal?: AbortSignal;
  onProgress?: (p: CoverSearchProgress) => void;
  probe?: ImageProbe;
  /** Also redo books whose saved cover turned out to be broken or a blank tile. */
  isBroken?: (cover: string) => boolean;
  fetcher?: typeof fetch;
}

/** Books worth searching a cover for: none at all, or a cover known to be unusable. */
export function booksWithoutCover(books: Book[], isBroken?: (cover: string) => boolean): Book[] {
  return books.filter((b) => !b.cover || (!b.cover.startsWith('data:') && !!isBroken?.(b.cover)));
}

/**
 * Looks for a cover for every book without one, one after another (so the catalogues aren't
 * hammered). Safe to stop: every cover found is saved right away.
 */
export async function findMissingCovers(lib: Library, opts: CoverSearchOptions = {}): Promise<CoverSearchProgress> {
  const f = opts.fetcher ?? fetch.bind(globalThis);
  const probe = opts.probe ?? browserProbe;
  const todo = booksWithoutCover(lib.state.books, opts.isBroken);
  const progress: CoverSearchProgress = { done: 0, total: todo.length, found: 0 };
  opts.onProgress?.({ ...progress });
  for (const b of todo) {
    if (opts.signal?.aborted) break;
    opts.onProgress?.({ ...progress, current: b.title });
    try {
      const cover = await findCover(b, f, probe, opts.key);
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

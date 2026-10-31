import type { Book } from '../domain/types';
import { groupOf } from './seriesCovers';

export type ReviewScope = 'missing' | 'series' | 'all';

const num = (s: string | undefined) => {
  const m = s?.match(/\d+/);
  return m ? Number(m[0]) : Infinity;
};

/**
 * Books to walk through, volumes of a series together and in order: first the books of each
 * series (series by name, volumes by number), then the rest by title.
 * - missing: no usable cover; series: every book that belongs to a series; all: everything.
 */
export function reviewQueue(books: Book[], scope: ReviewScope, isBroken: (cover: string) => boolean = () => false): Book[] {
  const picked = books.filter((b) => {
    if (b.ownership === 'wishlist') return false;
    if (scope === 'all') return true;
    if (scope === 'series') return !!b.series;
    return !b.cover || (!b.cover.startsWith('data:') && isBroken(b.cover));
  });
  const key = (b: Book) => (groupOf(b)?.kind === 'series' ? b.series!.toLowerCase() : undefined);
  return picked.sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka && !kb) return -1;
    if (!ka && kb) return 1;
    if (ka && kb && ka !== kb) return ka.localeCompare(kb);
    if (ka) return num(a.seriesNumber ?? a.volume) - num(b.seriesNumber ?? b.volume) || num(a.volume) - num(b.volume) || a.title.localeCompare(b.title);
    return a.title.localeCompare(b.title);
  });
}

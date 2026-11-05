/**
 * Which cover comes first: one rule for the automatic choice, the cover picker, Review covers and
 * series matching (they used to each have their own, slightly different order).
 *
 * 1. This very edition (same ISBN): it's the one on your shelf.
 * 2. Looks like the other volumes of the series (or uniform paperback line) you already have.
 * 3. Same language as your book.
 * 4. Everything else.
 * Within each: the closest look first, then Open Library before Google (Google may serve a blank
 * tile), then the order the catalogue gave.
 */

/** How alike two covers must look (see covers/cache lookDistance) to count as "matching the series". */
export const LOOK_LIMIT = 0.35;

export interface Rankable {
  sameEdition?: boolean;
  sameLanguage?: boolean;
  source?: string;
}

export function coverTier(o: Rankable, distance = Infinity): number {
  if (o.sameEdition) return 0;
  if (distance <= LOOK_LIMIT) return 1;
  if (o.sameLanguage) return 2;
  return 3;
}

export function rankCovers<T extends Rankable>(options: readonly T[], distance: (o: T) => number = () => Infinity): T[] {
  return options
    .map((o, i) => ({ o, i, d: distance(o) }))
    .sort((x, y) =>
      coverTier(x.o, x.d) - coverTier(y.o, y.d) ||
      (x.d === y.d ? 0 : x.d - y.d) ||
      Number(x.o.source !== 'openlibrary') - Number(y.o.source !== 'openlibrary') ||
      x.i - y.i)
    .map(({ o }) => o);
}

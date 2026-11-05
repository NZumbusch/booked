import { describe, expect, it } from 'vitest';
import { rankCovers } from './coverRank';

const o = (id: string, p: { sameEdition?: boolean; sameLanguage?: boolean; source?: string; d?: number } = {}) => ({ id, source: 'openlibrary', ...p });

describe('rankCovers', () => {
  it('this edition first, then series look-alikes, then same language, then the rest', () => {
    const list = [o('other'), o('lang', { sameLanguage: true }), o('alike', { d: 0.1 }), o('edition', { sameEdition: true, d: 0.9 })];
    expect(rankCovers(list, (x) => x.d ?? Infinity).map((x) => x.id)).toEqual(['edition', 'alike', 'lang', 'other']);
  });
  it('the same edition wins even over a perfect look-alike', () => {
    const list = [o('alike', { d: 0 }), o('edition', { sameEdition: true })];
    expect(rankCovers(list, (x) => x.d ?? Infinity)[0].id).toBe('edition');
  });
  it('within a group: closest look, then Open Library before Google, then catalogue order', () => {
    const list = [o('g', { sameEdition: true, source: 'googlebooks' }), o('ol2', { sameEdition: true }), o('ol1', { sameEdition: true, d: 0.2 })];
    expect(rankCovers(list, (x) => x.d ?? Infinity).map((x) => x.id)).toEqual(['ol1', 'ol2', 'g']);
  });
  it('without a series to compare to, look plays no part', () => {
    const list = [o('b', { sameLanguage: true }), o('a', { sameEdition: true, source: 'googlebooks' })];
    expect(rankCovers(list).map((x) => x.id)).toEqual(['a', 'b']);
  });
});

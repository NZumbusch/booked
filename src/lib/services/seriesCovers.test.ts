import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import type { CoverAnalysis } from '../covers/colors';
import { matchingCover, siblingLooks } from './seriesCovers';

const look = (r: number, g: number, b: number, lightness: number): CoverAnalysis => ({
  color: [r, g, b], hue: 0, saturation: 0.5, lightness, palette: [[r, g, b]], contrast: 0.2
});
const NAVY = look(20, 20, 50, 0.1);
const book = (id: string, series?: string, cover?: string) =>
  createBook({ title: id, series, cover }, { id, now: '2026-01-01T00:00:00.000Z' });

describe('series covers', () => {
  it('picks the candidate that looks like the other volumes', async () => {
    const colours: Record<string, CoverAnalysis> = { white: look(250, 250, 250, 0.95), navy: look(25, 22, 55, 0.12), red: look(200, 30, 30, 0.4) };
    const url = await matchingCover(book('a', 'Goethe'), [NAVY], {
      probe: async () => true,
      siblings: () => [],
      candidates: async () => ['white', 'red', 'navy'].map((n) => ({ url: `u-${n}`, thumb: n })),
      sample: async (thumb) => ({ analysis: colours[thumb], w: 300, h: 450 })
    });
    expect(url).toBe('u-navy');
  });

  it('gives nothing when no candidate is close, and ignores wide scans', async () => {
    const ctx = {
      probe: async () => true,
      siblings: () => [],
      candidates: async () => [{ url: 'u-wide', thumb: 'wide' }, { url: 'u-white', thumb: 'white' }]
    };
    const sample = async (t: string) => (t === 'wide' ? { analysis: look(20, 20, 50, 0.1), w: 900, h: 400 } : { analysis: look(250, 250, 250, 0.95), w: 300, h: 450 });
    expect(await matchingCover(book('a', 'Goethe'), [NAVY], { ...ctx, sample })).toBeUndefined();
  });

  it('collects the cover colours of the same series only', () => {
    const books = [book('a', 'Goethe', 'x'), book('b', 'goethe', 'y'), book('c', 'Jean Paul', 'z'), book('d', 'Goethe')];
    const seen = siblingLooks(books, books[0], (c) => (c === 'y' ? NAVY : undefined));
    expect(seen).toEqual([NAVY]);
  });
});

import { isUniform } from './seriesCovers';
describe('paperback lines', () => {
  it('counts a line only when its covers share a look', () => {
    const navy = [look(20, 20, 50, 0.1), look(25, 22, 55, 0.12), look(18, 20, 48, 0.1)];
    expect(isUniform(navy)).toBe(true);
    expect(isUniform([...navy.slice(0, 2), look(240, 200, 20, 0.6)])).toBe(false);
    expect(isUniform(navy.slice(0, 2))).toBe(false); // too few to tell
  });

  it('uses a uniform line for matching, ignores a mixed one, and series always count', () => {
    const line = (id: string, cover: string) => createBook({ title: id, line: 'Reclam', cover }, { id, now: '2026-01-01T00:00:00.000Z' });
    const books = [line('a', '1'), line('b', '2'), line('c', '3'), line('d', '4')];
    const same = (c: string) => ({ '1': look(240, 200, 20, 0.6), '2': look(238, 198, 24, 0.6), '3': look(242, 205, 18, 0.6) }[c]);
    expect(siblingLooks(books, books[3], same)).toHaveLength(3);
    const mixed = (c: string) => ({ '1': look(240, 200, 20, 0.6), '2': look(20, 20, 50, 0.1), '3': look(30, 160, 60, 0.4) }[c]);
    expect(siblingLooks(books, books[3], mixed)).toEqual([]);
  });
});

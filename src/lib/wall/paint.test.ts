import { describe, expect, it } from 'vitest';
import { MAX_TRIM, placeInRect } from './paint';

const box = { x: 10, y: 20, w: 100, h: 150 };

describe('placeInRect', () => {
  it('fills the tile when the cover is close to 2:3 (trimming a sliver)', () => {
    const p = placeInRect(640, 1000, box); // 0.64: slightly narrower than 2:3
        expect(p.dst).toEqual(box);
    expect(1 - p.src.h / 1000).toBeLessThanOrEqual(MAX_TRIM);
    expect(p.src.w / p.src.h).toBeCloseTo(2 / 3, 5);
  });

  it('shows unusually wide or narrow covers whole, never stretched', () => {
    for (const [w, h] of [[1000, 1000], [400, 1000]]) {
      const p = placeInRect(w, h, box);
      expect(p.src).toEqual({ x: 0, y: 0, w, h });
      expect(p.dst.w / p.dst.h).toBeCloseTo(w / h, 5);
      expect(p.dst.x).toBeGreaterThanOrEqual(box.x);
      expect(p.dst.y).toBeGreaterThanOrEqual(box.y);
      expect(p.dst.x + p.dst.w).toBeLessThanOrEqual(box.x + box.w + 1e-9);
      expect(p.dst.y + p.dst.h).toBeLessThanOrEqual(box.y + box.h + 1e-9);
    }
  });
});

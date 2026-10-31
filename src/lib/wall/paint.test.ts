import { describe, expect, it } from 'vitest';
import { placeInRect, TOP_SHARE } from './paint';

const box = { x: 10, y: 20, w: 100, h: 150 };

describe('placeInRect', () => {
  it('always fills the whole tile with the same 2:3 shape, never stretched', () => {
    for (const [w, h] of [[640, 1000], [1000, 1000], [400, 1000], [600, 900]]) {
      const p = placeInRect(w, h, box);
      expect(p.dst).toEqual(box);
      expect(p.src.w / p.src.h).toBeCloseTo(2 / 3, 5);
      expect(p.src.x).toBeGreaterThanOrEqual(0);
      expect(p.src.y).toBeGreaterThanOrEqual(0);
      expect(p.src.x + p.src.w).toBeLessThanOrEqual(w + 1e-9);
      expect(p.src.y + p.src.h).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it('crops wide covers evenly at the sides', () => {
    const p = placeInRect(1000, 1000, box);
    expect(p.src.x).toBeCloseTo((1000 - p.src.w) / 2);
  });

  it('crops tall covers mostly at the bottom, keeping the title area', () => {
    const p = placeInRect(400, 1000, box);
    const excess = 1000 - p.src.h;
    expect(p.src.y).toBeCloseTo(excess * TOP_SHARE);
    expect(p.src.y).toBeLessThan(excess / 2);
  });

  it('leaves exact 2:3 covers untouched', () => {
    expect(placeInRect(600, 900, box).src).toEqual({ x: 0, y: 0, w: 600, h: 900 });
  });
});

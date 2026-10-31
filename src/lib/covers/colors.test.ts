import { describe, expect, it } from 'vitest';
import { analyzePixels, colorSortKey, isNiceCover, rgbToHsl, type RGB } from './colors';

/** RGBA buffer from a list of [colour, count]. */
function image(parts: [RGB, number][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [c, n] of parts) for (let i = 0; i < n; i++) out.push(c[0], c[1], c[2], 255);
  return new Uint8ClampedArray(out);
}

describe('rgbToHsl', () => {
  it('converts primaries and greys', () => {
    expect(rgbToHsl([255, 0, 0])).toEqual([0, 1, 0.5]);
    expect(rgbToHsl([0, 0, 255])[0]).toBe(240);
    expect(rgbToHsl([128, 128, 128])[1]).toBe(0);
  });
});

describe('analyzePixels', () => {
  it('picks the colourful part over a large white background', () => {
    const a = analyzePixels(image([[[250, 250, 250], 500], [[200, 40, 30], 300], [[20, 20, 20], 50]]));
    expect(a.color).toEqual([200, 40, 30]);
    expect(Math.round(a.hue)).toBe(4);
    expect(a.palette[0]).toEqual([250, 250, 250]);
    expect(a.contrast).toBeGreaterThan(0.2);
  });
  it('reports a flat placeholder as low contrast', () => {
    const a = analyzePixels(image([[[230, 230, 230], 800]]));
    expect(a.contrast).toBe(0);
    expect(isNiceCover(180, 270, a.contrast)).toBe(false);
  });
});

describe('isNiceCover', () => {
  it('needs size, book shape and some contrast', () => {
    expect(isNiceCover(180, 270, 0.2)).toBe(true);
    expect(isNiceCover(330, 500, 0.057)).toBe(true); // a plain, dark real cover (Penguin Ulysses)
    expect(isNiceCover(1, 1, 0.2)).toBe(false); // Open Library "no cover" pixel
    expect(isNiceCover(300, 200, 0.2)).toBe(false); // landscape
  });
});

describe('colorSortKey', () => {
  it('orders colours by hue and puts greys last', () => {
    const red = colorSortKey({ hue: 0, saturation: 0.8, lightness: 0.5 });
    const blue = colorSortKey({ hue: 220, saturation: 0.8, lightness: 0.5 });
    const grey = colorSortKey({ hue: 0, saturation: 0.05, lightness: 0.5 });
    expect(red).toBeLessThan(blue);
    expect(blue).toBeLessThan(grey);
  });
});

import { looksLikePlaceholder } from './colors';
describe('looksLikePlaceholder', () => {
  it('flags pale colourless low-contrast tiles only', () => {
    expect(looksLikePlaceholder({ lightness: 0.9, saturation: 0.05, contrast: 0.04 })).toBe(true);
    expect(looksLikePlaceholder({ lightness: 0.5, saturation: 0.6, contrast: 0.3 })).toBe(false);
  });
});

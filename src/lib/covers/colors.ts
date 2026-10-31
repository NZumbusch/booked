/**
 * Cover colour analysis from a small RGBA sample (e.g. the cover drawn at 24×36 px):
 * the dominant colour (largest cluster, nudged towards colourful ones), average lightness,
 * and whether the image looks like a real cover rather than a blank placeholder.
 */

export type RGB = [number, number, number];

export interface CoverAnalysis {
  /** Dominant colour, sRGB 0–255. */
  color: RGB;
  /** Hue 0–360, saturation and lightness 0–1 of the dominant colour. */
  hue: number;
  saturation: number;
  lightness: number;
  /** A few colours of the cover, most prominent first. */
  palette: RGB[];
  /** Spread of lightness (0 = flat single colour). */
  contrast: number;
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [h * 60, s, l];
}

const dist2 = (a: RGB, b: RGB) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Tiny k-means over the sampled pixels (deterministic seeding). */
function kmeans(pixels: RGB[], k: number, rounds = 8): { center: RGB; size: number }[] {
  if (!pixels.length) return [];
  let centers: RGB[] = Array.from({ length: k }, (_, i) => pixels[Math.floor(((i + 0.5) * pixels.length) / k)]);
  let sizes = new Array(k).fill(0);
  for (let round = 0; round < rounds; round++) {
    const sums = centers.map(() => [0, 0, 0]);
    sizes = new Array(k).fill(0);
    for (const p of pixels) {
      let best = 0;
      for (let c = 1; c < k; c++) if (dist2(p, centers[c]) < dist2(p, centers[best])) best = c;
      sums[best][0] += p[0];
      sums[best][1] += p[1];
      sums[best][2] += p[2];
      sizes[best]++;
    }
    centers = centers.map((c, i) => (sizes[i] ? (sums[i].map((s) => s / sizes[i]) as RGB) : c));
  }
  return centers.map((center, i) => ({ center: center.map(Math.round) as RGB, size: sizes[i] })).filter((c) => c.size > 0);
}

export function analyzePixels(rgba: Uint8ClampedArray | Uint8Array): CoverAnalysis {
  const pixels: RGB[] = [];
  for (let i = 0; i + 3 < rgba.length; i += 4) if (rgba[i + 3] > 128) pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  const clusters = kmeans(pixels, 4).sort((a, b) => b.size - a.size);
  // Prefer a reasonably large, colourful cluster over a big white/grey background.
  const score = (c: { center: RGB; size: number }) => {
    const [, s, l] = rgbToHsl(c.center);
    const vivid = s * (1 - Math.abs(l - 0.5) * 1.6);
    return c.size * (0.35 + Math.max(0, vivid));
  };
  const dominant = [...clusters].sort((a, b) => score(b) - score(a))[0]?.center ?? [128, 128, 128];
  const [hue, saturation, lightness] = rgbToHsl(dominant);
  const lum = pixels.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
  const mean = lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length);
  const contrast = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lum.length)) / 255;
  return { color: dominant, hue, saturation, lightness, palette: clusters.map((c) => c.center), contrast };
}

/** A real cover: big enough, book-shaped and not a flat placeholder. */
export function isNiceCover(width: number, height: number, contrast: number): boolean {
  const ratio = width / height;
  return width >= 90 && height >= 120 && ratio >= 0.5 && ratio <= 0.9 && contrast >= 0.025;
}

/** Order for colour layouts: greys/near-black/near-white last, colours along the hue wheel, then by lightness. */
export function colorSortKey(a: Pick<CoverAnalysis, 'hue' | 'saturation' | 'lightness'>): number {
  const grey = a.saturation < 0.15 || a.lightness < 0.12 || a.lightness > 0.92;
  return grey ? 1000 + (1 - a.lightness) * 100 : Math.round(a.hue / 15) * 10 + a.lightness * 5;
}

export function rgbCss([r, g, b]: RGB): string {
  return `rgb(${r} ${g} ${b})`;
}

/** Google Books' "image not available" tile (and similar blanks): pale, nearly colourless, almost no contrast. */
export function looksLikePlaceholder(a: Pick<CoverAnalysis, 'lightness' | 'saturation' | 'contrast'>): boolean {
  // Measured on Google's "image not available" tiles: white, no colour, contrast 0.03. Real light covers
  // (a pencil sketch on cream, contrast 0.09) must not be caught.
  return a.lightness >= 0.9 && a.saturation < 0.1 && a.contrast < 0.06;
}

/** Book covers are portrait (about 2:3). Wide title-page scans, strips and thumbnails of other shapes are not covers. */
export function isCoverShape(width: number, height: number): boolean {
  if (!width || !height) return true; // unknown: give it the benefit of the doubt
  const ratio = width / height;
  return ratio >= 0.5 && ratio <= 0.9;
}

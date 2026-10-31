/**
 * How a cover image is placed in its 2:3 tile, so covers of any shape look right and nothing
 * important is cut off:
 *
 * - Covers close to 2:3 fill the tile edge to edge (at most a thin sliver is trimmed).
 * - Unusually wide or narrow covers are shown whole and centred, in their true shape,
 *   rather than stretched or heavily cropped.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest share of a cover that may be trimmed before showing it whole instead. */
export const MAX_TRIM = 0.08;

export interface Placement {
  /** Part of the image to draw (image pixels). */
  src: Rect;
  /** Where to draw it (canvas units), always inside the tile. */
  dst: Rect;
}

/** Place a `bw`×`bh` image in the tile `box`. */
export function placeInRect(bw: number, bh: number, box: Rect): Placement {
  const ratio = bw / bh;
  const target = box.w / box.h;
  const full = { x: 0, y: 0, w: bw, h: bh };
  if (ratio > target) {
    // Wider than the tile: trim the sides a little, or show it whole.
    const keep = target / ratio;
    if (1 - keep <= MAX_TRIM) return { src: { x: (bw * (1 - keep)) / 2, y: 0, w: bw * keep, h: bh }, dst: box };
    const h = box.w / ratio;
    return { src: full, dst: { x: box.x, y: box.y + (box.h - h) / 2, w: box.w, h } };
  }
  const keep = ratio / target;
  if (1 - keep <= MAX_TRIM) return { src: { x: 0, y: (bh * (1 - keep)) / 2, w: bw, h: bh * keep }, dst: box };
  const w = box.h * ratio;
  return { src: full, dst: { x: box.x + (box.w - w) / 2, y: box.y, w, h: box.h } };
}

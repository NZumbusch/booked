/**
 * How a cover image fills its 2:3 tile. Every tile has the same size and the field is seamless,
 * so covers are cropped to fill (never stretched). The crop is as small as the cover's shape
 * allows: wide covers lose equal strips left and right; tall covers lose more at the bottom than
 * at the top, because titles and artwork usually sit in the upper part.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  /** Part of the image to draw (image pixels). */
  src: Rect;
  /** Where to draw it: always exactly the tile. */
  dst: Rect;
}

/** Share of a tall cover's excess height taken from the top (the rest from the bottom). */
export const TOP_SHARE = 0.3;

/** Fill the tile `box` with a `bw`×`bh` image. */
export function placeInRect(bw: number, bh: number, box: Rect): Placement {
  const ratio = bw / bh;
  const target = box.w / box.h;
  if (ratio > target) {
    const w = bh * target;
    return { src: { x: (bw - w) / 2, y: 0, w, h: bh }, dst: box };
  }
  const h = bw / target;
  return { src: { x: 0, y: (bh - h) * TOP_SHARE, w: bw, h }, dst: box };
}

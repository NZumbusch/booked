/**
 * A generalised Hilbert curve ("gilbert", after Jakub Červený's algorithm) through every cell of a
 * w × h rectangle, of any size. Unlike a Hilbert curve cut out of a power-of-two square, it never
 * jumps: each cell is next to the one before. Laying an ordered sequence along it keeps neighbours
 * in the sequence neighbours on the map, so a topic becomes one connected region.
 */
export function gilbert(width: number, height: number): [number, number][] {
  const out: [number, number][] = [];
  if (width <= 0 || height <= 0) return out;
  const sign = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const gen = (x: number, y: number, ax: number, ay: number, bx: number, by: number) => {
    const w = Math.abs(ax + ay), h = Math.abs(bx + by);
    const dax = sign(ax), day = sign(ay), dbx = sign(bx), dby = sign(by);
    if (h === 1) {
      for (let i = 0; i < w; i++) { out.push([x, y]); x += dax; y += day; }
      return;
    }
    if (w === 1) {
      for (let i = 0; i < h; i++) { out.push([x, y]); x += dbx; y += dby; }
      return;
    }
    let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
    let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
    const w2 = Math.abs(ax2 + ay2), h2 = Math.abs(bx2 + by2);
    if (2 * w > 3 * h) {
      if (w2 % 2 && w > 2) { ax2 += dax; ay2 += day; }
      gen(x, y, ax2, ay2, bx, by);
      gen(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by);
    } else {
      if (h2 % 2 && h > 2) { bx2 += dbx; by2 += dby; }
      gen(x, y, bx2, by2, ax2, ay2);
      gen(x + bx2, y + by2, ax, ay, bx - bx2, by - by2);
      gen(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby), -bx2, -by2, -(ax - ax2), -(ay - ay2));
    }
  };
  if (width >= height) gen(0, 0, width, 0, 0, height);
  else gen(0, 0, 0, height, width, 0);
  return out;
}

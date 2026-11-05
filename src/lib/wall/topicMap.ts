import type { FieldLabel, FieldTile } from './field';
import type { SimilarityModel } from './similarity';

/**
 * The topic map of the cover wall: covers placed so that similar books sit side by side, with
 * regions that flow into each other (no rectangles).
 *
 * 1. Start: a chain through the books, always on to the most similar one not placed yet, laid
 *    along a space-filling curve (so the chain's neighbours become map neighbours).
 * 2. Refine: many swaps of two covers, kept when they put more similar books next to each other
 *    (with a little randomness early on, so regions can still move and borders soften).
 * On an endless wall a book may appear several times: each copy keeps far from the others, so it
 * shows up in different neighbourhoods (a book on Berlin and philosophy near both).
 */

/** Small deterministic PRNG, so the same library and seed always give the same wall. */
export function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Grid {
  /** Cells in space-filling-curve order (neighbours in this list are neighbours on the map). */
  cells: { col: number; row: number }[];
  /** Neighbouring cell indexes (8 around; across the edge on an endless wall). */
  neighbours: number[][];
  /** Distance in cells between two cell indexes (wrapping on an endless wall). */
  dist(a: number, b: number): number;
}

export function makeGrid(cells: { col: number; row: number }[], wrap?: { cols: number; rows: number }): Grid {
  const at = new Map(cells.map((c, i) => [`${c.col},${c.row}`, i]));
  const norm = (v: number, p: number) => ((v % p) + p) % p;
  const neighbours = cells.map((c) => {
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const col = wrap ? norm(c.col + dc, wrap.cols) : c.col + dc;
      const row = wrap ? norm(c.row + dr, wrap.rows) : c.row + dr;
      const j = at.get(`${col},${row}`);
      if (j !== undefined && !out.includes(j)) out.push(j);
    }
    return out;
  });
  const dist = (a: number, b: number) => {
    let dc = Math.abs(cells[a].col - cells[b].col);
    let dr = Math.abs(cells[a].row - cells[b].row);
    if (wrap) {
      dc = Math.min(dc, wrap.cols - dc);
      dr = Math.min(dr, wrap.rows - dr);
    }
    return Math.max(dc, dr * 1.5);
  };
  return { cells, neighbours, dist };
}

/** A chain through all books: each step goes to the most similar book not visited yet. */
function chain(model: SimilarityModel, n: number, random: () => number): number[] {
  const seen = new Uint8Array(n);
  const out: number[] = [];
  let cur = Math.floor(random() * n);
  while (out.length < n) {
    seen[cur] = 1;
    out.push(cur);
    let next = -1;
    // most similar unvisited neighbour of the current book, else of the last few in the chain
    for (let back = out.length - 1; back >= Math.max(0, out.length - 6) && next < 0; back--) {
      next = model.nearest[out[back]].find((j) => !seen[j]) ?? -1;
    }
    if (next < 0) {
      // nothing similar left nearby: jump to a random unvisited book (a new region starts)
      const left: number[] = [];
      for (let i = 0; i < n; i++) if (!seen[i]) left.push(i);
      if (!left.length) break;
      next = left[Math.floor(random() * left.length)];
    }
    cur = next;
  }
  return out;
}

export interface MapResult {
  /** Book index per cell. */
  slots: number[];
  /** Different arrangements of the same map (endless wall: each repeat uses one of them). */
  variants: number[][];
}

/**
 * Fill every cell with a book (books repeat if there are more cells than books) and arrange them.
 * `copiesApart`: copies of one book keep at least this many cells apart.
 */
export interface ArrangeOptions {
  /** The book sequence to lay out for each round of copies (topic tree order); else a similarity chain. */
  order?: (round: number) => number[];
  /** How many topic levels two books share: sharing a path keeps them together while borders soften. */
  shared?: (a: number, b: number) => number;
  /** For measuring: called with the arrangement after each stage. */
  trace?: (stage: string, slots: number[]) => void;
}

/** Extra closeness for books that share their broad topic, sub-topic, sub-sub-topic. */
const SHARED_BONUS = [0, 0.12, 0.24, 0.34];

export function arrangeByTopic(model: SimilarityModel, n: number, grid: Grid, seed: number, copiesApart: number, variantCount = 1, opts: ArrangeOptions = {}): MapResult {
  const random = rng(seed);
  const m = grid.cells.length;
  // 1. one sequence per round of copies, joined end to end along the curve
  const slots: number[] = [];
  for (let round = 0; slots.length < m; round++) slots.push(...(opts.order ? opts.order(round) : chain(model, n, random)));
  slots.length = m;
  opts.trace?.('order', [...slots]);

  const shared = opts.shared;
  const sim = (a: number, b: number) =>
    a === b ? 0 : (model.sim[a].get(b) ?? 0) + (shared ? SHARED_BONUS[Math.min(3, shared(a, b))] : 0);
  const where: number[][] = Array.from({ length: n }, () => []);
  slots.forEach((b, i) => where[b].push(i));
  /** How well book `b` fits into cell `c` (its neighbours' similarity), minus a penalty for a copy too close. */
  const fit = (b: number, c: number, skip = -1) => {
    let s = 0;
    for (const k of grid.neighbours[c]) if (k !== skip) s += sim(b, slots[k]);
    for (const other of where[b]) if (other !== c && other !== skip && grid.dist(other, c) < copiesApart) s -= 3;
    return s;
  };
  const move = (b: number, from: number, to: number) => {
    const w = where[b];
    w[w.indexOf(from)] = to;
  };
  const swap = (a: number, c: number) => {
    const x = slots[a], y = slots[c];
    if (x === y) return;
    slots[a] = y;
    slots[c] = x;
    move(x, a, c);
    move(y, c, a);
  };
  /** Gain from swapping the covers in cells a and c. */
  const gain = (a: number, c: number) => {
    const x = slots[a], y = slots[c];
    if (x === y) return -Infinity;
    const before = fit(x, a, c) + fit(y, c, a);
    swap(a, c);
    const after = fit(x, c, a) + fit(y, a, c);
    swap(a, c);
    return after - before;
  };

  // 2. refine: swaps that move a book next to one of its most similar books (or anywhere close)
  const steps = Math.min(220_000, 45 * m);
  for (let s = 0; s < steps; s++) {
    const temp = (opts.order ? 0.08 : 0.25) * (1 - s / steps) ** 2;
    const a = Math.floor(random() * m);
    const x = slots[a];
    let c: number;
    const near = model.nearest[x];
    if (near.length && random() < 0.75) {
      const friend = near[Math.floor(random() * Math.min(near.length, 6))];
      const spots = where[friend];
      const spot = spots[Math.floor(random() * spots.length)];
      const around = grid.neighbours[spot];
      c = around[Math.floor(random() * around.length)];
    } else {
      const around = grid.neighbours[a];
      c = around[Math.floor(random() * around.length)];
      if (random() < 0.5) c = grid.neighbours[c][Math.floor(random() * grid.neighbours[c].length)];
    }
    if (c === a || c === undefined) continue;
    const g = gain(a, c);
    if (g > 0 || (temp > 0 && random() < Math.exp(g / temp))) swap(a, c);
  }

  opts.trace?.('refined', [...slots]);
  // 2b. copies too close (the curve folds, so far apart in the order can still be near on the map):
  // move one to the best-fitting cell elsewhere that is far enough from all its other copies.
  if (copiesApart > 0) {
    /** Cells holding a book of the same broad topic (sharing at least the first path level). */
    const poolCache = new Map<number, number[]>();
    const sameTopic = (b: number) => {
      let p = poolCache.get(b);
      if (!p) {
        p = [];
        for (let c = 0; c < m; c++) if (slots[c] !== b && shared!(b, slots[c]) >= 1) p.push(c);
        poolCache.set(b, p);
      }
      return p;
    };
    const tooClose = (b: number, c: number, skip = -1) => where[b].some((o) => o !== c && o !== skip && grid.dist(o, c) < copiesApart);
    for (let pass = 0; pass < 3; pass++) {
      let fixed = 0;
      for (let a = 0; a < m; a++) {
        const x = slots[a];
        if (!tooClose(x, a)) continue;
        let best = -1, bestG = -Infinity;
        // swap with a book of the same topic (both stay in their region), else with any
        const pool = shared ? sameTopic(x) : undefined;
        for (let t = 0; t < 300; t++) {
          const c = pool?.length && t < 240 ? pool[Math.floor(random() * pool.length)] : Math.floor(random() * m);
          const y = slots[c];
          if (c === a || y === x || tooClose(x, c, a)) continue;
          // the book coming back must not end up too close to its own copies either
          if (where[y].some((o) => o !== c && grid.dist(o, a) < copiesApart)) continue;
          const g = gain(a, c);
          if (g > bestG) { bestG = g; best = c; }
        }
        if (best >= 0) { swap(a, best); fixed++; }
      }
      if (!fixed) break;
    }
  }

  opts.trace?.('repaired', [...slots]);
  // 3. variants: a few more small local swaps that hardly change how well things fit, so each repeat
  // of an endless wall is arranged a little differently while the map (and the seams) stay the same.
  const base = [...slots];
  const variants: number[][] = [base];
  for (let v = 1; v < variantCount; v++) {
    for (let i = 0; i < m; i++) {
      slots[i] = base[i];
    }
    where.forEach((w) => (w.length = 0));
    slots.forEach((b, i) => where[b].push(i));
    for (let s = 0; s < m * 3; s++) {
      const a = Math.floor(random() * m);
      const around = grid.neighbours[a];
      const c = around[Math.floor(random() * around.length)];
      if (c !== undefined && gain(a, c) > -0.12) swap(a, c);
    }
    variants.push([...slots]);
  }
  if (variantCount > 1) {
    for (let i = 0; i < m; i++) slots[i] = base[i];
  }
  return { slots: base, variants };
}

/** How many topic levels get tags (deeper ones are rarely big enough to name a region). */
export const TOPIC_LEVELS = 3;

/**
 * Names for regions of the map, on several levels: level 1 the broad topics (Fiction, History…),
 * levels 2 and 3 their sub-topics (Crime & mystery › Police procedural), and the last level series
 * and authors. Each cell gets, per level, the strongest name around it; connected cells with the
 * same name form a region, labelled at its middle. The wall shows a deeper level the closer you zoom.
 */
export function regionLabels(
  model: SimilarityModel, slots: number[], grid: Grid, cellCentre: (i: number) => { x: number; y: number }, wrapCells?: number
): FieldLabel[] {
  const m = slots.length;
  const out: FieldLabel[] = [];
  const levels = TOPIC_LEVELS + 1;
  for (let level = 1; level <= levels; level++) {
    const people = level === levels;
    /** The names a book offers on this level, with their weight. */
    const offers = (b: number): { key: string; w: number; label: string }[] => {
      if (people) return model.features[b].filter((f) => (f.kind === 'series' || f.kind === 'author') && f.w > 0);
      const key = model.tree.paths[b][level - 1];
      return key ? [{ key, w: 1, label: model.topicLabel.get(key) ?? key }] : [];
    };
    const minRegion = people ? 3 : [6, 4, 3][level - 1] ?? 3;
    const threshold = people ? 4 : 2.4;
    const labelOf: (string | undefined)[] = new Array(m);
    const text = new Map<string, string>();
    for (let i = 0; i < m; i++) {
      const score = new Map<string, number>();
      for (const c of [i, ...grid.neighbours[i]]) {
        for (const f of offers(slots[c])) {
          score.set(f.key, (score.get(f.key) ?? 0) + f.w * (c === i ? 1.5 : 1));
          text.set(f.key, f.label);
        }
      }
      let best: string | undefined, bestS = threshold;
      for (const [k, v] of score) if (v > bestS) { best = k; bestS = v; }
      labelOf[i] = best;
    }
    // connected regions with the same label
    const regions: { key: string; cells: number[]; books: number }[] = [];
    const done = new Uint8Array(m);
    for (let i = 0; i < m; i++) {
      const key = labelOf[i];
      if (!key || done[i]) continue;
      const region: number[] = [];
      const stack = [i];
      done[i] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        region.push(c);
        for (const k of grid.neighbours[c]) if (!done[k] && labelOf[k] === key) { done[k] = 1; stack.push(k); }
      }
      const books = new Set(region.map((c) => slots[c])).size;
      if (books < minRegion || (wrapCells && region.length >= wrapCells * 0.6)) continue;
      regions.push({ key, cells: region, books });
    }
    // Per topic only its main regions get a tag (not every small patch where it shows up again).
    const largest = new Map<string, number>();
    for (const r of regions) largest.set(r.key, Math.max(largest.get(r.key) ?? 0, r.books));
    for (const r of regions) {
      if (r.books < largest.get(r.key)! * 0.6) continue;
      // the cell nearest the region's middle (robust across the endless seam); sampled for big regions
      const sample = r.cells.length > 120 ? r.cells.filter((_, k) => k % Math.ceil(r.cells.length / 120) === 0) : r.cells;
      let mid = r.cells[0], bestD = Infinity;
      for (const c of sample) {
        let d = 0;
        for (const o of sample) d += grid.dist(c, o);
        if (d < bestD) { bestD = d; mid = c; }
      }
      const p = cellCentre(mid);
      out.push({ text: text.get(r.key)!, level, x: p.x, y: p.y, count: r.books });
    }
  }
  return out;
}

export type { FieldTile };

import { colorSortKey, type CoverAnalysis } from '../covers/colors';
import { labelOf, pathOf } from '../domain/locations';
import { fold } from '../domain/query';
import type { Book, Location } from '../domain/types';
import { ordinal } from '../format';

/**
 * Cover field layouts: one seamless field of covers instead of rows or islands.
 *
 * - "disc": a roughly circular blob with a gently irregular edge, no holes.
 * - "endless": a rectangle that wraps around in both directions (scrolling never ends).
 *
 * Ordered arrangements (topic › subtopic, letter › title, century › decade, place › room…) are
 * laid along a Hilbert curve over the field, which keeps neighbours in the order next to each
 * other, so every group becomes one compact region with its subgroups nested inside.
 * Colour becomes a colour wheel (disc) or a hue band that wraps (endless).
 */

export type FieldOrder = 'color' | 'topic' | 'title' | 'author' | 'time' | 'room';
export type FieldShape = 'disc' | 'endless';

export const FIELD_ORDERS: Record<FieldOrder, string> = {
  color: 'Colour', topic: 'Topic', title: 'Title', author: 'Author', time: 'When written', room: 'Room'
};

/** World size of one cell: exactly one 2:3 cover, so the field is seamless. */
export const CELL_W = 1;
export const CELL_H = 1.5;

/** Cell geometry: the world size of one grid cell. */
export interface Geometry {
  cellW: number;
  cellH: number;
}
export const RECT: Geometry = { cellW: CELL_W, cellH: CELL_H };

/** World position of a cell's top-left corner. */
export function cellPos(col: number, row: number, g: Geometry): { x: number; y: number } {
  return { x: col * g.cellW, y: row * g.cellH };
}

export interface FieldItem {
  book: Book;
  analysis?: CoverAnalysis;
}

export interface FieldTile {
  id: string;
  col: number;
  row: number;
}

export interface FieldLabel {
  text: string;
  /** World coordinates of the group's centre. */
  x: number;
  y: number;
  /** 1 = group, 2 = subgroup. */
  level: 1 | 2;
  count: number;
}

export interface FieldLayout {
  tiles: FieldTile[];
  labels: FieldLabel[];
  /** Endless: the field repeats every `cols` × `rows` cells. */
  wrap?: { cols: number; rows: number };
  bounds: { minCol: number; maxCol: number; minRow: number; maxRow: number };
}

// ---------------------------------------------------------------- shapes

/** Smooth, deterministic wobble around the circle (a few low-frequency waves). */
function wobble(angle: number, seed: number): number {
  return 0.07 * Math.sin(3 * angle + seed) + 0.05 * Math.sin(5 * angle + seed * 1.7) + 0.035 * Math.sin(8 * angle + seed * 2.3);
}

/**
 * The `n` cells of a roughly round blob around (0,0), innermost first. Each cell's distance is
 * scaled by a wobble that only depends on its angle, so the shape stays solid (star-shaped).
 */
export function discCells(n: number, seed = 1, g: Geometry = RECT): FieldTile[] {
  if (n <= 0) return [];
  const radius = Math.sqrt((n * g.cellW * g.cellH) / Math.PI) * 1.35 + 2;
  const maxC = Math.ceil(radius / g.cellW) + 1;
  const maxR = Math.ceil(radius / g.cellH) + 1;
  const cells: { col: number; row: number; d: number }[] = [];
  for (let row = -maxR; row <= maxR; row++) {
    for (let col = -maxC; col <= maxC; col++) {
      const { x, y } = cellPos(col, row, g);
      const d = Math.hypot(x, y) / (1 + wobble(Math.atan2(y, x), seed));
      cells.push({ col, row, d });
    }
  }
  return cells.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col).slice(0, n).map(({ col, row }) => ({ id: '', col, row }));
}

/** Torus size for n covers: roughly square in world units (an even number of rows for honeycombs, so they wrap). */
export function torusSize(n: number, g: Geometry = RECT): { cols: number; rows: number } {
  const cols = Math.max(1, Math.round(Math.sqrt((n * g.cellH) / g.cellW)));
  return { cols, rows: Math.max(1, Math.ceil(n / cols)) };
}

// ---------------------------------------------------------------- Hilbert ordering

/** Position of (x, y) along a Hilbert curve filling a size×size square (size = power of two). */
export function hilbertIndex(size: number, x: number, y: number): number {
  let d = 0;
  for (let s = size / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x;
        y = s - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return d;
}

function hilbertSorted(cells: FieldTile[]): FieldTile[] {
  const minC = Math.min(...cells.map((c) => c.col));
  const minR = Math.min(...cells.map((c) => c.row));
  const span = Math.max(...cells.map((c) => c.col - minC), ...cells.map((c) => c.row - minR)) + 1;
  let size = 1;
  while (size < span) size *= 2;
  return [...cells].sort((a, b) => hilbertIndex(size, a.col - minC, a.row - minR) - hilbertIndex(size, b.col - minC, b.row - minR));
}

// ---------------------------------------------------------------- ordering (group › subgroup › colour)

interface Keyed {
  item: FieldItem;
  g1: string;
  g2: string;
}

const colorKey = (it: FieldItem) => (it.analysis ? colorSortKey(it.analysis) : 2000);
const titleKey = (b: Book) => fold(b.title.replace(/^(the|a|an|der|die|das|le|la|les|el|il)\s+/i, ''));
const topicsOf = (b: Book) => [...new Set([...b.genres, ...(b.subjects ?? [])].map((t) => t.trim()).filter(Boolean))];

/**
 * Topic › subtopic for every book. Genres are the broad categories, subjects the specific ones:
 * the topic is the book's most common usable genre (else subject), the subtopic its most common
 * other topic. "Usable" = not tiny and not near-universal (like "Fiction").
 */
export function topicKeys(items: FieldItem[], minSize = 3): Map<string, { topic: string; sub: string }> {
  const counts = new Map<string, { label: string; n: number }>();
  for (const it of items) for (const t of topicsOf(it.book)) {
    const e = counts.get(fold(t)) ?? { label: t, n: 0 };
    e.n++;
    counts.set(fold(t), e);
  }
  const limit = Math.max(minSize, items.length * (items.length >= 20 ? 0.6 : 0.75));
  const usable = (k: string) => (counts.get(k)?.n ?? 0) >= minSize && (counts.get(k)?.n ?? 0) <= limit;
  const rank = (list: string[]) => [...new Set(list.map(fold))].filter(usable).sort((a, b2) => counts.get(b2)!.n - counts.get(a)!.n || a.localeCompare(b2));
  const out = new Map<string, { topic: string; sub: string }>();
  for (const it of items) {
    const genres = rank(it.book.genres);
    const subjects = rank(it.book.subjects ?? []);
    const first = genres[0] ?? subjects[0];
    const second = [...subjects, ...genres].find((k) => k !== first);
    out.set(it.book.id, { topic: first ? counts.get(first)!.label : 'Other', sub: second ? counts.get(second)!.label : '' });
  }
  return out;
}

function keyed(items: FieldItem[], order: Exclude<FieldOrder, 'color'>, locations: Location[]): Keyed[] {
  switch (order) {
    case 'topic': {
      const keys = topicKeys(items);
      return items.map((item) => ({ item, g1: keys.get(item.book.id)!.topic, g2: keys.get(item.book.id)!.sub }));
    }
    case 'title':
      return items.map((item) => ({ item, g1: (titleKey(item.book)[0] ?? '#').toUpperCase().replace(/[^A-Z]/, '#'), g2: '' }));
    case 'author':
      return items.map((item) => {
        const a = item.book.authors[0] ?? 'Unknown author';
        return { item, g1: (a.split(' ').pop()![0] ?? '#').toUpperCase(), g2: a };
      });
    case 'time':
      return items.map((item) => {
        const y = item.book.writing?.year ?? item.book.firstPublishedYear ?? item.book.publishedYear;
        return y ? { item, g1: `${ordinal(Math.floor((y - 1) / 100) + 1)} century`, g2: `${Math.floor(y / 10) * 10}s` } : { item, g1: 'Unknown year', g2: '' };
      });
    case 'room':
      return items.map((item) => {
        const path = pathOf(locations, item.book.locationId);
        return { item, g1: path[0]?.name ?? 'No location', g2: path[1] ? labelOf(locations, path[1].id) : '' };
      });
  }
}

/** Sort: bigger groups first (they claim the centre of the disc), then subgroups, then colour. */
function sortKeyed(list: Keyed[], order: FieldOrder): Keyed[] {
  const size1 = new Map<string, number>();
  const size2 = new Map<string, number>();
  for (const k of list) {
    size1.set(k.g1, (size1.get(k.g1) ?? 0) + 1);
    size2.set(k.g1 + '\u0000' + k.g2, (size2.get(k.g1 + '\u0000' + k.g2) ?? 0) + 1);
  }
  const natural = order === 'title' || order === 'author' || order === 'time';
  const last = (g: string) => (g === 'Other' || g === 'No location' || g === 'Unknown year' ? 1 : 0);
  return [...list].sort((a, b) =>
    last(a.g1) - last(b.g1) ||
    (natural ? a.g1.localeCompare(b.g1, undefined, { numeric: true }) : size1.get(b.g1)! - size1.get(a.g1)! || a.g1.localeCompare(b.g1)) ||
    (natural ? a.g2.localeCompare(b.g2, undefined, { numeric: true }) : size2.get(b.g1 + '\u0000' + b.g2)! - size2.get(a.g1 + '\u0000' + a.g2)! || a.g2.localeCompare(b.g2)) ||
    (order === 'title' ? titleKey(a.item.book).localeCompare(titleKey(b.item.book)) : colorKey(a.item) - colorKey(b.item))
  );
}

function labelsFor(list: Keyed[], tiles: FieldTile[], g: Geometry, wrap?: { cols: number; rows: number }): FieldLabel[] {
  const acc = new Map<string, { text: string; level: 1 | 2; xs: number[]; ys: number[] }>();
  list.forEach((k, i) => {
    const t = tiles[i];
    for (const [level, key, text] of [[1, k.g1, k.g1], [2, k.g1 + '\u0000' + k.g2, k.g2]] as const) {
      if (!text) continue;
      const e = acc.get(`${level}:${key}`) ?? { text, level, xs: [], ys: [] };
      e.xs.push(t.col);
      e.ys.push(t.row);
      acc.set(`${level}:${key}`, e);
    }
  });
  // Centre = the group's median cell (robust against groups split by the torus seam).
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const groupSize = new Map<string, number>();
  for (const k of list) groupSize.set(k.g1, (groupSize.get(k.g1) ?? 0) + 1);
  return [...acc.entries()]
    // A subgroup covering its whole group would only repeat information.
    .filter(([key, e]) => e.level === 1 || e.xs.length < (groupSize.get(key.slice(2).split('\u0000')[0]) ?? 0))
    .map(([, e]) => e)
    .filter((e) => e.xs.length >= (e.level === 1 ? 2 : 3))
    .map((e) => {
      const p = cellPos(median(e.xs), median(e.ys), g);
      return { text: e.text, level: e.level, count: e.xs.length, x: p.x + g.cellW / 2, y: p.y + g.cellH / 2 };
    })
    .filter((l) => !wrap || l.count < wrap.cols * wrap.rows);
}

// ---------------------------------------------------------------- colour wheel

/** Assign each item to the free cell nearest its target point (greedy, outermost targets first). */
function assignNearest(cells: FieldTile[], targets: { item: FieldItem; x: number; y: number; priority: number }[], g: Geometry): FieldTile[] {
  const free = new Map(cells.map((c) => [`${c.col},${c.row}`, c]));
  const out: FieldTile[] = [];
  for (const t of [...targets].sort((a, b) => b.priority - a.priority)) {
    const r0 = Math.round(t.y / g.cellH);
    const c0 = Math.round((t.x - cellPos(0, r0, g).x) / g.cellW);
    let found: FieldTile | undefined;
    for (let ring = 0; !found && ring < 400; ring++) {
      let best: { cell: FieldTile; d: number } | undefined;
      for (let dc = -ring; dc <= ring; dc++) {
        for (let dr = -ring; dr <= ring; dr++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue;
          const cell = free.get(`${c0 + dc},${r0 + dr}`);
          if (!cell) continue;
          const p = cellPos(cell.col, cell.row, g);
          const d = Math.hypot(p.x - t.x, p.y - t.y);
          if (!best || d < best.d) best = { cell, d };
        }
      }
      found = best?.cell;
    }
    if (!found) found = free.values().next().value!;
    free.delete(`${found.col},${found.row}`);
    out.push({ id: t.item.book.id, col: found.col, row: found.row });
  }
  return out;
}

function colorWheel(items: FieldItem[], cells: FieldTile[], g: Geometry): FieldTile[] {
  const radius = Math.max(1, ...cells.map((c) => {
    const p = cellPos(c.col, c.row, g);
    return Math.hypot(p.x, p.y);
  }));
  // Rank by colourfulness so the wheel fills evenly from grey centre to vivid edge.
  const vivid = (it: FieldItem) => (it.analysis ? it.analysis.saturation * (1 - Math.abs(it.analysis.lightness - 0.5)) : -1);
  const ranked = [...items].sort((a, b) => vivid(a) - vivid(b));
  const targets = ranked.map((item, i) => {
    const r = radius * Math.sqrt((i + 0.5) / ranked.length);
    const angle = ((item.analysis?.hue ?? 0) / 360) * Math.PI * 2 - Math.PI / 2;
    return { item, x: Math.cos(angle) * r, y: Math.sin(angle) * r, priority: r };
  });
  return assignNearest(cells, targets, g);
}

/**
 * Pads a sorted list to `total` cells with copies of books (the torus has a few more cells than
 * books). A copy is inserted at evenly spread places but shows a book from the far side of the
 * order, so a book never ends up right next to its own copy. `make` builds the copy from the
 * book it repeats and the neighbour it sits beside (so group labels stay right).
 */
export function spreadCopies<T>(sorted: T[], total: number, make: (source: T, neighbour: T) => T): T[] {
  const n = sorted.length;
  const extra = total - n;
  if (extra <= 0 || n === 0) return sorted;
  const out = [...sorted];
  for (let k = extra - 1; k >= 0; k--) {
    const at = Math.min(n - 1, Math.floor(((k + 0.5) * n) / extra));
    const source = sorted[(at + Math.floor(n / 2)) % n];
    out.splice(at + 1, 0, make(source, sorted[at]));
  }
  return out;
}

/** Endless colour: hue runs along x (wraps naturally), lightness goes up and back down along y (wraps too). */
function colorTorus(items: FieldItem[], cols: number, rows: number): FieldTile[] {
  const byHue = spreadCopies([...items].sort((a, b) => colorKey(a) - colorKey(b)), cols * rows, (src) => src);
  const tiles: FieldTile[] = [];
  for (let c = 0; c * rows < byHue.length; c++) {
    const column = byHue.slice(c * rows, (c + 1) * rows).sort((a, b) => (a.analysis?.lightness ?? 0.5) - (b.analysis?.lightness ?? 0.5));
    // Dark at top and bottom edge, light in the middle: the column wraps without a jump.
    const placed: FieldItem[] = new Array(column.length);
    column.forEach((it, i) => {
      const slot = i % 2 === 0 ? i / 2 : column.length - 1 - (i - 1) / 2;
      placed[slot] = it;
    });
    placed.forEach((it, r) => tiles.push({ id: it.book.id, col: c, row: r }));
  }
  return tiles;
}

// ---------------------------------------------------------------- main

export function fieldLayout(items: FieldItem[], order: FieldOrder, shape: FieldShape, locations: Location[], seed = 7, g: Geometry = RECT): FieldLayout {
  if (!items.length) return { tiles: [], labels: [], bounds: { minCol: 0, maxCol: 0, minRow: 0, maxRow: 0 } };
  let tiles: FieldTile[];
  let labels: FieldLabel[] = [];
  let wrap: FieldLayout['wrap'];

  if (shape === 'disc') {
    const cells = discCells(items.length, seed, g);
    if (order === 'color') tiles = colorWheel(items, cells, g);
    else {
      const list = sortKeyed(keyed(items, order, locations), order);
      const path = hilbertSorted(cells);
      tiles = list.map((k, i) => ({ id: k.item.book.id, col: path[i].col, row: path[i].row }));
      labels = labelsFor(list, tiles, g);
    }
  } else {
    wrap = torusSize(items.length, g);
    // Every cell is filled: if the torus has a few more cells than books, some books repeat (spread out, never side by side).
    if (order === 'color') tiles = colorTorus(items, wrap.cols, wrap.rows);
    else {
      const list = spreadCopies(sortKeyed(keyed(items, order, locations), order), wrap.cols * wrap.rows, (src, at) => ({ item: src.item, g1: at.g1, g2: at.g2 }));
      const cells: FieldTile[] = [];
      for (let row = 0; row < wrap.rows; row++) for (let col = 0; col < wrap.cols; col++) cells.push({ id: '', col, row });
      const path = hilbertSorted(cells);
      tiles = list.map((k, i) => ({ id: k.item.book.id, col: path[i].col, row: path[i].row }));
      labels = labelsFor(list, tiles, g, wrap);
    }
  }
  const cols = tiles.map((t) => t.col);
  const rows = tiles.map((t) => t.row);
  return {
    tiles, labels, wrap,
    bounds: { minCol: Math.min(...cols), maxCol: Math.max(...cols), minRow: Math.min(...rows), maxRow: Math.max(...rows) }
  };
}

/** Topics available for the topic dropdown (most common first). */
export function fieldTopics(items: FieldItem[]): { name: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const it of items) for (const t of topicsOf(it.book)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].filter(([, n]) => n >= 3).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 40);
}

export function hasTopic(b: Book, topic: string): boolean {
  return topicsOf(b).some((t) => fold(t) === fold(topic));
}

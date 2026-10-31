import { colorSortKey, type CoverAnalysis } from '../covers/colors';
import { labelOf, pathOf } from '../domain/locations';
import { fold } from '../domain/query';
import type { Book, Location } from '../domain/types';

/**
 * Cover wall layouts, in grid units (one cover = one cell; cells are 2:3 portrait).
 * Group layouts place each group as a labelled block ("island"); blocks are packed in rows.
 */

export type WallOrder = 'color' | 'topic' | 'title' | 'author' | 'time' | 'room';
export const WALL_ORDERS: Record<WallOrder, string> = {
  color: 'Colour', topic: 'Topic', title: 'Title', author: 'Author', time: 'When written', room: 'Room'
};

export interface WallItem {
  book: Book;
  analysis?: CoverAnalysis;
}

export interface Tile {
  id: string;
  col: number;
  row: number;
}

export interface Label {
  text: string;
  col: number;
  row: number;
  /** Width of its block in cells. */
  width: number;
  count: number;
}

export interface WallLayout {
  tiles: Tile[];
  labels: Label[];
  cols: number;
  rows: number;
}

const byColor = (a: WallItem, b: WallItem) =>
  (a.analysis ? colorSortKey(a.analysis) : 2000) - (b.analysis ? colorSortKey(b.analysis) : 2000);
const titleKey = (b: Book) => fold(b.title.replace(/^(the|a|an|der|die|das|le|la|les|el|il)\s+/i, ''));

/** Square-ish block for n portrait covers (wider than tall in cells so the block looks square). */
export function blockWidth(n: number): number {
  return Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n * 1.5))));
}

/**
 * Colour field: covers sorted along the colour wheel, filled column by column, each column
 * from dark to light, so zooming out shows a smooth rainbow.
 */
export function colorLayout(items: WallItem[]): WallLayout {
  const sorted = [...items].sort(byColor);
  const rows = Math.max(1, Math.ceil(Math.sqrt(sorted.length / 1.5)));
  const tiles: Tile[] = [];
  for (let c = 0; c * rows < sorted.length; c++) {
    const column = sorted.slice(c * rows, (c + 1) * rows).sort((a, b) => (a.analysis?.lightness ?? 0.5) - (b.analysis?.lightness ?? 0.5));
    column.forEach((it, r) => tiles.push({ id: it.book.id, col: c, row: r }));
  }
  return { tiles, labels: [], cols: Math.ceil(sorted.length / rows), rows };
}

export interface Group {
  label: string;
  items: WallItem[];
}

/** Shelf-pack labelled blocks into rows of at most `width` cells (label row above each block, one cell gap). */
function packAt(groups: Group[], width: number): WallLayout {
  const tiles: Tile[] = [];
  const labels: Label[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const g of groups) {
    const w = blockWidth(g.items.length);
    const h = Math.ceil(g.items.length / w) + 1; // + label row
    if (x > 0 && x + w > width) {
      x = 0;
      y += rowHeight + 1;
      rowHeight = 0;
    }
    labels.push({ text: g.label, col: x, row: y, width: w, count: g.items.length });
    g.items.forEach((it, i) => tiles.push({ id: it.book.id, col: x + (i % w), row: y + 1 + Math.floor(i / w) }));
    x += w + 1;
    rowHeight = Math.max(rowHeight, h);
  }
  const cols = Math.max(0, ...tiles.map((t) => t.col + 1));
  return { tiles, labels, cols, rows: y + rowHeight };
}

/**
 * Pack labelled blocks, trying row widths and keeping the most compact, roughly square result
 * (in screen proportions: a cell is 1 × 1.5), so there are no large empty areas.
 */
export function packGroups(groups: Group[]): WallLayout {
  if (!groups.length) return { tiles: [], labels: [], cols: 0, rows: 0 };
  const widths = groups.map((g) => blockWidth(g.items.length));
  const widest = Math.max(...widths);
  const all = widths.reduce((a, b) => a + b + 1, 0);
  let best: { layout: WallLayout; score: number } | undefined;
  for (let w = widest; w <= all; w++) {
    const layout = packAt(groups, w);
    const ww = layout.cols * 1.12;
    const hh = layout.rows * 1.62;
    const score = ww * hh * (1 + Math.abs(Math.log(ww / hh)) * 0.6); // area, mildly preferring square
    if (!best || score < best.score) best = { layout, score };
  }
  return best!.layout;
}

/**
 * Topic clusters: each book joins its most telling topic, the largest of its topics that is
 * neither tiny (< minSize books) nor so broad it says nothing (> maxShare of all, e.g. "Fiction").
 * Inside each island covers are arranged by colour.
 */
export function topicGroups(items: WallItem[], minSize = 3, maxShare = 0.35): Group[] {
  const topicsOf = (b: Book) => [...new Set([...b.genres, ...(b.subjects ?? [])].map((t) => t.trim()).filter(Boolean))];
  const counts = new Map<string, { label: string; n: number }>();
  for (const it of items) for (const t of topicsOf(it.book)) {
    const k = fold(t);
    const e = counts.get(k) ?? { label: t, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  // Small libraries have few topics: only drop the near-universal ones there.
  const limit = Math.max(minSize, items.length * (items.length >= 20 ? maxShare : 0.75));
  const usable = (k: string) => {
    const n = counts.get(k)?.n ?? 0;
    return n >= minSize && n <= limit;
  };
  const groups = new Map<string, Group>();
  const other: WallItem[] = [];
  for (const it of items) {
    const best = topicsOf(it.book).map(fold).filter(usable).sort((a, b) => counts.get(b)!.n - counts.get(a)!.n || a.localeCompare(b))[0];
    if (!best) {
      other.push(it);
      continue;
    }
    const g = groups.get(best) ?? { label: counts.get(best)!.label, items: [] };
    g.items.push(it);
    groups.set(best, g);
  }
  const result = [...groups.values()].sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  if (other.length) result.push({ label: 'Other', items: other });
  return result.map((g) => ({ ...g, items: [...g.items].sort(byColor) }));
}

function groupBy(items: WallItem[], key: (b: Book) => string, sortGroups: (a: string, b: string) => number, sortItems: (a: WallItem, b: WallItem) => number): Group[] {
  const m = new Map<string, WallItem[]>();
  for (const it of items) {
    const k = key(it.book);
    m.set(k, [...(m.get(k) ?? []), it]);
  }
  return [...m.entries()].sort((a, b) => sortGroups(a[0], b[0])).map(([label, list]) => ({ label, items: list.sort(sortItems) }));
}

export function wallLayout(items: WallItem[], order: WallOrder, locations: Location[]): WallLayout {
  const none = '~';
  switch (order) {
    case 'color':
      return colorLayout(items);
    case 'topic':
      return packGroups(topicGroups(items));
    case 'title':
      return packGroups(groupBy(items, (b) => (titleKey(b)[0] ?? '#').toUpperCase().replace(/[^A-Z]/, '#'),
        (a, b) => a.localeCompare(b), (a, b) => titleKey(a.book).localeCompare(titleKey(b.book))));
    case 'author':
      return packGroups(groupBy(items, (b) => b.authors[0] ?? 'Unknown author',
        (a, b) => a.split(' ').pop()!.localeCompare(b.split(' ').pop()!), (a, b) => titleKey(a.book).localeCompare(titleKey(b.book))));
    case 'time':
      return packGroups(groupBy(items, (b) => {
        const y = b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
        return y ? `${Math.floor(y / 10) * 10}s` : none;
      }, (a, b) => (a === none ? 1 : b === none ? -1 : parseInt(a) - parseInt(b)), byColor)
        .map((g) => (g.label === none ? { ...g, label: 'Unknown year' } : g)));
    case 'room':
      return packGroups(groupBy(items, (b) => {
        const path = pathOf(locations, b.locationId).slice(0, 2);
        return path.length ? labelOf(locations, path[path.length - 1].id) : 'No location';
      }, (a, b) => (a === 'No location' ? 1 : b === 'No location' ? -1 : a.localeCompare(b)), byColor));
  }
}

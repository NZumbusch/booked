import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import { CELL_H, CELL_W, discCells, fieldLayout, hilbertIndex, topicKeys, torusSize, type FieldItem } from './field';

const now = '2026-10-31T10:00:00.000Z';
let n = 0;
const item = (d: Partial<Parameters<typeof createBook>[0]> & { hue?: number; sat?: number; light?: number } = {}): FieldItem => {
  const { hue, sat, light, ...rest } = d;
  return {
    book: createBook({ title: `B${n}`, ...rest }, { id: `b${n++}`, now }),
    analysis: hue === undefined ? undefined : { color: [0, 0, 0], hue, saturation: sat ?? 0.8, lightness: light ?? 0.5, palette: [], contrast: 0.2 }
  };
};
const key = (c: { col: number; row: number }) => `${c.col},${c.row}`;

describe('discCells', () => {
  const cells = discCells(500);
  const set = new Set(cells.map(key));
  it('returns n distinct cells', () => {
    expect(cells).toHaveLength(500);
    expect(set.size).toBe(500);
  });
  it('is solid (no holes): the cell one step towards the centre is always there', () => {
    for (const c of cells) {
      if (c.col === 0 && c.row === 0) continue;
      const x = c.col * CELL_W, y = c.row * CELL_H;
      const d = Math.hypot(x, y);
      const step = { col: Math.round((x * (1 - 1.2 / d)) / CELL_W), row: Math.round((y * (1 - 1.2 / d)) / CELL_H) };
      expect(set.has(key(step)) || (step.col === c.col && step.row === c.row)).toBe(true);
    }
  });
  it('is roughly round but not a perfect circle', () => {
    const radii = cells.map((c) => Math.hypot(c.col * CELL_W, c.row * CELL_H));
    const edge = cells.filter((c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => !set.has(key({ col: c.col + dc, row: c.row + dr }))));
    const edgeR = edge.map((c) => Math.hypot(c.col * CELL_W, c.row * CELL_H));
    const max = Math.max(...radii);
    expect(Math.min(...edgeR) / max).toBeGreaterThan(0.7); // round-ish
    expect(Math.min(...edgeR) / max).toBeLessThan(0.97); // but wobbly
  });
});

describe('hilbertIndex', () => {
  it('walks the 2×2 square in order', () => {
    expect([[0, 0], [0, 1], [1, 1], [1, 0]].map(([x, y]) => hilbertIndex(2, x, y))).toEqual([0, 1, 2, 3]);
    const all = new Set<number>();
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) all.add(hilbertIndex(8, x, y));
    expect(all.size).toBe(64);
  });
});

describe('fieldLayout', () => {
  const topics = ['Ecology', 'History', 'Poetry', 'Philosophy', 'Art'];
  const items = Array.from({ length: 300 }, (_, i) => item({ genres: ['Fiction', topics[i % 5]], subjects: [`Sub${i % 3}`], hue: (i * 37) % 360, light: 0.3 + (i % 5) / 10 }));

  it('topic clusters are seamless regions (each cover has a same-topic neighbour)', () => {
    const l = fieldLayout(items, 'topic', 'disc', []);
    expect(new Set(l.tiles.map(key)).size).toBe(300);
    const topicOf = new Map(items.map((it, i) => [it.book.id, topics[i % 5]]));
    const at = new Map(l.tiles.map((t) => [key(t), topicOf.get(t.id)]));
    const withNeighbour = l.tiles.filter((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => at.get(key({ col: t.col + dc, row: t.row + dr })) === topicOf.get(t.id)));
    expect(withNeighbour.length / l.tiles.length).toBeGreaterThan(0.95);
    expect(l.labels.filter((x) => x.level === 1).map((x) => x.text).sort()).toEqual([...topics].sort());
  });

  it('colour wheel: covers sit at the angle of their hue', () => {
    const l = fieldLayout(items, 'color', 'disc', []);
    const hueOf = new Map(items.map((it) => [it.book.id, it.analysis!.hue]));
    let ok = 0;
    for (const t of l.tiles) {
      if (Math.hypot(t.col, t.row) < 3) continue;
      const angle = ((Math.atan2(t.row * CELL_H, t.col * CELL_W) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) * (180 / Math.PI);
      const diff = Math.min(Math.abs(angle - hueOf.get(t.id)!), 360 - Math.abs(angle - hueOf.get(t.id)!));
      if (diff < 45) ok++;
    }
    expect(ok / l.tiles.length).toBeGreaterThan(0.75);
  });

  it('endless: fills the whole torus (repeating a few books) and wraps colour smoothly', () => {
    const l = fieldLayout(items, 'color', 'endless', []);
    const { cols, rows } = torusSize(300);
    expect(l.wrap).toEqual({ cols, rows });
    expect(l.tiles).toHaveLength(cols * rows);
    expect(new Set(l.tiles.map(key)).size).toBe(cols * rows);
    const light = new Map(items.map((it) => [it.book.id, it.analysis!.lightness]));
    const column0 = l.tiles.filter((t) => t.col === 0).sort((a, b) => a.row - b.row).map((t) => light.get(t.id)!);
    // dark at both ends, light in the middle → no jump at the seam
    expect(Math.abs(column0[0] - column0[column0.length - 1])).toBeLessThan(0.25);
    expect(Math.max(...column0)).toBeGreaterThan(column0[0]);
  });

  it('time and room get group › subgroup labels', () => {
    const t = now;
    const locs = [{ id: 'p', kind: 'place' as const, name: 'Flat A', parentId: null, order: 0, createdAt: t, updatedAt: t }, { id: 'r', kind: 'room' as const, name: 'Study', parentId: 'p', order: 0, createdAt: t, updatedAt: t }];
    const books = Array.from({ length: 12 }, (_, i) => item({ firstPublishedYear: 1925 + (i % 2) * 40, locationId: i % 3 ? 'r' : null }));
    expect(fieldLayout(books, 'time', 'disc', []).labels.filter((l) => l.level === 1).map((l) => l.text).sort()).toEqual(['20th century']);
    expect(fieldLayout(books, 'time', 'disc', []).labels.filter((l) => l.level === 2).map((l) => l.text).sort()).toEqual(['1920s', '1960s']);
    expect(fieldLayout(books, 'room', 'disc', locs).labels.filter((l) => l.level === 1).map((l) => l.text).sort()).toEqual(['Flat A', 'No location']);
  });
});

describe('labels', () => {
  it('skips subgroup labels that would only repeat their group', () => {
    const items = Array.from({ length: 30 }, (_, i) => item({ genres: ['Fiction', i % 2 ? 'Art' : 'Poetry'], subjects: [i % 2 ? 'Painting' : (i % 4 ? 'Love' : 'War')] }));
    const l = fieldLayout(items, 'topic', 'disc', []);
    expect(l.labels.filter((x) => x.level === 2).map((x) => x.text).sort()).toEqual(['Love', 'War']);
  });
});

describe('topicKeys', () => {
  it('gives topic and subtopic, skipping the near-universal "Fiction"', () => {
    const items = [
      ...Array.from({ length: 6 }, () => item({ genres: ['Fiction', 'History'], subjects: ['War'] })),
      ...Array.from({ length: 4 }, () => item({ genres: ['Fiction', 'History'], subjects: ['Kings'] })),
      ...Array.from({ length: 3 }, () => item({ genres: ['Fiction', 'Poetry'], subjects: ['War'] })),
      ...Array.from({ length: 8 }, () => item({ genres: ['Fiction', 'Cooking'] }))
    ];
    const k = topicKeys(items);
    expect(k.get(items[0].book.id)).toEqual({ topic: 'History', sub: 'War' });
    expect(k.get(items[7].book.id)).toEqual({ topic: 'History', sub: 'Kings' });
    expect(k.get(items[12].book.id)).toEqual({ topic: 'Poetry', sub: 'War' });
    expect(k.get(items[14].book.id)).toEqual({ topic: 'Cooking', sub: '' });
  });
});

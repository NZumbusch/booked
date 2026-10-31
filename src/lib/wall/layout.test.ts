import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import type { Location } from '../domain/types';
import { blockWidth, colorLayout, packGroups, topicGroups, wallLayout, type WallItem } from './layout';

const now = '2026-10-31T10:00:00.000Z';
let n = 0;
const item = (d: Partial<Parameters<typeof createBook>[0]> & { hue?: number; light?: number }): WallItem => {
  const { hue, light, ...rest } = d;
  return {
    book: createBook({ title: `B${n}`, ...rest }, { id: `b${n++}`, now }),
    analysis: hue === undefined ? undefined : { color: [0, 0, 0], hue, saturation: 0.8, lightness: light ?? 0.5, palette: [], contrast: 0.2 }
  };
};

describe('colorLayout', () => {
  it('runs along the colour wheel across columns, dark to light within a column', () => {
    const items = [item({ hue: 240, light: 0.3 }), item({ hue: 0, light: 0.7 }), item({ hue: 0, light: 0.2 }), item({ hue: 120 }), item({ hue: 240, light: 0.6 }), item({ hue: 120, light: 0.2 })];
    const l = colorLayout(items);
    expect(l.rows).toBe(2);
    expect(l.cols).toBe(3);
    const at = (c: number, r: number) => items.find((i) => i.book.id === l.tiles.find((t) => t.col === c && t.row === r)?.id)!.analysis!;
    expect([at(0, 0).hue, at(1, 0).hue, at(2, 0).hue]).toEqual([0, 120, 240]);
    expect(at(0, 0).lightness).toBeLessThan(at(0, 1).lightness);
  });
  it('handles empty input', () => {
    expect(colorLayout([])).toMatchObject({ tiles: [], cols: 0 });
  });
});

describe('packGroups', () => {
  it('places labelled blocks without overlap', () => {
    const groups = [{ label: 'A', items: Array.from({ length: 10 }, () => item({})) }, { label: 'B', items: Array.from({ length: 3 }, () => item({})) }];
    const l = packGroups(groups);
    const cells = new Set(l.tiles.map((t) => `${t.col},${t.row}`));
    expect(cells.size).toBe(13);
    expect(l.labels.map((x) => [x.text, x.count])).toEqual([['A', 10], ['B', 3]]);
    expect(l.tiles.every((t) => !l.labels.some((lab) => lab.row === t.row && t.col >= lab.col && t.col < lab.col + lab.width))).toBe(true);
    expect(blockWidth(10)).toBe(4);
  });
});

describe('packGroups compactness', () => {
  it('fills rows instead of leaving large gaps', () => {
    const sizes = [114, 114, 58, 57, 57];
    const groups = sizes.map((n, i) => ({ label: `G${i}`, items: Array.from({ length: n }, () => item({})) }));
    const l = packGroups(groups);
    const used = l.tiles.length;
    expect(used / (l.cols * l.rows)).toBeGreaterThan(0.6);
  });
});

describe('topicGroups', () => {
  it('clusters by the most telling topic, skipping too-broad and tiny ones', () => {
    const items = [
      ...Array.from({ length: 4 }, () => item({ genres: ['Fiction'], subjects: ['Ecology'] })),
      ...Array.from({ length: 3 }, () => item({ genres: ['Fiction'], subjects: ['Love'] })),
      ...Array.from({ length: 3 }, () => item({ genres: ['Fiction', 'History'] })),
      item({ genres: ['Fiction'], subjects: ['Unique topic'] })
    ];
    const g = topicGroups(items);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([['Ecology', 4], ['History', 3], ['Love', 3], ['Other', 1]]);
  });
});

describe('wallLayout', () => {
  it('groups by decade and room with unknowns last', () => {
    const t = now;
    const locs: Location[] = [{ id: 'p', kind: 'place', name: 'Flat', parentId: null, order: 0, createdAt: t, updatedAt: t }, { id: 'r', kind: 'room', name: 'Study', parentId: 'p', order: 0, createdAt: t, updatedAt: t }];
    const items = [item({ firstPublishedYear: 1965, locationId: 'r' }), item({ firstPublishedYear: 1927 }), item({})];
    expect(wallLayout(items, 'time', locs).labels.map((l) => l.text)).toEqual(['1920s', '1960s', 'Unknown year']);
    expect(wallLayout(items, 'room', locs).labels.map((l) => l.text)).toEqual(['Flat › Study', 'No location']);
    expect(wallLayout(items, 'title', locs).labels.map((l) => l.text)).toEqual(['B']);
  });
});

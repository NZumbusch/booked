import { describe, expect, it } from 'vitest';
import type { Location } from './types';
import {
  childKind, childrenOf, pathOf, labelOf, descendantIds, canParent, nextOrder, reorder, bookCounts
} from './locations';

const t = '2026-01-01T00:00:00.000Z';
const loc = (id: string, kind: Location['kind'], parentId: string | null, order = 0, name = id): Location =>
  ({ id, kind, name, parentId, order, createdAt: t, updatedAt: t });

const locs: Location[] = [
  loc('flatB', 'place', null, 1, 'Flat B'),
  loc('flatA', 'place', null, 0, 'Flat A'),
  loc('living', 'room', 'flatA', 0, 'Living room'),
  loc('study', 'room', 'flatA', 1, 'Study'),
  loc('shelf1', 'shelf', 'living', 0, 'Shelf 1'),
  loc('kitchen', 'room', 'flatB', 0, 'Kitchen')
];

describe('location tree', () => {
  it('knows which kind lives below which', () => {
    expect(childKind('place')).toBe('room');
    expect(childKind('room')).toBe('shelf');
    expect(childKind('shelf')).toBeNull();
  });

  it('lists children sorted by order', () => {
    expect(childrenOf(locs, null).map((l) => l.id)).toEqual(['flatA', 'flatB']);
    expect(childrenOf(locs, 'flatA').map((l) => l.id)).toEqual(['living', 'study']);
  });

  it('builds the path and a readable label', () => {
    expect(pathOf(locs, 'shelf1').map((l) => l.id)).toEqual(['flatA', 'living', 'shelf1']);
    expect(labelOf(locs, 'shelf1')).toBe('Flat A › Living room › Shelf 1');
    expect(labelOf(locs, null)).toBe('No location');
    expect(labelOf(locs, 'missing')).toBe('Unknown location');
  });

  it('collects descendants including itself', () => {
    expect(descendantIds(locs, 'flatA').sort()).toEqual(['flatA', 'living', 'shelf1', 'study']);
    expect(descendantIds(locs, 'shelf1')).toEqual(['shelf1']);
  });

  it('validates parent/child kinds', () => {
    expect(canParent(undefined, 'place')).toBe(true);
    expect(canParent(locs[1], 'room')).toBe(true);
    expect(canParent(locs[1], 'shelf')).toBe(false);
    expect(canParent(undefined, 'room')).toBe(false);
  });

  it('computes next sibling order', () => {
    expect(nextOrder(locs, 'flatA')).toBe(2);
    expect(nextOrder(locs, 'study')).toBe(0);
  });

  it('reorders siblings', () => {
    const changed = reorder(locs, 'flatA', ['study', 'living'], t);
    expect(changed.map((l) => [l.id, l.order])).toEqual([['study', 0], ['living', 1]]);
  });

  it('counts books per node including descendants', () => {
    const counts = bookCounts(locs, [{ locationId: 'shelf1' }, { locationId: 'study' }, { locationId: null }, { locationId: 'kitchen' }]);
    expect(counts.get('flatA')).toBe(2);
    expect(counts.get('living')).toBe(1);
    expect(counts.get('shelf1')).toBe(1);
    expect(counts.get('flatB')).toBe(1);
    expect(counts.get(null)).toBe(1);
  });
});

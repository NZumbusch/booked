import type { Id, Location, LocationKind, Timestamp } from './types';

const CHILD: Record<LocationKind, LocationKind | null> = { place: 'room', room: 'shelf', shelf: null };
export const KIND_LABEL: Record<LocationKind, string> = { place: 'Place', room: 'Room', shelf: 'Shelf' };

export function childKind(kind: LocationKind): LocationKind | null {
  return CHILD[kind];
}

export function childrenOf(locations: Location[], parentId: Id | null): Location[] {
  return locations
    .filter((l) => l.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function pathOf(locations: Location[], id: Id | null): Location[] {
  const byId = new Map(locations.map((l) => [l.id, l]));
  const path: Location[] = [];
  let current = id ? byId.get(id) : undefined;
  while (current && path.length < 3) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function labelOf(locations: Location[], id: Id | null): string {
  if (!id) return 'No location';
  const path = pathOf(locations, id);
  return path.length ? path.map((l) => l.name).join(' › ') : 'Unknown location';
}

export function descendantIds(locations: Location[], id: Id): Id[] {
  const result = [id];
  for (let i = 0; i < result.length; i++) {
    for (const l of locations) if (l.parentId === result[i]) result.push(l.id);
  }
  return result;
}

/** Whether a node of `kind` may live under `parent` (undefined = top level). */
export function canParent(parent: Location | undefined, kind: LocationKind): boolean {
  return parent ? CHILD[parent.kind] === kind : kind === 'place';
}

export function nextOrder(locations: Location[], parentId: Id | null): number {
  const siblings = locations.filter((l) => l.parentId === parentId);
  return siblings.length ? Math.max(...siblings.map((l) => l.order)) + 1 : 0;
}

/** Returns the siblings whose order changed, in their new order. */
export function reorder(locations: Location[], parentId: Id | null, orderedIds: Id[], now: Timestamp): Location[] {
  const byId = new Map(locations.filter((l) => l.parentId === parentId).map((l) => [l.id, l]));
  return orderedIds
    .map((id, order) => ({ loc: byId.get(id), order }))
    .filter((x): x is { loc: Location; order: number } => !!x.loc)
    .map(({ loc, order }) => ({ ...loc, order, updatedAt: now }));
}

/** Book count per location id (including descendants); key null = books with no location. */
export function bookCounts(locations: Location[], books: { locationId: Id | null }[]): Map<Id | null, number> {
  const parent = new Map(locations.map((l) => [l.id, l.parentId]));
  const counts = new Map<Id | null, number>();
  const bump = (k: Id | null) => counts.set(k, (counts.get(k) ?? 0) + 1);
  for (const book of books) {
    if (!book.locationId || !parent.has(book.locationId)) {
      bump(null);
      continue;
    }
    let id: Id | null = book.locationId;
    while (id) {
      bump(id);
      id = parent.get(id) ?? null;
    }
  }
  return counts;
}

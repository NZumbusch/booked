import { descendantIds, pathOf } from './locations';
import type { SyncData, Tombstone } from './sync';
import type { Book, Id, Location, MoveRecord } from './types';

/**
 * Shared places: a location (place or room) and everything in it, shared with family.
 *
 * Each member keeps the shared books in their own library; syncing exchanges just that part.
 * A book someone takes out of the shared location (into their own room) stays in the shared
 * place for everyone else, marked "away with <name>", like a loan; moving it back clears that.
 * Deleting a shared book removes it for everyone (tombstone).
 */

/** What we remember per shared place between syncs. */
export interface SpaceBookkeeping {
  bookIds: Id[];
  locationIds: Id[];
  /** Deletion markers known for this space (so they keep propagating). */
  deleted: Tombstone[];
  /** Where each shared book belongs in the shared place (its last location there). */
  homes?: Record<Id, Id>;
}

export const EMPTY_BOOKKEEPING: SpaceBookkeeping = { bookIds: [], locationIds: [], deleted: [], homes: {} };

export interface LocalData {
  books: Book[];
  locations: Location[];
  moves: MoveRecord[];
  /** The library's own deletion markers. */
  deleted: Tombstone[];
}

/** The shared part of this library, ready to merge with the remote copy. */
export function exportSpace(local: LocalData, rootId: Id, prev: SpaceBookkeeping, me = 'someone'): SyncData {
  const rootExists = local.locations.some((l) => l.id === rootId);
  const inside = new Set(rootExists ? descendantIds(local.locations, rootId) : []);
  // The path above the root (e.g. the place of a shared room) travels along so members can show it.
  const ancestors = rootExists ? pathOf(local.locations, rootId).slice(0, -1) : [];
  const locations = [...ancestors, ...local.locations.filter((l) => inside.has(l.id))];
  // A book that's "away" stays listed under its home in the shared place.
  const books = local.books.filter((b) => b.locationId && inside.has(b.locationId));
  for (const b of local.books) {
    const home = prev.homes?.[b.id];
    if (!prev.bookIds.includes(b.id) || (b.locationId && inside.has(b.locationId)) || !home) continue;
    books.push({ ...b, locationId: home, away: b.away ?? { by: me, since: b.updatedAt } });
  }
  const bookIds = new Set(books.map((b) => b.id));
  const moves = local.moves.filter((m) => bookIds.has(m.bookId));

  const wasShared = new Set([...prev.bookIds, ...prev.locationIds]);
  const shared = new Set([...bookIds, ...locations.map((l) => l.id)]);
  const deleted: Tombstone[] = [...prev.deleted, ...local.deleted.filter((t) => wasShared.has(t.id))];
  // Locations that were shared but now live elsewhere in this library left the space.
  for (const l of local.locations) {
    if (prev.locationIds.includes(l.id) && !shared.has(l.id)) deleted.push({ id: l.id, kind: 'location', at: l.updatedAt });
  }
  return { books, locations, moves, deleted };
}

export interface SpaceApplyPlan {
  putBooks: Book[];
  deleteBookIds: Id[];
  putLocations: Location[];
  deleteLocationIds: Id[];
  putMoves: MoveRecord[];
  tombstones: Tombstone[];
  bookkeeping: SpaceBookkeeping;
}

/** How to bring the local library in line with the merged shared copy, touching only shared things. */
export function planSpaceApply(local: LocalData, rootId: Id, merged: SyncData): SpaceApplyPlan {
  const books = new Map(local.books.map((b) => [b.id, b]));
  const locations = new Map(local.locations.map((l) => [l.id, l]));
  const moveIds = new Set(local.moves.map((m) => m.id));
  // "Inside" is judged on the merged tree, so a room shared just now counts for its books.
  const allLocations = [...new Map([...local.locations, ...merged.locations].map((l) => [l.id, l])).values()];
  const inside = new Set(allLocations.some((l) => l.id === rootId) ? descendantIds(allLocations, rootId) : []);

  const putLocations = merged.locations.filter((m) => {
    const l = locations.get(m.id);
    return !l || m.updatedAt > l.updatedAt;
  });
  const putBooks = merged.books.filter((m) => {
    const b = books.get(m.id);
    if (!b) return true;
    // I'm the one who took it out: keep it where it is in my library.
    if (m.away && b.locationId && !inside.has(b.locationId)) return false;
    return m.updatedAt > b.updatedAt;
  });
  const putMoves = merged.moves.filter((m) => !moveIds.has(m.id));

  const deleteBookIds: Id[] = [];
  const deleteLocationIds: Id[] = [];
  const tombstones: Tombstone[] = [];
  for (const t of merged.deleted) {
    if (t.kind === 'book') {
      const b = books.get(t.id);
      // Only remove it here if it's still in the shared place and wasn't changed after the deletion.
      if (b && b.locationId && inside.has(b.locationId) && b.updatedAt <= t.at) {
        deleteBookIds.push(t.id);
        tombstones.push(t);
      }
    } else if (t.kind === 'location') {
      const l = locations.get(t.id);
      if (l && inside.has(l.id) && l.id !== rootId && l.updatedAt <= t.at) {
        deleteLocationIds.push(t.id);
        tombstones.push(t);
      }
    }
  }
  return {
    putBooks, deleteBookIds, putLocations, deleteLocationIds, putMoves, tombstones,
    bookkeeping: bookkeepingFor(merged)
  };
}

/** What to remember after a sync: shared ids, deletion markers, and each book's home in the place. */
export function bookkeepingFor(merged: SyncData, prev?: SpaceBookkeeping): SpaceBookkeeping {
  const homes: Record<Id, Id> = {};
  for (const b of merged.books) {
    const home = b.away ? (prev?.homes?.[b.id] ?? b.locationId) : b.locationId;
    if (home) homes[b.id] = home;
  }
  return { bookIds: merged.books.map((b) => b.id), locationIds: merged.locations.map((l) => l.id), deleted: merged.deleted, homes };
}

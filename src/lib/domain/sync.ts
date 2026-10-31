import type { Book, Id, Location, MoveRecord, Timestamp } from './types';

/** A deleted record, remembered so the deletion wins over older copies on other devices. */
export interface Tombstone {
  id: Id;
  kind: 'book' | 'location' | 'move';
  at: Timestamp;
}

/** The part of the library that syncs between devices (settings stay per device). */
export interface SyncData {
  books: Book[];
  locations: Location[];
  moves: MoveRecord[];
  deleted: Tombstone[];
}

export interface MergeResult {
  merged: SyncData;
  /** The local copy needs updating. */
  localChanged: boolean;
  /** The remote copy needs updating. */
  remoteChanged: boolean;
}

/** Tombstones older than this are dropped (every device will have synced by then). */
const TOMBSTONE_DAYS = 180;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function mergeRecords<T extends { id: Id }>(
  local: T[], remote: T[], stamp: (r: T) => Timestamp, tombstones: Map<Id, Timestamp>
): T[] {
  const byId = new Map<Id, T>();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote) {
    const l = byId.get(r.id);
    // Newer edit wins; on a tie keep the local version (they're almost always identical).
    if (!l || stamp(r) > stamp(l)) byId.set(r.id, r);
  }
  // A deletion wins unless the record was edited after it (e.g. restored by undo).
  return [...byId.values()].filter((r) => {
    const deletedAt = tombstones.get(r.id);
    return !deletedAt || stamp(r) > deletedAt;
  });
}

/** Sort for stable output so "changed?" comparisons don't depend on order. */
const byIdSort = <T extends { id: Id }>(xs: T[]) => [...xs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Merge two library copies record by record: last write wins per record, deletions are tracked
 * with tombstones, and dangling references are repaired (books pointing at deleted locations
 * lose their location; rooms whose place was deleted are dropped).
 */
export function mergeSyncData(local: SyncData, remote: SyncData, now: Timestamp): MergeResult {
  const cutoff = new Date(Date.parse(now) - TOMBSTONE_DAYS * 86400000).toISOString();
  const tomb = new Map<string, Tombstone>();
  for (const t of [...local.deleted, ...remote.deleted]) {
    const key = `${t.kind}:${t.id}`;
    const prev = tomb.get(key);
    if (t.at >= cutoff && (!prev || t.at > prev.at)) tomb.set(key, t);
  }
  const deletedAt = (kind: Tombstone['kind']) =>
    new Map([...tomb.values()].filter((t) => t.kind === kind).map((t) => [t.id, t.at]));

  let locations = mergeRecords(local.locations, remote.locations, (l) => l.updatedAt, deletedAt('location'));
  // Drop locations whose parent no longer exists (repeat for nested levels).
  for (let i = 0; i < 3; i++) {
    const ids = new Set(locations.map((l) => l.id));
    locations = locations.filter((l) => !l.parentId || ids.has(l.parentId));
  }
  const locIds = new Set(locations.map((l) => l.id));
  const books = mergeRecords(local.books, remote.books, (b) => b.updatedAt, deletedAt('book'))
    .map((b) => (b.locationId && !locIds.has(b.locationId) ? { ...b, locationId: null } : b));
  const bookIds = new Set(books.map((b) => b.id));
  const moves = mergeRecords(local.moves, remote.moves, (m) => m.at, deletedAt('move')).filter((m) => bookIds.has(m.bookId));

  const merged: SyncData = {
    books: byIdSort(books),
    locations: byIdSort(locations),
    moves: byIdSort(moves),
    deleted: [...tomb.values()].sort((a, b) => (a.id < b.id ? -1 : 1))
  };
  const norm = (d: SyncData): SyncData => ({
    books: byIdSort(d.books), locations: byIdSort(d.locations), moves: byIdSort(d.moves),
    deleted: [...d.deleted].sort((a, b) => (a.id < b.id ? -1 : 1))
  });
  const dataOnly = (d: SyncData) => ({ books: d.books, locations: d.locations, moves: d.moves });
  return {
    merged,
    localChanged: !same(dataOnly(norm(local)), dataOnly(merged)),
    remoteChanged: !same(norm(remote), merged)
  };
}

export const EMPTY_SYNC: SyncData = { books: [], locations: [], moves: [], deleted: [] };

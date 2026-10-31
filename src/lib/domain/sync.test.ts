import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { EMPTY_SYNC, mergeSyncData, type SyncData } from './sync';
import type { Location } from './types';

const T = (min: number) => new Date(Date.UTC(2026, 9, 30, 10, min)).toISOString();
const now = T(60);
const book = (id: string, title: string, at: number, extra = {}) => createBook({ title, ...extra }, { id, now: T(at) });
const loc = (id: string, kind: Location['kind'], parentId: string | null, at = 0): Location =>
  ({ id, kind, name: id, parentId, order: 0, createdAt: T(at), updatedAt: T(at) });
const data = (d: Partial<SyncData>): SyncData => ({ ...EMPTY_SYNC, ...d });

describe('mergeSyncData', () => {
  it('unions records from both sides', () => {
    const r = mergeSyncData(data({ books: [book('a', 'A', 1)] }), data({ books: [book('b', 'B', 1)] }), now);
    expect(r.merged.books.map((b) => b.id)).toEqual(['a', 'b']);
    expect(r).toMatchObject({ localChanged: true, remoteChanged: true });
  });

  it('keeps the newer edit of the same book', () => {
    const local = data({ books: [{ ...book('a', 'Old', 1), updatedAt: T(5) }] });
    const remote = data({ books: [{ ...book('a', 'New', 1), updatedAt: T(9) }] });
    expect(mergeSyncData(local, remote, now).merged.books[0].title).toBe('New');
    expect(mergeSyncData(remote, local, now).merged.books[0].title).toBe('New');
  });

  it('reports nothing changed when both sides are equal', () => {
    const d = data({ books: [book('a', 'A', 1)], locations: [loc('p', 'place', null)] });
    expect(mergeSyncData(d, structuredClone(d), now)).toMatchObject({ localChanged: false, remoteChanged: false });
  });

  it('applies deletions from the other device', () => {
    const local = data({ books: [book('a', 'A', 1)] });
    const remote = data({ deleted: [{ id: 'a', kind: 'book', at: T(5) }] });
    const r = mergeSyncData(local, remote, now);
    expect(r.merged.books).toEqual([]);
    expect(r.localChanged).toBe(true);
    expect(r.merged.deleted).toHaveLength(1);
  });

  it('lets a later edit (e.g. undo of a delete) beat an older deletion', () => {
    const local = data({ books: [{ ...book('a', 'A', 1), updatedAt: T(9) }] });
    const remote = data({ deleted: [{ id: 'a', kind: 'book', at: T(5) }] });
    expect(mergeSyncData(local, remote, now).merged.books).toHaveLength(1);
  });

  it('repairs books pointing at a location deleted elsewhere, and drops orphaned rooms', () => {
    const local = data({
      locations: [loc('p', 'place', null), loc('r', 'room', 'p')],
      books: [book('a', 'A', 1, { locationId: 'r' })]
    });
    const remote = data({ deleted: [{ id: 'p', kind: 'location', at: T(5) }] });
    const r = mergeSyncData(local, remote, now);
    expect(r.merged.locations).toEqual([]);
    expect(r.merged.books[0].locationId).toBeNull();
  });

  it('drops moves of deleted books and old tombstones', () => {
    const move = { id: 'm', bookId: 'gone', fromId: null, toId: null, fromLabel: '', toLabel: '', at: T(1), batchId: 'x' };
    const r = mergeSyncData(
      data({ moves: [move], deleted: [{ id: 'old', kind: 'book', at: '2020-01-01T00:00:00.000Z' }] }),
      data({ deleted: [{ id: 'gone', kind: 'book', at: T(2) }] }),
      now
    );
    expect(r.merged.moves).toEqual([]);
    expect(r.merged.deleted.map((t) => t.id)).toEqual(['gone']);
  });

  it('only flags remote changes when the remote copy lacks something', () => {
    const remote = data({ books: [book('a', 'A', 1)] });
    const r = mergeSyncData(data({}), remote, now);
    expect(r).toMatchObject({ localChanged: true, remoteChanged: false });
  });
});

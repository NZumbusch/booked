import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { EMPTY_BOOKKEEPING, exportSpace, planSpaceApply, type LocalData } from './spaces';
import { mergeSyncData } from './sync';
import type { Location } from './types';

const T = (m: number) => new Date(Date.UTC(2026, 9, 31, 10, m)).toISOString();
const loc = (id: string, kind: Location['kind'], parentId: string | null, at = 0): Location =>
  ({ id, kind, name: id, parentId, order: 0, createdAt: T(at), updatedAt: T(at) });
const book = (id: string, locationId: string | null, at = 1) => createBook({ title: id, locationId }, { id, now: T(at) });

// Owner's library: Flat A › Living room (shared) and Flat A › Bedroom (private).
const ownerLocs = [loc('flat', 'place', null), loc('living', 'room', 'flat'), loc('shelf', 'shelf', 'living'), loc('bed', 'room', 'flat')];
const owner = (books = [book('shared1', 'living'), book('shared2', 'shelf'), book('private', 'bed')]): LocalData =>
  ({ books, locations: ownerLocs, moves: [], deleted: [] });
const empty: LocalData = { books: [], locations: [], moves: [], deleted: [] };

describe('exportSpace', () => {
  it('exports only the shared room, its shelves and books, plus the path above it', () => {
    const d = exportSpace(owner(), 'living', EMPTY_BOOKKEEPING);
    expect(d.locations.map((l) => l.id)).toEqual(['flat', 'living', 'shelf']);
    expect(d.books.map((b) => b.id)).toEqual(['shared1', 'shared2']);
  });

  it('keeps a book taken out to a private room in the shared place, marked away', () => {
    const prev = { bookIds: ['shared1', 'shared2'], locationIds: ['flat', 'living', 'shelf'], deleted: [], homes: { shared1: 'living', shared2: 'shelf' } };
    const moved = { ...book('shared2', 'bed', 5) };
    const d = exportSpace(owner([book('shared1', 'living'), moved, book('private', 'bed')]), 'living', prev, 'Nils');
    expect(d.books.map((b) => [b.id, b.locationId, b.away])).toEqual([
      ['shared1', 'living', undefined],
      ['shared2', 'shelf', { by: 'Nils', since: T(5) }]
    ]);
    expect(d.deleted).toEqual([]);
    expect(d.books.map((b) => b.id)).not.toContain('private');
  });

  it('does not move the book back into the shared room for the person who took it', () => {
    const local = owner([book('shared2', 'bed', 5)]);
    const merged = { books: [{ ...book('shared2', 'shelf', 9), away: { by: 'Nils', since: T(5) } }], locations: ownerLocs.slice(0, 3), moves: [], deleted: [] };
    expect(planSpaceApply(local, 'living', merged).putBooks).toEqual([]);
  });

  it('remembers each book’s home, also while it is away', async () => {
    const { bookkeepingFor } = await import('./spaces');
    const merged = { books: [book('a', 'living'), { ...book('b', 'living'), away: { by: 'X', since: T(1) } }], locations: [], moves: [], deleted: [] };
    expect(bookkeepingFor(merged, { ...EMPTY_BOOKKEEPING, homes: { b: 'shelf' } }).homes).toEqual({ a: 'living', b: 'shelf' });
  });

  it('passes on local deletions of shared books', () => {
    const prev = { bookIds: ['shared1'], locationIds: [], deleted: [] };
    const local = { ...owner([]), deleted: [{ id: 'shared1', kind: 'book' as const, at: T(3) }, { id: 'unrelated', kind: 'book' as const, at: T(3) }] };
    expect(exportSpace(local, 'living', prev).deleted.map((t) => t.id)).toEqual(['shared1']);
  });
});

describe('planSpaceApply', () => {
  it('a new member receives the room with its place', () => {
    const remote = exportSpace(owner(), 'living', EMPTY_BOOKKEEPING);
    const { merged } = mergeSyncData(exportSpace(empty, 'living', EMPTY_BOOKKEEPING), remote, T(30));
    const plan = planSpaceApply(empty, 'living', merged);
    expect(plan.putLocations.map((l) => l.id)).toEqual(['flat', 'living', 'shelf']);
    expect(plan.putBooks.map((b) => b.id)).toEqual(['shared1', 'shared2']);
    expect(plan.bookkeeping.bookIds).toEqual(['shared1', 'shared2']);
  });

  it('removes a book another member took out of the shared room, but never touches private books', () => {
    const local = owner();
    const merged = {
      books: [book('shared1', 'living')], locations: ownerLocs.slice(0, 3), moves: [],
      deleted: [{ id: 'shared2', kind: 'book' as const, at: T(9) }, { id: 'private', kind: 'book' as const, at: T(9) }]
    };
    const plan = planSpaceApply(local, 'living', merged);
    expect(plan.deleteBookIds).toEqual(['shared2']);
  });

  it('keeps a book that was edited after the other side removed it', () => {
    const local = owner([{ ...book('shared1', 'living'), updatedAt: T(20) }]);
    const plan = planSpaceApply(local, 'living', { books: [], locations: [], moves: [], deleted: [{ id: 'shared1', kind: 'book', at: T(9) }] });
    expect(plan.deleteBookIds).toEqual([]);
  });

  it('only overwrites books with newer remote edits', () => {
    const local = owner([{ ...book('shared1', 'living'), updatedAt: T(20) }, book('shared2', 'shelf', 1)]);
    const merged = { books: [{ ...book('shared1', 'living'), title: 'older', updatedAt: T(10) }, { ...book('shared2', 'shelf'), title: 'newer', updatedAt: T(10) }], locations: [], moves: [], deleted: [] };
    expect(planSpaceApply(local, 'living', merged).putBooks.map((b) => b.title)).toEqual(['newer']);
  });

  it('never deletes the shared root itself', () => {
    const plan = planSpaceApply(owner(), 'living', { books: [], locations: [], moves: [], deleted: [{ id: 'living', kind: 'location', at: T(50) }, { id: 'shelf', kind: 'location', at: T(50) }] });
    expect(plan.deleteLocationIds).toEqual(['shelf']);
  });
});

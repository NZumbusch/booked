import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { DexieRepository } from './dexie-repository';

describe('database upgrade', () => {
  it('keeps v1 data when opening with the v2 schema', async () => {
    const name = 'upgrade-test';
    const v1 = new Dexie(name);
    v1.version(1).stores({ books: 'id, locationId, isbn13, updatedAt', locations: 'id, parentId', moves: 'id, bookId, batchId, at', undo: 'id, at', meta: 'key' });
    await v1.table('books').put({ id: 'b1', title: 'Old book', authors: [], genres: [], tags: [], collections: [], status: 'unread', ownership: 'owned', signed: false, copies: 1, locationId: null, createdAt: 'x', updatedAt: 'x' });
    v1.close();

    const repo = new DexieRepository(name);
    const state = await repo.load();
    expect(state.books.map((b) => b.title)).toEqual(['Old book']);
    expect((await repo.exportSyncData()).deleted).toEqual([]);
    await repo.destroy();
  });
});

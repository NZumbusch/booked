import Dexie, { type Table } from 'dexie';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from '../domain/types';
import type { SyncData, Tombstone } from '../domain/sync';
import type { Book, Id, Location, MoveRecord, Settings, Snapshot, UndoEntry } from '../domain/types';
import { UNDO_LIMIT, type ChangeSet, type LoadedState, type Repository } from './repository';

class BookedDb extends Dexie {
  books!: Table<Book, Id>;
  locations!: Table<Location, Id>;
  moves!: Table<MoveRecord, Id>;
  undo!: Table<UndoEntry, Id>;
  meta!: Table<{ key: string; value: unknown }, string>;
  deleted!: Table<Tombstone & { key: string }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      books: 'id, locationId, isbn13, updatedAt',
      locations: 'id, parentId',
      moves: 'id, bookId, batchId, at',
      undo: 'id, at',
      meta: 'key'
    });
    // v2: deletion markers for Google Drive sync.
    this.version(2).stores({ deleted: 'key, at' });
  }
}

/** IndexedDB-backed repository (via Dexie). */
export class DexieRepository implements Repository {
  private db: BookedDb;

  constructor(name = 'booked') {
    this.db = new BookedDb(name);
  }

  async load(): Promise<LoadedState> {
    const [books, locations, settings] = await Promise.all([
      this.db.books.toArray(),
      this.db.locations.toArray(),
      this.readSettings()
    ]);
    return { books, locations, settings };
  }

  private async readSettings(): Promise<Settings> {
    const row = await this.db.meta.get('settings');
    return { ...DEFAULT_SETTINGS, ...(row?.value as Partial<Settings> | undefined) };
  }

  async commit(c: ChangeSet): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.books, db.locations, db.moves, db.undo, db.deleted], async () => {
      if (c.putTombstones?.length) await db.deleted.bulkPut(c.putTombstones.map((t) => ({ ...t, key: `${t.kind}:${t.id}` })));
      if (c.deleteBookIds?.length) await db.books.bulkDelete(c.deleteBookIds);
      if (c.putBooks?.length) await db.books.bulkPut(c.putBooks);
      if (c.deleteLocationIds?.length) await db.locations.bulkDelete(c.deleteLocationIds);
      if (c.putLocations?.length) await db.locations.bulkPut(c.putLocations);
      if (c.deleteMoveIds?.length) await db.moves.bulkDelete(c.deleteMoveIds);
      if (c.putMoves?.length) await db.moves.bulkPut(c.putMoves);
      if (c.deleteUndoIds?.length) await db.undo.bulkDelete(c.deleteUndoIds);
      if (c.pushUndo) {
        await db.undo.put(c.pushUndo);
        const stale = await db.undo.orderBy('at').reverse().offset(UNDO_LIMIT).primaryKeys();
        if (stale.length) await db.undo.bulkDelete(stale);
      }
    });
  }

  async movesFor(bookId: Id): Promise<MoveRecord[]> {
    const moves = await this.db.moves.where('bookId').equals(bookId).toArray();
    return moves.sort((a, b) => b.at.localeCompare(a.at));
  }

  latestUndo(): Promise<UndoEntry | undefined> {
    return this.db.undo.orderBy('at').last();
  }

  async saveSettings(settings: Settings): Promise<void> {
    await this.db.meta.put({ key: 'settings', value: settings });
  }

  async exportSnapshot(): Promise<Snapshot> {
    const [books, locations, moves, settings] = await Promise.all([
      this.db.books.toArray(),
      this.db.locations.toArray(),
      this.db.moves.toArray(),
      this.readSettings()
    ]);
    return { app: 'booked', schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), books, locations, moves, settings };
  }

  async importSnapshot(s: Snapshot): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.books, db.locations, db.moves, db.undo, db.meta], async () => {
      await Promise.all([db.books.clear(), db.locations.clear(), db.moves.clear(), db.undo.clear()]);
      await db.books.bulkPut(s.books);
      await db.locations.bulkPut(s.locations);
      await db.moves.bulkPut(s.moves ?? []);
      await db.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...s.settings } });
    });
  }

  async saveSafetyCopy(snapshot: Snapshot | undefined): Promise<void> {
    if (snapshot) await this.db.meta.put({ key: 'safetyCopy', value: snapshot });
    else await this.db.meta.delete('safetyCopy');
  }

  async loadSafetyCopy(): Promise<Snapshot | undefined> {
    return (await this.db.meta.get('safetyCopy'))?.value as Snapshot | undefined;
  }

  async exportSyncData(): Promise<SyncData> {
    const [books, locations, moves, deleted] = await Promise.all([
      this.db.books.toArray(), this.db.locations.toArray(), this.db.moves.toArray(), this.db.deleted.toArray()
    ]);
    return { books, locations, moves, deleted: deleted.map(({ id, kind, at }) => ({ id, kind, at })) };
  }

  async replaceSyncData(data: SyncData): Promise<void> {
    const db = this.db;
    await db.transaction('rw', [db.books, db.locations, db.moves, db.undo, db.deleted], async () => {
      await Promise.all([db.books.clear(), db.locations.clear(), db.moves.clear(), db.undo.clear(), db.deleted.clear()]);
      await db.books.bulkPut(data.books);
      await db.locations.bulkPut(data.locations);
      await db.moves.bulkPut(data.moves);
      await db.deleted.bulkPut(data.deleted.map((t) => ({ ...t, key: `${t.kind}:${t.id}` })));
    });
  }

  /** For tests. */
  async destroy(): Promise<void> {
    await this.db.delete();
  }
}

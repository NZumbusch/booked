import { applyPatch, cleanList, createBook, findDuplicates } from '../domain/book';
import { fold } from '../domain/query';
import { newId } from '../domain/ids';
import { bookCounts, canParent, childrenOf, descendantIds, labelOf, nextOrder, reorder } from '../domain/locations';
import type {
  Book, BookDraft, Id, Location, LocationKind, MoveRecord, SavedFilter, Settings, Snapshot, Timestamp, UndoEntry
} from '../domain/types';

/** Free-form list fields that can be renamed, merged and deleted library-wide. */
export type TermKind = 'tags' | 'collections' | 'genres';
const TERM_LABEL: Record<TermKind, string> = { tags: 'tag', collections: 'collection', genres: 'genre' };
import type { SyncData, Tombstone } from '../domain/sync';
import type { ChangeSet, LoadedState, Repository } from '../storage/repository';

type Listener = (state: LoadedState) => void;

interface Action {
  putBooks?: Book[];
  deleteBookIds?: Id[];
  putLocations?: Location[];
  deleteLocationIds?: Id[];
  putMoves?: MoveRecord[];
}

/**
 * The library: an in-memory model of all books and locations, persisted
 * through a Repository. Every mutation is atomic and undoable.
 * Implements the Svelte store contract (`subscribe`).
 */
export class Library {
  private listeners = new Set<Listener>();
  private books = new Map<Id, Book>();
  private locations = new Map<Id, Location>();
  private countsCache?: Map<Id | null, number>;
  private lastTime = 0;

  private constructor(private repo: Repository, public state: LoadedState) {
    this.index();
  }

  static async open(repo: Repository): Promise<Library> {
    return new Library(repo, await repo.load());
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------- queries

  book(id: Id): Book | undefined {
    return this.books.get(id);
  }

  location(id: Id): Location | undefined {
    return this.locations.get(id);
  }

  children(parentId: Id | null): Location[] {
    return childrenOf(this.state.locations, parentId);
  }

  label(id: Id | null): string {
    return labelOf(this.state.locations, id);
  }

  counts(): Map<Id | null, number> {
    return (this.countsCache ??= bookCounts(this.state.locations, this.state.books));
  }

  duplicatesOf(candidate: { id?: Id; isbn10?: string; isbn13?: string }): Book[] {
    return findDuplicates(this.state.books, candidate);
  }

  history(bookId: Id): Promise<MoveRecord[]> {
    return this.repo.movesFor(bookId);
  }

  // ------------------------------------------------------------- books

  async addBook(draft: BookDraft): Promise<Book> {
    const book = createBook(
      // An explicitly undefined location means "not chosen", so the default applies.
      { ...draft, locationId: draft.locationId === undefined ? this.state.settings.defaultLocationId : draft.locationId },
      { id: newId(), now: this.now() }
    );
    await this.run(`Added “${book.title}”`, { putBooks: [book] });
    return book;
  }

  async updateBook(id: Id, patch: Partial<Book>): Promise<Book> {
    const before = this.mustBook(id);
    const now = this.now();
    if ('locationId' in patch && patch.locationId !== before.locationId) this.mustLocation(patch.locationId ?? null);
    const after = applyPatch(before, patch, now);
    const moves = this.moveRecords([[before, after]], now);
    await this.run(`Edited “${after.title}”`, { putBooks: [after], putMoves: moves });
    return after;
  }

  /**
   * Background update (online details arriving later). Not an undoable user action, so it
   * doesn't push an undo entry and can't hijack "Undo". No-op if the book is gone.
   */
  async enrichBook(id: Id, patch: Partial<Book>): Promise<Book | undefined> {
    const before = this.books.get(id);
    if (!before) return undefined;
    const after = applyPatch(before, patch, this.now());
    await this.commit({ putBooks: [after] });
    return after;
  }

  async deleteBooks(ids: Id[]): Promise<void> {
    const books = ids.map((id) => this.mustBook(id));
    const label = books.length === 1 ? `Deleted “${books[0].title}”` : `Deleted ${books.length} books`;
    await this.run(label, { deleteBookIds: books.map((b) => b.id) });
  }

  /**
   * Change many books in one undoable step. `change` returns a patch per book (or undefined to skip it).
   * Location changes are recorded in each book's history. Returns how many books changed.
   */
  async bulkUpdate(ids: Id[], change: (book: Book) => Partial<Book> | undefined, label: string): Promise<number> {
    const now = this.now();
    const pairs: [Book, Book][] = [];
    for (const id of ids) {
      const before = this.mustBook(id);
      const patch = change(before);
      if (!patch) continue;
      if ('locationId' in patch && patch.locationId !== before.locationId) this.mustLocation(patch.locationId ?? null);
      const after = applyPatch(before, patch, now);
      if (JSON.stringify({ ...after, updatedAt: '' }) !== JSON.stringify({ ...before, updatedAt: '' })) pairs.push([before, after]);
    }
    if (!pairs.length) return 0;
    await this.run(label, { putBooks: pairs.map(([, b]) => b), putMoves: this.moveRecords(pairs, now) });
    return pairs.length;
  }

  /**
   * Import many books in one undoable step. Location paths (place › room › shelf names) are
   * matched case-insensitively and created when missing. Returns the new books.
   */
  async importBooks(
    items: { draft: BookDraft; locationPath: string[] }[],
    { skipDuplicates = false, lookup = false }: { skipDuplicates?: boolean; lookup?: boolean } = {}
  ): Promise<{ added: Book[]; skipped: number; createdLocations: number }> {
    const now = this.now();
    const locations = [...this.state.locations];
    const newLocations: Location[] = [];
    const kinds: LocationKind[] = ['place', 'room', 'shelf'];
    const resolve = (path: string[]): Id | null => {
      let parentId: Id | null = null;
      path.slice(0, 3).forEach((name, depth) => {
        const existing = locations.find((l) => l.parentId === parentId && fold(l.name) === fold(name));
        if (existing) {
          parentId = existing.id;
          return;
        }
        const loc: Location = {
          id: newId(), kind: kinds[depth], name: name.trim(), parentId,
          order: nextOrder(locations, parentId), createdAt: now, updatedAt: now
        };
        locations.push(loc);
        newLocations.push(loc);
        parentId = loc.id;
      });
      return parentId;
    };

    const added: Book[] = [];
    let skipped = 0;
    const seen = [...this.state.books];
    for (const { draft, locationPath } of items) {
      if (skipDuplicates && findDuplicates(seen, draft).length) {
        skipped++;
        continue;
      }
      const locationId = locationPath.length ? resolve(locationPath) : (draft.locationId ?? null);
      const pendingLookup = lookup && !!(draft.isbn13 || draft.isbn10) ? true : undefined;
      const book = createBook({ ...draft, locationId, pendingLookup }, { id: newId(), now });
      added.push(book);
      seen.push(book);
    }
    if (added.length || newLocations.length) {
      await this.run(`Imported ${added.length} book${added.length === 1 ? '' : 's'}`, { putBooks: added, putLocations: newLocations });
    }
    return { added, skipped, createdLocations: newLocations.length };
  }

  /** Rename a tag/collection/genre everywhere. Renaming onto an existing name merges them. */
  async renameTerm(kind: TermKind, from: string, to: string): Promise<number> {
    const target = to.trim();
    if (!target) throw new Error('Name cannot be empty');
    const key = fold(from);
    const exists = this.state.books.some((b) => b[kind].some((v) => fold(v) === fold(target) && fold(v) !== key));
    return this.bulkUpdate(
      this.state.books.filter((b) => b[kind].some((v) => fold(v) === key)).map((b) => b.id),
      (b) => ({ [kind]: cleanList(b[kind].map((v) => (fold(v) === key ? target : v))) }),
      exists ? `Merged ${TERM_LABEL[kind]} “${from}” into “${target}”` : `Renamed ${TERM_LABEL[kind]} “${from}” to “${target}”`
    );
  }

  /** Remove a tag/collection/genre from every book. */
  async deleteTerm(kind: TermKind, name: string): Promise<number> {
    const key = fold(name);
    return this.bulkUpdate(
      this.state.books.filter((b) => b[kind].some((v) => fold(v) === key)).map((b) => b.id),
      (b) => ({ [kind]: b[kind].filter((v) => fold(v) !== key) }),
      `Removed ${TERM_LABEL[kind]} “${name}”`
    );
  }

  async saveFilter(name: string, query: Record<string, string>): Promise<SavedFilter> {
    const filter: SavedFilter = { id: newId(), name: name.trim() || 'My filter', query };
    await this.updateSettings({ savedFilters: [...(this.state.settings.savedFilters ?? []), filter] });
    return filter;
  }

  async deleteSavedFilter(id: Id): Promise<void> {
    await this.updateSettings({ savedFilters: (this.state.settings.savedFilters ?? []).filter((f) => f.id !== id) });
  }

  /** Move books to a location (null = no location). Returns how many actually moved. */
  async moveBooks(ids: Id[], toId: Id | null): Promise<number> {
    this.mustLocation(toId);
    const now = this.now();
    const pairs = ids
      .map((id) => this.mustBook(id))
      .filter((b) => b.locationId !== toId)
      .map((b): [Book, Book] => [b, { ...b, locationId: toId, updatedAt: now }]);
    if (!pairs.length) return 0;
    const n = pairs.length;
    await this.run(`Moved ${n} book${n === 1 ? '' : 's'} to ${this.label(toId)}`, {
      putBooks: pairs.map(([, after]) => after),
      putMoves: this.moveRecords(pairs, now)
    });
    return n;
  }

  // ------------------------------------------------------------- locations

  async addLocation(kind: LocationKind, name: string, parentId: Id | null): Promise<Location> {
    const parent = parentId ? this.mustLocation(parentId) : undefined;
    if (!canParent(parent, kind)) throw new Error(`A ${kind} can't go there`);
    const now = this.now();
    const loc: Location = {
      id: newId(), kind, name: cleanName(name), parentId,
      order: nextOrder(this.state.locations, parentId), createdAt: now, updatedAt: now
    };
    await this.run(`Added ${kind} “${loc.name}”`, { putLocations: [loc] });
    return loc;
  }

  async renameLocation(id: Id, name: string): Promise<void> {
    const loc = this.mustLocation(id)!;
    const renamed = { ...loc, name: cleanName(name), updatedAt: this.now() };
    await this.run(`Renamed “${loc.name}” to “${renamed.name}”`, { putLocations: [renamed] });
  }

  async updateLocation(id: Id, patch: Pick<Partial<Location>, 'geo'>): Promise<void> {
    const loc = this.mustLocation(id)!;
    await this.run(`Edited “${loc.name}”`, { putLocations: [{ ...loc, ...patch, updatedAt: this.now() }] });
  }

  async reorderLocations(parentId: Id | null, orderedIds: Id[]): Promise<void> {
    await this.run('Reordered locations', { putLocations: reorder(this.state.locations, parentId, orderedIds, this.now()) });
  }

  /** Move a room (or shelf) with everything in it under another place (or room). */
  async moveLocation(id: Id, newParentId: Id): Promise<void> {
    const loc = this.mustLocation(id)!;
    const parent = this.mustLocation(newParentId)!;
    if (!canParent(parent, loc.kind)) throw new Error(`A ${loc.kind} can't go into a ${parent.kind}`);
    if (loc.parentId === newParentId) return;
    const now = this.now();
    const moved: Location = {
      ...loc, parentId: newParentId, order: nextOrder(this.state.locations, newParentId), updatedAt: now
    };
    const after = this.state.locations.map((l) => (l.id === id ? moved : l));
    const inside = new Set(descendantIds(this.state.locations, id));
    const pairs = this.state.books
      .filter((b) => b.locationId && inside.has(b.locationId))
      .map((b): [Book, Book] => [b, b]);
    await this.run(`Moved “${loc.name}” to ${parent.name}`, {
      putLocations: [moved],
      putMoves: this.moveRecords(pairs, now, after)
    });
  }

  /** Delete a location and everything below it; its books go to `moveBooksTo`. */
  async deleteLocation(id: Id, moveBooksTo: Id | null): Promise<void> {
    const loc = this.mustLocation(id)!;
    this.mustLocation(moveBooksTo);
    const doomed = descendantIds(this.state.locations, id);
    if (moveBooksTo && doomed.includes(moveBooksTo)) throw new Error('Books must go somewhere outside the deleted location');
    const now = this.now();
    const inside = new Set(doomed);
    const pairs = this.state.books
      .filter((b) => b.locationId && inside.has(b.locationId))
      .map((b): [Book, Book] => [b, { ...b, locationId: moveBooksTo, updatedAt: now }]);
    const remaining = this.state.locations.filter((l) => !inside.has(l.id));
    await this.run(`Deleted ${loc.kind} “${loc.name}”`, {
      deleteLocationIds: doomed,
      putBooks: pairs.map(([, b]) => b),
      putMoves: this.moveRecords(pairs, now, remaining)
    });
    if (this.state.settings.defaultLocationId && inside.has(this.state.settings.defaultLocationId)) {
      await this.updateSettings({ defaultLocationId: null });
    }
  }

  // ------------------------------------------------------------- settings, undo, backup

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const settings = { ...this.state.settings, ...patch };
    await this.repo.saveSettings(settings);
    this.set({ ...this.state, settings });
  }

  /** Revert the most recent action. Returns its label, or undefined if there's nothing to undo. */
  async undo(): Promise<string | undefined> {
    const entry = await this.repo.latestUndo();
    if (!entry) return undefined;
    // Undo is a new change as far as other devices are concerned: restored records get a fresh
    // timestamp and removed ones a deletion marker, so sync carries the undo everywhere.
    const now = this.now();
    await this.commit({
      putBooks: entry.booksBefore.map((b) => ({ ...b, updatedAt: now })),
      deleteBookIds: entry.createdBookIds,
      putLocations: entry.locationsBefore.map((l) => ({ ...l, updatedAt: now })),
      deleteLocationIds: entry.createdLocationIds,
      deleteMoveIds: entry.moveIds,
      deleteUndoIds: [entry.id],
      putTombstones: [
        ...entry.createdBookIds.map((id): Tombstone => ({ id, kind: 'book', at: now })),
        ...entry.createdLocationIds.map((id): Tombstone => ({ id, kind: 'location', at: now })),
        ...entry.moveIds.map((id): Tombstone => ({ id, kind: 'move', at: now }))
      ]
    });
    return entry.label;
  }

  async lastActionLabel(): Promise<string | undefined> {
    return (await this.repo.latestUndo())?.label;
  }

  exportSyncData(): Promise<SyncData> {
    return this.repo.exportSyncData();
  }

  /** Replace books/locations/moves with merged sync data (settings stay; undo history resets). */
  async applySyncData(data: SyncData): Promise<void> {
    await this.repo.replaceSyncData(plain(data));
    const loaded = await this.repo.load();
    this.set({ ...loaded, settings: this.state.settings });
  }

  exportSnapshot(): Promise<Snapshot> {
    return this.repo.exportSnapshot();
  }

  /** Take a snapshot for a backup file and remember when, for backup reminders. */
  async createBackup(): Promise<Snapshot> {
    const snapshot = await this.repo.exportSnapshot();
    await this.markBackedUp(snapshot.exportedAt);
    return { ...snapshot, settings: { ...snapshot.settings, lastBackupAt: snapshot.exportedAt } };
  }

  /** Record that a snapshot taken at `at` was saved somewhere safe. */
  async markBackedUp(at: Timestamp): Promise<void> {
    await this.updateSettings({ lastBackupAt: at });
  }

  /** Replace the library with a backup. The current library is kept as a safety copy (see undoRestore). */
  async importSnapshot(snapshot: Snapshot): Promise<void> {
    if (snapshot?.app !== 'booked' || !Array.isArray(snapshot.books) || !Array.isArray(snapshot.locations)) {
      throw new Error('This file is not a Booked backup');
    }
    await this.repo.saveSafetyCopy(await this.repo.exportSnapshot());
    await this.replaceWith(plain(snapshot));
  }

  async hasSafetyCopy(): Promise<boolean> {
    return !!(await this.repo.loadSafetyCopy());
  }

  /** Go back to the library as it was before the last restore. */
  async undoRestore(): Promise<boolean> {
    const copy = await this.repo.loadSafetyCopy();
    if (!copy) return false;
    await this.replaceWith(copy);
    await this.repo.saveSafetyCopy(undefined);
    return true;
  }

  private async replaceWith(snapshot: Snapshot): Promise<void> {
    // A restore is "make it like this" everywhere: restored records get a fresh timestamp and
    // records missing from the backup get deletion markers, so sync propagates the restore.
    const now = this.now();
    const keepBooks = new Set(snapshot.books.map((b) => b.id));
    const keepLocs = new Set(snapshot.locations.map((l) => l.id));
    const tombstones: Tombstone[] = [
      ...this.state.books.filter((b) => !keepBooks.has(b.id)).map((b): Tombstone => ({ id: b.id, kind: 'book', at: now })),
      ...this.state.locations.filter((l) => !keepLocs.has(l.id)).map((l): Tombstone => ({ id: l.id, kind: 'location', at: now }))
    ];
    await this.repo.importSnapshot({
      ...snapshot,
      books: snapshot.books.map((b) => ({ ...b, updatedAt: now })),
      locations: snapshot.locations.map((l) => ({ ...l, updatedAt: now }))
    });
    if (tombstones.length) await this.repo.commit({ putTombstones: tombstones });
    this.set(await this.repo.load());
    // The data now matches a backup file, so nothing is "unsaved".
    await this.updateSettings({ lastBackupAt: this.now() });
  }

  // ------------------------------------------------------------- internals

  /** Strictly increasing timestamps so undo order is unambiguous. */
  private now(): Timestamp {
    this.lastTime = Math.max(Date.now(), this.lastTime + 1);
    return new Date(this.lastTime).toISOString();
  }

  private mustBook(id: Id): Book {
    const b = this.books.get(id);
    if (!b) throw new Error(`Book not found: ${id}`);
    return b;
  }

  /** Validates a location id; null (no location) is always valid. */
  private mustLocation(id: Id | null): Location | undefined {
    if (id === null) return undefined;
    const l = this.locations.get(id);
    if (!l) throw new Error(`Location not found: ${id}`);
    return l;
  }

  /** Move records for [before, after] pairs whose location label changes. */
  private moveRecords(pairs: [Book, Book][], at: Timestamp, locationsAfter = this.state.locations): MoveRecord[] {
    const batchId = newId();
    return pairs.flatMap(([before, after]) => {
      const fromLabel = this.label(before.locationId);
      const toLabel = labelOf(locationsAfter, after.locationId);
      if (before.locationId === after.locationId && fromLabel === toLabel) return [];
      return [{ id: newId(), bookId: after.id, fromId: before.locationId, toId: after.locationId, fromLabel, toLabel, at, batchId }];
    });
  }

  private async run(label: string, action: Action): Promise<void> {
    const putBookIds = action.putBooks?.map((b) => b.id) ?? [];
    const touchedBooks = [...putBookIds, ...(action.deleteBookIds ?? [])];
    const putLocIds = action.putLocations?.map((l) => l.id) ?? [];
    const touchedLocs = [...putLocIds, ...(action.deleteLocationIds ?? [])];
    const undo: UndoEntry = {
      id: newId(),
      label,
      at: this.now(),
      booksBefore: unique(touchedBooks).flatMap((id) => this.books.get(id) ?? []),
      createdBookIds: putBookIds.filter((id) => !this.books.has(id)),
      locationsBefore: unique(touchedLocs).flatMap((id) => this.locations.get(id) ?? []),
      createdLocationIds: putLocIds.filter((id) => !this.locations.has(id)),
      moveIds: action.putMoves?.map((m) => m.id) ?? []
    };
    const at = undo.at;
    const putTombstones: Tombstone[] = [
      ...(action.deleteBookIds ?? []).map((id): Tombstone => ({ id, kind: 'book', at })),
      ...(action.deleteLocationIds ?? []).map((id): Tombstone => ({ id, kind: 'location', at }))
    ];
    await this.commit({ ...action, pushUndo: undo, putTombstones });
  }

  private async commit(changes: ChangeSet): Promise<void> {
    await this.repo.commit(plain(changes));
    const books = new Map(this.books);
    changes.deleteBookIds?.forEach((id) => books.delete(id));
    changes.putBooks?.forEach((b) => books.set(b.id, b));
    const locations = new Map(this.locations);
    changes.deleteLocationIds?.forEach((id) => locations.delete(id));
    changes.putLocations?.forEach((l) => locations.set(l.id, l));
    this.set({ ...this.state, books: [...books.values()], locations: [...locations.values()] });
  }

  private set(state: LoadedState) {
    this.state = state;
    this.index();
    this.listeners.forEach((fn) => fn(state));
  }

  private index() {
    this.books = new Map(this.state.books.map((b) => [b.id, b]));
    this.locations = new Map(this.state.locations.map((l) => [l.id, l]));
    this.countsCache = undefined;
  }
}

function cleanName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error('Name cannot be empty');
  return n;
}

/**
 * Deep plain copy. UI frameworks may hand us reactive proxies, which IndexedDB cannot store
 * ("could not be cloned"); everything we persist is JSON, so a JSON round-trip is safe.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

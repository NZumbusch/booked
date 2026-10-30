import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DexieRepository } from '../storage/dexie-repository';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;

beforeEach(async () => {
  repo = new DexieRepository(`test-${n++}`);
  lib = await Library.open(repo);
});
afterEach(() => repo.destroy());

async function setupFlats() {
  const flatA = await lib.addLocation('place', 'Flat A', null);
  const flatB = await lib.addLocation('place', 'Flat B', null);
  const living = await lib.addLocation('room', 'Living room', flatA.id);
  const study = await lib.addLocation('room', 'Study', flatA.id);
  const shelf = await lib.addLocation('shelf', 'Top shelf', living.id);
  return { flatA, flatB, living, study, shelf };
}

describe('books', () => {
  it('adds, persists and reloads books', async () => {
    const book = await lib.addBook({ title: 'Dune', authors: ['Frank Herbert'] });
    expect(lib.state.books).toHaveLength(1);
    const reopened = await Library.open(repo);
    expect(reopened.state.books[0]).toEqual(book);
  });

  it('uses the default location for new books', async () => {
    const { study } = await setupFlats();
    await lib.updateSettings({ defaultLocationId: study.id });
    const book = await lib.addBook({ title: 'X' });
    expect(book.locationId).toBe(study.id);
    const explicit = await lib.addBook({ title: 'Y', locationId: null });
    expect(explicit.locationId).toBeNull();
  });

  it('notifies subscribers on change', async () => {
    const seen: number[] = [];
    const unsub = lib.subscribe((s) => seen.push(s.books.length));
    await lib.addBook({ title: 'A' });
    unsub();
    await lib.addBook({ title: 'B' });
    expect(seen).toEqual([0, 1]);
  });

  it('updates books and logs a move when the location changes', async () => {
    const { study, shelf } = await setupFlats();
    const book = await lib.addBook({ title: 'A', locationId: study.id });
    const updated = await lib.updateBook(book.id, { locationId: shelf.id, rating: 4 });
    expect(updated.rating).toBe(4);
    const history = await lib.history(book.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromLabel: 'Flat A › Study', toLabel: 'Flat A › Living room › Top shelf' });
  });

  it('enriches in the background without hijacking undo', async () => {
    const a = await lib.addBook({ title: 'A' });
    await lib.enrichBook(a.id, { publisher: 'P' });
    expect(lib.book(a.id)?.publisher).toBe('P');
    expect(await lib.undo()).toMatch(/Added/);
    expect(lib.state.books).toEqual([]);
    expect(await lib.enrichBook(a.id, { publisher: 'Q' })).toBeUndefined();
  });

  it('deletes books and can undo it', async () => {
    const a = await lib.addBook({ title: 'A' });
    await lib.deleteBooks([a.id]);
    expect(lib.state.books).toHaveLength(0);
    expect(await lib.undo()).toMatch(/delete/i);
    expect(lib.state.books.map((b) => b.id)).toEqual([a.id]);
  });

  it('finds duplicates by ISBN', async () => {
    await lib.addBook({ title: 'A', isbn13: '9780306406157' });
    expect(lib.duplicatesOf({ isbn10: '0306406152' })).toHaveLength(1);
  });
});

describe('moving books', () => {
  it('moves many books, records history, and undoes in one step', async () => {
    const { living, flatB } = await setupFlats();
    const a = await lib.addBook({ title: 'A', locationId: living.id });
    const b = await lib.addBook({ title: 'B' });
    const moved = await lib.moveBooks([a.id, b.id], flatB.id);
    expect(moved).toBe(2);
    expect(lib.state.books.every((x) => x.locationId === flatB.id)).toBe(true);
    expect((await lib.history(b.id))[0]).toMatchObject({ fromLabel: 'No location', toLabel: 'Flat B' });

    expect(await lib.undo()).toMatch(/moved 2 books/i);
    expect(lib.book(a.id)?.locationId).toBe(living.id);
    expect(lib.book(b.id)?.locationId).toBeNull();
    expect(await lib.history(a.id)).toEqual([]);
  });

  it('skips books already at the target', async () => {
    const { living } = await setupFlats();
    const a = await lib.addBook({ title: 'A', locationId: living.id });
    expect(await lib.moveBooks([a.id], living.id)).toBe(0);
    expect(await lib.history(a.id)).toEqual([]);
  });

  it('rejects unknown targets', async () => {
    const a = await lib.addBook({ title: 'A' });
    await expect(lib.moveBooks([a.id], 'nope')).rejects.toThrow(/location/i);
  });
});

describe('locations', () => {
  it('enforces place > room > shelf', async () => {
    const { flatA, shelf } = await setupFlats();
    await expect(lib.addLocation('shelf', 'S', flatA.id)).rejects.toThrow();
    await expect(lib.addLocation('room', 'R', null)).rejects.toThrow();
    await expect(lib.addLocation('room', 'R', shelf.id)).rejects.toThrow();
  });

  it('renames and reorders', async () => {
    const { flatA, living, study } = await setupFlats();
    await lib.renameLocation(living.id, '  Lounge ');
    expect(lib.location(living.id)?.name).toBe('Lounge');
    await lib.reorderLocations(flatA.id, [study.id, living.id]);
    expect(lib.children(flatA.id).map((l) => l.name)).toEqual(['Study', 'Lounge']);
    await expect(lib.renameLocation(living.id, ' ')).rejects.toThrow();
  });

  it('moves a whole room to another place and logs moves for its books', async () => {
    const { living, flatB, shelf } = await setupFlats();
    const a = await lib.addBook({ title: 'A', locationId: shelf.id });
    await lib.moveLocation(living.id, flatB.id);
    expect(lib.label(a.locationId)).toBe('Flat B › Living room › Top shelf');
    expect((await lib.history(a.id))[0]).toMatchObject({
      fromLabel: 'Flat A › Living room › Top shelf',
      toLabel: 'Flat B › Living room › Top shelf'
    });
    await lib.undo();
    expect(lib.label(a.locationId)).toBe('Flat A › Living room › Top shelf');
  });

  it('refuses invalid location moves', async () => {
    const { living, study } = await setupFlats();
    await expect(lib.moveLocation(living.id, study.id)).rejects.toThrow();
  });

  it('deletes a subtree and reassigns its books', async () => {
    const { flatA, flatB, shelf, study } = await setupFlats();
    const a = await lib.addBook({ title: 'A', locationId: shelf.id });
    const b = await lib.addBook({ title: 'B', locationId: study.id });
    await lib.deleteLocation(flatA.id, flatB.id);
    expect(lib.state.locations.map((l) => l.name)).toEqual(['Flat B']);
    expect(lib.book(a.id)?.locationId).toBe(flatB.id);
    expect(lib.book(b.id)?.locationId).toBe(flatB.id);

    await lib.undo();
    expect(lib.state.locations).toHaveLength(5);
    expect(lib.book(a.id)?.locationId).toBe(shelf.id);
  });

  it('cannot reassign books into the subtree being deleted', async () => {
    const { flatA, living } = await setupFlats();
    await expect(lib.deleteLocation(flatA.id, living.id)).rejects.toThrow();
  });

  it('clears the default location when it is deleted', async () => {
    const { study } = await setupFlats();
    await lib.updateSettings({ defaultLocationId: study.id });
    await lib.deleteLocation(study.id, null);
    expect(lib.state.settings.defaultLocationId).toBeNull();
  });

  it('counts books per location', async () => {
    const { flatA, shelf } = await setupFlats();
    await lib.addBook({ title: 'A', locationId: shelf.id });
    await lib.addBook({ title: 'B', copies: 3 });
    expect(lib.counts().get(flatA.id)).toBe(1);
    expect(lib.counts().get(null)).toBe(1);
  });
});

describe('undo', () => {
  it('returns undefined when there is nothing to undo', async () => {
    expect(await lib.undo()).toBeUndefined();
  });

  it('undoes an add', async () => {
    await lib.addBook({ title: 'A' });
    await lib.undo();
    expect(lib.state.books).toEqual([]);
  });
});

describe('backup', () => {
  it('round-trips a snapshot', async () => {
    const { study } = await setupFlats();
    await lib.addBook({ title: 'A', locationId: study.id });
    const snap = await lib.exportSnapshot();
    const other = new DexieRepository(`test-${n++}`);
    const lib2 = await Library.open(other);
    await lib2.importSnapshot(snap);
    expect(lib2.state.books).toEqual(lib.state.books);
    expect(lib2.state.locations).toHaveLength(5);
    await other.destroy();
  });

  it('records when a backup was made', async () => {
    await lib.addBook({ title: 'A' });
    const snap = await lib.createBackup();
    expect(lib.state.settings.lastBackupAt).toBe(snap.exportedAt);
    expect(snap.settings.lastBackupAt).toBe(snap.exportedAt);
  });

  it('keeps a safety copy so a restore can be undone', async () => {
    await lib.addBook({ title: 'Before' });
    const other = new DexieRepository(`test-${n++}`);
    const lib2 = await Library.open(other);
    await lib2.addBook({ title: 'From backup' });
    const backup = await lib2.exportSnapshot();
    await other.destroy();

    await lib.importSnapshot(backup);
    expect(lib.state.books.map((b) => b.title)).toEqual(['From backup']);
    expect(await lib.hasSafetyCopy()).toBe(true);

    expect(await lib.undoRestore()).toBe(true);
    expect(lib.state.books.map((b) => b.title)).toEqual(['Before']);
    expect(await lib.hasSafetyCopy()).toBe(false);
    expect(await lib.undoRestore()).toBe(false);
  });

  it('rejects foreign files', async () => {
    await expect(lib.importSnapshot({} as never)).rejects.toThrow(/backup/i);
  });
});

describe('persistence of proxied input', () => {
  it('stores drafts that arrive as Proxies (e.g. from reactive UI state)', async () => {
    const reactive = <T extends object>(o: T): T => new Proxy(o, {});
    const book = await lib.addBook(reactive({ title: 'A', authors: reactive(['X']) }));
    const reopened = await Library.open(repo);
    expect(reopened.book(book.id)?.authors).toEqual(['X']);
  });
});

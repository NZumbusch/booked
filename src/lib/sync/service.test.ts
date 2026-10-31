import { afterEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';
import { librarySource, SyncService as BaseService } from './service';
import { MemoryTarget, SyncAuthError, SyncConflict, type SyncTarget } from './target';

/** Library-wide sync, as the Drive sync uses it. */
class SyncService extends BaseService {
  constructor(lib: Library, target: SyncTarget) {
    super(librarySource(lib), target);
  }
}

let n = 0;
const repos: DexieRepository[] = [];
async function device() {
  const repo = new DexieRepository(`sync-${n++}`);
  repos.push(repo);
  return Library.open(repo);
}
afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.destroy()));
});

describe('SyncService', () => {
  it('first sync uploads; a second device pulls everything', async () => {
    const drive = new MemoryTarget();
    const phone = await device();
    const flat = await phone.addLocation('place', 'Flat A', null);
    await phone.addBook({ title: 'Dune', locationId: flat.id });
    expect(await new SyncService(phone, drive).sync()).toBe('pushed');

    const laptop = await device();
    expect(await new SyncService(laptop, drive).sync()).toBe('pulled');
    expect(laptop.state.books.map((b) => b.title)).toEqual(['Dune']);
    expect(laptop.label(laptop.state.books[0].locationId)).toBe('Flat A');
  });

  it('merges edits from both devices and propagates deletions', async () => {
    const drive = new MemoryTarget();
    const phone = await device();
    const laptop = await device();
    const sPhone = new SyncService(phone, drive);
    const sLaptop = new SyncService(laptop, drive);

    const a = await phone.addBook({ title: 'A' });
    const b = await phone.addBook({ title: 'B' });
    await sPhone.sync();
    await sLaptop.sync();

    await phone.updateBook(a.id, { rating: 5 }); // edit on the phone
    await laptop.deleteBooks([b.id]); // delete on the laptop
    await laptop.addBook({ title: 'C' }); // add on the laptop

    await sPhone.sync();
    expect(await sLaptop.sync()).toBe('both');
    await sPhone.sync();

    const titles = (lib: Library) => lib.state.books.map((x) => x.title).sort();
    expect(titles(phone)).toEqual(['A', 'C']);
    expect(titles(laptop)).toEqual(['A', 'C']);
    expect(laptop.book(a.id)?.rating).toBe(5);
    expect(await sPhone.sync()).toBe('unchanged');
  });

  it('retries when another device writes in between', async () => {
    const drive = new MemoryTarget();
    const lib = await device();
    await lib.addBook({ title: 'A' });
    let interfered = false;
    const racy: SyncTarget = {
      read: () => drive.read(),
      async write(data, version) {
        if (!interfered) {
          interfered = true;
          await drive.write({ books: [], locations: [], moves: [], deleted: [] }, version);
          throw new SyncConflict();
        }
        return drive.write(data, version);
      }
    };
    expect(await new SyncService(lib, racy).sync()).toBe('pushed');
    expect(drive.data?.books).toHaveLength(1);
  });

  it('reports sign-in problems separately', async () => {
    const lib = await device();
    const s = new SyncService(lib, { read: async () => { throw new SyncAuthError('expired'); }, write: async () => '' });
    await expect(s.sync()).rejects.toThrow('expired');
    expect(get(s.status).state).toBe('needs-auth');
  });
});

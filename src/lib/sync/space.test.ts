import { afterEach, describe, expect, it } from 'vitest';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';
import { SyncService } from './service';
import { spaceSource } from './space-source';
import { MemoryTarget } from './target';

let n = 0;
const repos: DexieRepository[] = [];
async function person(name: string) {
  const repo = new DexieRepository(`space-${n++}`);
  repos.push(repo);
  const lib = await Library.open(repo);
  await lib.updateSettings({ userName: name });
  return lib;
}
afterEach(async () => {
  await Promise.all(repos.splice(0).map((r) => r.destroy()));
});

const titles = (lib: Library) => lib.state.books.map((b) => b.title).sort();

describe('shared places end to end (two people, one shared living room)', () => {
  it('shares only the room, lets the member add/edit, and handles books leaving', async () => {
    const drive = new MemoryTarget(); // stands in for the encrypted Worker storage
    const me = await person('Me');
    const flat = await me.addLocation('place', 'Flat A', null);
    const living = await me.addLocation('room', 'Living room', flat.id);
    const myRoom = await me.addLocation('room', 'My room', flat.id);
    const novel = await me.addBook({ title: 'Shared novel', locationId: living.id });
    await me.addBook({ title: 'My diary', locationId: myRoom.id });

    const mine = new SyncService(spaceSource(me, 's1', living.id), drive);
    expect(await mine.sync()).toBe('pushed');

    // Anna joins with the link: gets Flat A › Living room and its books, nothing private.
    const anna = await person('Anna');
    const hers = new SyncService(spaceSource(anna, 's1', living.id), drive);
    expect(await hers.sync()).toBe('pulled');
    expect(titles(anna)).toEqual(['Shared novel']);
    expect(anna.label(living.id)).toBe('Flat A › Living room');

    // Anna adds a book and rates mine.
    const added = await anna.addBook({ title: 'Anna’s cookbook', locationId: living.id });
    await anna.updateBook(novel.id, { rating: 4 });
    await hers.sync();
    await mine.sync();
    expect(titles(me)).toEqual(['Anna’s cookbook', 'My diary', 'Shared novel']);
    expect(me.book(added.id)?.addedBy).toBe('Anna');
    expect(me.book(novel.id)?.rating).toBe(4);

    // I take the novel to my room: it leaves the shared place for Anna, but stays mine.
    await me.moveBooks([novel.id], myRoom.id);
    await mine.sync();
    await hers.sync();
    expect(titles(anna)).toEqual(['Anna’s cookbook']);
    expect(me.book(novel.id)?.locationId).toBe(myRoom.id);

    // Anna deletes her cookbook: gone for me too.
    await anna.deleteBooks([added.id]);
    await hers.sync();
    await mine.sync();
    expect(titles(me)).toEqual(['My diary', 'Shared novel']);

    // Nothing private ever reached the shared copy.
    expect(drive.data!.books.map((b) => b.title)).not.toContain('My diary');
    expect(drive.data!.locations.map((l) => l.name)).not.toContain('My room');
    expect(await mine.sync()).toBe('unchanged');
  });

  it('a member’s new shelf in the shared room reaches everyone', async () => {
    const drive = new MemoryTarget();
    const me = await person('Me');
    const living = await me.addLocation('place', 'Living room', null);
    const mine = new SyncService(spaceSource(me, 's2', living.id), drive);
    await mine.sync();
    const anna = await person('Anna');
    const hers = new SyncService(spaceSource(anna, 's2', living.id), drive);
    await hers.sync();
    const shelf = await anna.addLocation('room', 'Big shelf', living.id);
    await anna.addBook({ title: 'On the shelf', locationId: shelf.id });
    await hers.sync();
    await mine.sync();
    expect(me.label(me.state.books[0].locationId)).toBe('Living room › Big shelf');
  });
});

describe('share links', () => {
  it('round-trip all join parameters, rejecting incomplete or non-https ones', async () => {
    const { shareLink, parseJoin } = await import('./spaces');
    const link = shareLink({ id: 'abc', key: 'k-_1', helperUrl: 'https://h.workers.dev', rootLocationId: 'loc1', name: 'Flat A › Living room', role: 'owner' }, 'https://me.github.io/booked/');
    expect(link.startsWith('https://me.github.io/booked/#/join?')).toBe(true);
    const query = Object.fromEntries(new URLSearchParams(link.split('#/join?')[1]));
    expect(parseJoin(query)).toEqual({ id: 'abc', key: 'k-_1', helperUrl: 'https://h.workers.dev', rootLocationId: 'loc1', name: 'Flat A › Living room' });
    expect(parseJoin({ ...query, h: 'http://evil' })).toBeUndefined();
    expect(parseJoin({ s: 'x' })).toBeUndefined();
  });
});

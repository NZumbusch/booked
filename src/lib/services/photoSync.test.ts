import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mergeSyncData } from '../domain/sync';
import { base64ToBytes, isPhotoRef, photoIdOf } from '../domain/photos';
import { DexieRepository } from '../storage/dexie-repository';
import { syncPhotos, type PhotoTarget } from '../sync/photos';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;
const others: DexieRepository[] = [];
beforeEach(async () => {
  repo = new DexieRepository(`photosync-${n++}`);
  lib = await Library.open(repo);
});
afterEach(async () => {
  await repo.destroy();
  await Promise.all(others.splice(0).map((r) => r.destroy()));
});

async function fresh(): Promise<Library> {
  const r = new DexieRepository(`photosync-${n++}`);
  others.push(r);
  return Library.open(r);
}

/** A tiny "JPEG" (any bytes do) as an old-style inline cover. */
const BYTES = 'aGVsbG8gcGhvdG8gYnl0ZXM='; // "hello photo bytes"
const INLINE = `data:image/jpeg;base64,${BYTES}`;

/** Google Drive's photo files, in memory. */
class FakeDrive implements PhotoTarget {
  files = new Map<string, { data: ArrayBuffer; type: string }>();
  uploads = 0;
  async listPhotos() {
    return new Map([...this.files.keys()].map((id) => [id, `file-${id}`]));
  }
  async uploadPhoto(id: string, data: ArrayBuffer, type: string) {
    this.files.set(id, { data, type });
    this.uploads++;
  }
  async downloadPhoto(fileId: string) {
    return this.files.get(fileId.replace('file-', ''))!;
  }
}

describe('own cover photos', () => {
  it('live in the photo store; the book only keeps a reference', async () => {
    const ref = await lib.addPhoto(base64ToBytes(BYTES));
    const b = await lib.addBook({ title: 'Mit Foto', cover: ref });
    expect(isPhotoRef(lib.book(b.id)!.cover)).toBe(true);
    const sync = await lib.exportSyncData();
    expect(JSON.stringify(sync).length).toBeLessThan(2000); // no image data in the synced records
    expect(new Uint8Array((await lib.photo(photoIdOf(ref)!))!.data)).toEqual(new Uint8Array(base64ToBytes(BYTES)));
  });

  it('the same photo gets the same id (so devices never clash)', async () => {
    const a = await lib.addPhoto(base64ToBytes(BYTES));
    const other = await fresh();
    expect(await other.addPhoto(base64ToBytes(BYTES))).toBe(a);
  });

  it('photos stored inside books by earlier versions move into the photo store on open, without looking like an edit', async () => {
    // what an earlier version stored
    const b = await lib.addBook({ title: 'Alt' });
    const old = { ...lib.book(b.id)!, cover: INLINE };
    await repo.commit({ putBooks: [old] });
    const reopened = await Library.open(repo);
    const now = reopened.book(b.id)!;
    expect(isPhotoRef(now.cover)).toBe(true);
    expect(now.updatedAt).toBe(old.updatedAt);
    expect(await reopened.photo(photoIdOf(now.cover)!)).toBeDefined();
  });

  it('backups contain the photos and restore them on a new device; old backups with inline photos still work', async () => {
    const ref = await lib.addPhoto(base64ToBytes(BYTES));
    await lib.addBook({ title: 'Mit Foto', cover: ref });
    const backup = await lib.createBackup();
    expect(backup.schemaVersion).toBe(2);
    expect(backup.photos?.map((p) => p.id)).toEqual([photoIdOf(ref)]);

    const device = await fresh();
    await device.importSnapshot(JSON.parse(JSON.stringify(backup)));
    expect(await device.photo(photoIdOf(ref)!)).toBeDefined();

    const v1 = { ...backup, schemaVersion: 1, photos: undefined, books: backup.books.map((b) => ({ ...b, cover: INLINE })) };
    const device2 = await fresh();
    await device2.importSnapshot(v1);
    await device2.migratePhotos();
    const restored = device2.state.books[0];
    expect(restored.cover).toBe(ref);
    expect(await device2.photo(photoIdOf(ref)!)).toBeDefined();
  });

  it('Google Drive: each photo is uploaded once and downloaded by the other device', async () => {
    const drive = new FakeDrive();
    const ref = await lib.addPhoto(base64ToBytes(BYTES));
    await lib.addBook({ title: 'Mit Foto', cover: ref });
    expect(await syncPhotos(lib, drive)).toEqual({ up: 1, down: 0 });
    expect(await syncPhotos(lib, drive)).toEqual({ up: 0, down: 0 }); // nothing again

    const phone = await fresh();
    await phone.applySyncData(await lib.exportSyncData());
    let arrived = 0;
    phone.onPhoto(() => arrived++);
    expect(await syncPhotos(phone, drive)).toEqual({ up: 0, down: 1 });
    expect(arrived).toBe(1);
    expect(await phone.photo(photoIdOf(ref)!)).toBeDefined();
    expect(drive.uploads).toBe(1);
  });

  it('shared places carry the photos of their books inside the (encrypted) shared copy', () => {
    const photo = { id: 'a'.repeat(20), type: 'image/jpeg', data: BYTES };
    const book = { id: 'b1', title: 'Shared', cover: `photo:${photo.id}`, updatedAt: '2026-01-01T00:00:00.000Z' };
    const empty = { books: [], locations: [], moves: [], deleted: [] };
    const local = { ...empty, books: [book as never], photos: [photo] };
    const { merged, remoteChanged } = mergeSyncData(local, { ...empty, photos: [] }, '2026-02-01T00:00:00.000Z');
    expect(merged.photos).toEqual([photo]);
    expect(remoteChanged).toBe(true);
    // a photo no book uses any more isn't carried along
    expect(mergeSyncData({ ...empty, photos: [photo] }, { ...empty, photos: [] }, '2026-02-01T00:00:00.000Z').merged.photos).toEqual([]);
  });
});

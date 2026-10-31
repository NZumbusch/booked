import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DexieRepository } from '../storage/dexie-repository';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;
beforeEach(async () => {
  repo = new DexieRepository(`photosync-${n++}`);
  lib = await Library.open(repo);
});
afterEach(() => repo.destroy());

describe('own cover photos', () => {
  it('are part of the book, so Drive sync and shared places carry them to every device', async () => {
    const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    const b = await lib.addBook({ title: 'Mit Foto', cover: photo });
    const data = await lib.exportSyncData();
    expect(data.books.find((x) => x.id === b.id)?.cover).toBe(photo);
    // and a device that receives that data keeps the photo
    const other = new DexieRepository(`photosync-${n++}`);
    const lib2 = await Library.open(other);
    await lib2.applySyncData(data);
    expect(lib2.book(b.id)?.cover).toBe(photo);
    await other.destroy();
  });
});

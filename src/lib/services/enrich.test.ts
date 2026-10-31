import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { placeholderTitle } from '../domain/book';
import type { LookupResult } from '../metadata/lookup';
import { DexieRepository } from '../storage/dexie-repository';
import { Enricher } from './enrich';
import { Library } from './library';

let repo: DexieRepository;
let lib: Library;
let n = 0;
beforeEach(async () => {
  repo = new DexieRepository(`enrich-${n++}`);
  lib = await Library.open(repo);
});
afterEach(() => repo.destroy());

const found = (draft: LookupResult['draft']): LookupResult => ({ status: 'found', draft, warnings: [] });

describe('Enricher', () => {
  it('fills placeholder books and clears the pending flag', async () => {
    const b = await lib.addBook({ title: placeholderTitle('9780306406157'), isbn13: '9780306406157', pendingLookup: true });
    const e = new Enricher(lib, {
      lookupIsbn: async () => found({ title: 'Real title', authors: ['A'], provenance: { authors: { source: 'openlibrary' } } }),
      lookupCandidate: async () => found({})
    });
    e.enqueue(b.id);
    await e.idle();
    expect(lib.book(b.id)).toMatchObject({ title: 'Real title', authors: ['A'] });
    expect(lib.book(b.id)?.pendingLookup).toBeUndefined();
  });

  it('keeps user edits made while the lookup was running', async () => {
    const b = await lib.addBook({ title: 'Mine', isbn13: '9780306406157', pendingLookup: true });
    let release!: () => void;
    const e = new Enricher(lib, {
      lookupIsbn: () => new Promise((r) => (release = () => r(found({ title: 'Theirs', publisher: 'Pub', notes: 'x' })))),
      lookupCandidate: async () => found({})
    });
    e.enqueue(b.id);
    await new Promise((r) => setTimeout(r, 10));
    await lib.updateBook(b.id, { notes: 'my note' });
    release();
    await e.idle();
    expect(lib.book(b.id)).toMatchObject({ title: 'Mine', publisher: 'Pub', notes: 'my note' });
  });

  it('keeps the flag when offline and retries on resume', async () => {
    const b = await lib.addBook({ title: 'X', isbn13: '9780306406157', pendingLookup: true });
    let online = false;
    const e = new Enricher(lib, {
      lookupIsbn: async () => (online ? found({ publisher: 'P' }) : { status: 'error', draft: {}, warnings: [] }),
      lookupCandidate: async () => found({})
    });
    e.resumeAll();
    await e.idle();
    expect(lib.book(b.id)?.pendingLookup).toBe(true);
    online = true;
    e.resumeAll();
    await e.idle();
    expect(lib.book(b.id)).toMatchObject({ publisher: 'P' });
    expect(lib.book(b.id)?.pendingLookup).toBeUndefined();
  });

  it('clears the flag when nothing is found', async () => {
    const b = await lib.addBook({ title: 'X', isbn13: '9780306406157', pendingLookup: true });
    const e = new Enricher(lib, {
      lookupIsbn: async () => ({ status: 'notfound', draft: {}, warnings: [] }),
      lookupCandidate: async () => found({})
    });
    e.enqueue(b.id);
    await e.idle();
    expect(lib.book(b.id)?.pendingLookup).toBeUndefined();
  });

  it('uses the Open Library work for books without ISBN', async () => {
    const b = await lib.addBook({ title: 'X', identifiers: { olwork: 'OL1W' }, pendingLookup: true });
    const e = new Enricher(lib, {
      lookupIsbn: async () => found({}),
      lookupCandidate: async (c) => found({ description: `about ${c.olWorkId}` })
    });
    e.enqueue(b.id);
    await e.idle();
    expect(lib.book(b.id)?.description).toBe('about OL1W');
  });

  it('does nothing for deleted books', async () => {
    const b = await lib.addBook({ title: 'X', isbn13: '9780306406157', pendingLookup: true });
    const e = new Enricher(lib, { lookupIsbn: async () => found({ publisher: 'P' }), lookupCandidate: async () => found({}) });
    await lib.deleteBooks([b.id]);
    e.enqueue(b.id);
    await e.idle();
    expect(lib.state.books).toEqual([]);
  });
});

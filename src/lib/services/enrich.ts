import { writable, type Readable } from 'svelte/store';
import { enrichmentPatch } from '../domain/book';
import type { Book, Id } from '../domain/types';
import type { LookupResult } from '../metadata/lookup';
import type { Candidate } from '../metadata/types';
import type { Library } from './library';

export interface EnrichDeps {
  lookupIsbn(isbn: string): Promise<LookupResult>;
  lookupCandidate(c: Candidate): Promise<LookupResult>;
}

/**
 * Fills in online details for books marked `pendingLookup`, a few at a time, after they've
 * been added. Network failures leave the flag set so the book is retried later
 * (next start, or when the device comes back online).
 */
export class Enricher {
  private queue: Id[] = [];
  private active = new Set<Id>();
  private store = writable<Set<Id>>(new Set());

  constructor(private lib: Library, private deps: EnrichDeps, private concurrency = 3) {}

  /** Ids currently queued or being looked up. */
  get pending(): Readable<Set<Id>> {
    return this.store;
  }

  enqueue(id: Id) {
    if (this.active.has(id) || this.queue.includes(id)) return;
    this.queue.push(id);
    this.publish();
    this.pump();
  }

  /** Queue every book still waiting for details. */
  resumeAll() {
    for (const b of this.lib.state.books) if (b.pendingLookup) this.enqueue(b.id);
  }

  /** Resolves when the queue is empty (for tests). */
  async idle(): Promise<void> {
    while (this.queue.length || this.active.size) await new Promise((r) => setTimeout(r, 5));
  }

  private publish() {
    this.store.set(new Set([...this.queue, ...this.active]));
  }

  private pump() {
    while (this.active.size < this.concurrency && this.queue.length) {
      const id = this.queue.shift()!;
      this.active.add(id);
      this.run(id).finally(() => {
        this.active.delete(id);
        this.publish();
        this.pump();
      });
    }
  }

  private async run(id: Id) {
    const book = this.lib.book(id);
    if (!book?.pendingLookup) return;
    let result: LookupResult | undefined;
    try {
      result = await this.lookup(book);
    } catch {
      return; // unexpected failure: keep pending, retry later
    }
    if (!result || result.status === 'error') return; // offline: retry later
    const current = this.lib.book(id); // may have been edited or deleted meanwhile
    if (!current) return;
    await this.lib.enrichBook(id, enrichmentPatch(current, result.status === 'found' ? result.draft : {}));
  }

  private lookup(book: Book): Promise<LookupResult> | undefined {
    if (book.isbn13 || book.isbn10) return this.deps.lookupIsbn(book.isbn13 ?? book.isbn10!);
    const olWorkId = book.identifiers?.olwork;
    if (olWorkId) {
      return this.deps.lookupCandidate({ key: olWorkId, olWorkId, title: book.title, authors: book.authors, source: 'openlibrary' });
    }
    return undefined;
  }
}

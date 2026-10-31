import type { SyncData } from '../domain/sync';

/** Where the shared copy of the library lives (Google Drive, or a fake in tests). */
export interface SyncTarget {
  /** The remote copy and an opaque version, or undefined if there is none yet. */
  read(): Promise<{ data: SyncData; version: string } | undefined>;
  /**
   * Write the merged copy. `expectedVersion` is what `read` returned (undefined = create).
   * Must throw SyncConflict if the remote copy changed in between.
   */
  write(data: SyncData, expectedVersion: string | undefined): Promise<string>;
}

export class SyncConflict extends Error {
  constructor() {
    super('The remote copy changed during sync');
  }
}

/** Not signed in, or the sign-in expired. */
export class SyncAuthError extends Error {}

/** In-memory target (tests, and a reference for the contract). */
export class MemoryTarget implements SyncTarget {
  private version = 0;
  data: SyncData | undefined;
  writes = 0;

  async read() {
    return this.data ? { data: structuredClone(this.data), version: String(this.version) } : undefined;
  }

  async write(data: SyncData, expectedVersion: string | undefined) {
    if ((this.data ? String(this.version) : undefined) !== expectedVersion) throw new SyncConflict();
    this.data = structuredClone(data);
    this.writes++;
    return String(++this.version);
  }
}

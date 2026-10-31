import { writable, type Readable } from 'svelte/store';
import { mergeSyncData, type SyncData } from '../domain/sync';
import type { Library } from '../services/library';
import { SyncAuthError, SyncConflict, type SyncTarget } from './target';

export type SyncState = 'off' | 'idle' | 'syncing' | 'error' | 'needs-auth';

export interface SyncStatus {
  state: SyncState;
  lastSyncAt?: string;
  message?: string;
}

export type SyncOutcome = 'unchanged' | 'pulled' | 'pushed' | 'both';

/** What gets synced: the whole library (Drive) or one shared place. */
export interface SyncSource {
  export(): Promise<SyncData>;
  apply(merged: SyncData): Promise<void>;
  /** Serializes syncs that touch the same library. */
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  /** Called after every successful sync with the agreed state (both sides now match it). */
  committed?(merged: SyncData): Promise<void>;
}

/** The whole library as a sync source. */
export function librarySource(lib: Library): SyncSource {
  return {
    export: () => lib.exportSyncData(),
    apply: (merged) => lib.applySyncData(merged),
    exclusive: (fn) => lib.exclusive(fn)
  };
}

/**
 * Two-way sync: read the remote copy, merge record by record, update whichever side is
 * behind. Optimistic concurrency: if another device wrote meanwhile, merge again.
 */
export class SyncService {
  private store = writable<SyncStatus>({ state: 'off' });
  private running: Promise<SyncOutcome> | undefined;

  constructor(private source: SyncSource, private target: SyncTarget) {}

  get status(): Readable<SyncStatus> {
    return this.store;
  }

  setStatus(s: SyncStatus) {
    this.store.set(s);
  }

  /** Run a sync (concurrent calls share the same run). */
  sync(): Promise<SyncOutcome> {
    this.running ??= this.source.exclusive(() => this.run()).finally(() => (this.running = undefined));
    return this.running;
  }

  private async run(): Promise<SyncOutcome> {
    this.store.update((s) => ({ ...s, state: 'syncing', message: undefined }));
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await this.target.read();
        const local = await this.source.export();
        const now = new Date().toISOString();
        const { merged, localChanged, remoteChanged } = remote
          ? mergeSyncData(local, remote.data, now)
          : { merged: local, localChanged: false, remoteChanged: true };
        try {
          if (remoteChanged) await this.target.write(merged, remote?.version);
        } catch (e) {
          if (e instanceof SyncConflict) continue; // someone else wrote: merge again
          throw e;
        }
        if (localChanged) await this.source.apply(merged);
        await this.source.committed?.(merged);
        this.store.set({ state: 'idle', lastSyncAt: now });
        return localChanged && remoteChanged ? 'both' : localChanged ? 'pulled' : remoteChanged ? 'pushed' : 'unchanged';
      }
      throw new Error('Another device kept changing the library; try again in a moment');
    } catch (e) {
      const auth = e instanceof SyncAuthError;
      this.store.update((s) => ({ ...s, state: auth ? 'needs-auth' : 'error', message: e instanceof Error ? e.message : String(e) }));
      throw e;
    }
  }
}

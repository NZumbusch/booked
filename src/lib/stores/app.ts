import { writable } from 'svelte/store';
import { lookupCandidate, lookupIsbn } from '../metadata/lookup';
import { Enricher } from '../services/enrich';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';
import { SyncController } from '../sync/controller';
import { SpacesController } from '../sync/spaces';

let instance: Library | undefined;
let enricherInstance: Enricher | undefined;
let syncInstance: SyncController | undefined;
let spacesInstance: SpacesController | undefined;

/** Places shared with family. */
export function spaces(): SpacesController {
  if (!spacesInstance) throw new Error('Library not opened yet');
  return spacesInstance;
}

/** Google Drive sync (inactive until configured in Settings). */
export function sync(): SyncController {
  if (!syncInstance) throw new Error('Library not opened yet');
  return syncInstance;
}

/** Background filler for books added before their online details were known. */
export function enricher(): Enricher {
  if (!enricherInstance) throw new Error('Library not opened yet');
  return enricherInstance;
}

/** The single Library instance used by the UI. */
export function library(): Library {
  if (!instance) throw new Error('Library not opened yet');
  return instance;
}

export async function openLibrary(): Promise<Library> {
  if (!instance) {
    instance = await Library.open(new DexieRepository());
    enricherInstance = new Enricher(instance, { lookupIsbn: (isbn) => lookupIsbn(isbn), lookupCandidate: (c) => lookupCandidate(c) });
    enricherInstance.resumeAll();
    window.addEventListener('online', () => enricherInstance?.resumeAll());
    syncInstance = new SyncController(instance);
    spacesInstance = new SpacesController(instance);
  }
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
  return instance;
}

export interface Toast {
  id: number;
  message: string;
  undo?: boolean;
}

export const toasts = writable<Toast[]>([]);
let toastId = 0;

export function toast(message: string, opts: { undo?: boolean } = {}) {
  const t = { id: ++toastId, message, ...opts };
  toasts.set([t]); // one at a time: an older "Undo" would otherwise undo a newer action
  setTimeout(() => dismissToast(t.id), opts.undo ? 7000 : 3500);
}

export function dismissToast(id: number) {
  toasts.update((all) => all.filter((t) => t.id !== id));
}

/** Run an action, report errors as a toast instead of crashing the UI. */
export async function attempt<T>(fn: () => Promise<T>, success?: string, opts: { undo?: boolean } = {}): Promise<T | undefined> {
  try {
    const result = await fn();
    if (success) toast(success, opts);
    return result;
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
    return undefined;
  }
}

export async function undoLast() {
  const label = await library().undo();
  toast(label ? `Undone: ${label}` : 'Nothing to undo');
}

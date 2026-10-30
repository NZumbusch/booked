import { writable } from 'svelte/store';
import { Library } from '../services/library';
import { DexieRepository } from '../storage/dexie-repository';

let instance: Library | undefined;

/** The single Library instance used by the UI. */
export function library(): Library {
  if (!instance) throw new Error('Library not opened yet');
  return instance;
}

export async function openLibrary(): Promise<Library> {
  instance ??= await Library.open(new DexieRepository());
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

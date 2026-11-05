import { writable } from 'svelte/store';
import { photoIdOf } from '../domain/photos';
import type { Library } from '../services/library';

/** Bumped when a photo arrives (from Drive or a shared place), so covers waiting for it look again. */
export const photoArrived = writable(0);

let lib: Library | undefined;
const urls = new Map<string, string>();
const MAX = 400;

/** Connect to the library once (from the app store). */
export function initPhotoUrls(l: Library) {
  lib = l;
  l.onPhoto(() => photoArrived.update((n) => n + 1));
}

/** A displayable address for a `photo:<id>` cover, or undefined while the photo isn't on this device. */
export async function photoUrl(ref: string | undefined): Promise<string | undefined> {
  const id = photoIdOf(ref);
  if (!id || !lib) return undefined;
  const hit = urls.get(id);
  if (hit) {
    urls.delete(id);
    urls.set(id, hit); // most recently used last
    return hit;
  }
  const p = await lib.photo(id);
  if (!p) return undefined;
  const url = URL.createObjectURL(new Blob([p.data], { type: p.type }));
  urls.set(id, url);
  while (urls.size > MAX) {
    const [oldId, oldUrl] = urls.entries().next().value as [string, string];
    urls.delete(oldId);
    setTimeout(() => URL.revokeObjectURL(oldUrl), 60_000); // may still be on screen for a moment
  }
  return url;
}

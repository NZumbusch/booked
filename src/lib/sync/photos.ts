import { photoIdsIn } from '../domain/photos';
import type { Library } from '../services/library';

/** Where photo files are kept besides the library file (Google Drive's app folder). */
export interface PhotoTarget {
  listPhotos(): Promise<Map<string, string>>;
  uploadPhoto(id: string, data: ArrayBuffer, type: string): Promise<void>;
  downloadPhoto(fileId: string): Promise<{ data: ArrayBuffer; type: string }>;
}

/**
 * After the library synced: upload the own cover photos Drive doesn't have yet, and download the
 * ones this device is missing. Photos never change (same id = same file), so there's nothing to merge.
 * Returns how many went each way.
 */
export async function syncPhotos(lib: Library, target: PhotoTarget): Promise<{ up: number; down: number }> {
  const used = photoIdsIn(lib.state.books);
  if (!used.size) return { up: 0, down: 0 };
  const [remote, local] = await Promise.all([target.listPhotos(), lib.photoIds().then((ids) => new Set(ids))]);
  let up = 0, down = 0;
  for (const id of used) {
    if (local.has(id) && !remote.has(id)) {
      const p = await lib.photo(id);
      if (p) {
        await target.uploadPhoto(id, p.data, p.type);
        up++;
      }
    } else if (!local.has(id) && remote.has(id)) {
      const file = await target.downloadPhoto(remote.get(id)!);
      await lib.putPhoto(id, file.data, file.type);
      down++;
    }
  }
  return { up, down };
}

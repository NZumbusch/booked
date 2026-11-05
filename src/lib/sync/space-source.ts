import { bookkeepingFor, EMPTY_BOOKKEEPING, exportSpace, planSpaceApply, type SpaceBookkeeping } from '../domain/spaces';
import { photoIdsIn } from '../domain/photos';
import type { Id } from '../domain/types';
import type { Library } from '../services/library';
import type { SyncSource } from './service';

const metaKey = (spaceId: string) => `space:${spaceId}`;

/** One shared place of the library as a sync source. */
export function spaceSource(lib: Library, spaceId: string, rootId: Id): SyncSource {
  return {
    exclusive: (fn) => lib.exclusive(fn),
    async export() {
      const prev = (await lib.getMeta<SpaceBookkeeping>(metaKey(spaceId))) ?? EMPTY_BOOKKEEPING;
      const data = exportSpace(await lib.exportSyncData(), rootId, prev, lib.state.settings.userName);
      // The shared place has no separate file store: own cover photos of its books travel inside (encrypted).
      return { ...data, photos: await lib.photoFiles(photoIdsIn(data.books)) };
    },
    async apply(merged) {
      if (merged.photos?.length) await lib.storePhotos(merged.photos);
      const plan = planSpaceApply(await lib.exportSyncData(), rootId, merged);
      await lib.applyExternal({
        putBooks: plan.putBooks,
        deleteBookIds: plan.deleteBookIds,
        putLocations: plan.putLocations,
        deleteLocationIds: plan.deleteLocationIds,
        putMoves: plan.putMoves,
        putTombstones: plan.tombstones
      });
    },
    async committed(merged) {
      // Remember what is shared now, so books that leave later get announced to the others.
      const prev = await lib.getMeta<SpaceBookkeeping>(metaKey(spaceId));
      await lib.setMeta(metaKey(spaceId), bookkeepingFor(merged, prev));
    }
  };
}

export async function forgetSpace(lib: Library, spaceId: string) {
  await lib.setMeta(metaKey(spaceId), undefined);
}

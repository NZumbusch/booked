import { EMPTY_BOOKKEEPING, exportSpace, planSpaceApply, type SpaceBookkeeping } from '../domain/spaces';
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
      return exportSpace(await lib.exportSyncData(), rootId, prev);
    },
    async apply(merged) {
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
      const bookkeeping: SpaceBookkeeping = {
        bookIds: merged.books.map((b) => b.id), locationIds: merged.locations.map((l) => l.id), deleted: merged.deleted
      };
      await lib.setMeta(metaKey(spaceId), bookkeeping);
    }
  };
}

export async function forgetSpace(lib: Library, spaceId: string) {
  await lib.setMeta(metaKey(spaceId), undefined);
}

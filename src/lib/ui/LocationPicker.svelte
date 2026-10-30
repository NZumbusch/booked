<script lang="ts">
  import { childrenOf, pathOf } from '../domain/locations';
  import type { Id, Location } from '../domain/types';

  let { value = $bindable(null), locations, allowNone = true, exclude = [] }: {
    value?: Id | null;
    locations: Location[];
    allowNone?: boolean;
    /** Location ids that can't be picked (e.g. a subtree being deleted). */
    exclude?: Id[];
  } = $props();

  const visible = $derived(locations.filter((l) => !exclude.includes(l.id)));
  const path = $derived(pathOf(visible, value));
  const placeId = $derived(path[0]?.id ?? '');
  const roomId = $derived(path[1]?.id ?? '');
  const shelfId = $derived(path[2]?.id ?? '');
  const places = $derived(childrenOf(visible, null));
  const rooms = $derived(placeId ? childrenOf(visible, placeId) : []);
  const shelves = $derived(roomId ? childrenOf(visible, roomId) : []);

  const pick = (id: string, fallback: Id | null) => (value = id || fallback);
</script>

<div class="picker">
  <label class="field">Place
    <select value={placeId} onchange={(e) => pick(e.currentTarget.value, null)}>
      {#if allowNone || !placeId}<option value="">{allowNone ? 'No location' : 'Choose a place…'}</option>{/if}
      {#each places as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
    </select>
  </label>
  {#if rooms.length}
    <label class="field">Room
      <select value={roomId} onchange={(e) => pick(e.currentTarget.value, placeId)}>
        <option value="">Any room</option>
        {#each rooms as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
      </select>
    </label>
  {/if}
  {#if shelves.length}
    <label class="field">Shelf
      <select value={shelfId} onchange={(e) => pick(e.currentTarget.value, roomId)}>
        <option value="">Any shelf</option>
        {#each shelves as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
      </select>
    </label>
  {/if}
</div>

<style>
  .picker { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
</style>

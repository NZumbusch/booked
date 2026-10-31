<script lang="ts">
  import { childrenOf, KIND_LABEL, pathOf } from '../domain/locations';
  import type { Id, Location, LocationKind } from '../domain/types';
  import { attempt, library } from '../stores/app';

  type Create = (kind: LocationKind, name: string, parentId: Id | null) => Promise<Location | undefined>;

  let { value = $bindable(null), locations, allowNone = true, exclude = [], oncreate }: {
    value?: Id | null;
    locations: Location[];
    allowNone?: boolean;
    /** Location ids that can't be picked (e.g. a subtree being deleted). */
    exclude?: Id[];
    /** Creates a location inline ("+ New place…"). Defaults to the app library; pass null to disable. */
    oncreate?: Create | null;
  } = $props();

  const NEW = '__new__';
  const create = $derived<Create | null>(
    oncreate === undefined ? (kind, name, parentId) => attempt(() => library().addLocation(kind, name, parentId)) : oncreate
  );

  const visible = $derived(locations.filter((l) => !exclude.includes(l.id)));
  const path = $derived(pathOf(visible, value));
  const placeId = $derived(path[0]?.id ?? '');
  const roomId = $derived(path[1]?.id ?? '');
  const shelfId = $derived(path[2]?.id ?? '');
  const places = $derived(childrenOf(visible, null));
  const rooms = $derived(placeId ? childrenOf(visible, placeId) : []);
  const shelves = $derived(roomId ? childrenOf(visible, roomId) : []);

  /** The level currently showing the inline "new …" input. */
  let adding = $state<{ kind: LocationKind; parentId: Id | null } | undefined>();
  let newName = $state('');

  function pick(id: string, fallback: Id | null, kind: LocationKind, parentId: Id | null) {
    if (id === NEW) {
      adding = { kind, parentId };
      newName = '';
      return;
    }
    adding = undefined;
    value = id || fallback;
  }

  async function confirmNew() {
    if (!adding || !create || !newName.trim()) return;
    const loc = await create(adding.kind, newName, adding.parentId);
    if (loc) value = loc.id;
    adding = undefined;
  }

  function onkey(e: KeyboardEvent) {
    // Enter must not submit a surrounding form.
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmNew();
    } else if (e.key === 'Escape') {
      adding = undefined;
    }
  }
</script>

<div class="picker">
  <label class="field">Place
    <select value={adding?.kind === 'place' ? NEW : placeId} onchange={(e) => pick(e.currentTarget.value, null, 'place', null)}>
      {#if allowNone || !placeId}<option value="">{allowNone ? 'No location' : 'Choose a place…'}</option>{/if}
      {#each places as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      {#if create}<option value={NEW}>+ New place…</option>{/if}
    </select>
  </label>
  {#if placeId && (rooms.length || create)}
    <label class="field">Room
      <select value={adding?.kind === 'room' ? NEW : roomId} onchange={(e) => pick(e.currentTarget.value, placeId, 'room', placeId)}>
        <option value="">{rooms.length ? 'Any room' : 'No room'}</option>
        {#each rooms as r (r.id)}<option value={r.id}>{r.name}</option>{/each}
        {#if create}<option value={NEW}>+ New room…</option>{/if}
      </select>
    </label>
  {/if}
  {#if shelves.length}
    <!-- Shelves are optional: this level only appears once a room has shelves. -->
    <label class="field">Shelf
      <select value={adding?.kind === 'shelf' ? NEW : shelfId} onchange={(e) => pick(e.currentTarget.value, roomId, 'shelf', roomId)}>
        <option value="">Any shelf</option>
        {#each shelves as sh (sh.id)}<option value={sh.id}>{sh.name}</option>{/each}
        {#if create}<option value={NEW}>+ New shelf…</option>{/if}
      </select>
    </label>
  {/if}
</div>
{#if adding}
  <div class="new">
    <!-- svelte-ignore a11y_autofocus -->
    <input bind:value={newName} onkeydown={onkey} autofocus placeholder="New {KIND_LABEL[adding.kind].toLowerCase()} name"
      aria-label="New {KIND_LABEL[adding.kind].toLowerCase()} name" />
    <button type="button" onclick={() => (adding = undefined)}>Cancel</button>
    <button type="button" class="btn-primary" onclick={confirmNew} disabled={!newName.trim()}>Add</button>
  </div>
{/if}

<style>
  .picker { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .new { display: flex; gap: 8px; margin-top: 10px; }
  .new input { flex: 1; width: auto; }
</style>

<script lang="ts">
  import { childKind, descendantIds, KIND_LABEL, pathOf } from '../lib/domain/locations';
  import type { Id, Location, LocationKind } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { attempt, library } from '../lib/stores/app';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  let { id = null }: { id?: Id | null } = $props();

  const lib = library();
  const current = $derived($lib && (id ? lib.location(id) : undefined));
  const crumbs = $derived(pathOf($lib.locations, id));
  const kids = $derived($lib && lib.children(id));
  const counts = $derived($lib && lib.counts());
  const kidKind = $derived<LocationKind | null>(current ? childKind(current.kind) : 'place');

  let newName = $state('');
  // Shelves are optional: their add form stays hidden until asked for.
  let showShelfForm = $state(false);
  const showAddForm = $derived(kidKind !== 'shelf' || kids.length > 0 || showShelfForm);

  // The location being managed in the edit sheet.
  let editing = $state<Location>();
  let editOpen = $state(false);
  let renameTo = $state('');
  let moveOpen = $state(false);
  let moveTo = $state<Id>('');
  let deleteOpen = $state(false);
  let deleteTarget = $state<Id | null>(null);

  async function add(e: SubmitEvent) {
    e.preventDefault();
    if (!kidKind || !newName.trim()) return;
    const name = newName;
    newName = ''; // clear right away so fast typists can add the next one
    if (!(await attempt(() => lib.addLocation(kidKind, name, id)))) newName = name;
  }

  function manage(loc: Location) {
    editing = loc;
    renameTo = loc.name;
    editOpen = true;
  }

  async function rename() {
    if (!editing) return;
    editOpen = false;
    await attempt(() => lib.renameLocation(editing!.id, renameTo), 'Renamed', { undo: true });
  }

  async function shift(loc: Location, delta: number) {
    const ids = kids.map((k) => k.id);
    const i = ids.indexOf(loc.id);
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await attempt(() => lib.reorderLocations(id, ids));
  }

  /** Possible new parents when moving a room (→ other places) or a shelf (→ other rooms). */
  const parentOptions = $derived(
    editing && editing.kind !== 'place'
      ? $lib.locations
          .filter((l) => childKind(l.kind) === editing!.kind && l.id !== editing!.parentId)
          .map((l) => ({ id: l.id, label: lib.label(l.id) }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : []
  );

  function openMove() {
    editOpen = false;
    moveTo = parentOptions[0]?.id ?? '';
    moveOpen = true;
  }

  async function doMove() {
    if (!editing || !moveTo) return;
    moveOpen = false;
    const n = counts.get(editing.id) ?? 0;
    await attempt(() => lib.moveLocation(editing!.id, moveTo),
      `Moved “${editing.name}” (${plural(n, 'book')}) to ${lib.label(moveTo)}`, { undo: true });
  }

  function openDelete() {
    editOpen = false;
    deleteTarget = editing?.parentId ?? null;
    deleteOpen = true;
  }

  async function doDelete() {
    if (!editing) return;
    deleteOpen = false;
    const wasCurrent = editing.id === id;
    const parent = editing.parentId;
    if (await attempt(() => lib.deleteLocation(editing!.id, deleteTarget).then(() => true), `Deleted “${editing.name}”`, { undo: true })) {
      if (wasCurrent) navigate(parent ? `/locations/${parent}` : '/locations');
    }
  }
</script>

<div class="page stack">
  <header class="stack tight">
    <nav class="crumbs small" aria-label="Breadcrumb">
      <a href="#/locations">All places</a>
      {#each crumbs as c (c.id)}<span class="muted">›</span><a href="#/locations/{c.id}">{c.name}</a>{/each}
    </nav>
    {#if id && !current}
      <h1>Location not found</h1>
    {:else}
      <div class="spread">
        <h1>{current?.name ?? 'Places'}</h1>
        {#if current}<button class="btn-sm" onclick={() => manage(current)}><Icon name="edit" size={18} /> Edit</button>{/if}
      </div>
      {#if current}
        <a class="btn btn-primary" href="#/books?loc={current.id}"><Icon name="books" /> View {plural(counts.get(current.id) ?? 0, 'book')}</a>
      {/if}
    {/if}
  </header>

  {#if kidKind}
    <section class="stack">
      {#if kids.length}<h2>{KIND_LABEL[kidKind]}s</h2>{/if}
      <ul class="list">
        {#each kids as loc, i (loc.id)}
          <li class="card item">
            <a class="main" href="#/locations/{loc.id}">
              <strong>{loc.name}</strong>
              <span class="muted small">
                {plural(counts.get(loc.id) ?? 0, 'book')}
                {#if childKind(loc.kind)}· {plural(lib.children(loc.id).length, KIND_LABEL[childKind(loc.kind)!].toLowerCase())}{/if}
              </span>
            </a>
            <div class="tools">
              <button class="btn-ghost btn-icon" aria-label="Move {loc.name} up" disabled={i === 0} onclick={() => shift(loc, -1)}><Icon name="up" /></button>
              <button class="btn-ghost btn-icon" aria-label="Move {loc.name} down" disabled={i === kids.length - 1} onclick={() => shift(loc, 1)}><Icon name="down" /></button>
              <button class="btn-ghost btn-icon" aria-label="Edit {loc.name}" onclick={() => manage(loc)}><Icon name="edit" /></button>
            </div>
          </li>
        {/each}
      </ul>

      {#if !kids.length && kidKind !== 'shelf'}
        <p class="muted empty-hint">
          {#if !current}No places yet. Start with where your books live, e.g. “Flat A” or “Parents’ house”.
          {:else}Add the rooms of {current.name}, e.g. “Living room”.{/if}
        </p>
      {/if}

      {#if !showAddForm}
        <button class="btn-ghost small optional" onclick={() => (showShelfForm = true)}>+ Add shelves (optional)</button>
      {:else}
      <form class="add" onsubmit={add}>
        <input bind:value={newName} placeholder="New {KIND_LABEL[kidKind].toLowerCase()} name" aria-label="New {KIND_LABEL[kidKind].toLowerCase()} name" />
        <button class="btn-primary" type="submit" disabled={!newName.trim()}><Icon name="plus" /> Add</button>
      </form>
      {/if}
    </section>
  {/if}

  {#if !id && (counts.get(null) ?? 0) > 0}
    <a class="card item main" href="#/books?loc=none">
      <strong>No location</strong>
      <span class="muted small">{plural(counts.get(null) ?? 0, 'book')}</span>
    </a>
  {/if}
</div>

<Dialog bind:open={editOpen} title="Edit {editing ? KIND_LABEL[editing.kind].toLowerCase() : ''}">
  <form class="add" onsubmit={(e) => { e.preventDefault(); rename(); }}>
    <input bind:value={renameTo} aria-label="Name" />
    <button class="btn-primary" type="submit" disabled={!renameTo.trim()}>Rename</button>
  </form>
  {#if editing && editing.kind !== 'place'}
    <button onclick={openMove} disabled={!parentOptions.length}>
      <Icon name="move" /> Move whole {KIND_LABEL[editing.kind].toLowerCase()} to another {editing.kind === 'room' ? 'place' : 'room'}
    </button>
  {/if}
  <button class="btn-danger" onclick={openDelete}><Icon name="trash" /> Delete</button>
</Dialog>

<Dialog bind:open={moveOpen} title="Move “{editing?.name}”">
  <p class="muted small">Everything inside moves along, and each book’s history records the move.</p>
  <label class="field">New {editing?.kind === 'room' ? 'place' : 'room'}
    <select bind:value={moveTo}>
      {#each parentOptions as o (o.id)}<option value={o.id}>{o.label}</option>{/each}
    </select>
  </label>
  {#snippet actions()}
    <button onclick={() => (moveOpen = false)}>Cancel</button>
    <button class="btn-primary" onclick={doMove} disabled={!moveTo}>Move</button>
  {/snippet}
</Dialog>

<Dialog bind:open={deleteOpen} title="Delete “{editing?.name}”?">
  {#if editing}
    {@const n = counts.get(editing.id) ?? 0}
    {#if editing.kind !== 'shelf' && lib.children(editing.id).length}
      <p>Everything inside it ({lib.children(editing.id).map((c) => c.name).join(', ')}) will be deleted too.</p>
    {/if}
    {#if n > 0}
      <p>Where should its {plural(n, 'book')} go?</p>
      <LocationPicker bind:value={deleteTarget} locations={$lib.locations} exclude={descendantIds($lib.locations, editing.id)} />
    {:else}
      <p class="muted">It contains no books.</p>
    {/if}
  {/if}
  {#snippet actions()}
    <button onclick={() => (deleteOpen = false)}>Cancel</button>
    <button class="btn-danger solid" onclick={doDelete}>Delete</button>
  {/snippet}
</Dialog>

<style>
  .tight { gap: 4px; }
  .crumbs { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; min-height: 32px; }
  .crumbs a { text-decoration: none; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .item { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; }
  .main { flex: 1; display: grid; text-decoration: none; min-height: var(--tap); align-content: center; }
  a.item { padding: 6px 16px; }
  .tools { display: flex; }
  .tools button { color: var(--muted); }
  .add { display: flex; gap: 8px; }
  .empty-hint { margin: 0; }
  .optional { color: var(--muted); justify-self: start; }
</style>

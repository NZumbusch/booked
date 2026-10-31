<script lang="ts">
  import { facet, filterToQuery } from '../lib/domain/filters';
  import { fold } from '../lib/domain/query';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { attempt, library } from '../lib/stores/app';
  import type { TermKind } from '../lib/services/library';
  import Confirm from '../lib/ui/Confirm.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let { kind = 'tags' }: { kind?: TermKind } = $props();

  const lib = library();
  const TABS: [TermKind, string][] = [['tags', 'Tags'], ['collections', 'Collections'], ['genres', 'Genres']];
  const SINGULAR: Record<TermKind, string> = { tags: 'tag', collections: 'collection', genres: 'genre' };

  const items = $derived(facet($lib.books, (b) => b[kind]));
  let editing = $state<string>();
  let renameTo = $state('');
  let renameOpen = $state(false);
  let deleteOpen = $state(false);

  const mergesInto = $derived(
    renameTo.trim() && editing && fold(renameTo) !== fold(editing) ? items.find((i) => fold(i.value) === fold(renameTo)) : undefined
  );

  function edit(value: string) {
    editing = value;
    renameTo = value;
    renameOpen = true;
  }

  async function rename() {
    renameOpen = false;
    if (!editing || !renameTo.trim() || renameTo.trim() === editing) return;
    await attempt(() => lib.renameTerm(kind, editing!, renameTo), mergesInto ? `Merged into “${mergesInto.value}”` : 'Renamed', { undo: true });
  }

  function show(value: string) {
    const key = { tags: 'tags', collections: 'collections', genres: 'genres' }[kind] as 'tags' | 'collections' | 'genres';
    navigate('/books', filterToQuery({ [key]: [value] }));
  }
</script>

<div class="page stack">
  <h1>Tags & collections</h1>
  <div class="seg" role="tablist">
    {#each TABS as [k, label]}
      <a role="tab" href="#/tags/{k}" aria-selected={kind === k} class:on={kind === k}>{label}</a>
    {/each}
  </div>

  {#if items.length === 0}
    <div class="card empty">
      <p>No {kind} yet.
        {#if kind === 'genres'}Genres are filled in automatically from online catalogues.
        {:else}Add them on a book, or select several books in the library and use “{kind === 'tags' ? 'Tags' : 'Collection'}”.{/if}
      </p>
      <a class="btn" href="#/books">Go to library</a>
    </div>
  {:else}
    <p class="muted small">{plural(items.length, SINGULAR[kind])}. Rename one to the name of another to merge them.</p>
    <ul class="list">
      {#each items as item (item.value)}
        <li class="card row-item">
          <button class="main btn-ghost" onclick={() => show(item.value)}>
            <strong>{kind === 'tags' ? '#' : ''}{item.value}</strong>
            <span class="muted small">{plural(item.count, 'book')}</span>
          </button>
          <button class="btn-ghost btn-icon" aria-label="Rename or delete {item.value}" onclick={() => edit(item.value)}><Icon name="edit" /></button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog bind:open={renameOpen} title="Edit {SINGULAR[kind]}">
  <form class="row add" onsubmit={(e) => { e.preventDefault(); rename(); }}>
    <input bind:value={renameTo} aria-label="Name" />
    <button class="btn-primary" type="submit" disabled={!renameTo.trim()}>{mergesInto ? 'Merge' : 'Rename'}</button>
  </form>
  {#if mergesInto}
    <p class="small warn">“{mergesInto.value}” already exists ({plural(mergesInto.count, 'book')}). Both will be merged into one.</p>
  {/if}
  <button class="btn-danger" onclick={() => { renameOpen = false; deleteOpen = true; }}><Icon name="trash" /> Remove from all books</button>
</Dialog>

<Confirm bind:open={deleteOpen} title="Remove “{editing}”?" confirmLabel="Remove"
  message="It will be removed from every book that has it. The books themselves stay. You can undo this right after."
  onconfirm={() => attempt(() => lib.deleteTerm(kind, editing!), `Removed “${editing}”`, { undo: true })} />

<style>
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); background: var(--surface-2); border-radius: 999px; padding: 4px; gap: 4px; }
  .seg a { text-align: center; text-decoration: none; min-height: 40px; display: grid; place-items: center; border-radius: 999px; }
  .seg a.on { background: var(--surface); box-shadow: var(--shadow); font-weight: 600; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .row-item { display: flex; align-items: center; padding: 4px 4px 4px 8px; }
  .main { flex: 1; justify-content: space-between; border-radius: 10px; }
  .add input { flex: 1; width: auto; }
  .warn { color: var(--warn); margin: 0; }
</style>

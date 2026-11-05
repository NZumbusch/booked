<script lang="ts">
  import { displayTitle } from '../lib/domain/book';
  import { flatten, mergeNode, moveNode, pathTree, removeNode, renameNode, type PathChanges, type PathNode } from '../lib/domain/pathTree';
  import { plural } from '../lib/format';
  import { attempt, library } from '../lib/stores/app';
  import Dialog from '../lib/ui/Dialog.svelte';

  /**
   * Your topic paths as one tree (broad › specific): rename, move, merge or remove a topic on any
   * level, for all its books at once. These paths alone arrange and name the cover wall.
   */
  const lib = library();
  const books = $derived($lib && lib.owned());
  const tree = $derived(pathTree(books));
  const all = $derived(flatten(tree));
  const unsorted = $derived(books.filter((b) => !b.aiTopics?.length).length);
  const key = (p: string[]) => p.join('\u0000');

  let open = $state(new Set<string>());
  function toggle(n: PathNode) {
    const k = key(n.path);
    const next = new Set(open);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    open = next;
  }
  let q = $state('');
  /** While searching: the topics whose name matches, with the way to them opened. */
  const matches = $derived.by(() => {
    const t = q.trim().toLowerCase();
    if (!t) return undefined;
    const hits = new Set<string>();
    for (const { node } of all) if (node.name.toLowerCase().includes(t)) for (let d = 1; d <= node.path.length; d++) hits.add(key(node.path.slice(0, d)));
    return hits;
  });
  const visible = (n: PathNode) => !matches || matches.has(key(n.path));
  const isOpen = (n: PathNode) => open.has(key(n.path)) || (!!matches && n.children.some((c) => matches!.has(key(c.path))));

  async function apply(changes: PathChanges, label: string) {
    if (!changes.size) return;
    await attempt(() => lib.bulkUpdate([...changes.keys()], (b) => ({ aiTopics: changes.get(b.id) }), label), `${label} (${plural(changes.size, 'book')})`, { undo: true });
  }

  // ---- rename (inline)
  let renaming = $state<string>();
  let newName = $state('');
  function startRename(n: PathNode) {
    renaming = key(n.path);
    newName = n.name;
  }
  async function rename(n: PathNode) {
    renaming = undefined;
    if (newName.trim() && newName.trim() !== n.name) await apply(renameNode(books, n.path, newName), `Renamed “${n.name}” to “${newName.trim()}”`);
  }

  // ---- move / merge: choose where
  let target = $state<{ node: PathNode; mode: 'move' | 'merge' }>();
  let targetOpen = $state(false);
  function choose(node: PathNode, mode: 'move' | 'merge') {
    target = { node, mode };
    targetOpen = true;
  }
  const inside = (p: string[], of: string[]) => of.length <= p.length && of.every((x, i) => x === p[i]);
  const destinations = $derived(target ? all.filter(({ node }) => !inside(node.path, target!.node.path) && !(target!.mode === 'move' && key(node.path) === key(target!.node.path.slice(0, -1)))) : []);
  async function pick(to: string[]) {
    const t = target;
    targetOpen = false;
    if (!t) return;
    if (t.mode === 'move') await apply(moveNode(books, t.node.path, to), `Moved “${t.node.name}” ${to.length ? `under “${to.join(' › ')}”` : 'to the top'}`);
    else await apply(mergeNode(books, t.node.path, to), `Merged “${t.node.name}” into “${to.join(' › ')}”`);
  }

  // ---- remove
  let removing = $state<PathNode>();
  let removeOpen = $state(false);
  async function remove(mode: 'lift' | 'drop') {
    const n = removing;
    removeOpen = false;
    if (n) await apply(removeNode(books, n.path, mode), `Removed “${n.name}”`);
  }

  const splitHref = (n: PathNode) => `#/topics?split=${encodeURIComponent(n.path.join(' > '))}`;
  const parentName = (n: PathNode) => (n.path.length > 1 ? n.path[n.path.length - 2] : '');
  const titleOf = (id: string) => {
    const b = lib.book(id);
    return b ? displayTitle(b) : '';
  };
</script>

<div class="page stack">
  <header class="spread">
    <h1>Topics</h1>
    <a class="btn btn-sm" href="#/topics">✨ Sort with AI</a>
  </header>
  <p class="muted small">Your topic paths, broad to specific. They alone arrange and name the cover wall (tags don’t). Rename, move, merge or remove a topic on any level: it changes for all its books, and can be undone.{#if unsorted} {plural(unsorted, 'book')} have no path yet (<a href="#/topics">sort them with AI</a>, or set one on a book’s page).{/if}</p>

  {#if !tree.length}
    <div class="card empty">
      <span class="big">🗂️</span>
      <p>No topic paths yet. Sort your books with an AI chat, or give a book a topic on its page.</p>
      <a class="btn btn-primary" href="#/topics">✨ Sort with AI</a>
    </div>
  {:else}
    {#if all.length > 12}
      <input type="search" bind:value={q} placeholder="Find a topic" aria-label="Find a topic" />
    {/if}
    <ul class="tree" role="tree">
      {#each tree as n (key(n.path))}{@render row(n, 0)}{/each}
    </ul>
  {/if}
</div>

{#snippet row(n: PathNode, depth: number)}
  {#if visible(n)}
    <li role="treeitem" aria-expanded={n.children.length || n.direct.length ? isOpen(n) : undefined} aria-selected="false" class="level{Math.min(depth, 3)}">
      <div class="node">
        <button class="twisty" onclick={() => toggle(n)} aria-label={isOpen(n) ? 'Close' : 'Open'} disabled={!n.children.length && !n.direct.length}>{n.children.length || n.direct.length ? (isOpen(n) ? '▾' : '▸') : '·'}</button>
        {#if renaming === key(n.path)}
          <form class="rename" onsubmit={(e) => { e.preventDefault(); rename(n); }}>
            <!-- svelte-ignore a11y_autofocus -->
            <input bind:value={newName} aria-label="New name for {n.name}" autofocus onkeydown={(e) => e.key === 'Escape' && (renaming = undefined)} />
            <button class="btn-sm btn-primary" type="submit">Save</button>
            <button class="btn-sm" type="button" onclick={() => (renaming = undefined)}>Cancel</button>
          </form>
        {:else}
          <button class="name" onclick={() => toggle(n)}><strong>{n.name}</strong> <span class="muted small">{n.total}</span>
            {#if n.direct.length >= 15}<span class="badge warn" title="Many books with no finer topic: split it">split?</span>{/if}</button>
          <span class="acts">
            {#if n.total >= 12}<a class="btn btn-sm btn-ghost" href={splitHref(n)} title="Split into sub-topics with AI" aria-label="Split {n.name} with AI">✨</a>{/if}
            <button class="btn-sm btn-ghost" onclick={() => startRename(n)} title="Rename" aria-label="Rename {n.name}">✎</button>
            <button class="btn-sm btn-ghost" onclick={() => choose(n, 'move')} title="Move (with its sub-topics)" aria-label="Move {n.name}">↗</button>
            <button class="btn-sm btn-ghost" onclick={() => choose(n, 'merge')} title="Merge into another topic" aria-label="Merge {n.name}">⤵</button>
            <button class="btn-sm btn-ghost" onclick={() => { removing = n; removeOpen = true; }} title="Remove" aria-label="Remove {n.name}">✕</button>
          </span>
        {/if}
      </div>
      {#if isOpen(n)}
        {#if n.direct.length}
          <ul class="books">
            {#each n.direct.slice(0, 50) as id (id)}<li><a href="#/book/{id}">{titleOf(id)}</a></li>{/each}
            {#if n.direct.length > 50}<li class="muted small">and {n.direct.length - 50} more</li>{/if}
          </ul>
        {/if}
        {#if n.children.length}
          <ul class="tree" role="group">{#each n.children as c (key(c.path))}{@render row(c, depth + 1)}{/each}</ul>
        {/if}
      {/if}
    </li>
  {/if}
{/snippet}

<Dialog bind:open={targetOpen} title={target ? (target.mode === 'move' ? `Move “${target.node.name}” to…` : `Merge “${target.node.name}” into…`) : ''}>
  <p class="muted small">
    {#if target?.mode === 'move'}It keeps its name and sub-topics; if the new place already has a topic of that name, they become one.
    {:else}Its books and sub-topics join the chosen topic; “{target?.node.name}” disappears.{/if}
  </p>
  <ul class="picker">
    {#if target?.mode === 'move' && target.node.path.length > 1}<li><button onclick={() => pick([])}><strong>Top level</strong> <span class="muted small">(a broad topic of its own)</span></button></li>{/if}
    {#each destinations as { node, depth } (key(node.path))}
      <li><button style:padding-left="{12 + depth * 16}px" onclick={() => pick(node.path)}>{node.name} <span class="muted small">{node.total}</span></button></li>
    {/each}
  </ul>
</Dialog>

<Dialog bind:open={removeOpen} title="Remove “{removing?.name ?? ''}”?">
  <div class="stack">
    {#if removing?.children.length}
      <button onclick={() => remove('lift')}>
        <strong>Keep its sub-topics</strong><br />
        <span class="muted small">They move up {removing.path.length > 1 ? `under “${parentName(removing)}”` : 'to broad topics'}; books directly in “{removing.name}” {removing.path.length > 1 ? `go to “${parentName(removing)}”` : 'lose their path'}.</span>
      </button>
    {/if}
    <button onclick={() => remove('drop')}>
      <strong>{removing?.children.length ? 'Remove it with its sub-topics' : 'Remove it'}</strong><br />
      <span class="muted small">{removing && removing.path.length > 1 ? `Its ${plural(removing.total, 'book')} go to “${parentName(removing)}”.` : `Its ${plural(removing?.total ?? 0, 'book')} lose their path (the catalogue stands in again on the wall).`}</span>
    </button>
  </div>
</Dialog>

<style>
  .tree { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .tree .tree { margin-left: 14px; padding-left: 8px; border-left: 1px solid var(--line); }
  .node { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .twisty { width: 32px; min-height: 36px; padding: 0; border: none; background: none; color: var(--muted); flex: none; }
  .name { flex: 1; min-width: 0; justify-content: flex-start; text-align: left; border: none; background: none; padding: 6px 4px; white-space: normal; overflow-wrap: anywhere; }
  .level0 > .node .name strong { font-size: 1.05rem; }
  .acts { display: flex; flex: none; }
  .acts button, .acts a { min-width: 34px; padding: 0 6px; }
  .name .badge { margin-left: 4px; }
  .rename { display: flex; gap: 6px; flex: 1; min-width: 0; }
  .rename input { flex: 1; min-width: 0; }
  .books { list-style: none; margin: 0 0 6px 36px; padding: 0; display: grid; gap: 2px; font-size: 0.88rem; }
  .books a { text-decoration: none; }
  .picker { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 55dvh; overflow: auto; }
  .picker button { width: 100%; justify-content: flex-start; text-align: left; white-space: normal; }
  .stack button { text-align: left; justify-content: flex-start; white-space: normal; display: block; }
  p { margin: 0; }
</style>

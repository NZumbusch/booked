<script lang="ts">
  import { displayTitle, todayIso } from '../lib/domain/book';
  import { matchesText } from '../lib/domain/query';
  import type { Book, Id } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { attempt, library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  /** Books you'd like to have: kept apart from the library (no room, not in counts, stats or the wall). */
  const lib = library();
  let q = $state('');
  const all = $derived($lib && lib.wishlist());
  const wishes = $derived(
    all.filter((b) => !q.trim() || matchesText(b, q)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );
  const df = $derived($lib.settings.dateFormat);

  async function remove(b: Book) {
    await attempt(() => lib.deleteBooks([b.id]), `Removed “${b.title}” from your wishlist`, { undo: true });
  }

  // ---- Bought it: choose where it goes, then it's part of the library
  let buying = $state<Book>();
  let buyOpen = $state(false);
  let target = $state<Id | null>(null);
  function startBuy(b: Book) {
    target = $lib.settings.defaultLocationId ?? null;
    buying = b;
    buyOpen = true;
  }
  async function buy() {
    const b = buying;
    buyOpen = false;
    if (!b) return;
    const where = target;
    await attempt(() => lib.updateBook(b.id, { ownership: 'owned', locationId: where, purchasedOn: b.purchasedOn ?? todayIso() }),
      `“${b.title}” is in your library: ${lib.label(where)}`, { undo: true });
  }
</script>

<div class="page stack">
  <header class="spread">
    <h1>Wishlist</h1>
    <a class="btn btn-sm btn-primary" href="#/add?mode=search&to=wishlist"><Icon name="search" size={18} /> Add a wish</a>
  </header>

  {#if all.length === 0}
    <div class="card empty">
      <span class="big">🎁</span>
      <p>Nothing on your wishlist yet. Search a title with “Add a wish”, or add well-known books from a topic page in Discover.</p>
      <div class="row center">
        <a class="btn btn-primary" href="#/add?mode=search&to=wishlist">Add a wish</a>
        <a class="btn" href="#/discover">Discover</a>
      </div>
    </div>
  {:else}
    {#if all.length > 6}
      <form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input type="search" bind:value={q} placeholder="Search your wishlist" aria-label="Search your wishlist" />
      </form>
    {/if}
    <p class="muted small">{plural(all.length, 'book')} you’d like to have. They’re not part of your library until you tap “Bought it”.</p>
    <ul class="list">
      {#each wishes as b (b.id)}
        <li class="card item">
          <a href="#/book/{b.id}" class="cover"><Cover book={b} size="sm" /></a>
          <a href="#/book/{b.id}" class="text">
            <strong>{displayTitle(b)}</strong>
            <span class="muted small">{b.authors.join(', ')}{b.firstPublishedYear ? ` · ${b.firstPublishedYear}` : ''}</span>
            <span class="muted small">Added {formatDate(b.createdAt.slice(0, 10), df)}</span>
          </a>
          <div class="actions">
            <button class="btn-sm btn-primary" onclick={() => startBuy(b)}>🛍️ Bought it</button>
            <button class="btn-sm" onclick={() => remove(b)} aria-label="Remove “{b.title}” from your wishlist"><Icon name="trash" size={16} /> Remove</button>
          </div>
        </li>
      {:else}
        <li class="muted">Nothing matches “{q}”.</li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog bind:open={buyOpen} title="Where does “{buying?.title ?? ''}” go?">
  <LocationPicker bind:value={target} locations={$lib.locations} />
  {#snippet actions()}
    <button onclick={() => (buyOpen = false)}>Cancel</button>
    <button class="btn-primary" onclick={buy}>Put it here</button>
  {/snippet}
</Dialog>

<style>
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .item { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; align-items: center; }
  .text { display: grid; gap: 2px; text-decoration: none; color: inherit; min-width: 0; }
  .text strong { overflow-wrap: anywhere; }
  .actions { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
  .center { justify-content: center; }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  p { margin: 0; }
</style>

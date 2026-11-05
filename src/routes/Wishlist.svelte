<script lang="ts">
  import { displayTitle, todayIso } from '../lib/domain/book';
  import { matchesText } from '../lib/domain/query';
  import { sortWishes, wishlistText } from '../lib/domain/wishlist';
  import type { Book, Id } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { attempt, library, toast } from '../lib/stores/app';
  import { wishlistImage } from '../lib/ui/wishlistImage';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  /** Books you'd like to have: kept apart from the library (no room, not in counts, stats or the wall). */
  const lib = library();
  let q = $state('');
  const all = $derived($lib && lib.wishlist());
  const wishes = $derived(sortWishes(all.filter((b) => !q.trim() || matchesText(b, q))));
  const df = $derived($lib.settings.dateFormat);

  async function remove(b: Book) {
    await attempt(() => lib.deleteBooks([b.id]), `Removed “${b.title}” from your wishlist`, { undo: true });
  }

  function star(b: Book) {
    attempt(() => lib.updateBook(b.id, { mustHave: !b.mustHave }));
  }

  // ---- a note per wish (e.g. "the green Suhrkamp edition")
  let noteFor = $state<Book>();
  let noteOpen = $state(false);
  let noteText = $state('');
  function editNote(b: Book) {
    noteFor = b;
    noteText = b.notes ?? '';
    noteOpen = true;
  }
  async function saveNote() {
    const b = noteFor;
    noteOpen = false;
    if (b) await attempt(() => lib.updateBook(b.id, { notes: noteText.trim() || undefined }));
  }

  // ---- share the list with family: as text (messages, email) or as a picture
  let shareOpen = $state(false);
  let sharing = $state(false);
  const heading = $derived($lib.settings.userName ? `${$lib.settings.userName}’s wishlist` : 'My wishlist');
  async function shareText() {
    const text = wishlistText(all, heading);
    shareOpen = false;
    try {
      if (navigator.share) await navigator.share({ title: heading, text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Wishlist copied: paste it into a message');
      }
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('Couldn’t share the list');
    }
  }
  async function shareImage() {
    sharing = true;
    try {
      const blob = await wishlistImage(all, heading);
      const file = new File([blob], 'wishlist.png', { type: 'image/png' });
      shareOpen = false;
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: heading });
      else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'wishlist.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') toast('Couldn’t make the picture');
    } finally {
      sharing = false;
    }
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
    <div class="row">
      {#if all.length}<button class="btn-sm" onclick={() => (shareOpen = true)}>📤 Share</button>{/if}
      <a class="btn btn-sm btn-primary" href="#/add?mode=search&to=wishlist"><Icon name="search" size={18} /> Add a wish</a>
    </div>
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
            {#if b.notes?.trim()}<span class="note small">{b.notes}</span>{/if}
            <span class="muted small">Added {formatDate(b.createdAt.slice(0, 10), df)}</span>
          </a>
          <div class="actions">
            <button class="btn-sm star" class:on={b.mustHave} aria-pressed={!!b.mustHave} onclick={() => star(b)}
              title={b.mustHave ? 'Most wanted (tap to undo)' : 'Mark as most wanted'}>{b.mustHave ? '★' : '☆'}</button>
            <button class="btn-sm" onclick={() => editNote(b)}>✎ Note</button>
            <span class="grow"></span>
            <button class="btn-sm btn-primary" onclick={() => startBuy(b)}>🛍️ Bought it</button>
            <button class="btn-sm btn-icon" onclick={() => remove(b)} aria-label="Remove “{b.title}” from your wishlist" title="Remove from wishlist"><Icon name="trash" size={16} /></button>
          </div>
        </li>
      {:else}
        <li class="muted">Nothing matches “{q}”.</li>
      {/each}
    </ul>
  {/if}
</div>

<Dialog bind:open={noteOpen} title="Note for “{noteFor?.title ?? ''}”">
  <label class="field">Note <span class="hint">e.g. which edition, where you saw it</span>
    <textarea rows="3" bind:value={noteText}></textarea>
  </label>
  {#snippet actions()}
    <button onclick={() => (noteOpen = false)}>Cancel</button>
    <button class="btn-primary" onclick={saveNote}>Save</button>
  {/snippet}
</Dialog>

<Dialog bind:open={shareOpen} title="Share your wishlist">
  <p class="muted small">For family and friends: ★ marks the most wanted, notes come along.</p>
  <div class="stack">
    <button onclick={shareText}>💬 As text (for a message)</button>
    <button onclick={shareImage} disabled={sharing}>{sharing ? 'Making the picture…' : '🖼️ As a picture with covers'}</button>
  </div>
</Dialog>

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
  .actions .grow { flex: 1; }
  .star { font-size: 1.1rem; min-width: 44px; }
  .star.on { color: var(--warn); border-color: var(--warn); }
  .note { color: var(--text); font-style: italic; overflow-wrap: anywhere; }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  p { margin: 0; }
</style>

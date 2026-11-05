<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { displayTitle } from '../lib/domain/book';
  import { matchesText, sortBooks } from '../lib/domain/query';
  import type { Book, Id } from '../lib/domain/types';
  import { navigate } from '../lib/router';
  import { attempt, coverFromLink, library, photoCover, toast } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import { clearShared, forgetCoverSearch, pendingCoverSearch, takeShared, type Shared } from '../lib/ui/sharedCover';

  /** An image shared to Booked from another app: choose the book it's the cover of. */
  const lib = library();
  let shared = $state<Shared>();
  let preview = $state<string>();
  let loading = $state(true);
  let busy = $state(false);
  let q = $state('');
  // svelte-ignore state_referenced_locally
  let chosen = $state<Id | undefined>(pendingCoverSearch());

  onMount(async () => {
    try {
      shared = await takeShared();
      if (shared.image) preview = URL.createObjectURL(shared.image);
      else if (shared.link) preview = shared.link;
    } finally {
      loading = false;
    }
  });
  onDestroy(() => {
    if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview);
  });

  const chosenBook = $derived(chosen ? $lib && lib.book(chosen) : undefined);
  const candidates = $derived.by(() => {
    const text = q.trim();
    const books = text ? $lib.books.filter((b) => matchesText(b, text)) : sortBooks($lib.books, 'added', 'desc');
    return books.slice(0, 30);
  });

  async function use(b: Book) {
    if (!shared?.image && !shared?.link) return;
    busy = true;
    try {
      const cover = shared.image ? await photoCover(shared.image) : await coverFromLink(shared.link!);
      const done = await attempt(() => lib.updateBook(b.id, { cover }), `New cover for “${b.title}”`, { undo: true });
      if (done) {
        forgetCoverSearch();
        await clearShared();
        navigate(`/book/${b.id}`, {}, true);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<div class="page stack">
  <h1>Shared image</h1>
  {#if loading}
    <p class="muted">Opening…</p>
  {:else if !preview}
    <div class="card empty">
      <span class="big">🖼️</span>
      <p>No image arrived. In Google Images, long-press the picture and choose <strong>Share image</strong> (not the page link), then Booked.</p>
      <a class="btn" href="#/">Home</a>
    </div>
  {:else}
    <div class="shared">
      <img src={preview} alt="Shared" />
      {#if !shared?.image}<p class="muted small">Only a link arrived; Booked tries to load the image from it.</p>{/if}
    </div>

    {#if chosenBook}
      <div class="card target">
        <Cover book={chosenBook} size="sm" />
        <div class="text"><span class="muted small">Cover for</span><strong>{displayTitle(chosenBook)}</strong></div>
        <button class="btn-primary" disabled={busy} onclick={() => use(chosenBook)}>{busy ? 'Saving…' : 'Use as cover'}</button>
      </div>
      <button class="btn-ghost" onclick={() => (chosen = undefined)}>Another book…</button>
    {:else}
      <h2>Which book is it the cover of?</h2>
      <form class="search" role="search" onsubmit={(e) => e.preventDefault()}>
        <Icon name="search" />
        <input type="search" bind:value={q} placeholder="Title, author, ISBN" aria-label="Find the book" />
      </form>
      <ul class="list">
        {#each candidates as b (b.id)}
          <li>
            <button class="pick" disabled={busy} onclick={() => use(b)}>
              <Cover book={b} size="sm" />
              <span class="text"><strong>{displayTitle(b)}</strong><span class="muted small">{b.authors.join(', ')}</span></span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .shared { display: grid; justify-items: center; gap: 6px; }
  .shared img { max-width: min(260px, 70vw); max-height: 40dvh; border-radius: 8px; box-shadow: var(--shadow); }
  .target { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; align-items: center; }
  .text { display: grid; gap: 2px; min-width: 0; }
  .text strong { overflow-wrap: anywhere; }
  .list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .pick { width: 100%; display: flex; gap: 12px; align-items: center; justify-content: flex-start; text-align: left; white-space: normal; padding: 8px 12px; }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  p, h2 { margin: 0; }
</style>

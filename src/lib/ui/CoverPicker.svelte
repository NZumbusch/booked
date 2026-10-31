<script lang="ts">
  import type { Book } from '../domain/types';
  import { fileToCoverDataUrl } from '../images';
  import { alternativeCovers, type CoverOption } from '../metadata/covers';
  import { attempt, library, toast } from '../stores/app';
  import CoverStack from './CoverStack.svelte';
  import Dialog from './Dialog.svelte';

  /** Pick a different cover: other editions of the same book, or your own photo. */
  let { book, open = $bindable(false) }: { book: Book; open?: boolean } = $props();

  const lib = library();
  let options = $state<CoverOption[]>([]);
  let loading = $state(false);
  let error = $state('');
  let broken = $state(new Set<string>());
  let loadedFor = '';

  $effect(() => {
    if (open && loadedFor !== book.id) load();
  });

  async function load() {
    loadedFor = book.id;
    loading = true;
    error = '';
    try {
      options = await alternativeCovers(book, fetch.bind(globalThis), lib.state.settings.googleBooksKey);
    } catch {
      error = navigator.onLine ? 'Couldn’t reach the catalogues. Try again in a moment.' : 'You’re offline. Covers can be searched once you’re online.';
      loadedFor = '';
    } finally {
      loading = false;
    }
  }

  const visible = $derived(options.filter((o) => !broken.has(o.thumb)));

  async function use(cover: string, message = 'Cover changed') {
    open = false;
    await attempt(() => lib.updateBook(book.id, { cover }), message, { undo: true });
  }

  async function upload(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      await use(await fileToCoverDataUrl(file, 900), 'Your photo is now the cover');
    } catch {
      toast('That image couldn’t be read');
    }
  }
</script>

<Dialog bind:open title="Choose a cover">
  <label class="btn upload">
    📷 Use my own photo
    <input type="file" accept="image/*" onchange={upload} />
  </label>
  <p class="muted small">Tip: photograph the cover straight on and fill the frame.</p>

  {#if loading}
    <p class="muted">Looking for other editions…</p>
  {:else if error}
    <p class="muted">{error} <button class="btn-sm" onclick={load}>Retry</button></p>
  {:else if !visible.length}
    <p class="muted">No other covers found for this book.</p>
  {:else}
    <p class="muted small">{visible.length} covers from other editions, yours first. Tap one to pull it out.</p>
    <CoverStack options={visible} onchoose={(o) => use(o.url)} onbroken={(o) => (broken = new Set([...broken, o.thumb]))} />
  {/if}
</Dialog>

<style>
  .upload { position: relative; overflow: hidden; justify-self: start; }
  .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  p { margin: 0; }
</style>

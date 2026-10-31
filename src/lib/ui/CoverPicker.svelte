<script lang="ts">
  import { booksKeyOf, helperUrlOf } from '../config';
  import { lookDistance, sampleColors } from '../covers/cache';
  import type { CoverAnalysis } from '../covers/colors';
  import { dnbByIsbn } from '../metadata/dnb';
  import { fold } from '../domain/query';
  import type { Book } from '../domain/types';
  import { fileToCoverDataUrl } from '../images';
  import { alternativeCovers, type CoverOption } from '../metadata/covers';
  import { attempt, covers, library, toast } from '../stores/app';
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
      await fillSeries();
      options = await alternativeCovers(book, fetch.bind(globalThis), booksKeyOf(lib.state.settings));
      if (siblings.length) analyse(options);
    } catch {
      error = navigator.onLine ? 'Couldn’t reach the catalogues. Try again in a moment.' : 'You’re offline. Covers can be searched once you’re online.';
      loadedFor = '';
    } finally {
      loading = false;
    }
  }

  // ---- series: volumes of one series usually look alike (e.g. the dark blue stw covers)
  const cache = covers();
  const sameSeries = (b: Book) => !!book.series && !!b.series && fold(b.series) === fold(book.series);
  /** Covers of the other books in this series that are saved on this device. */
  const siblings = $derived(
    $lib.books.filter((b) => b.id !== book.id && sameSeries(b) && b.cover && cache.meta(b.cover)?.analysis).map((b) => cache.meta(b.cover)!.analysis!)
  );
  let matchSeries = $state(true);
  let looks = $state(new Map<string, CoverAnalysis>());

  /** Older books may lack their series: ask the German National Library once. */
  async function fillSeries() {
    if (book.series || !(book.isbn13 || book.isbn10)) return;
    try {
      const r = await dnbByIsbn((book.isbn13 ?? book.isbn10)!, fetch.bind(globalThis));
      const { series, seriesNumber } = r?.fields ?? {};
      if (series) await lib.enrichBook(book.id, { series, seriesNumber });
    } catch {
      // not essential
    }
  }

  /** Colours of the candidate covers (a few at a time), so similar-looking ones can be listed first. */
  async function analyse(list: CoverOption[]) {
    const proxy = helperUrlOf(lib.state.settings);
    const todo = list.slice(0, 80).filter((o) => !looks.has(o.thumb));
    let i = 0;
    const worker = async () => {
      while (i < todo.length) {
        const o = todo[i++];
        try {
          const a = await sampleColors(o.thumb, proxy);
          looks = new Map(looks).set(o.thumb, a);
        } catch {
          // no colours for this one: it stays where it is
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  const distance = (o: CoverOption) => {
    const a = looks.get(o.thumb);
    return a && siblings.length ? Math.min(...siblings.map((s) => lookDistance(a, s))) : Infinity;
  };
  const rank = (o: CoverOption) => (o.sameEdition ? -1 : distance(o));
  const visible = $derived.by(() => {
    const ok = options.filter((o) => !broken.has(o.thumb));
    if (!matchSeries || !siblings.length) return ok;
    // Looks-alike first; the same edition (by ISBN) still wins over a mere look-alike.
    return ok.map((o, i) => ({ o, i })).sort((x, y) => rank(x.o) - rank(y.o) || x.i - y.i).map(({ o }) => o);
  });

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
    {#if siblings.length}
      <label class="check"><input type="checkbox" bind:checked={matchSeries} /> Look-alikes of “{book.series}” first</label>
    {/if}
    <CoverStack options={visible} onchoose={(o) => use(o.url)} onbroken={(o) => (broken = new Set([...broken, o.thumb]))} />
  {/if}
</Dialog>

<style>
  .upload { position: relative; overflow: hidden; justify-self: start; }
  .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  p { margin: 0; }
</style>

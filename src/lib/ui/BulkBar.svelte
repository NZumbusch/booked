<script lang="ts">
  import { borrowers, cleanList, lendingFrom, todayIso } from '../domain/book';
  import { statusPatch } from '../domain/reading';
  import { facet } from '../domain/filters';
  import { fold } from '../domain/query';
  import type { Id, ReadingStatus } from '../domain/types';
  import { STATUS_LABEL, plural } from '../format';
  import { sampleImage } from '../covers/cache';
  import { helperUrlOf } from '../config';
  import { matchingCover } from '../services/seriesCovers';
  import { attempt, coverContext, covers, library, toast } from '../stores/app';
  import Confirm from './Confirm.svelte';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';
  import LocationPicker from './LocationPicker.svelte';

  let { ids, ondone }: {
    ids: Id[];
    /** Called after destructive actions that invalidate the selection (delete). */
    ondone: () => void;
  } = $props();

  const lib = library();

  // Lift toasts above this bar while it's visible.
  $effect(() => {
    document.documentElement.style.setProperty('--toast-offset', '72px');
    return () => document.documentElement.style.removeProperty('--toast-offset');
  });

  type Panel = 'move' | 'tags' | 'collections' | 'status' | 'lend' | 'series' | 'more' | undefined;
  let panel = $state<Panel>();
  let open = $state(false);
  let deleteOpen = $state(false);

  let moveTo = $state<Id | null>(null);
  let term = $state('');
  let status = $state<ReadingStatus>('read');
  let lendTo = $state('');
  let lendDue = $state('');

  // ---- series & volumes
  let seriesName = $state('');
  let numberThem = $state(true);
  let startAt = $state(1);
  let refId = $state<Id>();
  let matching = $state<{ done: number; total: number }>();
  const withCover = $derived(ids.map((id) => lib.book(id)).filter((b): b is NonNullable<typeof b> => !!b?.cover));
  const knownSeries = $derived(facet($lib.books, (b) => (b.series ? [b.series] : [])));

  function openSeries() {
    const names = [...new Set(ids.map((id) => lib.book(id)?.series).filter(Boolean))] as string[];
    seriesName = names.length === 1 ? names[0] : '';
    refId = withCover[0]?.id;
    matching = undefined;
    show('series');
  }

  function applySeries() {
    const name = seriesName.trim();
    const order = new Map(ids.map((id, i) => [id, i]));
    run(() => lib.bulkUpdate(ids, (b) => ({ series: name, ...(numberThem ? { seriesNumber: String(startAt + order.get(b.id)!) } : {}) }),
      `Series “${name}” for ${what}`), (c) => `Series “${name}” set for ${plural(c, 'book')}`);
  }

  function sameCover() {
    const cover = refId ? lib.book(refId)?.cover : undefined;
    if (!cover) return;
    run(() => lib.bulkUpdate(ids, (b) => (b.cover === cover ? undefined : { cover }), `Same cover for ${what}`), (c) => `Cover set on ${plural(c, 'book')}`);
  }

  /** For each other book, the cover that looks most like the chosen model (same colours and brightness). */
  async function matchCovers() {
    const ref = refId ? lib.book(refId) : undefined;
    if (!ref?.cover) return;
    const proxy = helperUrlOf(lib.state.settings);
    let model = covers().meta(ref.cover)?.analysis;
    try {
      model ??= (await sampleImage(ref.cover, proxy)).analysis;
    } catch {
      return toast('That cover can’t be read right now. Try again with a connection.');
    }
    const others = ids.filter((id) => id !== ref.id).map((id) => lib.book(id)!).filter(Boolean);
    const ctx = { ...coverContext(), siblings: () => [model!] };
    const found = new Map<Id, string>();
    matching = { done: 0, total: others.length };
    for (const b of others) {
      try {
        const url = await matchingCover(b, [model], ctx);
        if (url) found.set(b.id, url);
      } catch {
        // skip this one
      }
      matching = { done: matching.done + 1, total: others.length };
    }
    matching = undefined;
    if (!found.size) return toast('No cover that looks like the model was found.');
    open = false;
    const changed = await attempt(() => lib.bulkUpdate(ids, (b) => (found.has(b.id) ? { cover: found.get(b.id) } : undefined), `Matching covers for ${found.size} books`));
    if (changed !== undefined) toast(`Matching covers for ${found.size} of ${others.length} books`, { undo: true });
  }

  const n = $derived(ids.length);
  const what = $derived(plural(n, 'book'));

  function show(p: Panel) {
    panel = p;
    term = '';
    open = true;
  }

  async function run(fn: () => Promise<number>, message: (changed: number) => string) {
    open = false;
    const changed = await attempt(fn);
    if (changed !== undefined) toast(message(changed), { undo: changed > 0 });
  }

  const suggestions = $derived(panel === 'tags' || panel === 'collections' ? facet($lib.books, (b) => b[panel as 'tags' | 'collections']) : []);
  const has = (kind: 'tags' | 'collections', name: string) => (id: Id) => lib.book(id)?.[kind].some((v) => fold(v) === fold(name));

  function addTerm(kind: 'tags' | 'collections', name: string) {
    const label = kind === 'tags' ? `#${name}` : `“${name}”`;
    run(() => lib.bulkUpdate(ids, (b) => ({ [kind]: cleanList([...b[kind], name]) }), `Added ${label} to ${what}`),
      (c) => `Added ${label} to ${plural(c, 'book')}`);
  }
  function removeTerm(kind: 'tags' | 'collections', name: string) {
    const label = kind === 'tags' ? `#${name}` : `“${name}”`;
    run(() => lib.bulkUpdate(ids, (b) => ({ [kind]: b[kind].filter((v) => fold(v) !== fold(name)) }), `Removed ${label} from ${what}`),
      (c) => `Removed ${label} from ${plural(c, 'book')}`);
  }
</script>

<div class="bar" role="toolbar" aria-label="Actions for selected books">
  <button class="act" onclick={() => { moveTo = null; show('move'); }} disabled={!n}><Icon name="move" /><span>Move</span></button>
  <button class="act" onclick={() => show('tags')} disabled={!n}><span class="glyph">#</span><span>Tags</span></button>
  <button class="act" onclick={() => show('collections')} disabled={!n}><span class="glyph">▣</span><span>Collection</span></button>
  <button class="act" onclick={() => show('status')} disabled={!n}><Icon name="books" /><span>Status</span></button>
  <button class="act" onclick={() => show('more')} disabled={!n}><span class="glyph">⋯</span><span>More</span></button>
</div>

<Dialog bind:open title={
  panel === 'move' ? `Move ${what}` : panel === 'tags' ? `Tags for ${what}` : panel === 'collections' ? `Collection for ${what}`
  : panel === 'status' ? `Status of ${what}` : panel === 'lend' ? `Lend ${what}` : panel === 'series' ? `Series for ${what}` : `${what} selected`}>
  {#if panel === 'move'}
    <LocationPicker bind:value={moveTo} locations={$lib.locations} />
    <button class="btn-primary" onclick={() => run(() => lib.moveBooks(ids, moveTo), (c) => `Moved ${plural(c, 'book')} to ${lib.label(moveTo)}`)}>
      Move here
    </button>
  {:else if panel === 'tags' || panel === 'collections'}
    {@const kind = panel}
    <form class="row add" onsubmit={(e) => { e.preventDefault(); if (term.trim()) addTerm(kind, term.trim()); }}>
      <input bind:value={term} list="bulk-terms" placeholder={kind === 'tags' ? 'Tag name' : 'Collection name'} aria-label="Name" />
      <datalist id="bulk-terms">{#each suggestions as s (s.value)}<option value={s.value}></option>{/each}</datalist>
      <button class="btn-primary" type="submit" disabled={!term.trim()}>Add</button>
    </form>
    {#if suggestions.length}
      <p class="muted small">Tap to add, ✕ to remove from the selected books:</p>
      <div class="row">
        {#each suggestions as s (s.value)}
          {@const count = ids.filter(has(kind, s.value)).length}
          <span class="term">
            <button class="btn-sm" onclick={() => addTerm(kind, s.value)}>{kind === 'tags' ? '#' : ''}{s.value}{count ? ` · ${count}` : ''}</button>
            {#if count}<button class="btn-sm btn-ghost" aria-label="Remove {s.value}" onclick={() => removeTerm(kind, s.value)}>✕</button>{/if}
          </span>
        {/each}
      </div>
    {/if}
  {:else if panel === 'status'}
    <div class="grid2">
      {#each Object.entries(STATUS_LABEL) as [v, l]}
        <button onclick={() => { status = v as ReadingStatus; run(() => lib.bulkUpdate(ids, (b) => statusPatch(b, status, todayIso()), `Marked ${what} as ${l}`), (c) => `Marked ${plural(c, 'book')} as ${l.toLowerCase()}`); }}>{l}</button>
      {/each}
    </div>
  {:else if panel === 'lend'}
    <label class="field">Lent to<input bind:value={lendTo} placeholder="Name" list="bulk-borrowers" /></label>
    <datalist id="bulk-borrowers">{#each borrowers($lib.books) as name}<option value={name}></option>{/each}</datalist>
    <label class="field">Due (optional)<input type="date" bind:value={lendDue} /></label>
    <button class="btn-primary" disabled={!lendTo.trim()} onclick={() => run(
      () => lib.bulkUpdate(ids, () => ({ lending: lendingFrom(lendTo, lendDue) }), `Lent ${what} to ${lendTo.trim()}`),
      (c) => `Lent ${plural(c, 'book')} to ${lendTo.trim()}`)}>Mark as lent</button>
  {:else if panel === 'more'}
    <div class="grid2">
      <button onclick={() => { lendTo = ''; lendDue = ''; panel = 'lend'; }}>Lend…</button>
      <button onclick={() => run(() => lib.bulkUpdate(ids, (b) => (b.lending ? { lending: undefined } : undefined), `Returned ${what}`), (c) => `Marked ${plural(c, 'book')} as returned`)}>Mark returned</button>
      <button onclick={() => run(() => lib.bulkUpdate(ids, () => ({ ownership: 'owned' }), `Marked ${what} as owned`), (c) => `${plural(c, 'book')} marked as owned`)}>Mark owned</button>
      <button onclick={() => run(() => lib.bulkUpdate(ids, () => ({ ownership: 'wishlist' }), `Moved ${what} to wishlist`), (c) => `${plural(c, 'book')} moved to wishlist`)}>Move to wishlist</button>
      <button onclick={openSeries}>Series &amp; volumes…</button>
      <button class="btn-danger" onclick={() => { open = false; deleteOpen = true; }}><Icon name="trash" size={18} /> Delete</button>
    </div>
  {:else if panel === 'series'}
    <label class="field">Series
      <input bind:value={seriesName} list="bulk-series" placeholder="e.g. Goethe, Gesamtausgabe" />
    </label>
    <datalist id="bulk-series">{#each knownSeries as s (s.value)}<option value={s.value}></option>{/each}</datalist>
    <label class="check"><input type="checkbox" bind:checked={numberThem} /> Number the volumes in the order shown, starting at
      <input class="start" type="number" min="0" bind:value={startAt} aria-label="First volume number" /></label>
    {#if numberThem}<p class="muted small">Tip: sort the list so the volumes are in order before selecting (e.g. by year or title).</p>{/if}
    <button class="btn-primary" disabled={!seriesName.trim()} onclick={applySeries}>Set series</button>

    <hr />
    <strong>Covers that belong together</strong>
    {#if withCover.length}
      <label class="field">Model cover (the one that’s right)
        <select bind:value={refId}>
          {#each withCover as b (b.id)}<option value={b.id}>{b.title}{b.volume ? ` · Vol. ${b.volume}` : b.seriesNumber ? ` · ${b.seriesNumber}` : ''}</option>{/each}
        </select>
      </label>
      {#if matching}
        <p class="small">Searching {matching.done + 1} of {matching.total}…</p>
      {:else}
        <button onclick={matchCovers} disabled={n < 2}>Find covers that look like it</button>
        <button onclick={sameCover} disabled={n < 2}>Use this cover for all</button>
        <p class="muted small">“Find covers that look like it” picks, for every other book, the available cover with the most similar colours. Books with no good match keep theirs.</p>
      {/if}
    {:else}
      <p class="muted small">None of the selected books has a cover yet.</p>
    {/if}
  {/if}
</Dialog>

<Confirm bind:open={deleteOpen} title="Delete {what}?" message="The selected books will be removed. You can undo this right after."
  onconfirm={async () => {
    const count = n;
    if (await attempt(() => lib.deleteBooks(ids).then(() => true), `Deleted ${plural(count, 'book')}`, { undo: true })) ondone();
  }} />

<style>
  .start { width: 5em; min-height: 36px; }
  hr { border: none; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
  .bar {
    position: fixed; left: 0; right: 0; bottom: calc(var(--nav-h) + env(safe-area-inset-bottom)); z-index: 45;
    display: grid; grid-template-columns: repeat(5, 1fr); background: var(--accent); color: var(--accent-text);
    padding: 4px; box-shadow: var(--shadow);
  }
  @media (min-width: 900px) { .bar { max-width: 560px; margin: 0 auto; border-radius: 16px; bottom: calc(var(--nav-h) + 20px); } }
  .act { display: grid; justify-items: center; gap: 2px; background: transparent; color: inherit; border: none; min-height: 56px; padding: 0; font-size: 0.75rem; }
  .glyph { font-size: 1.25rem; line-height: 22px; font-weight: 700; }
  .add input { flex: 1; width: auto; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .term { display: inline-flex; align-items: center; }
</style>

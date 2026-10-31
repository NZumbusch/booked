<script lang="ts">
  import { addToFilter, facet, type BookFilter } from '../domain/filters';
  import type { Book, BookFormat, Location, ReadingStatus } from '../domain/types';
  import { FORMAT_LABEL, STATUS_LABEL, languageName } from '../format';
  import Dialog from './Dialog.svelte';
  import LocationPicker from './LocationPicker.svelte';

  let { open = $bindable(false), filter, books, locations, onapply }: {
    open?: boolean;
    filter: BookFilter;
    books: Book[];
    locations: Location[];
    onapply: (f: BookFilter) => void;
  } = $props();

  // Edit a copy; nothing changes until "Show results".
  let f = $state<BookFilter>({});
  $effect(() => {
    if (open) f = structuredClone($state.snapshot(filter));
  });

  const lists = $derived({
    authors: facet(books, (b) => b.authors),
    genres: facet(books, (b) => b.genres),
    tags: facet(books, (b) => b.tags),
    collections: facet(books, (b) => b.collections),
    languages: facet(books, (b) => [b.language])
  });

  type ListKey = 'authors' | 'genres' | 'tags' | 'collections' | 'languages';
  const LIST_LABEL: Record<ListKey, string> = { authors: 'Author', genres: 'Genre', tags: 'Tag', collections: 'Collection', languages: 'Language' };

  function add(key: ListKey, value: string) {
    if (value) f = addToFilter(f, key, value);
  }
  function remove(key: ListKey, value: string) {
    const rest = (f[key] ?? []).filter((v) => v !== value);
    f = { ...f, [key]: rest.length ? rest : undefined };
  }
  function toggle<T extends string>(key: 'status' | 'formats' | 'missing', value: T) {
    const cur = (f[key] as T[] | undefined) ?? [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    f = { ...f, [key]: next.length ? next : undefined };
  }
  const num = (v: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);

  // LocationPicker binds Id | null; the filter also knows 'none'.
  const locValue = $derived(f.loc && f.loc !== 'none' ? f.loc : null);

  function apply() {
    open = false;
    onapply($state.snapshot(f));
  }
</script>

<Dialog bind:open title="Filters">
  <section class="stack">
    <h3>Where</h3>
    <LocationPicker locations={locations} oncreate={null}
      bind:value={() => locValue, (v) => (f = { ...f, loc: v ?? undefined })} />
    <label class="check"><input type="checkbox" checked={f.loc === 'none'}
      onchange={(e) => (f = { ...f, loc: e.currentTarget.checked ? 'none' : undefined })} /> Only books without a location</label>
  </section>

  <section class="stack">
    <h3>Reading status</h3>
    <div class="row">
      {#each Object.entries(STATUS_LABEL) as [v, l]}
        <button type="button" class="chip-btn" class:on={f.status?.includes(v as ReadingStatus)} aria-pressed={!!f.status?.includes(v as ReadingStatus)}
          onclick={() => toggle('status', v as ReadingStatus)}>{l}</button>
      {/each}
    </div>
  </section>

  {#each (['authors', 'genres', 'tags', 'collections', 'languages'] as ListKey[]) as key}
    {#if lists[key].length}
      <section class="stack">
        <label class="field">{LIST_LABEL[key]}
          <select value="" onchange={(e) => { add(key, e.currentTarget.value); e.currentTarget.value = ''; }}>
            <option value="">Add {LIST_LABEL[key].toLowerCase()}…</option>
            {#each lists[key] as item (item.value)}
              <option value={item.value}>{key === 'languages' ? languageName(item.value) : item.value} ({item.count})</option>
            {/each}
          </select>
        </label>
        {#if f[key]?.length}
          <div class="row">
            {#each f[key] ?? [] as v (v)}
              <button type="button" class="chip-btn on" onclick={() => remove(key, v)} aria-label="Remove {v}">{key === 'languages' ? languageName(v) : v} ✕</button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/each}

  <section class="grid">
    <label class="field">Minimum rating
      <select value={String(f.ratingMin ?? '')} onchange={(e) => (f = { ...f, ratingMin: num(e.currentTarget.value) })}>
        <option value="">Any</option>
        {#each [1, 2, 3, 4, 5] as r}<option value={String(r)}>{'★'.repeat(r)}</option>{/each}
      </select>
    </label>
    <label class="field">Year from
      <input inputmode="numeric" value={f.yearFrom ?? ''} onchange={(e) => (f = { ...f, yearFrom: num(e.currentTarget.value) })} />
    </label>
    <label class="field">Year to
      <input inputmode="numeric" value={f.yearTo ?? ''} onchange={(e) => (f = { ...f, yearTo: num(e.currentTarget.value) })} />
    </label>
  </section>

  <section class="stack">
    <h3>Format</h3>
    <div class="row">
      {#each Object.entries(FORMAT_LABEL) as [v, l]}
        <button type="button" class="chip-btn" class:on={f.formats?.includes(v as BookFormat)} aria-pressed={!!f.formats?.includes(v as BookFormat)}
          onclick={() => toggle('formats', v as BookFormat)}>{l}</button>
      {/each}
    </div>
  </section>

  <section class="grid">
    <label class="field">Owned / wishlist
      <select value={f.ownership ?? ''} onchange={(e) => (f = { ...f, ownership: (e.currentTarget.value || undefined) as BookFilter['ownership'] })}>
        <option value="">Both</option><option value="owned">Owned</option><option value="wishlist">Wishlist</option>
      </select>
    </label>
    <label class="field">Lending
      <select value={f.lending ?? ''} onchange={(e) => (f = { ...f, lending: (e.currentTarget.value || undefined) as BookFilter['lending'] })}>
        <option value="">Any</option><option value="lent">Lent out</option><option value="overdue">Overdue</option>
      </select>
    </label>
  </section>

  <section class="stack">
    <h3>Needs attention</h3>
    <label class="check"><input type="checkbox" checked={!!f.missing?.includes('cover')} onchange={() => toggle('missing', 'cover')} /> Missing cover</label>
    <label class="check"><input type="checkbox" checked={!!f.missing?.includes('metadata')} onchange={() => toggle('missing', 'metadata')} /> Missing details (author, year or ISBN)</label>
  </section>

  {#snippet actions()}
    <button onclick={() => (f = { q: f.q })}>Clear all</button>
    <button class="btn-primary" onclick={apply}>Show results</button>
  {/snippet}
</Dialog>

<style>
  section { display: grid; gap: 8px; }
  h3 { margin: 4px 0 0; font-size: 0.9rem; color: var(--muted); font-weight: 600; }
  .grid { grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 10px; }
  .chip-btn { min-height: 38px; padding: 0 14px; font-size: 0.9rem; }
  .chip-btn.on { background: var(--accent); color: var(--accent-text); border-color: transparent; }
</style>

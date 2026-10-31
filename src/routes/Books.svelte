<script lang="ts">
  import { untrack } from 'svelte';
  import { displayTitle, isOverdue, todayIso } from '../lib/domain/book';
  import {
    applyFilter, filterChips, filterFromQuery, filterToQuery, GROUP_LABELS, groupBooks, isEmptyFilter, removeChip,
    type BookFilter, type Chip, type GroupBy
  } from '../lib/domain/filters';
  import { sortBooks, SORT_LABELS, type SortDir, type SortKey } from '../lib/domain/query';
  import type { Book, Id } from '../lib/domain/types';
  import { STATUS_LABEL, plural } from '../lib/format';
  import { navigate, route } from '../lib/router';
  import { attempt, library } from '../lib/stores/app';
  import BulkBar from '../lib/ui/BulkBar.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import FilterSheet from '../lib/ui/FilterSheet.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import { longpress } from '../lib/ui/longpress';
  import Rating from '../lib/ui/Rating.svelte';

  const PAGE = 120;
  const lib = library();

  // ---- URL state: filter + sort + view + group, so back/forward and saved filters just work
  const query = $derived($route.query);
  const filter = $derived(filterFromQuery(query));
  const sort = $derived((query.sort as SortKey) in SORT_LABELS ? (query.sort as SortKey) : 'title');
  const dir = $derived<SortDir>(query.dir === 'desc' ? 'desc' : 'asc');
  const group = $derived<GroupBy>((query.group as GroupBy) in GROUP_LABELS ? (query.group as GroupBy) : 'none');
  const view = $derived(query.view === 'list' || query.view === 'grid' ? query.view : $lib.settings.view);

  function setQuery(patch: Record<string, string | undefined>) {
    navigate('/books', { ...query, ...patch }, true);
  }
  function setFilter(f: BookFilter) {
    const keep = { sort: query.sort, dir: query.dir, group: query.group, view: query.view };
    navigate('/books', { ...keep, ...filterToQuery(f) }, true);
  }

  // svelte-ignore state_referenced_locally
  let q = $state(query.q ?? '');
  // The URL can change the search too (saved filters, back/forward): keep the box in step.
  // svelte-ignore state_referenced_locally
  let lastUrlQ = query.q ?? '';
  $effect(() => {
    const urlQ = query.q ?? '';
    if (urlQ === lastUrlQ) return;
    lastUrlQ = urlQ;
    // Only take over external changes; the box's own (trimmed) writes must not rewrite what's being typed.
    if (urlQ !== untrack(() => q).trim()) q = urlQ;
  });
  $effect(() => {
    const text = q.trim();
    const t = setTimeout(() => {
      if ((filter.q ?? '') === text) return;
      lastUrlQ = text;
      setFilter({ ...filter, q: text || undefined });
    }, 200);
    return () => clearTimeout(t);
  });

  // ---- results
  const results = $derived(sortBooks(applyFilter($lib.books, filter, { locations: $lib.locations, today: todayIso() }), sort, dir, (id) => lib.label(id)));
  const groups = $derived(groupBooks(results, group, $lib.locations));
  const chips = $derived(filterChips(filter, $lib.locations));
  const filterCount = $derived(chips.filter((c) => c.key !== 'q').length);

  // Incremental rendering: only the first `shown` books are in the DOM; more load while scrolling.
  let shown = $state(PAGE);
  let sentinel: HTMLElement | undefined = $state();
  $effect(() => {
    void results;
    shown = PAGE;
  });
  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((entries) => { if (entries[0].isIntersecting) shown += PAGE; }, { rootMargin: '1200px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });
  /** Groups trimmed to the render budget. */
  const visibleGroups = $derived.by(() => {
    let budget = shown;
    const out: { key: string; label: string; total: number; books: Book[] }[] = [];
    for (const g of groups) {
      if (budget <= 0) break;
      out.push({ key: g.key, label: g.label, total: g.books.length, books: g.books.slice(0, budget) });
      budget -= g.books.length;
    }
    return out;
  });

  // ---- selection
  let selecting = $state(false);
  let selected = $state<Set<Id>>(new Set());
  // In the order shown (so "number the volumes" follows the list), then anything selected but filtered out.
  const selectedIds = $derived.by(() => {
    const shown = results.filter((b) => selected.has(b.id)).map((b) => b.id);
    return [...shown, ...[...selected].filter((id) => lib.book(id) && !shown.includes(id))];
  });

  function toggle(id: Id) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }
  function startSelect(id?: Id) {
    selecting = true;
    if (id && !selected.has(id)) toggle(id);
  }
  function stopSelect() {
    selecting = false;
    selected = new Set();
  }
  const allSelected = $derived(results.length > 0 && results.every((b) => selected.has(b.id)));
  function selectAll() {
    selected = allSelected ? new Set() : new Set(results.map((b) => b.id));
  }
  function open(book: Book, e: Event) {
    if (selecting) {
      e.preventDefault();
      toggle(book.id);
    }
  }

  // ---- saved filters
  let saveOpen = $state(false);
  let saveName = $state('');
  const saved = $derived($lib.settings.savedFilters ?? []);
  async function save() {
    saveOpen = false;
    await attempt(() => lib.saveFilter(saveName, filterToQuery(filter)), `Saved “${saveName.trim() || 'My filter'}”`);
  }

  let filtersOpen = $state(false);
  const today = todayIso();

  function sortBy(key: SortKey) {
    setQuery({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' });
  }
  function dropChip(c: Chip) {
    if (c.key === 'q') q = '';
    setFilter(removeChip(filter, c));
  }
</script>

<div class="page stack" class:selecting>
  <header class="spread">
    {#if selecting}
      <h1>{plural(selectedIds.length, 'book')} selected</h1>
      <button class="btn-sm" onclick={stopSelect}>Done</button>
    {:else}
      <h1>Library</h1>
      <div class="row">
        <a class="btn btn-sm" href="#/tags">Tags</a>
        <button class="btn-sm" onclick={() => startSelect()}>Select</button>
        <a class="btn btn-sm" href="#/add"><Icon name="plus" size={18} /> Add</a>
      </div>
    {/if}
  </header>

  <div class="search">
    <Icon name="search" />
    <input type="search" bind:value={q} placeholder="Search title, author, ISBN, tag, notes…" aria-label="Search" />
  </div>

  <div class="toolbar">
    <button class="btn-sm" class:active={filterCount > 0} onclick={() => (filtersOpen = true)}>
      Filters{filterCount ? ` · ${filterCount}` : ''}
    </button>
    <label>
      <span class="sr-only">Sort by</span>
      <select class="pill" value={sort} onchange={(e) => setQuery({ sort: e.currentTarget.value })}>
        {#each Object.entries(SORT_LABELS) as [k, l]}<option value={k}>{l}</option>{/each}
      </select>
    </label>
    <button class="btn-icon" aria-label="Sort direction: {dir === 'asc' ? 'ascending' : 'descending'}"
      onclick={() => setQuery({ dir: dir === 'asc' ? 'desc' : 'asc' })}>
      <span class:flip={dir === 'desc'}><Icon name="sort" /></span>
    </button>
    <label>
      <span class="sr-only">Group by</span>
      <select class="pill" value={group} onchange={(e) => setQuery({ group: e.currentTarget.value === 'none' ? undefined : e.currentTarget.value })}>
        {#each Object.entries(GROUP_LABELS) as [k, l]}<option value={k}>{k === 'none' ? 'No groups' : `By ${l.toLowerCase()}`}</option>{/each}
      </select>
    </label>
    <div class="seg" role="group" aria-label="View">
      <button class="btn-icon" class:on={view === 'grid'} aria-pressed={view === 'grid'} aria-label="Grid view"
        onclick={() => { setQuery({ view: 'grid' }); lib.updateSettings({ view: 'grid' }); }}><Icon name="grid" /></button>
      <button class="btn-icon" class:on={view === 'list'} aria-pressed={view === 'list'} aria-label="List view"
        onclick={() => { setQuery({ view: 'list' }); lib.updateSettings({ view: 'list' }); }}><Icon name="list" /></button>
      <a class="btn btn-icon wall-link" href="#/wall?{new URLSearchParams(filterToQuery(filter))}" aria-label="Cover wall" title="Cover wall">▦</a>
    </div>
  </div>

  {#if chips.length}
    <div class="chips">
      {#each chips as c (c.key + (c.value ?? ''))}
        <span class="chip">{c.label}<button class="x btn-ghost" aria-label="Remove filter {c.label}" onclick={() => dropChip(c)}><Icon name="close" size={14} /></button></span>
      {/each}
      {#if filterCount}
        <button class="btn-sm btn-ghost" onclick={() => { saveName = ''; saveOpen = true; }}>Save filter</button>
        <button class="btn-sm btn-ghost" onclick={() => { q = ''; setFilter({}); }}>Clear</button>
      {/if}
    </div>
  {:else if saved.length}
    <div class="chips">
      <span class="muted small">Saved:</span>
      {#each saved as s (s.id)}
        <span class="chip">
          <a href="#/books?{new URLSearchParams(s.query)}">{s.name}</a>
          <button class="x btn-ghost" aria-label="Delete saved filter {s.name}" onclick={() => lib.deleteSavedFilter(s.id)}><Icon name="close" size={14} /></button>
        </span>
      {/each}
    </div>
  {/if}

  <div class="spread">
    <span class="muted small">{plural(results.length, 'book')}{results.length !== $lib.books.length ? ` of ${$lib.books.length.toLocaleString()}` : ''}</span>
    {#if selecting}
      <button class="btn-sm" onclick={selectAll}>{allSelected ? 'Select none' : `Select all ${results.length.toLocaleString()}`}</button>
    {/if}
  </div>

  {#if $lib.books.length === 0}
    <div class="card empty">
      <span class="big">📚</span>
      <p>Your library is empty. Scan a barcode or add your first book by hand.</p>
      <a class="btn btn-primary" href="#/add?mode=scan">Scan a book</a>
    </div>
  {:else if results.length === 0}
    <div class="card empty">
      <span class="big">🔍</span>
      <p>No books match. Try a different search or remove a filter.</p>
      <button onclick={() => { q = ''; setFilter({}); }}>Clear all filters</button>
    </div>
  {:else}
    {#each visibleGroups as g (g.key)}
      {#if g.label}<h2 class="group">{g.label} <span class="muted small">{g.total}</span></h2>{/if}
      {#if view === 'grid'}
        <div class="grid">
          {#each g.books as book (book.id)}
            <a class="tile" class:sel={selected.has(book.id)} href="#/book/{book.id}" onclick={(e) => open(book, e)}
              use:longpress={() => startSelect(book.id)}>
              <span class="cover-wrap">
                <Cover {book} />
                {#if selecting}<span class="check" aria-hidden="true">{selected.has(book.id) ? '✓' : ''}</span>{/if}
                {#if book.lending}<span class="badge lent" class:danger={isOverdue(book, today)}>lent</span>
                {:else if book.away}<span class="badge lent away">with {book.away.by}</span>{/if}
              </span>
              <span class="t">{displayTitle(book)}</span>
              <span class="a muted">{book.authors.join(', ')}</span>
            </a>
          {/each}
        </div>
      {:else}
        <div class="table-wrap card">
          <table>
            <thead>
              <tr>
                {#if selecting}<th class="c-sel"><span class="sr-only">Selected</span></th>{/if}
                <th class="c-cover"></th>
                {#each [['title', 'Title'], ['author', 'Author'], ['year', 'Year'], ['location', 'Location'], ['rating', 'Rating']] as [key, label]}
                  <th aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'} class="c-{key}">
                    <button class="btn-ghost th" onclick={() => sortBy(key as SortKey)}>
                      {label}{#if sort === key}<span>{dir === 'asc' ? '▲' : '▼'}</span>{/if}
                    </button>
                  </th>
                {/each}
                <th class="c-status">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each g.books as book (book.id)}
                <tr class:sel={selected.has(book.id)} use:longpress={() => startSelect(book.id)}
                  onclick={(e) => (selecting ? toggle(book.id) : navigate(`/book/${book.id}`, {}))}>
                  {#if selecting}
                    <td class="c-sel"><input type="checkbox" checked={selected.has(book.id)} aria-label="Select {book.title}"
                      onclick={(e) => { e.stopPropagation(); toggle(book.id); }} /></td>
                  {/if}
                  <td class="c-cover"><Cover {book} size="sm" /></td>
                  <td class="c-title"><a href="#/book/{book.id}" onclick={(e) => { e.stopPropagation(); open(book, e); }}>{displayTitle(book)}</a>
                    {#if book.lending}<span class="badge" class:danger={isOverdue(book, today)}>lent</span>
                    {:else if book.away}<span class="badge away">with {book.away.by}</span>{/if}
                    <div class="muted small mobile-only">{book.authors.join(', ')}</div></td>
                  <td class="c-author">{book.authors.join(', ')}</td>
                  <td class="c-year">{book.publishedYear ?? book.firstPublishedYear ?? ''}</td>
                  <td class="c-location small">{lib.label(book.locationId)}</td>
                  <td class="c-rating"><Rating value={book.rating} readonly /></td>
                  <td class="c-status small">{STATUS_LABEL[book.status]}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/each}
    {#if shown < results.length}<div bind:this={sentinel} class="muted small sentinel">Loading more…</div>{/if}
  {/if}
</div>

{#if selecting}
  <BulkBar ids={selectedIds} ondone={stopSelect} />
{/if}

<FilterSheet bind:open={filtersOpen} {filter} books={$lib.books} locations={$lib.locations} onapply={setFilter} />

<Dialog bind:open={saveOpen} title="Save this filter">
  <form class="row save" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <input bind:value={saveName} placeholder="e.g. Unread in Flat A" aria-label="Filter name" />
    <button class="btn-primary" type="submit">Save</button>
  </form>
</Dialog>

<style>
  .selecting { padding-bottom: calc(var(--nav-h) + 110px + env(safe-area-inset-bottom)); }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .toolbar .active { background: var(--accent); color: var(--accent-text); border-color: transparent; }
  .pill { min-height: 36px; width: auto; border-radius: 999px; padding: 0 10px; font-size: 0.9rem; }
  .flip { display: inline-flex; transform: scaleY(-1); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; margin-left: auto; }
  .seg button { border: none; border-radius: 0; background: transparent; color: var(--muted); min-height: 40px; width: 44px; }
  .seg button.on { background: var(--surface-2); color: var(--text); }
  .seg .wall-link { border: none; border-radius: 0; background: transparent; color: var(--muted); min-height: 40px; width: 44px; font-size: 1.2rem; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .chip a { text-decoration: none; }
  .x { min-height: 24px; width: 24px; padding: 0; margin-right: -6px; }
  .save input { flex: 1; width: auto; }
  .group { margin: 12px 0 0; font-size: 1rem; display: flex; gap: 8px; align-items: baseline; }
  .grid { display: grid; gap: 16px 12px; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
  .tile { display: grid; gap: 4px; text-decoration: none; align-content: start; -webkit-touch-callout: none; user-select: none; }
  .cover-wrap { position: relative; display: block; }
  .tile.sel .cover-wrap { outline: 3px solid var(--brand); outline-offset: 2px; border-radius: 6px; }
  .check {
    position: absolute; top: 6px; right: 6px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center;
    background: rgb(255 255 255 / 0.9); color: #000; border: 2px solid var(--brand); font-weight: 700;
  }
  .tile.sel .check { background: var(--brand); color: #fff; }
  .lent { position: absolute; left: 4px; bottom: 4px; max-width: calc(100% - 8px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .away { background: color-mix(in srgb, var(--brand) 22%, var(--surface)); color: var(--text); }
  .tile .t { font-weight: 600; font-size: 0.85rem; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tile .a { font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .table-wrap { padding: 0; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tbody tr { cursor: pointer; -webkit-touch-callout: none; }
  tbody tr:hover { background: var(--surface-2); }
  tbody tr.sel { background: color-mix(in srgb, var(--brand) 15%, transparent); }
  td a { text-decoration: none; font-weight: 600; }
  .th { min-height: 40px; padding: 0 4px; font-weight: 600; gap: 4px; }
  .c-cover { width: 56px; }
  .c-sel { width: 36px; }
  .c-sel input { width: 22px; min-height: 22px; }
  .mobile-only { display: none; }
  .sentinel { text-align: center; padding: 16px; }
  @media (max-width: 640px) {
    .c-author, .c-year, .c-location, .c-status { display: none; }
    .mobile-only { display: block; }
  }
</style>

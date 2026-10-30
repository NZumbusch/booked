<script lang="ts">
  import { isOverdue, todayIso } from '../lib/domain/book';
  import { descendantIds } from '../lib/domain/locations';
  import { matchesText, sortBooks, SORT_LABELS, type SortDir, type SortKey } from '../lib/domain/query';
  import { STATUS_LABEL, plural } from '../lib/format';
  import { navigate, route } from '../lib/router';
  import { library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Rating from '../lib/ui/Rating.svelte';

  const PAGE = 120;
  const lib = library();

  const query = $derived($route.query);
  const sort = $derived((query.sort as SortKey) in SORT_LABELS ? (query.sort as SortKey) : 'title');
  const dir = $derived<SortDir>(query.dir === 'desc' ? 'desc' : 'asc');
  const loc = $derived(query.loc ?? '');
  const view = $derived(query.view === 'list' || query.view === 'grid' ? query.view : $lib.settings.view);

  // svelte-ignore state_referenced_locally
  let q = $state(query.q ?? '');
  let shown = $state(PAGE);
  let sentinel: HTMLElement | undefined = $state();

  function setQuery(patch: Record<string, string | undefined>) {
    navigate('/books', { ...query, ...patch }, true);
  }

  // Keep the URL in sync with the search box (debounced), so back/forward and links work.
  $effect(() => {
    const text = q;
    const t = setTimeout(() => { if ((query.q ?? '') !== text) setQuery({ q: text }); }, 200);
    return () => clearTimeout(t);
  });

  const scope = $derived.by(() => {
    if (!loc) return undefined;
    if (loc === 'none') return 'none' as const;
    return new Set(descendantIds($lib.locations, loc));
  });

  const results = $derived.by(() => {
    const text = query.q ?? '';
    const s = scope;
    const filtered = $lib.books.filter((b) => {
      if (s === 'none' ? !!b.locationId : s && !(b.locationId && s.has(b.locationId))) return false;
      return matchesText(b, text);
    });
    return sortBooks(filtered, sort, dir, (id) => lib.label(id));
  });

  $effect(() => {
    void results; // reset paging whenever the result set changes
    shown = PAGE;
  });

  $effect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) shown += PAGE;
    }, { rootMargin: '800px' });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  const visible = $derived(results.slice(0, shown));
  const today = todayIso();

  function sortBy(key: SortKey) {
    setQuery({ sort: key, dir: sort === key && dir === 'asc' ? 'desc' : 'asc' });
  }
</script>

<div class="page stack">
  <header class="spread">
    <h1>Library</h1>
    <a class="btn btn-sm" href="#/add"><Icon name="plus" size={18} /> Add</a>
  </header>

  <div class="search">
    <Icon name="search" />
    <input type="search" bind:value={q} placeholder="Search title, author, ISBN, tag, notes…" aria-label="Search" />
  </div>

  <div class="toolbar">
    {#if loc}
      <span class="chip">
        <Icon name="pin" size={16} /> {loc === 'none' ? 'No location' : lib.label(loc)}
        <button class="btn-ghost x" aria-label="Clear location filter" onclick={() => setQuery({ loc: undefined })}><Icon name="close" size={16} /></button>
      </span>
    {/if}
    <span class="muted small count">{plural(results.length, 'book')}</span>
    <label class="sort">
      <span class="sr-only">Sort by</span>
      <select value={sort} onchange={(e) => setQuery({ sort: e.currentTarget.value })}>
        {#each Object.entries(SORT_LABELS) as [k, l]}<option value={k}>{l}</option>{/each}
      </select>
    </label>
    <button class="btn-icon" aria-label="Sort direction: {dir === 'asc' ? 'ascending' : 'descending'}"
      onclick={() => setQuery({ dir: dir === 'asc' ? 'desc' : 'asc' })}>
      <span class:flip={dir === 'desc'}><Icon name="sort" /></span>
    </button>
    <div class="seg" role="group" aria-label="View">
      <button class="btn-icon" class:on={view === 'grid'} aria-pressed={view === 'grid'} aria-label="Grid view"
        onclick={() => { setQuery({ view: 'grid' }); lib.updateSettings({ view: 'grid' }); }}><Icon name="grid" /></button>
      <button class="btn-icon" class:on={view === 'list'} aria-pressed={view === 'list'} aria-label="List view"
        onclick={() => { setQuery({ view: 'list' }); lib.updateSettings({ view: 'list' }); }}><Icon name="list" /></button>
    </div>
  </div>

  {#if $lib.books.length === 0}
    <div class="card empty">
      <span class="big">📚</span>
      <p>Your library is empty. Scan a barcode or add your first book by hand.</p>
      <a class="btn btn-primary" href="#/add">Add a book</a>
    </div>
  {:else if results.length === 0}
    <div class="card empty">
      <span class="big">🔍</span>
      <p>No books match. Try a different search or clear the filters.</p>
      <a class="btn" href="#/books">Clear all</a>
    </div>
  {:else if view === 'grid'}
    <div class="grid">
      {#each visible as book (book.id)}
        <a class="tile" href="#/book/{book.id}">
          <Cover {book} />
          <span class="t">{book.title}</span>
          <span class="a muted">{book.authors.join(', ')}</span>
        </a>
      {/each}
    </div>
  {:else}
    <div class="table-wrap card">
      <table>
        <thead>
          <tr>
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
          {#each visible as book (book.id)}
            <tr onclick={() => navigate(`/book/${book.id}`)}>
              <td class="c-cover"><Cover {book} size="sm" /></td>
              <td class="c-title"><a href="#/book/{book.id}" onclick={(e) => e.stopPropagation()}>{book.title}</a>
                {#if book.lending}<span class="badge" class:danger={isOverdue(book, today)}>lent</span>{/if}
                <div class="muted small mobile-only">{book.authors.join(', ')}</div></td>
              <td class="c-author">{book.authors.join(', ')}</td>
              <td class="c-year">{book.publishedYear ?? ''}</td>
              <td class="c-location small">{lib.label(book.locationId)}</td>
              <td class="c-rating"><Rating value={book.rating} readonly /></td>
              <td class="c-status small">{STATUS_LABEL[book.status]}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if shown < results.length}<div bind:this={sentinel} class="muted small sentinel">Loading more…</div>{/if}
</div>

<style>
  .search { display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .count { margin-right: auto; }
  .sort select { min-height: 44px; width: auto; border-radius: 999px; }
  .flip { display: inline-flex; transform: scaleY(-1); }
  .seg { display: inline-flex; border: 1px solid var(--line); border-radius: 999px; overflow: hidden; }
  .seg button { border: none; border-radius: 0; background: transparent; color: var(--muted); }
  .seg button.on { background: var(--surface-2); color: var(--text); }
  .x { min-height: 28px; width: 28px; padding: 0; }
  .grid { display: grid; gap: 16px 12px; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); }
  .tile { display: grid; gap: 4px; text-decoration: none; align-content: start; }
  .tile .t { font-weight: 600; font-size: 0.85rem; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .tile .a { font-size: 0.75rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .table-wrap { padding: 0; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: middle; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: var(--surface-2); }
  td a { text-decoration: none; font-weight: 600; }
  .th { min-height: 40px; padding: 0 4px; font-weight: 600; gap: 4px; }
  .c-cover { width: 56px; }
  .mobile-only { display: none; }
  .sentinel { text-align: center; padding: 16px; }
  @media (max-width: 640px) {
    .c-author, .c-year, .c-location, .c-status { display: none; }
    .mobile-only { display: block; }
  }
</style>

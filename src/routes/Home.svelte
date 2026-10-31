<script lang="ts">
  import { isOverdue, todayIso } from '../lib/domain/book';
  import { sortBooks } from '../lib/domain/query';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import BackupReminder from '../lib/ui/BackupReminder.svelte';
  import SyncBanner from '../lib/ui/SyncBanner.svelte';
  import CoverPrompt from '../lib/ui/CoverPrompt.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  const lib = library();
  let q = $state('');
  const shared = $derived(new Set(($lib.settings.spaces ?? []).map((sp) => sp.rootLocationId)));

  const places = $derived($lib && lib.children(null));
  const counts = $derived($lib && lib.counts());
  const recent = $derived(sortBooks($lib.books, 'added', 'desc').slice(0, 12));
  const unplaced = $derived(counts.get(null) ?? 0);
  const reading = $derived($lib.books.filter((b) => b.status === 'reading'));
  const upNext = $derived($lib.books.filter((b) => b.queuedAt && b.status !== 'read').sort((a, b) => a.queuedAt!.localeCompare(b.queuedAt!)));
  const lent = $derived($lib.books.filter((b) => b.lending || b.away).length);
  const overdue = $derived($lib.books.filter((b) => isOverdue(b, todayIso())).length);
</script>

<div class="page stack">
  <header class="spread">
    <h1>Booked</h1>
    <div class="row">
      <span class="muted small">{plural($lib.books.length, 'book')}</span>
      <a class="btn btn-ghost btn-icon" href="#/settings" aria-label="Settings"><Icon name="settings" /></a>
    </div>
  </header>

  <form class="search" role="search" onsubmit={(e) => { e.preventDefault(); navigate('/books', { q }); }}>
    <Icon name="search" />
    <input type="search" bind:value={q} placeholder="Search title, author, ISBN, tag…" aria-label="Search your books" />
  </form>

  <a class="scan btn btn-primary" href="#/add?mode=scan"><Icon name="scan" size={28} /> Scan a book</a>
  <div class="row more-ways">
    <a class="btn btn-ghost" href="#/scan">Batch scan</a>
    <span class="muted">·</span>
    <a class="btn btn-ghost" href="#/add?mode=search">Search title</a>
    <span class="muted">·</span>
    <a class="btn btn-ghost" href="#/add">ISBN / by hand</a>
  </div>

  <SyncBanner />
  <BackupReminder />
  <CoverPrompt />

  {#if $lib.books.length}
    <nav class="explore" aria-label="Explore">
      <a class="card" href="#/stats"><span>📊</span>Stats</a>
      <a class="card" href="#/map"><span>🗺️</span>Map</a>
      <a class="card" href="#/lending"><span>🤝</span>Lending{#if overdue}<b class="badge danger">{overdue}</b>{:else if lent}<b class="badge">{lent}</b>{/if}</a>
      <a class="card" href="#/tags"><span>#</span>Tags</a>
    </nav>
  {/if}

  <section class="stack">
    <div class="spread">
      <h2>Places</h2>
      <a class="btn btn-sm" href="#/locations">Manage</a>
    </div>
    {#if places.length === 0}
      <div class="card empty">
        <span class="big">🏠</span>
        <p>Create your first place (e.g. “Flat A”), then add rooms and shelves.</p>
        <a class="btn btn-primary" href="#/locations">Add a place</a>
      </div>
    {:else}
      <div class="places">
        {#each places as place (place.id)}
          <div class="card place">
            <a class="spread title" href="#/locations/{place.id}">
              <strong>{place.name}{#if shared.has(place.id)} 👥{/if}</strong>
              <span class="muted small">{plural(counts.get(place.id) ?? 0, 'book')}</span>
            </a>
            <div class="row">
              {#each lib.children(place.id) as room (room.id)}
                <a class="chip" href="#/books?loc={room.id}">{room.name}{#if shared.has(room.id)} 👥{/if} <span class="muted">{counts.get(room.id) ?? 0}</span></a>
              {/each}
            </div>
          </div>
        {/each}
        {#if unplaced}
          <a class="card place spread" href="#/books?loc=none">
            <strong>No location</strong>
            <span class="muted small">{plural(unplaced, 'book')}</span>
          </a>
        {/if}
      </div>
    {/if}
  </section>

  {#if reading.length || upNext.length}
    <section class="stack">
      <h2>Reading</h2>
      {#each reading.slice(0, 3) as b (b.id)}
        <a class="card now" href="#/book/{b.id}">
          <Cover book={b} size="sm" />
          <span class="now-text">
            <strong>{b.title}</strong>
            {#if b.pageCount && b.currentPage}
              <span class="bar"><span style:width="{Math.min(100, (b.currentPage / b.pageCount) * 100)}%"></span></span>
              <span class="muted small">page {b.currentPage} of {b.pageCount}</span>
            {:else}<span class="muted small">{b.authors.join(', ')}</span>{/if}
          </span>
        </a>
      {/each}
      {#if reading.length > 3}<a class="btn btn-sm btn-ghost more" href="#/books?status=reading">and {reading.length - 3} more reading</a>{/if}
      {#if upNext.length}
        <span class="muted small">Up next</span>
        <div class="strip">{#each upNext as b (b.id)}<a href="#/book/{b.id}" title={b.title}><Cover book={b} /></a>{/each}</div>
      {/if}
    </section>
  {/if}

  {#if recent.length}
    <section class="stack">
      <div class="spread">
        <h2>Recently added</h2>
        <a class="btn btn-sm" href="#/books?sort=added&dir=desc">See all</a>
      </div>
      <div class="strip">
        {#each recent as book (book.id)}
          <a href="#/book/{book.id}" title={book.title}><Cover {book} /></a>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .search {
    display: flex; align-items: center; gap: 8px; padding: 0 14px; background: var(--surface); border-radius: 999px;
    box-shadow: var(--shadow); color: var(--muted);
  }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  .scan { min-height: 72px; font-size: 1.2rem; border-radius: 20px; }
  .more-ways { margin-top: -6px; justify-content: center; gap: 0; color: var(--muted); }
  .more-ways .btn { padding: 0 10px; color: var(--muted); }
  .explore { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .explore a { display: grid; justify-items: center; gap: 2px; padding: 10px 4px; text-decoration: none; font-size: 0.85rem; position: relative; }
  .explore span { font-size: 1.3rem; line-height: 1.4; font-weight: 700; }
  .explore b { position: absolute; top: 6px; right: 6px; }
  .places { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .place { display: grid; gap: 10px; text-decoration: none; }
  .title { text-decoration: none; min-height: 32px; }
  .strip { display: grid; grid-auto-flow: column; grid-auto-columns: 96px; gap: 12px; overflow-x: auto; padding: 4px 2px 12px; scroll-snap-type: x mandatory; }
  .strip a { scroll-snap-align: start; }
  .more { justify-self: start; }
  .now { display: flex; gap: 12px; align-items: center; text-decoration: none; padding: 10px 12px; }
  .now-text { display: grid; gap: 4px; flex: 1; min-width: 0; }
  .now-text strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; display: block; }
  .bar span { display: block; height: 100%; background: var(--chart-bar); }
</style>

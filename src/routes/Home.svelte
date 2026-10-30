<script lang="ts">
  import { sortBooks } from '../lib/domain/query';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import BackupReminder from '../lib/ui/BackupReminder.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  const lib = library();
  let q = $state('');

  const places = $derived($lib && lib.children(null));
  const counts = $derived($lib && lib.counts());
  const recent = $derived(sortBooks($lib.books, 'added', 'desc').slice(0, 12));
  const unplaced = $derived(counts.get(null) ?? 0);
</script>

<div class="page stack">
  <header class="spread">
    <h1>Booked</h1>
    <span class="muted small">{plural($lib.books.length, 'book')}</span>
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

  <BackupReminder />

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
              <strong>{place.name}</strong>
              <span class="muted small">{plural(counts.get(place.id) ?? 0, 'book')}</span>
            </a>
            <div class="row">
              {#each lib.children(place.id) as room (room.id)}
                <a class="chip" href="#/books?loc={room.id}">{room.name} <span class="muted">{counts.get(room.id) ?? 0}</span></a>
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
  .places { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  .place { display: grid; gap: 10px; text-decoration: none; }
  .title { text-decoration: none; min-height: 32px; }
  .strip { display: grid; grid-auto-flow: column; grid-auto-columns: 96px; gap: 12px; overflow-x: auto; padding: 4px 2px 12px; scroll-snap-type: x mandatory; }
  .strip a { scroll-snap-align: start; }
</style>

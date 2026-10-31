<script lang="ts">
  import { todayIso } from '../lib/domain/book';
  import { applyFilter } from '../lib/domain/filters';
  import { labelOf } from '../lib/domain/locations';
  import { sortBooks } from '../lib/domain/query';
  import type { Book, Id } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { library } from '../lib/stores/app';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  let { loc = null }: { loc?: Id | null } = $props();
  const lib = library();
  // svelte-ignore state_referenced_locally
  let scope = $state<Id | null>(loc);

  const books = $derived(
    sortBooks(scope ? applyFilter($lib.books, { loc: scope, ownership: 'owned' }, { locations: $lib.locations, today: todayIso() })
      : $lib.books.filter((b) => b.ownership === 'owned'), 'author', 'asc')
  );
  /** One section per exact location (room or shelf), in label order. */
  const sections = $derived.by(() => {
    const map = new Map<string, Book[]>();
    for (const b of books) {
      const key = labelOf($lib.locations, b.locationId);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
</script>

<div class="page stack">
  <div class="no-print stack">
    <h1>Printable list</h1>
    <LocationPicker bind:value={scope} locations={$lib.locations} oncreate={null} />
    <div class="row"><button class="btn-primary" onclick={() => window.print()}>Print / save as PDF</button></div>
  </div>

  <article class="sheet">
    <header>
      <h1>{scope ? lib.label(scope) : 'All books'}</h1>
      <p class="muted small">{plural(books.length, 'book')} · {formatDate(todayIso(), $lib.settings.dateFormat)}</p>
    </header>
    {#each sections as [label, list] (label)}
      <section>
        <h2>{label} <span class="muted small">({list.length})</span></h2>
        <table>
          <thead><tr><th>Author</th><th>Title</th><th>Year</th><th>ISBN</th></tr></thead>
          <tbody>
            {#each list as b (b.id)}
              <tr>
                <td>{b.authors.join(', ')}</td>
                <td>{b.title}{b.subtitle ? `: ${b.subtitle}` : ''}{b.lending ? ` (lent to ${b.lending.to})` : ''}</td>
                <td>{b.publishedYear ?? ''}</td>
                <td class="isbn">{b.isbn13 ?? b.isbn10 ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </section>
    {:else}
      <p class="muted">No books here.</p>
    {/each}
  </article>
</div>

<style>
  .sheet { background: var(--surface); border-radius: var(--radius); padding: 20px; box-shadow: var(--shadow); }
  .sheet h1 { font-size: 1.4rem; margin: 0; }
  .sheet h2 { font-size: 1rem; margin: 20px 0 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); }
  .isbn { font-variant-numeric: tabular-nums; white-space: nowrap; }
  @media print {
    .no-print { display: none; }
    .sheet { box-shadow: none; padding: 0; background: #fff; color: #000; }
    section { break-inside: auto; }
    tr { break-inside: avoid; }
  }
</style>

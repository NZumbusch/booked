<script lang="ts">
  import { isOverdue, todayIso } from '../lib/domain/book';
  import type { Book } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { attempt, library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';

  const lib = library();
  const today = todayIso();
  const lent = $derived(
    $lib.books
      .filter((b) => b.lending)
      .sort((a, b) => (a.lending!.dueOn ?? '9999').localeCompare(b.lending!.dueOn ?? '9999') || a.lending!.lentOn.localeCompare(b.lending!.lentOn))
  );
  const overdue = $derived(lent.filter((b) => isOverdue(b, today)).length);
  /** Group by borrower so "what does Sam have?" is one glance. */
  const byPerson = $derived.by(() => {
    const m = new Map<string, Book[]>();
    for (const b of lent) m.set(b.lending!.to, [...(m.get(b.lending!.to) ?? []), b]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });
  /** Books someone took out of a shared place, grouped by who has them. */
  const away = $derived.by(() => {
    const m = new Map<string, Book[]>();
    for (const b of $lib.books.filter((x) => x.away)) m.set(b.away!.by, [...(m.get(b.away!.by) ?? []), b]);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  function back(b: Book) {
    attempt(() => lib.updateBook(b.id, { away: undefined }), `“${b.title}” is back in ${lib.label(b.locationId)}`, { undo: true });
  }

  const days = (from: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86400000);
  const df = $derived($lib.settings.dateFormat);

  function returned(b: Book) {
    attempt(() => lib.updateBook(b.id, { lending: undefined }), `“${b.title}” is back`, { undo: true });
  }
</script>

<div class="page stack">
  <h1>Lending</h1>
  {#if lent.length === 0 && away.length === 0}
    <div class="card empty">
      <span class="big">🤝</span>
      <p>No books are lent out. To lend one, open it and fill in “Lending” in Edit, or select several in the library and use More › Lend.</p>
      <a class="btn" href="#/books">Go to library</a>
    </div>
  {:else}
    {#if lent.length}
    <p class="muted">{plural(lent.length, 'book')} lent to {plural(byPerson.length, 'person', 'people')}{overdue ? '' : ', none overdue'}.
      {#if overdue}<strong class="danger">{overdue} overdue.</strong>{/if}</p>
    {#each byPerson as [person, list] (person)}
      <section class="stack">
        <h2>{person} <span class="muted small">{list.length}</span></h2>
        {#each list as b (b.id)}
          <div class="card item" class:overdue={isOverdue(b, today)}>
            <a href="#/book/{b.id}"><Cover book={b} size="sm" /></a>
            <div class="text">
              <a href="#/book/{b.id}"><strong>{b.title}</strong></a>
              <span class="small muted">
                since {formatDate(b.lending!.lentOn, df)} ({plural(days(b.lending!.lentOn), 'day')})
                {#if b.lending!.dueOn}· due {formatDate(b.lending!.dueOn, df)}{/if}
              </span>
              {#if isOverdue(b, today)}<span class="badge danger">overdue by {plural(days(b.lending!.dueOn!), 'day')}</span>{/if}
            </div>
            <button class="btn-sm" onclick={() => returned(b)}>Returned</button>
          </div>
        {/each}
      </section>
    {/each}
    {/if}

    {#if away.length}
      <h2 class="section" class:first={!lent.length}>Taken out of shared places</h2>
      <p class="muted small">Books someone moved from a shared place into their own room. They come back automatically when it’s moved back.</p>
      {#each away as [person, list] (person)}
        <section class="stack">
          <h2>{person} <span class="muted small">{list.length}</span></h2>
          {#each list as b (b.id)}
            <div class="card item">
              <a href="#/book/{b.id}"><Cover book={b} size="sm" /></a>
              <div class="text">
                <a href="#/book/{b.id}"><strong>{b.title}</strong></a>
                <span class="small muted">from {lib.label(b.locationId)} · since {formatDate(b.away!.since, df)}</span>
              </div>
              <button class="btn-sm" onclick={() => back(b)}>It’s back</button>
            </div>
          {/each}
        </section>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .danger { color: var(--danger); }
  .section { font-size: 1.15rem; margin-top: 16px; border-top: 1px solid var(--line); padding-top: 16px; }
  .section.first { margin-top: 0; border-top: none; padding-top: 0; }
  h2 { display: flex; gap: 8px; align-items: baseline; margin: 8px 0 0; }
  .item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
  .item.overdue { border-left: 4px solid var(--danger); }
  .text { flex: 1; display: grid; gap: 2px; min-width: 0; justify-items: start; }
  .text a { text-decoration: none; }
</style>

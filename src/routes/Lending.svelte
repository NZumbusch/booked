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
  const days = (from: string) => Math.round((Date.parse(today) - Date.parse(from)) / 86400000);
  const df = $derived($lib.settings.dateFormat);

  function returned(b: Book) {
    attempt(() => lib.updateBook(b.id, { lending: undefined }), `“${b.title}” is back`, { undo: true });
  }
</script>

<div class="page stack">
  <h1>Lending</h1>
  {#if lent.length === 0}
    <div class="card empty">
      <span class="big">🤝</span>
      <p>No books are lent out. To lend one, open it and fill in “Lending” in Edit, or select several in the library and use More › Lend.</p>
      <a class="btn" href="#/books">Go to library</a>
    </div>
  {:else}
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
</div>

<style>
  .danger { color: var(--danger); }
  h2 { display: flex; gap: 8px; align-items: baseline; margin: 8px 0 0; }
  .item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
  .item.overdue { border-left: 4px solid var(--danger); }
  .text { flex: 1; display: grid; gap: 2px; min-width: 0; justify-items: start; }
  .text a { text-decoration: none; }
</style>

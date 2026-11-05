<script lang="ts">
  import { isOverdue, todayIso } from '../lib/domain/book';
  import type { Book } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { attempt, library, toast } from '../lib/stores/app';
  import { untrack } from 'svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import { DEFAULT_LOAN_DAYS, dueOf, dueText } from '../lib/domain/borrowing';
  import { addReturnToCalendar, enableDueNotifications, notificationsOn, notificationsSupported } from '../lib/ui/dueReminders';

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

  /** Books you borrowed, the one due first on top. */
  const borrowed = $derived(
    $lib.books.filter((b) => b.ownership === 'borrowed')
      .sort((a, b) => (a.borrowed?.dueOn ?? '9999').localeCompare(b.borrowed?.dueOn ?? '9999'))
  );
  let notifyOn = $state(notificationsOn());
  async function turnOnNotify() {
    notifyOn = await enableDueNotifications();
    if (!notifyOn) toast('Notifications are blocked for Booked in the browser settings');
  }
  async function givenBack(b: Book) {
    await attempt(() => lib.deleteBooks([b.id]), `“${b.title}” is given back`, { undo: true });
  }
  let loanDays = $state(untrack(() => $lib.settings.loanDays ?? DEFAULT_LOAN_DAYS));
  function saveLoanDays() {
    const n = Math.round(Number(loanDays));
    if (n >= 1 && n <= 365 && n !== ($lib.settings.loanDays ?? DEFAULT_LOAN_DAYS)) lib.updateSettings({ loanDays: n });
  }

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
  <header class="spread">
    <h1>Lending</h1>
    <a class="btn btn-sm btn-primary" href="#/add?mode=scan&to=borrowed">＋ Borrowed book</a>
  </header>

  <section class="stack">
    <h2 class="section first">Borrowed <span class="muted small">{borrowed.length || ''}</span></h2>
    {#if !borrowed.length}
      <p class="muted small">Books you borrow from a library or a friend: scan them with “＋ Borrowed book”. They sit in your library (marked) until you give them back, and Booked reminds you before they’re due.</p>
    {/if}
    {#each borrowed as b (b.id)}
      {@const d = dueOf(b, today)}
      <div class="card item" class:overdue={d.state === 'overdue' || d.state === 'today'} class:soon={d.state === 'soon'}>
        <a href="#/book/{b.id}"><Cover book={b} size="sm" /></a>
        <div class="text">
          <a href="#/book/{b.id}"><strong>{b.title}</strong></a>
          <span class="small muted">{b.borrowed?.from || 'borrowed'}{b.borrowed?.dueOn ? ` · back by ${formatDate(b.borrowed.dueOn, df)}` : ''}</span>
          {#if d.state !== 'open'}<span class="badge" class:danger={d.state === 'overdue' || d.state === 'today'} class:warn={d.state === 'soon'}>{dueText(d)}</span>{/if}
        </div>
        <div class="acts">
          {#if b.borrowed?.dueOn}<button class="btn-sm btn-icon" onclick={() => addReturnToCalendar(b)} title="Add a reminder to your calendar" aria-label="Add a reminder to your calendar">📅</button>{/if}
          <button class="btn-sm" onclick={() => givenBack(b)}>Given back</button>
        </div>
      </div>
    {/each}
    <div class="row settings small">
      <label>Usual loan period <input type="number" min="1" max="365" bind:value={loanDays} onchange={saveLoanDays} inputmode="numeric" /> days</label>
      {#if notificationsSupported()}
        {#if notifyOn}<span class="muted">🔔 You’ll get a notification when a book is due soon.</span>
        {:else}<button class="btn-sm" onclick={turnOnNotify}>🔔 Notify me when one is due</button>{/if}
      {/if}
    </div>
  </section>

  <h2 class="section">Lent out</h2>
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
  .item.soon { border-left: 4px solid var(--warn); }
  .acts { display: flex; gap: 6px; align-items: center; }
  .settings { gap: 12px; flex-wrap: wrap; align-items: center; }
  .settings input { width: 4.5em; display: inline-block; padding: 4px 8px; min-height: 0; }
  .text { flex: 1; display: grid; gap: 2px; min-width: 0; justify-items: start; }
  .text a { text-decoration: none; }
</style>

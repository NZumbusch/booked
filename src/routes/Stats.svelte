<script lang="ts">
  import { todayIso } from '../lib/domain/book';
  import { filterToQuery } from '../lib/domain/filters';
  import { computeStats, type Count } from '../lib/domain/stats';
  import { STATUS_LABEL, formatPrice, plural } from '../lib/format';
  import { library } from '../lib/stores/app';
  import BarList from '../lib/ui/BarList.svelte';
  import { breadth, readingStats, roomProfiles } from '../lib/domain/reading';
  import { languageName, ordinal } from '../lib/format';
  import { attempt } from '../lib/stores/app';

  const lib = library();
  const s = $derived(computeStats($lib.books, $lib.locations, todayIso(), $lib.settings.currency));
  const q = (f: Parameters<typeof filterToQuery>[0]) => `#/books?${new URLSearchParams(filterToQuery(f))}`;

  const places = $derived<(Count & { depth?: number })[]>([
    ...s.byPlace.flatMap((p) => [{ key: p.key, label: p.label, count: p.count }, ...p.rooms.map((r) => ({ ...r, depth: 1 }))]),
    ...(s.noLocation ? [{ key: 'none', label: 'No location', count: s.noLocation }] : [])
  ]);
  const statuses = $derived<Count[]>((['reading', 'unread', 'read', 'abandoned'] as const).map((k) => ({ key: k, label: STATUS_LABEL[k], count: s.byStatus[k] })));

  // Column chart: books finished per year (one series).
  const years = $derived(s.readPerYear.slice(-12));
  const maxYear = $derived(Math.max(1, ...years.map((y) => y.books)));
  const peak = $derived(years.reduce((m, y) => (y.books > m.books ? y : m), years[0] ?? { year: 0, books: 0, pages: 0 }));
  let hover = $state<number>();
  let hoverMonth = $state<string>();

  const r = $derived(readingStats($lib.books, todayIso(), $lib.settings.readingGoal));
  const maxMonth = $derived(Math.max(1, ...r.perMonth.map((m) => m.books)));
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short' });
  const wide = $derived(breadth($lib.books.filter((b) => b.ownership === 'owned')));
  const rooms = $derived(roomProfiles($lib.books.filter((b) => b.ownership === 'owned'), $lib.locations));
  const setGoal = (v: string) => attempt(() => lib.updateSettings({ readingGoal: Number(v) > 0 ? Math.round(Number(v)) : undefined }));
</script>

<div class="page stack">
  <h1>Statistics</h1>

  {#if $lib.books.length === 0}
    <div class="card empty"><p>Add some books to see statistics.</p><a class="btn btn-primary" href="#/add">Add a book</a></div>
  {:else}
    <section class="tiles">
      <div class="tile"><span class="v">{s.owned.toLocaleString()}</span><span class="k">books owned</span></div>
      <div class="tile"><span class="v">{s.authors.toLocaleString()}</span><span class="k">authors</span></div>
      <div class="tile"><span class="v">{s.pages.toLocaleString()}</span><span class="k">pages</span></div>
      <div class="tile"><span class="v">{s.byStatus.read.toLocaleString()}</span><span class="k">read ({s.owned ? Math.round((s.byStatus.read / s.owned) * 100) : 0}%)</span></div>
      <a class="tile" href={q({ lending: 'lent' })}><span class="v">{s.lent}</span><span class="k">lent out{#if s.overdue} · <strong class="danger">{s.overdue} overdue</strong>{/if}</span></a>
      <a class="tile" href={q({ ownership: 'wishlist' })}><span class="v">{s.wishlist}</span><span class="k">on wishlist</span></a>
      {#each s.valueByCurrency.slice(0, 2) as v (v.currency)}
        <div class="tile"><span class="v">{formatPrice(v.amount, v.currency)}</span><span class="k">collection value ({plural(v.books, 'book')} with a price)</span></div>
      {/each}
      {#if s.copies !== s.owned}<div class="tile"><span class="v">{s.copies.toLocaleString()}</span><span class="k">copies incl. duplicates</span></div>{/if}
    </section>

    <section class="card stack">
      <h2>Reading in {r.year}</h2>
      <div class="goal">
        <span class="v">{r.readThisYear}{#if r.goal}<span class="muted"> / {r.goal}</span>{/if}</span>
        <span class="k">books read{r.pagesThisYear ? ` · ${r.pagesThisYear.toLocaleString()} pages` : ''}</span>
      </div>
      {#if r.goal}
        <span class="goalbar" role="progressbar" aria-valuenow={r.readThisYear} aria-valuemax={r.goal}>
          <span style:width="{Math.min(100, (r.readThisYear / r.goal) * 100)}%"></span>
          {#if r.expectedByNow !== undefined}<i style:left="{Math.min(100, (r.expectedByNow / r.goal) * 100)}%" title="Where you’d be on an even pace"></i>{/if}
        </span>
        <span class="muted small">
          {r.readThisYear >= (r.expectedByNow ?? 0) ? 'On track ✓' : `${(r.expectedByNow ?? 0) - r.readThisYear} behind an even pace`}
        </span>
      {/if}
      <label class="field goal-input">Yearly goal (books)
        <input type="number" min="0" inputmode="numeric" value={r.goal ?? ''} onchange={(e) => setGoal(e.currentTarget.value)} placeholder="e.g. 24" />
      </label>
      <div class="cols months" role="img" aria-label="Books finished per month: {r.perMonth.map((m) => `${m.month}: ${m.books}`).join(', ')}">
        {#each r.perMonth as m (m.month)}
          <div class="col" role="presentation" onpointerenter={() => (hoverMonth = m.month)} onpointerleave={() => (hoverMonth = undefined)}>
            <span class="val" class:show={hoverMonth === m.month || (m.books > 0 && m.books === maxMonth)}>{m.books}</span>
            <span class="colbar" style:height="{(m.books / maxMonth) * 100}%"></span>
            <span class="yr">{monthLabel(m.month)}</span>
            {#if hoverMonth === m.month}<span class="tip">{m.month}: {m.books} books{m.pages ? `, ${m.pages.toLocaleString()} pages` : ''}</span>{/if}
          </div>
        {/each}
      </div>
      <p class="muted small facts">
        {[
          r.medianDays !== undefined ? (r.medianDays < 1 ? 'You usually finish a book within a day.' : `A book takes you about ${plural(r.medianDays, 'day')} (median).`) : '',
          ...r.abandonByGenre.slice(0, 2).map((a) => `You abandon ${Math.round(a.rate * 100)}% of ${a.genre} books.`)
        ].filter(Boolean).join(' ')}
      </p>
    </section>

    <section class="card stack">
      <h2>Books read per year</h2>
      {#if years.length === 0}
        <p class="muted small">Set a reading status of “Read” with a finish date to see your reading history here.</p>
      {:else}
        <div class="cols" role="img" aria-label="Books read per year: {years.map((y) => `${y.year}: ${y.books}`).join(', ')}">
          {#each years as y (y.year)}
            <div class="col" role="presentation" onpointerenter={() => (hover = y.year)} onpointerleave={() => (hover = undefined)}>
              <span class="val" class:show={hover === y.year || y === peak || y === years[years.length - 1]}>{y.books}</span>
              <span class="colbar" style:height="{(y.books / maxYear) * 100}%"></span>
              <span class="yr">{y.year}</span>
              {#if hover === y.year}<span class="tip">{y.year}: {y.books} books{y.pages ? `, ${y.pages.toLocaleString()} pages` : ''}</span>{/if}
            </div>
          {/each}
        </div>
        <details>
          <summary class="small muted">Show as table</summary>
          <table class="small">
            <thead><tr><th>Year</th><th>Books</th><th>Pages</th></tr></thead>
            <tbody>{#each years as y}<tr><td>{y.year}</td><td>{y.books}</td><td>{y.pages.toLocaleString()}</td></tr>{/each}</tbody>
          </table>
        </details>
      {/if}
    </section>

    <section class="card stack">
      <h2>Reading status</h2>
      <BarList items={statuses} href={(c) => q({ status: [c.key as 'read'] })} />
    </section>

    {#if places.length}
      <section class="card stack">
        <h2>Where they are</h2>
        <BarList items={places} href={(c) => q({ loc: c.key })} />
      </section>
    {/if}

    {#if s.topAuthors.length}
      <section class="card stack">
        <h2>Most collected authors</h2>
        <BarList items={s.topAuthors} href={(c) => q({ authors: [c.label] })} />
      </section>
    {/if}

    {#if s.topGenres.length}
      <section class="card stack">
        <h2>Genres</h2>
        <BarList items={s.topGenres} href={(c) => q({ genres: [c.label] })} />
      </section>
    {/if}

    {#if wide.languages.length > 1 || wide.centuries.length > 1}
      <section class="card stack">
        <h2>Breadth</h2>
        {#if wide.languages.length > 1}
          <span class="muted small">Original languages</span>
          <BarList items={wide.languages.slice(0, 8).map((l) => ({ key: l.code, label: languageName(l.code) ?? l.code, count: l.count }))} href={(c) => q({ languages: [c.key!] })} />
        {/if}
        {#if wide.centuries.length > 1}
          <span class="muted small">Written in</span>
          <BarList items={wide.centuries.map((c) => ({ key: String(c.century), label: `${ordinal(c.century)} century`, count: c.count }))}
            href={(c) => q({ yearFrom: (Number(c.key) - 1) * 100 + 1, yearTo: Number(c.key) * 100 })} />
        {/if}
      </section>
    {/if}

    {#if rooms.length}
      <section class="card stack">
        <h2>What each room is about</h2>
        {#each rooms as room (room.id)}
          <div class="room">
            <a href={q({ loc: room.id })}><strong>{room.label}</strong></a> <span class="muted small">{room.total}</span>
            <div class="small">{room.top.map((t) => `${t.topic} ${Math.round(t.share * 100)}%`).join(' · ')}</div>
          </div>
        {/each}
      </section>
    {/if}

    {#if s.byDecade.length > 1}
      <section class="card stack">
        <h2>When they were first published</h2>
        <BarList items={s.byDecade} href={(c) => q({ yearFrom: Number(c.key), yearTo: Number(c.key) + 9 })} />
      </section>
    {/if}
  {/if}
</div>

<style>
  .tiles { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
  .tile { background: var(--surface); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px; display: grid; gap: 2px; text-decoration: none; }
  .v { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .k { color: var(--muted); font-size: 0.85rem; }
  .danger { color: var(--danger); }
  .cols { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding-top: 20px; border-bottom: 1px solid var(--chart-grid); }
  .col { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; position: relative; min-width: 0; }
  .colbar { width: min(24px, 80%); background: var(--chart-bar); border-radius: 4px 4px 0 0; min-height: 2px; }
  .val { font-size: 0.75rem; color: var(--muted); visibility: hidden; font-variant-numeric: tabular-nums; }
  .val.show { visibility: visible; }
  .yr { position: absolute; bottom: -20px; font-size: 0.7rem; color: var(--muted); }
  .tip {
    position: absolute; bottom: 100%; background: var(--text); color: var(--bg); font-size: 0.75rem; padding: 4px 8px; border-radius: 6px;
    white-space: nowrap; z-index: 2; pointer-events: none;
  }
  details { margin-top: 24px; }
  .goal { display: flex; align-items: baseline; gap: 10px; }
  .goal .v { font-size: 2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .goal .k { color: var(--muted); }
  .goalbar { position: relative; height: 12px; border-radius: 6px; background: var(--surface-2); display: block; }
  .goalbar span { display: block; height: 100%; border-radius: 6px; background: var(--chart-bar); }
  .goalbar i { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--text); }
  .goal-input { max-width: 200px; }
  .months { height: 120px; margin-bottom: 8px; }
  .facts { margin: 16px 0 0; }
  .room { border-top: 1px solid var(--line); padding-top: 8px; }
  .room a { text-decoration: none; }
  table { border-collapse: collapse; margin-top: 8px; }
  th, td { padding: 2px 12px 2px 0; text-align: left; }
</style>

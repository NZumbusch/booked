<script lang="ts">
  import { onMount } from 'svelte';
  import { influences, KIND_LABEL, seriesStatus, sharedGroups } from '../lib/domain/connections';
  import { facet, filterToQuery } from '../lib/domain/filters';
  import { buildIndex, oddOneOut, topTopics } from '../lib/domain/similar';
  import type { Book } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { knowledge, library } from '../lib/stores/app';
  import BarList from '../lib/ui/BarList.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import PaletteStrip from '../lib/ui/PaletteStrip.svelte';

  const lib = library();
  const kn = knowledge();
  const k = kn.state;

  onMount(() => {
    kn.refresh();
  });

  const owned = $derived($lib.books.filter((b) => b.ownership === 'owned'));
  const unread = $derived(owned.filter((b) => b.status === 'unread'));
  const index = $derived(buildIndex(owned));

  let seed = $state(Math.random());
  const randomPick = $derived(unread.length ? unread[Math.floor(seed * unread.length)] : undefined);
  const forgotten = $derived([...unread].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 3));
  const odd = $derived(oddOneOut(owned, index));

  const topics = $derived(topTopics(owned, 24));
  const authors = $derived(facet(owned, (b) => b.authors).sort((a, b) => b.count - a.count).slice(0, 16));
  const series = $derived(seriesStatus(owned, $k.works).filter((s) => s.missing > 0));
  const groups = $derived(sharedGroups(owned, $k.works).slice(0, 12));
  const infl = $derived(influences($k.works, $k.authors, owned));
  const owned2owned = $derived(infl.filter((i) => i.byOwned));
  const otherInfluences = $derived.by(() => {
    // Most frequent outside influences on your authors: good reading suggestions.
    const m = new Map<string, { label: string; count: number; authors: string[]; person: boolean }>();
    for (const i of infl.filter((x) => !x.byOwned)) {
      const e = m.get(i.by.id) ?? { label: i.by.label, count: 0, authors: [], person: i.by.person !== false };
      e.count++;
      e.authors.push(i.author.label);
      m.set(i.by.id, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  });

  const decades = $derived.by(() => {
    const m = new Map<number, number>();
    for (const b of owned) {
      const y = b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
      if (y) m.set(Math.floor(y / 10) * 10, (m.get(Math.floor(y / 10) * 10) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([d, count]) => ({ key: String(d), label: d < 1800 ? `${d}s` : `${d}s`, count }));
  });

  const link = (f: Parameters<typeof filterToQuery>[0]) => `#/books?${new URLSearchParams(filterToQuery(f))}`;
  const topicHref = (t: string) => `#/topic/${encodeURIComponent(t)}`;
  const authorHref = (a: string) => `#/author/${encodeURIComponent(a)}`;
  const coverOf = (b: Book) => b;
</script>

<div class="page stack">
  <header class="spread">
    <h1>Discover</h1>
    <button class="btn-sm" onclick={() => kn.refresh(true)} disabled={$k.busy}>{$k.busy ? 'Looking up…' : 'Update'}</button>
  </header>

  {#if owned.length === 0}
    <div class="card empty"><span class="big">🧭</span><p>Add some books, then come back to explore what connects them.</p><a class="btn btn-primary" href="#/add?mode=scan">Scan a book</a></div>
  {:else}
    <a class="card wall-card" href="#/wall">
      <span class="stack tight">
        <strong>Cover wall</strong>
        <span class="muted small">All your covers on one zoomable wall: by colour, topic, author or time.</span>
      </span>
      <PaletteStrip height={40} />
    </a>

    <section class="stack">
      <h2>Pick something</h2>
      <div class="picks">
        {#if randomPick}
          <div class="card pick">
            <span class="muted small">Random unread</span>
            <a href="#/book/{randomPick.id}" class="pick-book"><Cover book={coverOf(randomPick)} size="sm" /><span><strong>{randomPick.title}</strong><br /><span class="muted small">{randomPick.authors.join(', ')}</span></span></a>
            <button class="btn-sm" onclick={() => (seed = Math.random())}>🎲 Another</button>
          </div>
        {/if}
        {#if forgotten.length}
          <div class="card pick">
            <span class="muted small">Waiting the longest</span>
            {#each forgotten as b (b.id)}<a href="#/book/{b.id}" class="line">{b.title}</a>{/each}
          </div>
        {/if}
        {#if odd}
          <div class="card pick">
            <span class="muted small">The odd one out</span>
            <a href="#/book/{odd.id}" class="pick-book"><Cover book={coverOf(odd)} size="sm" /><span><strong>{odd.title}</strong><br /><span class="muted small">least like the rest of your shelves</span></span></a>
          </div>
        {/if}
      </div>
    </section>

    {#if topics.length}
      <section class="stack">
        <h2>Your topics</h2>
        <div class="row">{#each topics as t (t.name)}<a class="chip" href={topicHref(t.name)}>{t.name} <span class="muted">{t.count}</span></a>{/each}</div>
      </section>
    {/if}

    {#if authors.length}
      <section class="stack">
        <h2>Your authors</h2>
        <div class="row">{#each authors as a (a.value)}<a class="chip" href={authorHref(a.value)}>{a.value} <span class="muted">{a.count}</span></a>{/each}</div>
      </section>
    {/if}

    {#if $k.coverage.known === 0}
      <p class="muted small card">Connections, series and influences come from Wikidata for books it knows. They appear once books have been looked up online (new books are automatically).</p>
    {:else}
      {#if series.length}
        <section class="stack">
          <h2>Series to complete</h2>
          {#each series as s (s.id)}
            <div class="card series">
              <strong>{s.label}</strong>
              <ol class="vols">
                {#each s.volumes as v (v.id)}
                  <li class:have={!!v.owned}>
                    <span class="pos">{v.position}</span>
                    {#if v.owned}<a href="#/book/{v.owned.id}">{v.label}</a>{:else}<span>{v.label}</span>{/if}
                  </li>
                {/each}
              </ol>
              <span class="muted small">{s.missing} missing</span>
            </div>
          {/each}
        </section>
      {/if}

      {#if owned2owned.length || otherInfluences.length}
        <section class="stack">
          <h2>Influences</h2>
          {#each owned2owned as i (i.author.id + i.by.id)}
            <p class="influence"><a href={authorHref(i.by.label)}>{i.by.label}</a> <span class="muted">influenced</span> <a href={authorHref(i.author.label)}>{i.author.label}</a> <span class="badge">both on your shelves</span></p>
          {/each}
          {#if otherInfluences.length}
            {#if otherInfluences.some((o) => o.person)}
              <p class="muted small">People who shaped your authors (worth a look):</p>
              <div class="row">
                {#each otherInfluences.filter((o) => o.person) as o (o.label)}
                  <a class="chip" href={authorHref(o.label)} title="Influenced {o.authors.join(', ')}">{o.label}{#if o.count > 1} <span class="muted">×{o.count}</span>{/if}</a>
                {/each}
              </div>
            {/if}
            {#if otherInfluences.some((o) => !o.person)}
              <p class="muted small">Ideas behind them:</p>
              <div class="row">
                {#each otherInfluences.filter((o) => !o.person) as o (o.label)}
                  <a class="chip" href={topicHref(o.label)} title="Influenced {o.authors.join(', ')}">{o.label}</a>
                {/each}
              </div>
            {/if}
          {/if}
        </section>
      {/if}

      {#if groups.length}
        <section class="stack">
          <h2>Connections</h2>
          <div class="groups">
            {#each groups as g (g.kind + g.id)}
              <div class="card group">
                <span class="muted small">{KIND_LABEL[g.kind]}</span>
                <strong>{g.label}</strong>
                <div class="covers">
                  {#each g.books.slice(0, 6) as b (b.id)}<a href="#/book/{b.id}" title={b.title}><Cover book={b} size="sm" /></a>{/each}
                </div>
                <span class="muted small">{plural(g.books.length, 'book')}</span>
              </div>
            {/each}
          </div>
        </section>
      {/if}
      <p class="muted small">Connections known for {$k.coverage.known} of {plural($k.coverage.total, 'book')} (books Wikidata knows).{#if $k.error} <span class="err">{$k.error}</span>{/if}</p>
    {/if}

    {#if decades.length > 1}
      <section class="card stack">
        <h2>Through time</h2>
        <p class="muted small">When your books were written or first published.</p>
        <BarList items={decades} href={(c) => link({ yearFrom: Number(c.key), yearTo: Number(c.key) + 9 })} />
      </section>
    {/if}
  {/if}
</div>

<style>
  h2 { margin: 8px 0 0; }
  .wall-card { display: grid; gap: 10px; text-decoration: none; }
  .tight { gap: 2px; display: grid; }
  .picks { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .pick { display: grid; gap: 8px; align-content: start; }
  .pick-book { display: flex; gap: 10px; align-items: center; text-decoration: none; }
  .line { text-decoration: none; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .series { display: grid; gap: 6px; }
  .vols { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .vols li { display: flex; gap: 8px; color: var(--muted); }
  .vols li.have { color: var(--text); }
  .vols li.have .pos { background: var(--chart-bar); color: #fff; }
  .vols a { text-decoration: none; font-weight: 600; }
  .pos { min-width: 22px; height: 22px; border-radius: 50%; display: inline-grid; place-items: center; font-size: 0.75rem; background: var(--surface-2); }
  .influence { margin: 0; }
  .influence a { font-weight: 600; text-decoration: none; }
  .groups { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }
  .group { display: grid; gap: 6px; }
  .covers { display: flex; gap: 6px; flex-wrap: wrap; }
  .err { color: var(--danger); }
</style>

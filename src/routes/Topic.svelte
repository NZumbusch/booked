<script lang="ts">
  import { fold } from '../lib/domain/query';
  import { booksOnTopic } from '../lib/domain/similar';
  import { plural } from '../lib/format';
  import { olSubject, type SubjectInfo } from '../lib/metadata/subjects';
  import { addToWishlist, library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';

  let { name }: { name: string } = $props();
  const lib = library();

  const mine = $derived(
    booksOnTopic($lib.books, name).sort((a, b) => (a.writing?.year ?? a.firstPublishedYear ?? 9999) - (b.writing?.year ?? b.firstPublishedYear ?? 9999))
  );
  let info = $state<SubjectInfo>();
  let loading = $state(true);
  let failed = $state(false);

  $effect(() => {
    const topic = name;
    loading = true;
    failed = false;
    olSubject(topic).then((s) => (info = s)).catch(() => (failed = true)).finally(() => (loading = false));
  });

  /** Do I own this (by Open Library work id, or same title + first author)? */
  function owned(w: SubjectInfo['works'][number]) {
    return $lib.books.find((b) => b.identifiers?.olwork === w.olWorkId || (fold(b.title) === fold(w.title) && fold(b.authors[0] ?? '') === fold(w.authors[0] ?? '')));
  }
  const year = (b: (typeof mine)[number]) => b.writing?.year ?? b.firstPublishedYear;
</script>

<div class="page stack">
  <header>
    <span class="muted small">Topic</span>
    <h1>{name}</h1>
  </header>

  <section class="stack">
    <h2>On your shelves <span class="muted small">{mine.length}</span></h2>
    {#if mine.length === 0}
      <p class="muted small">None yet.</p>
    {:else}
      <ol class="timeline">
        {#each mine as b (b.id)}
          <li>
            <span class="yr">{year(b) ?? '—'}</span>
            <a href="#/book/{b.id}" class="tl-book"><Cover book={b} size="sm" /><span><strong>{b.title}</strong><br /><span class="muted small">{b.authors.join(', ')}{b.ownership === 'wishlist' ? ' · wishlist' : ''}</span></span></a>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  {#if loading}
    <p class="muted small">Looking up “{name}” on Open Library…</p>
  {:else if failed}
    <p class="muted small">Couldn’t reach Open Library (offline?). Your own books are above.</p>
  {:else if info}
    {#if info.related.length}
      <section class="stack">
        <h2>Related topics</h2>
        <div class="row">{#each info.related as r (r.name)}<a class="chip" href="#/topic/{encodeURIComponent(r.name)}">{r.name}</a>{/each}</div>
      </section>
    {/if}
    <section class="stack">
      <h2>Well-known books on this topic</h2>
      <p class="muted small">{plural(info.workCount, 'book')} on Open Library; the most widely published first.</p>
      <ul class="works">
        {#each info.works as w (w.olWorkId)}
          {@const have = owned(w)}
          <li class="card work">
            <Cover book={{ title: w.title, authors: w.authors, cover: w.cover }} size="sm" />
            <div class="text">
              <strong>{w.title}</strong>
              <span class="muted small">{w.authors.join(', ')}{w.year ? ` · ${w.year}` : ''}</span>
            </div>
            {#if have}
              <a class="btn btn-sm" href="#/book/{have.id}">{have.ownership === 'wishlist' ? 'On wishlist' : '✓ Yours'}</a>
            {:else}
              <button class="btn-sm" onclick={() => addToWishlist(w)}>+ Wishlist</button>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="muted small">Open Library has no topic page for “{name}”. Topics from German catalogues often only exist in German; try a related English term.</p>
  {/if}
</div>

<style>
  h2 { display: flex; gap: 8px; align-items: baseline; margin: 8px 0 0; }
  .timeline { list-style: none; margin: 0; padding: 0 0 0 8px; border-left: 2px solid var(--line); display: grid; gap: 10px; }
  .timeline li { display: grid; grid-template-columns: 48px 1fr; gap: 10px; align-items: center; position: relative; }
  .timeline li::before { content: ''; position: absolute; left: -14px; width: 10px; height: 10px; border-radius: 50%; background: var(--chart-bar); }
  .yr { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.85rem; }
  .tl-book { display: flex; gap: 10px; align-items: center; text-decoration: none; }
  .works { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .work { display: flex; gap: 12px; align-items: center; padding: 10px 12px; }
  .text { flex: 1; display: grid; min-width: 0; }
</style>

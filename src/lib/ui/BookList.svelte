<script lang="ts">
  import { parseBookList, SHELF_PROMPT, type ListedBook } from '../domain/bookList';
  import type { BookDraft, Id } from '../domain/types';
  import { plural } from '../format';
  import { navigate } from '../router';
  import { attempt, enricher, library, toast } from '../stores/app';
  import LocationPicker from './LocationPicker.svelte';

  /**
   * Many books at once from a list: typed by hand, or written by any chat AI from photos of the shelf
   * (Booked writes the request; nothing is sent anywhere by Booked). Each book's details follow in the background.
   */
  let { wish = false, borrow = false }: { wish?: boolean; borrow?: boolean } = $props();

  const lib = library();
  let text = $state('');
  // svelte-ignore state_referenced_locally
  let locationId = $state<Id | null>(wish ? null : $lib.settings.defaultLocationId ?? null);
  let tags = $state('');
  let skipped = $state<Set<number>>(new Set());
  let busy = $state(false);
  let copied = $state(false);

  const rows = $derived(parseBookList(text));
  const have = $derived(rows.map((r) => lib.likelySame({ title: r.title, authors: r.authors, seriesNumber: r.seriesNumber })[0]));
  const chosen = $derived(rows.filter((_, i) => !skipped.has(i) && !have[i]));

  $effect(() => {
    void text;
    skipped = new Set();
  });

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(SHELF_PROMPT);
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } catch {
      toast('Couldn’t copy: select the request below and copy it yourself');
    }
  }

  function toggle(i: number) {
    const next = new Set(skipped);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    skipped = next;
  }

  const describe = (r: ListedBook) =>
    [r.authors.join(', '), r.publisher, r.year, r.series && `${r.series}${r.seriesNumber ? ` ${/^\d/.test(r.seriesNumber) ? 'Bd. ' : ''}${r.seriesNumber}` : ''}`].filter(Boolean).join(' · ');

  async function add() {
    if (!chosen.length) return;
    busy = true;
    const ownership = wish ? 'wishlist' : borrow ? 'borrowed' : 'owned';
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const drafts: BookDraft[] = chosen.map((r) => ({
      title: r.title, authors: r.authors, publisher: r.publisher, publishedYear: r.year, series: r.series, seriesNumber: r.seriesNumber,
      ownership, locationId: wish ? null : locationId, status: 'unread', copies: 1, tags: tagList, pendingLookup: true,
      ...(borrow ? { borrowed: { from: '', on: new Date().toISOString().slice(0, 10) } } : {})
    }));
    const label = `Added ${plural(drafts.length, 'book')}`;
    const books = await attempt(() => lib.addBooks(drafts, label), label, { undo: true });
    busy = false;
    if (!books) return;
    for (const b of books) enricher().enqueue(b.id);
    text = '';
    navigate(wish ? '/wishlist' : '/books');
  }
</script>

<div class="stack">
  <details class="card">
    <summary>📷 Read a shelf from photos (with any chat AI)</summary>
    <div class="stack inner">
      <ol class="small steps">
        <li>Take photos of the spines (or title pages), sharp and not too many books per photo.</li>
        <li>Copy the request, open any chat AI, paste it and attach the photos.</li>
        <li>Paste its answer into the box below and check the list.</li>
      </ol>
      <button class="btn-sm" onclick={copyPrompt}>{copied ? '✓ Copied' : 'Copy the request'}</button>
      <pre class="prompt">{SHELF_PROMPT}</pre>
    </div>
  </details>

  <label class="field">One book per line
    <textarea bind:value={text} rows="7" placeholder={'Theodor Fontane: Effi Briest\nFontane – Der Stechlin (Nymphenburger 1959)\nAuthor | Title | Publisher | Year | Series | Volume'}></textarea>
  </label>

  {#if rows.length}
    <ul class="rows">
      {#each rows as r, i (i)}
        <li>
          <label class="row-item" class:have={!!have[i]}>
            <input type="checkbox" checked={!skipped.has(i) && !have[i]} disabled={!!have[i]} onchange={() => toggle(i)} />
            <span class="t">
              <strong>{r.title}</strong>
              <span class="muted small">{[describe(r), have[i] && 'already in your library'].filter(Boolean).join(' · ')}</span>
            </span>
          </label>
        </li>
      {/each}
    </ul>
    <div class="card stack">
      {#if !wish}<div class="field-like"><span class="muted small">Where are they?</span><LocationPicker bind:value={locationId} locations={$lib.locations} /></div>{/if}
      <label class="field">Tags <span class="hint">comma-separated, for all</span><input bind:value={tags} /></label>
      <p class="muted small">Descriptions, topics and when each was written are looked up afterwards by title and author.</p>
      <button class="btn-primary" onclick={add} disabled={busy || !chosen.length}>{busy ? 'Adding…' : `Add ${plural(chosen.length, 'book')}`}</button>
    </div>
  {/if}
</div>

<style>
  summary { cursor: pointer; font-weight: 600; min-height: 32px; display: flex; align-items: center; }
  .inner { margin-top: 8px; }
  .steps { margin: 0; padding-left: 20px; }
  .prompt { white-space: pre-wrap; font-size: 0.75rem; background: var(--surface-2); padding: 10px; border-radius: 8px; margin: 0; max-height: 160px; overflow: auto; }
  .hint { font-size: 0.75rem; opacity: 0.8; }
  .field-like { display: grid; gap: 4px; }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .row-item { display: grid; grid-template-columns: auto 1fr; gap: 10px; align-items: start; padding: 8px 12px; background: var(--surface); border-radius: var(--radius); cursor: pointer; }
  .row-item input { margin-top: 3px; width: 20px; height: 20px; }
  .row-item.have { opacity: 0.55; }
  .t { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
</style>

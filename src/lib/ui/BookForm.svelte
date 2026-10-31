<script lang="ts">
  import { splitList } from '../domain/book';
  import type { Book, BookDraft, BookFormat, Location, ReadingStatus } from '../domain/types';
  import { FORMAT_LABEL, STATUS_LABEL } from '../format';
  import { fileToCoverDataUrl } from '../images';
  import Cover from './Cover.svelte';
  import LocationPicker from './LocationPicker.svelte';
  import Rating from './Rating.svelte';

  let { initial, locations, submitLabel = 'Save', onsubmit, oncancel }: {
    initial: Partial<Book>;
    locations: Location[];
    submitLabel?: string;
    onsubmit: (draft: BookDraft) => void;
    oncancel?: () => void;
  } = $props();

  // Local editable copy; list fields are edited as comma-separated text.
  // svelte-ignore state_referenced_locally
  let b = $state<Partial<Book>>(structuredClone($state.snapshot(initial)));
  const joined = (xs?: string[]) => (xs ?? []).join(', ');
  // svelte-ignore state_referenced_locally
  let lists = $state({
    authors: joined(initial.authors), genres: joined(initial.genres), tags: joined(initial.tags),
    collections: joined(initial.collections), subjects: joined(initial.subjects), contributors: joined(initial.contributors)
  });
  // svelte-ignore state_referenced_locally
  let listAmount = $state<number | undefined>(initial.listPrice?.amount);
  // svelte-ignore state_referenced_locally
  let listCurrency = $state(initial.listPrice?.currency ?? 'EUR');
  // svelte-ignore state_referenced_locally
  let lending = $state({ to: initial.lending?.to ?? '', lentOn: initial.lending?.lentOn ?? '', dueOn: initial.lending?.dueOn ?? '' });

  const num = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const draft: BookDraft = {
      ...$state.snapshot(b),
      title: b.title ?? '',
      authors: splitList(lists.authors),
      genres: splitList(lists.genres),
      tags: splitList(lists.tags),
      collections: splitList(lists.collections),
      subjects: splitList(lists.subjects),
      contributors: splitList(lists.contributors),
      publishedYear: num(b.publishedYear),
      firstPublishedYear: num(b.firstPublishedYear),
      pageCount: num(b.pageCount),
      price: num(b.price),
      copies: num(b.copies) ?? 1,
      listPrice: num(listAmount) !== undefined
        ? (num(listAmount) === initial.listPrice?.amount && listCurrency === initial.listPrice?.currency
          ? initial.listPrice
          : { amount: num(listAmount)!, currency: listCurrency, source: 'manual' })
        : undefined,
      lending: lending.to.trim()
        ? { to: lending.to.trim(), lentOn: lending.lentOn || new Date().toISOString().slice(0, 10), dueOn: str(lending.dueOn) }
        : undefined
    };
    for (const k of ['subtitle', 'publisher', 'edition', 'language', 'description', 'notes', 'condition', 'isbn10', 'isbn13',
      'startedOn', 'finishedOn', 'purchasedOn', 'series', 'seriesNumber', 'line', 'volume', 'cover'] as const) {
      (draft as Record<string, unknown>)[k] = str(draft[k]);
    }
    onsubmit(draft);
  }

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) b.cover = await fileToCoverDataUrl(file);
  }
</script>

<form onsubmit={submit} class="stack">
  <section class="card stack">
    <div class="head">
      <Cover book={{ title: b.title || 'Untitled', authors: splitList(lists.authors), cover: b.cover }} />
      <div class="stack">
        <label class="field">Title *<input bind:value={b.title} required autocomplete="off" /></label>
        <label class="field">Authors <span class="hint">comma-separated</span><input bind:value={lists.authors} autocomplete="off" /></label>
      </div>
    </div>
    <label class="field">Subtitle<input bind:value={b.subtitle} /></label>
    <div class="grid">
      <label class="field">ISBN-13<input bind:value={b.isbn13} inputmode="numeric" /></label>
      <label class="field">ISBN-10<input bind:value={b.isbn10} /></label>
      <label class="field">Publisher<input bind:value={b.publisher} /></label>
      <label class="field">Year<input type="number" bind:value={b.publishedYear} inputmode="numeric" /></label>
      <label class="field">Format
        <select bind:value={b.format}>
          <option value={undefined}>—</option>
          {#each Object.entries(FORMAT_LABEL) as [v, l]}<option value={v as BookFormat}>{l}</option>{/each}
        </select>
      </label>
      <label class="field">Pages<input type="number" min="0" bind:value={b.pageCount} inputmode="numeric" /></label>
    </div>
  </section>

  <section class="card stack">
    <h3>Where is it?</h3>
    <LocationPicker bind:value={b.locationId} {locations} />
    <div class="grid">
      <label class="field">Status
        <select bind:value={b.status}>
          {#each Object.entries(STATUS_LABEL) as [v, l]}<option value={v as ReadingStatus}>{l}</option>{/each}
        </select>
      </label>
      <label class="field">Owned / wishlist
        <select bind:value={b.ownership}>
          <option value="owned">Owned</option>
          <option value="wishlist">Wishlist</option>
        </select>
      </label>
    </div>
    <div class="field-like"><span class="muted small">Rating</span><Rating bind:value={b.rating} /></div>
    <label class="field">Tags <span class="hint">comma-separated</span><input bind:value={lists.tags} /></label>
  </section>

  <details class="card">
    <summary>More details</summary>
    <div class="stack inner">
      <div class="grid">
        <label class="field">Edition<input bind:value={b.edition} /></label>
        <label class="field">Language<input bind:value={b.language} placeholder="e.g. en" /></label>
        <label class="field">First published<input type="number" bind:value={b.firstPublishedYear} /></label>
        <label class="field">Series<input bind:value={b.series} /></label>
        <label class="field">No. in series<input bind:value={b.seriesNumber} /></label>
        <label class="field">Publisher line (e.g. dtv, Reclam)<input bind:value={b.line} /></label>
        <label class="field">Volume (if the work has several, e.g. 2)<input bind:value={b.volume} /></label>
      </div>
      <label class="field">Genres <span class="hint">comma-separated</span><input bind:value={lists.genres} /></label>
      <label class="field">Subjects / topics<input bind:value={lists.subjects} /></label>
      <label class="field">Contributors <span class="hint">e.g. Jane Doe (translator)</span><input bind:value={lists.contributors} /></label>
      <label class="field">Description<textarea bind:value={b.description} rows="5"></textarea></label>
      <div class="grid">
        <label class="field">Cover image URL<input bind:value={b.cover} type="url" placeholder="https://…" /></label>
        <label class="field">…or upload a photo<input type="file" accept="image/*" onchange={upload} /></label>
      </div>
    </div>
  </details>

  <details class="card">
    <summary>My copy</summary>
    <div class="stack inner">
      <label class="field">Collections <span class="hint">comma-separated</span><input bind:value={lists.collections} /></label>
      <div class="grid">
        <label class="field">Started<input type="date" bind:value={b.startedOn} /></label>
        <label class="field">Finished<input type="date" bind:value={b.finishedOn} /></label>
        <label class="field">Condition<input bind:value={b.condition} placeholder="e.g. Very good" /></label>
        <label class="field">Copies<input type="number" min="1" bind:value={b.copies} /></label>
        <label class="field">Purchased<input type="date" bind:value={b.purchasedOn} /></label>
        <label class="field">Price paid<input type="number" min="0" step="0.01" bind:value={b.price} /></label>
        <label class="field">List price<input type="number" min="0" step="0.01" bind:value={listAmount} /></label>
        <label class="field">List price currency
          <select bind:value={listCurrency}>{#each ['EUR', 'CHF', 'GBP', 'USD', 'CAD', 'AUD', 'NZD'] as c}<option>{c}</option>{/each}</select>
        </label>
      </div>
      <label class="check"><input type="checkbox" bind:checked={b.signed} /> Signed copy</label>
      <label class="field">Notes<textarea bind:value={b.notes} rows="4"></textarea></label>
    </div>
  </details>

  <details class="card" open={!!lending.to}>
    <summary>Lending</summary>
    <div class="grid inner">
      <label class="field">Lent to<input bind:value={lending.to} placeholder="Name" /></label>
      <label class="field">Date lent<input type="date" bind:value={lending.lentOn} /></label>
      <label class="field">Due<input type="date" bind:value={lending.dueOn} /></label>
    </div>
  </details>

  <div class="actions">
    {#if oncancel}<button type="button" onclick={oncancel}>Cancel</button>{/if}
    <button type="submit" class="btn-primary">{submitLabel}</button>
  </div>
</form>

<style>
  .head { display: grid; grid-template-columns: 96px 1fr; gap: 16px; align-items: start; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
  .hint { font-size: 0.75rem; opacity: 0.8; }
  .field-like { display: grid; gap: 2px; }
  summary { cursor: pointer; font-weight: 600; min-height: 32px; display: flex; align-items: center; }
  .inner { margin-top: 12px; }
  .actions {
    position: sticky; bottom: calc(var(--nav-h) + 8px + env(safe-area-inset-bottom)); display: flex; gap: 8px; justify-content: flex-end;
    padding: 8px; background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(8px); border-radius: 999px;
  }
</style>

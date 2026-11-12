<script lang="ts">
  import { onMount } from 'svelte';
  import { dnbSetVolumes, type DnbHit } from '../metadata/dnb';
  import { groupSets, volumeDraft, volumeLabel, type EditionSet, type SetVolume } from '../metadata/dnbSets';
  import type { Book, BookDraft, Id } from '../domain/types';
  import { displayTitle } from '../domain/book';
  import { plural } from '../format';
  import { attempt, enricher, library, photoCover } from '../stores/app';
  import LocationPicker from './LocationPicker.svelte';

  /**
   * A multi-volume edition from the DNB as a checklist: tick the volumes you own, choose the room once,
   * and they're all added in one step (undoable). Details about each work follow in the background.
   */
  let { set: initialSet, ownership = 'owned', ondone }: {
    set: EditionSet;
    ownership?: 'owned' | 'wishlist' | 'borrowed';
    ondone: (added: Book[]) => void;
  } = $props();

  const lib = library();
  // svelte-ignore state_referenced_locally
  let set = $state.raw<EditionSet>(initialSet);
  let loading = $state(true);
  let loadError = $state('');
  // svelte-ignore state_referenced_locally
  let seriesName = $state(initialSet.title);
  // svelte-ignore state_referenced_locally
  let locationId = $state<Id | null>(ownership === 'wishlist' ? null : $lib.settings.defaultLocationId ?? null);
  let tags = $state('');
  let cover = $state<string>();
  let busy = $state(false);

  const keyOf = (v: SetVolume) => v.hit.result.fields.identifiers?.dnb ?? `${v.number}|${v.part}|${v.title}`;
  /** Volumes already in the library (same DNB record, or same title, author and number). */
  const owned = $derived(new Map(set.volumes.map((v) => {
    const d = volumeDraft(v, '');
    const same = lib.likelySame({ title: d.title ?? '', authors: d.authors ?? [], volume: d.volume, seriesNumber: d.seriesNumber, identifiers: d.identifiers });
    return [keyOf(v), same[0]] as const;
  }).filter(([, b]) => !!b)));
  let picked = $state<Set<string>>(new Set());

  onMount(async () => {
    picked = new Set(set.volumes.map(keyOf).filter((k) => !owned.has(k)));
    try {
      // The search only found some volumes: ask for the whole set.
      const more: DnbHit[] = await dnbSetVolumes({ title: set.title, author: set.author, publisher: set.publisher }, fetch.bind(globalThis));
      const full = groupSets([...set.volumes.map((v) => v.hit), ...more]).find((s) => s.key === set.key);
      if (full && full.volumes.length > set.volumes.length) {
        const before = new Set(set.volumes.map(keyOf));
        set = full;
        const next = new Set(picked);
        for (const v of full.volumes) if (!before.has(keyOf(v)) && !owned.has(keyOf(v))) next.add(keyOf(v));
        picked = next;
      }
    } catch {
      loadError = 'Couldn’t ask the DNB for the other volumes; showing the ones found.';
    } finally {
      loading = false;
    }
  });

  function toggle(k: string) {
    const next = new Set(picked);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    picked = next;
  }
  const allOn = $derived(set.volumes.every((v) => owned.has(keyOf(v)) || picked.has(keyOf(v))));
  function toggleAll() {
    picked = allOn ? new Set() : new Set(set.volumes.map(keyOf).filter((k) => !owned.has(k)));
  }

  async function upload(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (file) cover = await photoCover(file);
  }

  const chosen = $derived(set.volumes.filter((v) => picked.has(keyOf(v))));

  async function add() {
    if (!chosen.length) return;
    busy = true;
    const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const drafts: BookDraft[] = chosen.map((v) => {
      const d = volumeDraft(v, seriesName);
      return {
        ...d,
        title: d.title ?? v.title,
        authors: d.authors ?? [],
        ownership,
        locationId: ownership === 'wishlist' ? null : locationId,
        status: 'unread',
        copies: 1,
        tags: tagList,
        ...(cover ? { cover } : {}),
        pendingLookup: true
      } as BookDraft;
    });
    const label = `Added ${plural(drafts.length, 'volume')} of ${seriesName || set.title}`;
    const books = await attempt(() => lib.addBooks(drafts, label), label, { undo: true });
    busy = false;
    if (!books) return;
    for (const b of books) enricher().enqueue(b.id);
    ondone(books);
  }
</script>

<section class="stack">
  <div class="card stack">
    <div>
      <h2>{set.title}</h2>
      <p class="muted small">
        {[set.author, set.publisher, set.firstYear && (set.lastYear && set.lastYear !== set.firstYear ? `${set.firstYear}–${set.lastYear}` : set.firstYear)].filter(Boolean).join(' · ')}
      </p>
    </div>
    <label class="field">Series name in your library
      <input bind:value={seriesName} placeholder="e.g. Sämtliche Werke" />
    </label>
    {#if ownership !== 'wishlist'}
      <div class="field-like"><span class="muted small">Where are they?</span><LocationPicker bind:value={locationId} locations={$lib.locations} /></div>
    {/if}
    <label class="field">Tags <span class="hint">comma-separated, for all volumes</span><input bind:value={tags} /></label>
    <label class="field">Same cover photo for all (optional)<input type="file" accept="image/*" onchange={upload} /></label>
    {#if cover}<p class="muted small">✓ Photo will be used for every volume</p>{/if}
  </div>

  <div class="spread">
    <strong>{loading ? 'Looking for all volumes…' : plural(set.volumes.length, 'volume')}</strong>
    <button class="btn-sm" onclick={toggleAll} disabled={loading}>{allOn ? 'None' : 'All'}</button>
  </div>
  {#if loadError}<p class="muted small">{loadError}</p>{/if}

  <ul class="vols">
    {#each set.volumes as v (keyOf(v))}
      {@const have = owned.get(keyOf(v))}
      <li>
        <label class="vol" class:have={!!have}>
          <input type="checkbox" checked={picked.has(keyOf(v))} disabled={!!have} onchange={() => toggle(keyOf(v))} />
          <span class="num">{volumeLabel(v) || '–'}</span>
          <span class="t">
            <span>{v.title}</span>
            <span class="muted small">{[v.year, have && `already in your library (${displayTitle(have)})`].filter(Boolean).join(' · ')}</span>
          </span>
        </label>
      </li>
    {/each}
  </ul>

  <div class="actions">
    <button class="btn-primary" onclick={add} disabled={busy || !chosen.length}>
      {busy ? 'Adding…' : `Add ${plural(chosen.length, 'volume')}`}
    </button>
  </div>
</section>

<style>
  h2 { margin: 0; font-size: 1.15rem; }
  .hint { font-size: 0.75rem; opacity: 0.8; }
  .field-like { display: grid; gap: 4px; }
  .vols { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .vol { display: grid; grid-template-columns: auto 5.5em 1fr; gap: 10px; align-items: start; padding: 10px 12px; background: var(--surface); border-radius: var(--radius); cursor: pointer; }
  .vol input { margin-top: 3px; width: 20px; height: 20px; }
  .vol.have { opacity: 0.55; cursor: default; }
  .num { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.9rem; padding-top: 1px; }
  .t { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
  .actions {
    position: sticky; bottom: calc(var(--nav-h) + 8px + env(safe-area-inset-bottom)); display: flex; justify-content: flex-end;
    padding: 8px; background: color-mix(in srgb, var(--bg) 85%, transparent); backdrop-filter: blur(8px); border-radius: 999px;
  }
</style>

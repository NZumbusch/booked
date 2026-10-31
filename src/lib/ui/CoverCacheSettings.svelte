<script lang="ts">
  import { booksWithoutCover, booksWithoutSeries, findMissingCovers, type CoverSearchProgress } from '../services/coverSearch';
  import { COVER_SIZES, estimateBytes, formatBytes, type CoverSize } from '../covers/sizes';
  import type { CacheMode } from '../covers/policy';
  import { plural } from '../format';
  import { attempt, coverContext, covers, library, toast } from '../stores/app';
  import Confirm from './Confirm.svelte';
  import CoverDownload from './CoverDownload.svelte';

  const lib = library();
  const cache = covers();
  const status = cache.status;
  const s = $derived($lib.settings.covers ?? {});
  let clearOpen = $state(false);

  const update = (patch: { mode?: CacheMode; size?: CoverSize; helper?: 'small' | 'off' }) => attempt(() => lib.updateSettings({ covers: { ...s, ...patch } }));
  const missingCovers = $derived($lib && booksWithoutCover($lib.books, (u) => cache.isBroken(u)).length);
  // Remember which books the library already answered for, so they aren't asked again.
  const CHECKED_KEY = 'booked.seriesChecked2';
  const checkedIds = (() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(CHECKED_KEY) ?? '[]'));
    } catch {
      return new Set<string>();
    }
  })();
  const checked = {
    has: (id: string) => checkedIds.has(id),
    add: (id: string) => {
      checkedIds.add(id);
      try {
        localStorage.setItem(CHECKED_KEY, JSON.stringify([...checkedIds]));
      } catch {
        // fine: they'll just be asked again next time
      }
    }
  };
  const missingSeries = $derived($lib && booksWithoutSeries($lib.books, checked).length);
  let search = $state<CoverSearchProgress>();
  let searching = $state(false);
  let abort: AbortController | undefined;
  async function findCovers() {
    abort = new AbortController();
    searching = true;
    try {
      const r = await findMissingCovers(lib, {
        context: coverContext(), seriesChecked: checked, signal: abort.signal, isBroken: (u) => cache.isBroken(u), onProgress: (p) => (search = p)
      });
      toast(r.found ? `Found ${plural(r.found, 'cover')}` : 'No new covers found');
      cache.run().catch(() => {});
    } finally {
      searching = false;
    }
  }
  const measured = $derived($status && cache.measured());

</script>

<section class="card stack" id="covers">
  <h2>Covers on this device</h2>
  <p class="muted small">Covers are saved on this device: they show offline, load instantly and power the colours of the cover wall.</p>

  <label class="field">Download
    <select value={s.mode ?? 'wifi'} onchange={(e) => update({ mode: e.currentTarget.value as CacheMode })}>
      <option value="wifi">Only on Wi-Fi (recommended)</option>
      <option value="any">On any connection</option>
      <option value="off">Off (always load from the internet)</option>
    </select>
  </label>

  <label class="field">Covers the browser can’t download directly (Google Books)
    <select value={s.helper ?? 'small'} onchange={(e) => update({ helper: e.currentTarget.value as 'small' | 'off' })}>
      <option value="small">Via my Cloudflare helper, small images only (≈ 10–20 KB each)</option>
      <option value="off">Never via the helper (always from the internet; not saved, not on the cover wall)</option>
    </select>
  </label>
  <p class="muted small">Most covers come straight from the source to this device. Google doesn’t allow that for saving, so those few go through your helper, as small thumbnails only. Looking at covers, comparing them and choosing a cover never uses the helper.</p>

  <fieldset class="sizes">
    <legend class="small muted">Resolution (estimated storage for your {plural($status.total, 'cover')})</legend>
    {#each Object.entries(COVER_SIZES) as [key, opt] (key)}
      <label class="size" class:on={(s.size ?? 'medium') === key}>
        <input type="radio" name="cover-size" value={key} checked={(s.size ?? 'medium') === key} onchange={() => update({ size: key as CoverSize })} />
        <span><strong>{opt.label}</strong> <span class="muted small">· {opt.px} px</span></span>
        <span class="est">≈ {formatBytes(estimateBytes($status.total, key as CoverSize, measured))}</span>
      </label>
    {/each}
    <p class="muted small">Never upscaled: covers stay at the size the catalogue has (often around 500 px).</p>
  </fieldset>

  <p class="small">
    {#if $status.running}Downloading… {/if}
    <strong>{$status.cached.toLocaleString()}</strong> of {$status.total.toLocaleString()} covers saved · {formatBytes($status.bytes)}
    {#if $status.cached > $status.current} · {$status.cached - $status.current} to resize{/if}
    {#if $status.failed} · {$status.failed} unavailable{/if}
  </p>
  {#if $status.decision === 'ask' && $status.current < $status.total}
    <p class="muted small">This device can’t tell whether it’s on Wi-Fi. Tap below when you are.</p>
  {:else if $status.decision === 'no' && $status.current < $status.total && (s.mode ?? 'wifi') !== 'off'}
    <p class="muted small">Waiting for Wi-Fi.</p>
  {/if}
  <div class="row">
    <CoverDownload disabled={$status.running || (s.mode ?? 'wifi') === 'off' || $status.current >= $status.total}>Download now</CoverDownload>
    <button disabled={!$status.cached} onclick={() => (clearOpen = true)}>Remove saved covers</button>
  </div>

  <div class="stack find">
    <strong>Books without a cover or series</strong>
    <p class="muted small">
      {missingCovers ? `${plural(missingCovers, 'book')} have no usable cover.` : 'Every book has a cover.'}
      {missingSeries ? `${plural(missingSeries, 'book')} may still be missing their series.` : ''}
      First reads series and volume numbers (German National Library), then searches covers by ISBN and across other editions, so volumes of a series get covers that look alike. One book after another.
    </p>
    {#if searching && search}
      <p class="small">{search.phase === 'series' ? 'Reading series' : 'Searching covers'}: {Math.min(search.done + 1, search.total)} of {search.total} · found {search.found}<br /><span class="muted">{search.current}</span></p>
      <div><button onclick={() => abort?.abort()}>Stop</button></div>
    {:else}
      <div class="row">
        <button class="btn-primary" disabled={!missingCovers && !missingSeries} onclick={findCovers}>Find missing covers &amp; series</button>
        <a class="btn" href="#/review">Review one by one…</a>
      </div>
      <p class="muted small">Prefer to decide yourself? “Review one by one” shows each book with its series, a suggested cover and similar alternatives.</p>
    {/if}
  </div>
</section>

<Confirm bind:open={clearOpen} title="Remove saved covers?" confirmLabel="Remove"
  message="Frees {formatBytes($status.bytes)} on this device. Covers then load from the internet again (and are re-saved per your setting)."
  onconfirm={() => cache.clear()} />

<style>
  .sizes { border: none; padding: 0; margin: 0; display: grid; gap: 6px; }
  .size { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding: 8px 12px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
  .size.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
  .size input { width: 20px; min-height: 20px; }
  .est { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.9rem; }
  .find { border-top: 1px solid var(--line); padding-top: 12px; }
  p { margin: 0; }
</style>

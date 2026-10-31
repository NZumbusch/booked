<script lang="ts">
  import { COVER_SIZES, estimateBytes, formatBytes, type CoverSize } from '../covers/sizes';
  import type { CacheMode } from '../covers/policy';
  import { plural } from '../format';
  import { attempt, covers, library, toast } from '../stores/app';
  import Confirm from './Confirm.svelte';

  const lib = library();
  const cache = covers();
  const status = cache.status;
  const s = $derived($lib.settings.covers ?? {});
  let clearOpen = $state(false);

  const update = (patch: { mode?: CacheMode; size?: CoverSize }) => attempt(() => lib.updateSettings({ covers: { ...s, ...patch } }));
  const measured = $derived($status && cache.measured());

  async function downloadNow() {
    toast('Downloading covers…');
    await cache.run(true);
    toast('Covers saved on this device');
  }
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
    <button class="btn-primary" disabled={$status.running || (s.mode ?? 'wifi') === 'off' || $status.current >= $status.total} onclick={downloadNow}>Download now</button>
    <button disabled={!$status.cached} onclick={() => (clearOpen = true)}>Remove saved covers</button>
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
  p { margin: 0; }
</style>

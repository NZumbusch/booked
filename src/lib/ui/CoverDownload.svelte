<script lang="ts">
  import type { Snippet } from 'svelte';
  import { get } from 'svelte/store';
  import { estimateBytes, formatBytes } from '../covers/sizes';
  import { plural } from '../format';
  import { navigate } from '../router';
  import { covers, library, toast } from '../stores/app';
  import Dialog from './Dialog.svelte';

  /**
   * A "download covers" button that always does something visible: downloads right away on
   * Wi-Fi, explains when offline or turned off, and otherwise asks before using mobile data,
   * with the estimated size.
   */
  let { class: cls = 'btn-primary', disabled = false, children }: { class?: string; disabled?: boolean; children: Snippet } = $props();

  const lib = library();
  const cache = covers();
  const status = cache.status;
  let open = $state(false);
  const missing = $derived(Math.max(0, $status.total - $status.current));
  const estimate = $derived(formatBytes(estimateBytes(missing, $lib.settings.covers?.size ?? 'medium', cache.measured())));

  async function download(force: true | 'mobile') {
    open = false;
    toast(`Downloading ${plural(missing, 'cover')}…`);
    await cache.run(force);
    const now = get(cache.status);
    const left = Math.max(0, now.total - now.current);
    toast(left ? `${plural(left, 'cover')} couldn't be saved (not available or connection lost)` : 'Covers saved on this device');
  }

  function start() {
    if (!navigator.onLine) return toast("You're offline: covers download once you're back online");
    if (($lib.settings.covers?.mode ?? 'wifi') === 'off') {
      toast('Saving covers is turned off');
      return navigate('/settings', {});
    }
    if ($status.decision === 'yes') download(true);
    else open = true;
  }
</script>

<button class={cls} {disabled} onclick={start}>{@render children()}</button>

<Dialog bind:open title="Download covers now?">
  <p>
    {#if $status.decision === 'no'}This doesn't look like Wi-Fi.{:else}This device can't tell whether it's on Wi-Fi.{/if}
    Downloading {plural(missing, 'cover')} uses about <strong>{estimate}</strong> of data.
  </p>
  <p class="muted small">Covers are saved at your chosen resolution ({$lib.settings.covers?.size ?? 'medium'}). You can change it in Settings.</p>
  {#snippet actions()}
    <button onclick={() => (open = false)}>Wait for Wi-Fi</button>
    <button class="btn-primary" onclick={() => download('mobile')}>Download ({estimate})</button>
  {/snippet}
</Dialog>

<style>
  p { margin: 0; }
</style>

<script lang="ts">
  import { estimateBytes, formatBytes } from '../covers/sizes';
  import { plural } from '../format';
  import { covers, library, toast } from '../stores/app';

  /** iPhone & co. can't tell if they're on Wi-Fi: ask once per session before downloading covers. */
  const lib = library();
  const cache = covers();
  const status = cache.status;
  let dismissed = $state(sessionStorage.getItem('booked.coverPrompt') === 'no');
  const missing = $derived($status.total - $status.current);
  const show = $derived(!dismissed && $status.decision === 'ask' && missing >= 10 && !$status.running);

  function later() {
    dismissed = true;
    try {
      sessionStorage.setItem('booked.coverPrompt', 'no');
    } catch {
      // fine
    }
  }
  async function go() {
    dismissed = true;
    await cache.run(true);
    toast('Covers saved on this device');
  }
</script>

{#if show}
  <div class="card prompt">
    <p class="small">Save {plural(missing, 'cover')} on this device for offline use and the cover wall? About {formatBytes(estimateBytes(missing, $lib.settings.covers?.size ?? 'medium', cache.measured()))}. Best on Wi-Fi.</p>
    <div class="row">
      <button class="btn-sm btn-primary" onclick={go}>Download now</button>
      <button class="btn-sm btn-ghost" onclick={later}>Not now</button>
    </div>
  </div>
{/if}

<style>
  .prompt { display: grid; gap: 8px; background: color-mix(in srgb, var(--brand) 10%, var(--surface)); }
  p { margin: 0; }
</style>

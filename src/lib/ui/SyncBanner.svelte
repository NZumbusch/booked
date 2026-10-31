<script lang="ts">
  import { library, sync, toast } from '../stores/app';

  const lib = library();
  const status = sync().status;
  let busy = $state(false);
  const show = $derived(!!$lib.settings.sync?.enabled && !!$lib.settings.sync.lastSyncAt && $status.state === 'needs-auth');

  async function reconnect() {
    busy = true;
    try {
      await sync().connect();
      toast('Synced with Google Drive');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

{#if show}
  <div class="card banner">
    <span class="small">Google Drive sync is paused.</span>
    <button class="btn-sm btn-primary" disabled={busy} onclick={reconnect}>Reconnect</button>
  </div>
{:else if $status.state === 'error' && $lib.settings.sync?.enabled}
  <div class="card banner"><span class="small">Sync problem: {$status.message}</span><a class="btn btn-sm" href="#/settings">Details</a></div>
{/if}

<style>
  .banner { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; background: color-mix(in srgb, var(--warn) 12%, var(--surface)); }
</style>

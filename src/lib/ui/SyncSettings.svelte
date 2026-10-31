<script lang="ts">
  import { formatDate } from '../format';
  import { attempt, library, sync, toast } from '../stores/app';

  const lib = library();
  const controller = sync();
  const status = controller.status;
  const s = $derived($lib.settings);
  // svelte-ignore state_referenced_locally
  let clientId = $state(s.sync?.clientId ?? '');
  let busy = $state(false);

  const OUTCOME = { unchanged: 'Already up to date', pulled: 'Updated from Google Drive', pushed: 'Saved to Google Drive', both: 'Synced both ways' };

  async function save() {
    await attempt(() => lib.updateSettings({ sync: { ...s.sync, clientId: clientId.trim() || undefined, enabled: !!clientId.trim() } }));
  }

  async function run(fn: () => Promise<keyof typeof OUTCOME | undefined | void>) {
    busy = true;
    try {
      const outcome = await fn();
      if (outcome) toast(OUTCOME[outcome]);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }

  const when = (iso: string | undefined) =>
    iso ? `${formatDate(iso, s.dateFormat)} ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'never';
</script>

<section class="card stack" id="sync">
  <h2>Sync with Google Drive</h2>
  <p class="muted small">
    Keeps your library the same on all your devices. It's stored in Booked's private folder on your Google Drive (invisible in
    “My Drive”, and Booked can’t see your other files). Changes from different devices are merged book by book.
    Needs a free one-time setup: <a href="https://github.com/nzumbusch/booked#google-drive-sync-setup" target="_blank" rel="noopener">how to get a client ID ↗</a>
  </p>
  <form class="row add" onsubmit={(e) => { e.preventDefault(); save(); }}>
    <input bind:value={clientId} placeholder="…apps.googleusercontent.com" autocomplete="off" spellcheck="false" aria-label="Google OAuth client ID" />
    <button type="submit" disabled={clientId.trim() === (s.sync?.clientId ?? '')}>Save</button>
  </form>

  {#if s.sync?.enabled && s.sync.clientId}
    <p class="small status {$status.state}">
      {#if $status.state === 'syncing'}Syncing…
      {:else if $status.state === 'needs-auth'}Not connected{#if $status.lastSyncAt} · last synced {when($status.lastSyncAt)}{/if}
      {:else if $status.state === 'error'}Sync problem: {$status.message}
      {:else}Connected ✓ · last synced {when($status.lastSyncAt ?? s.sync.lastSyncAt)}{/if}
    </p>
    <div class="row">
      {#if $status.state === 'needs-auth' || !controller.connected}
        <button class="btn-primary" disabled={busy} onclick={() => run(() => controller.connect())}>
          {s.sync.lastSyncAt ? 'Reconnect' : 'Connect Google Drive'}
        </button>
      {:else}
        <button class="btn-primary" disabled={busy || $status.state === 'syncing'} onclick={() => run(() => controller.syncNow())}>Sync now</button>
        <button disabled={busy} onclick={() => run(() => controller.disconnect())}>Disconnect</button>
      {/if}
    </div>
    <p class="muted small">Syncs automatically when the app opens, a few seconds after changes, and every few minutes. Google sign-ins last about an hour; after that, tap Reconnect.</p>
  {/if}
</section>

<style>
  .add input { flex: 1; width: auto; }
  .status { margin: 0; }
  .status.error { color: var(--danger); }
  .status.needs-auth { color: var(--warn); }
</style>

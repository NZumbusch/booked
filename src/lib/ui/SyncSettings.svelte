<script lang="ts">
  import { formatDate } from '../format';
  import { attempt, library, sync, toast } from '../stores/app';

  const lib = library();
  const controller = sync();
  const status = controller.status;
  const s = $derived($lib.settings);
  // svelte-ignore state_referenced_locally
  let clientId = $state(s.sync?.clientId ?? '');
  // svelte-ignore state_referenced_locally
  let helperUrl = $state(s.sync?.helperUrl ?? '');
  // Own state: a settings update (e.g. after each sync) must not snap the panel shut.
  // svelte-ignore state_referenced_locally
  let stayOpen = $state(!!s.sync?.helperUrl);
  const helperValid = $derived(!helperUrl.trim() || /^https:\/\/[^\s]+$/.test(helperUrl.trim()));
  let busy = $state(false);

  const update = (patch: Partial<NonNullable<typeof s.sync>>) => attempt(() => lib.updateSettings({ sync: { ...s.sync, ...patch } }));

  const OUTCOME = { unchanged: 'Already up to date', pulled: 'Updated from Google Drive', pushed: 'Saved to Google Drive', both: 'Synced both ways' };

  async function save() {
    await attempt(() => lib.updateSettings({ sync: { ...s.sync, clientId: clientId.trim() || undefined, enabled: !!clientId.trim() } }));
  }

  async function saveHelper() {
    if (!helperValid) return toast('The helper URL must start with https://');
    await attempt(() => lib.updateSettings({ sync: { ...s.sync, helperUrl: helperUrl.trim() || undefined } }),
      helperUrl.trim() ? 'Helper saved. Connect once more to stay signed in.' : 'Helper removed');
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
        <button class="btn-primary" data-sync-connect disabled={busy} onclick={() => run(() => controller.connect())}>
          {s.sync.lastSyncAt ? 'Reconnect' : 'Connect Google Drive'}
        </button>
      {:else}
        <button class="btn-primary" disabled={busy || $status.state === 'syncing'} onclick={() => run(() => controller.syncNow())}>Sync now</button>
        <button disabled={busy} onclick={() => run(() => controller.disconnect())}>Disconnect</button>
      {/if}
    </div>
    <p class="muted small">Syncs automatically when the app opens, a few seconds after changes, and every few minutes.</p>

    <details class="stay" bind:open={stayOpen}>
      <summary class="small">Stay signed in {s.sync.helperUrl ? '✓' : '(optional)'}</summary>
      <div class="stack inner">
        <p class="muted small">
          Google sign-ins from a website last about an hour. A small free helper on Cloudflare keeps you signed in
          until you disconnect. <a href="https://github.com/nzumbusch/booked#stay-signed-in-optional-token-helper" target="_blank" rel="noopener">Set it up ↗</a>
        </p>
        <form class="row add" onsubmit={(e) => { e.preventDefault(); saveHelper(); }}>
          <input bind:value={helperUrl} placeholder="https://booked-auth.….workers.dev" autocomplete="off" spellcheck="false"
            aria-label="Token helper URL" aria-invalid={!helperValid} />
          <button type="submit" disabled={helperUrl.trim() === (s.sync.helperUrl ?? '')}>Save</button>
        </form>
        {#if !s.sync.helperUrl}
          <label class="check small">
            <input type="checkbox" checked={s.sync.autoReconnect !== false}
              onchange={(e) => update({ autoReconnect: e.currentTarget.checked })} />
            Without a helper: renew the sign-in automatically on my first tap after it expired (Google’s window flashes briefly)
          </label>
        {/if}
      </div>
    </details>
  {/if}
</section>

<style>
  .add input { flex: 1; width: auto; }
  .status { margin: 0; }
  .status.error { color: var(--danger); }
  .status.needs-auth { color: var(--warn); }
  .stay summary { cursor: pointer; min-height: 36px; display: flex; align-items: center; font-weight: 600; }
  .inner { margin-top: 6px; }
</style>

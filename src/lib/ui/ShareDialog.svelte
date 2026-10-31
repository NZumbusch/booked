<script lang="ts">
  import { helperUrlOf } from '../config';
  import type { Location } from '../domain/types';
  import { saveFile } from '../files';
  import { plural } from '../format';
  import { attempt, library, spaces, toast } from '../stores/app';
  import { shareLink } from '../sync/spaces';
  import Dialog from './Dialog.svelte';

  let { open = $bindable(false), location }: { open?: boolean; location: Location } = $props();

  const lib = library();
  const ctl = spaces();
  const statuses = ctl.statuses;
  const space = $derived($lib && ctl.spaces.find((s) => s.rootLocationId === location.id));
  const link = $derived(space ? shareLink(space) : '');
  const hasHelper = $derived(!!helperUrlOf($lib.settings));
  // svelte-ignore state_referenced_locally
  let name = $state($lib.settings.userName ?? '');
  let busy = $state(false);
  let confirming = $state(false);

  async function unshare() {
    if (!space) return;
    busy = true;
    try {
      const owner = space.role === 'owner';
      const id = space.id;
      await attempt(() => (owner ? ctl.stopSharing(id) : ctl.leave(id, false)), owner ? 'Sharing stopped. The books stay in your library.' : 'Left the shared place; your copy stays.');
      confirming = false;
      open = false;
    } finally {
      busy = false;
    }
  }
  const count = $derived($lib && (lib.counts().get(location.id) ?? 0));

  async function create() {
    busy = true;
    try {
      if (name.trim() && name.trim() !== $lib.settings.userName) await lib.updateSettings({ userName: name.trim() });
      await attempt(() => ctl.share(location.id), 'Shared. Send the link to your family.');
    } finally {
      busy = false;
    }
  }

  async function send() {
    const text = `Join “${location.name}” in Booked: add and edit the books there with me.\n${link}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Booked: ${location.name}`, text });
        return;
      } catch (e) {
        if ((e as DOMException).name === 'AbortError') return;
      }
    }
    await navigator.clipboard?.writeText(link).then(() => toast('Link copied'), () => saveFile(new File([text], 'booked-share-link.txt')));
  }
</script>

<Dialog bind:open title="Share “{location.name}”">
  {#if space}
    {@const st = $statuses[space.id]}
    <p>Everyone with this link can see, add, edit and move the books in <strong>{lib.label(location.id)}</strong>.</p>
    <div class="row">
      <button class="btn-primary" onclick={send}>Send link…</button>
      <button onclick={() => navigator.clipboard?.writeText(link).then(() => toast('Link copied'))}>Copy</button>
    </div>
    <p class="muted small">
      {st?.state === 'syncing' ? 'Syncing…' : st?.state === 'error' ? `Problem: ${st.message}` : `Synced ${space.lastSyncAt ? new Date(space.lastSyncAt).toLocaleString() : '—'}`}
      · Manage under Settings › Shared places.
    </p>
    {#if confirming}
      <p>{space.role === 'owner'
        ? 'The shared copy is deleted and the link stops working for everyone. The books stay in your library; family members keep their last copy.'
        : 'You stop receiving changes. Your copy of the books stays.'}</p>
      <div class="row end">
        <button onclick={() => (confirming = false)}>Cancel</button>
        <button class="btn-danger solid" disabled={busy} onclick={unshare}>{space.role === 'owner' ? 'Stop sharing' : 'Leave'}</button>
      </div>
    {:else}
      <div class="row end"><button class="btn-danger" onclick={() => (confirming = true)}>{space.role === 'owner' ? 'Stop sharing this room' : 'Leave this shared room'}</button></div>
    {/if}
  {:else if !hasHelper}
    <p>Sharing needs the small Cloudflare helper (the same one that keeps Google Drive signed in) with its database switched on.</p>
    <p class="muted small">Set it up once (about 10 minutes): README › “Shared places”. Then paste its address under Settings › Sync › Stay signed in.</p>
    <a class="btn" href="https://github.com/nzumbusch/booked#shared-places-family" target="_blank" rel="noopener">Open instructions ↗</a>
  {:else}
    <p>Family members get <strong>{lib.label(location.id)}</strong> ({plural(count, 'book')}) in their own Booked and can add, edit and move books there. Changes sync both ways.</p>
    <ul class="small muted">
      <li>Only this {location.kind} is shared, not your other rooms. A book moved out of it leaves the shared place.</li>
      <li>Everything about these books is visible to them, including notes and ratings.</li>
      <li>Data is encrypted on your phone; the key is only in the link.</li>
    </ul>
    <label class="field">Your name (shown on books you add)<input bind:value={name} placeholder="e.g. Nils" /></label>
    <div class="row end">
      <button onclick={() => (open = false)}>Cancel</button>
      <button class="btn-primary" disabled={busy} onclick={create}>{busy ? 'Creating…' : 'Create share link'}</button>
    </div>
  {/if}
</Dialog>

<style>
  ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  p { margin: 0; }
  .end { justify-content: flex-end; }
</style>

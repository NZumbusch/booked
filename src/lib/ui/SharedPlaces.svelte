<script lang="ts">
  import { helperUrlOf } from '../config';
  import { formatDate } from '../format';
  import { attempt, library, spaces, toast } from '../stores/app';
  import { shareLink } from '../sync/spaces';
  import type { SpaceConfig } from '../domain/types';
  import Dialog from './Dialog.svelte';

  const lib = library();
  const ctl = spaces();
  const statuses = ctl.statuses;
  const list = $derived($lib.settings.spaces ?? []);
  const df = $derived($lib.settings.dateFormat);

  let leaving = $state<SpaceConfig>();
  let leaveOpen = $state(false);

  async function syncNow(id: string) {
    try {
      await ctl.syncOne(id);
      toast('Shared place synced');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    }
  }
</script>

<section class="card stack" id="shared">
  <h2>Shared places</h2>
  <label class="field">Your name (shown to family on books you add)
    <input value={$lib.settings.userName ?? ''} placeholder="e.g. Nils"
      onchange={(e) => attempt(() => lib.updateSettings({ userName: e.currentTarget.value.trim() || undefined }))} />
  </label>
  {#if !helperUrlOf($lib.settings)}
    <label class="field">Cloudflare helper address (needed to share; family members don’t need one)
      <input placeholder="https://booked-auth.….workers.dev" autocomplete="off" spellcheck="false"
        onchange={(e) => {
          const v = e.currentTarget.value.trim();
          if (v && !/^https:\/\//.test(v)) return toast('The address must start with https://');
          attempt(() => lib.updateSettings({ sync: { ...$lib.settings.sync, helperUrl: v || undefined } }), v ? 'Helper saved' : undefined);
        }} />
    </label>
    <p class="muted small"><a href="https://github.com/nzumbusch/booked#shared-places-family" target="_blank" rel="noopener">How to set up the helper ↗</a></p>
  {/if}
  {#if list.length === 0}
    <p class="muted small">Share a place or room (e.g. the family living room) so others can add and edit the books there: Places › Edit › “Share with family…”.</p>
  {:else}
    {#each list as sp (sp.id)}
      {@const st = $statuses[sp.id]}
      <div class="space">
        <div>
          <a href="#/books?loc={sp.rootLocationId}"><strong>👥 {lib.location(sp.rootLocationId) ? lib.label(sp.rootLocationId) : sp.name}</strong></a>
          <div class="small muted">
            {sp.role === 'owner' ? 'Shared by you' : 'Joined'} ·
            {#if st?.state === 'syncing'}syncing…{:else if st?.state === 'error'}<span class="err">{st.message}</span>{:else}synced {sp.lastSyncAt ? `${formatDate(sp.lastSyncAt, df)} ${new Date(sp.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'never'}{/if}
          </div>
        </div>
        <div class="row">
          <button class="btn-sm" onclick={() => syncNow(sp.id)}>Sync</button>
          {#if sp.role === 'owner'}
            <button class="btn-sm" onclick={() => navigator.clipboard?.writeText(shareLink(sp)).then(() => toast('Link copied'))}>Copy link</button>
          {/if}
          <button class="btn-sm btn-danger" onclick={() => { leaving = sp; leaveOpen = true; }}>{sp.role === 'owner' ? 'Stop' : 'Leave'}</button>
        </div>
      </div>
    {/each}
  {/if}
</section>

<Dialog bind:open={leaveOpen} title={leaving?.role === 'owner' ? 'Stop sharing?' : 'Leave shared place?'}>
  {#if leaving?.role === 'owner'}
    <p>The shared copy is deleted and the link stops working for everyone. The books stay in your library; family members keep their last copy.</p>
    <div class="row end">
      <button onclick={() => (leaveOpen = false)}>Cancel</button>
      <button class="btn-danger solid" onclick={async () => { leaveOpen = false; await attempt(() => ctl.stopSharing(leaving!.id), 'Sharing stopped'); }}>Stop sharing</button>
    </div>
  {:else if leaving}
    <p>You stop receiving changes. Keep a copy of its books in your library?</p>
    <div class="row end">
      <button onclick={async () => { leaveOpen = false; await attempt(() => ctl.leave(leaving!.id, true), 'Left and removed its books', { undo: true }); }}>Leave and remove books</button>
      <button class="btn-primary" onclick={async () => { leaveOpen = false; await attempt(() => ctl.leave(leaving!.id, false), 'Left; your copy stays'); }}>Leave, keep a copy</button>
    </div>
  {/if}
</Dialog>

<style>
  .space { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 10px; }
  .space a { text-decoration: none; }
  .err { color: var(--danger); }
  .end { justify-content: flex-end; }
  p { margin: 0; }
</style>

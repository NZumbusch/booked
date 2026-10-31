<script lang="ts">
  import { plural } from '../lib/format';
  import { navigate, route } from '../lib/router';
  import { library, spaces, toast } from '../lib/stores/app';
  import { parseJoin } from '../lib/sync/spaces';

  const lib = library();
  const ctl = spaces();
  const params = $derived(parseJoin($route.query));
  const already = $derived(params && $lib && ctl.spaces.find((s) => s.id === params.id));
  // svelte-ignore state_referenced_locally
  let name = $state($lib.settings.userName ?? '');
  let busy = $state(false);

  async function join() {
    if (!params) return;
    busy = true;
    try {
      if (name.trim()) await lib.updateSettings({ userName: name.trim() });
      await ctl.join(params);
      const inside = lib.counts().get(params.rootLocationId) ?? 0;
      toast(`Joined “${params.name}”: ${plural(inside, 'book')}`);
      navigate(`/books`, { loc: params.rootLocationId });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
    }
  }
</script>

<div class="page stack">
  <h1>Shared place</h1>
  {#if !params}
    <div class="card empty"><p>This link is incomplete. Ask for a new one.</p><a class="btn" href="#/">Home</a></div>
  {:else if already}
    <div class="card stack">
      <p>You’ve already joined <strong>{params.name}</strong>.</p>
      <a class="btn btn-primary" href="#/books?loc={params.rootLocationId}">Show its books</a>
    </div>
  {:else}
    <div class="card stack">
      <p>You’ve been invited to <strong>{params.name}</strong>.</p>
      <ul class="small muted">
        <li>Its books appear in your Booked, and you can add, edit and move books there. Changes are shared with everyone in it.</li>
        <li>Your own other places stay private.</li>
        <li>Everything is encrypted; the key is in this link, so don’t forward it to people who shouldn’t edit.</li>
      </ul>
      <label class="field">Your name (shown on books you add)<input bind:value={name} placeholder="e.g. Anna" /></label>
      <button class="btn-primary" onclick={join} disabled={busy}>{busy ? 'Joining…' : 'Join'}</button>
    </div>
  {/if}
</div>

<style>
  ul { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  p { margin: 0; }
</style>

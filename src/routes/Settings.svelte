<script lang="ts">
  import type { Settings, Snapshot } from '../lib/domain/types';
  import { attempt, library, toast } from '../lib/stores/app';
  import Confirm from '../lib/ui/Confirm.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  const lib = library();
  const s = $derived($lib.settings);

  let restoreOpen = $state(false);
  let pendingRestore = $state<Snapshot>();

  const update = (patch: Partial<Settings>) => attempt(() => lib.updateSettings(patch));

  async function exportJson() {
    const snap = await lib.exportSnapshot();
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `booked-backup-${snap.exportedAt.slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function pickRestore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      pendingRestore = JSON.parse(await file.text());
      restoreOpen = true;
    } catch {
      toast('Could not read that file');
    }
  }

  async function restore() {
    const snap = pendingRestore!;
    await attempt(() => lib.importSnapshot(snap), `Restored ${snap.books?.length ?? 0} books`);
  }
</script>

<div class="page stack">
  <h1>Settings</h1>

  <section class="card stack">
    <h2>New books</h2>
    <p class="muted small">Where new books go unless you choose otherwise.</p>
    <LocationPicker locations={$lib.locations}
      bind:value={() => s.defaultLocationId, (v) => update({ defaultLocationId: v })} />
  </section>

  <section class="card stack">
    <h2>Display</h2>
    <div class="grid">
      <label class="field">Theme
        <select value={s.theme} onchange={(e) => update({ theme: e.currentTarget.value as Settings['theme'] })}>
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label class="field">Date format
        <select value={s.dateFormat} onchange={(e) => update({ dateFormat: e.currentTarget.value as Settings['dateFormat'] })}>
          <option value="dmy">31.12.2026</option>
          <option value="mdy">12/31/2026</option>
          <option value="iso">2026-12-31</option>
        </select>
      </label>
      <label class="field">Currency
        <select value={s.currency} onchange={(e) => update({ currency: e.currentTarget.value })}>
          {#each ['EUR', 'CHF', 'GBP', 'USD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'JPY', 'CAD', 'AUD'] as c}<option>{c}</option>{/each}
        </select>
      </label>
    </div>
  </section>

  <section class="card stack">
    <h2>Backup</h2>
    <p class="muted small">Everything is stored only on this device. Export a backup now and then.</p>
    <div class="row">
      <button class="btn-primary" onclick={exportJson}>Export to file (JSON)</button>
      <label class="btn">Restore from file<input type="file" accept="application/json,.json" class="sr-only" onchange={pickRestore} /></label>
    </div>
  </section>

  <p class="muted small center">Booked {__APP_VERSION__} · works offline · your data never leaves this device</p>
</div>

<Confirm bind:open={restoreOpen} title="Replace your library?" confirmLabel="Replace"
  message="This replaces all books, locations and settings on this device with the {pendingRestore?.books?.length ?? 0} books in the backup. This cannot be undone."
  onconfirm={restore} />

<style>
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .center { text-align: center; }
</style>

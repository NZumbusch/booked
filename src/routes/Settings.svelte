<script lang="ts">
  import { onMount } from 'svelte';
  import { backupStatus, parseBackup } from '../lib/domain/backup';
  import type { Settings, Snapshot } from '../lib/domain/types';
  import { formatDate, plural } from '../lib/format';
  import { attempt, library, toast } from '../lib/stores/app';
  import BackupButton from '../lib/ui/BackupButton.svelte';
  import Confirm from '../lib/ui/Confirm.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  const lib = library();
  const s = $derived($lib.settings);
  const status = $derived(backupStatus(s.lastBackupAt, $lib.books));

  let restoreOpen = $state(false);
  let undoRestoreOpen = $state(false);
  let pendingRestore = $state.raw<Snapshot>();
  let safetyCopy = $state(false);
  let persisted = $state<boolean>();

  onMount(async () => {
    safetyCopy = await lib.hasSafetyCopy();
    persisted = await navigator.storage?.persisted?.();
  });

  const update = (patch: Partial<Settings>) => attempt(() => lib.updateSettings(patch));

  async function pickRestore(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      pendingRestore = parseBackup(await file.text());
      restoreOpen = true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not read that file');
    }
  }

  async function restore() {
    const snap = pendingRestore!;
    if (await attempt(() => lib.importSnapshot(snap).then(() => true), `Restored ${plural(snap.books.length, 'book')}`)) safetyCopy = true;
  }

  async function undoRestore() {
    if (await attempt(() => lib.undoRestore(), 'Back to your library from before the restore')) safetyCopy = false;
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
    <h2>Online lookups</h2>
    <p class="muted small">
      Book details come from Open Library and Wikidata (no limits) and Google Books. Without a key, Google’s shared free
      quota is often used up; with your own free key you get 1,000 Google lookups per day.
      <a href="https://github.com/nzumbusch/booked#google-books-api-key-optional" target="_blank" rel="noopener">How to get a key ↗</a>
    </p>
    <label class="field">Google Books API key (optional)
      <input value={s.googleBooksKey ?? ''} autocomplete="off" spellcheck="false" placeholder="AIza…"
        onchange={(e) => update({ googleBooksKey: e.currentTarget.value.trim() || undefined })} />
    </label>
  </section>

  <section class="card stack">
    <h2>Import, export & print</h2>
    <p class="muted small">CSV (Libib-compatible) for spreadsheets, Zotero/BibTeX/RIS for citations, CSV import from Libib or Goodreads, and printable lists per room.</p>
    <div class="row"><a class="btn" href="#/export">Open import & export</a></div>
  </section>

  <section class="card stack" id="backup">
    <h2>Backup</h2>
    <p class="small">
      {#if s.lastBackupAt}
        Last backup: <strong>{formatDate(s.lastBackupAt, s.dateFormat)}</strong>
        {#if status.changed}· <span class:warn={status.due}>{plural(status.changed, 'change')} since</span>{:else}· up to date ✓{/if}
      {:else if $lib.books.length}
        <span class="warn">No backup yet.</span> Your books are only stored on this device.
      {:else}
        No backup yet.
      {/if}
    </p>
    <p class="muted small">
      “Back up now” opens your phone’s share menu: choose <strong>Google Drive</strong> or <strong>Files</strong> to keep the
      backup somewhere safe. Each backup is one small file (named with date and time) that contains everything.
    </p>
    <div class="row">
      <BackupButton />
      <BackupButton label="Download file" primary={false} mode="download" />
    </div>
    <div class="row">
      <label class="btn">Restore from backup…<input type="file" accept="application/json,.json" class="sr-only" onchange={pickRestore} /></label>
      {#if safetyCopy}<button class="btn-ghost" onclick={() => (undoRestoreOpen = true)}>Undo last restore</button>{/if}
    </div>
    {#if persisted === false}
      <p class="muted small">ℹ️ Your browser may clear this app’s data if storage runs low. Installing the app to your home screen makes this much less likely. Regular backups keep you safe either way.</p>
    {/if}
  </section>

  <p class="muted small center">Booked {__APP_VERSION__} · works offline · your data never leaves this device</p>
</div>

<Confirm bind:open={restoreOpen} title="Replace your library?" confirmLabel="Replace"
  message="This replaces everything on this device with the backup from {formatDate(pendingRestore?.exportedAt, s.dateFormat)} ({plural(pendingRestore?.books.length ?? 0, 'book')}). Your current library is kept as a safety copy, so you can undo this."
  onconfirm={restore} />

<Confirm bind:open={undoRestoreOpen} title="Undo the restore?" confirmLabel="Undo restore" danger={false}
  message="Your library goes back to how it was right before the last restore."
  onconfirm={undoRestore} />

<style>
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
  .center { text-align: center; }
  .warn { color: var(--warn); font-weight: 600; }
</style>

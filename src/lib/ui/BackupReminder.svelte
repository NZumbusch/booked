<script lang="ts">
  import { backupStatus } from '../domain/backup';
  import { plural } from '../format';
  import { library } from '../stores/app';
  import BackupButton from './BackupButton.svelte';

  const SNOOZE_KEY = 'booked.backupSnoozedUntil';
  const lib = library();

  let snoozedUntil = $state(readSnooze());
  // A recent Google Drive sync is a backup too.
  const lastSafe = $derived([$lib.settings.lastBackupAt, $lib.settings.sync?.enabled ? $lib.settings.sync.lastSyncAt : undefined]
    .filter((x): x is string => !!x).sort().pop());
  const status = $derived(backupStatus(lastSafe, $lib.books));
  const visible = $derived(status.due && Date.now() > snoozedUntil);

  function readSnooze(): number {
    try {
      return Number(localStorage.getItem(SNOOZE_KEY) ?? 0);
    } catch {
      return 0;
    }
  }

  function later() {
    snoozedUntil = Date.now() + 24 * 3600 * 1000;
    try {
      localStorage.setItem(SNOOZE_KEY, String(snoozedUntil));
    } catch {
      // private mode: snooze for this session only
    }
  }
</script>

{#if visible}
  <section class="card reminder" aria-label="Backup reminder">
    <p>
      {#if status.never}
        <strong>Back up your library.</strong> {$lib.books.length === 1 ? 'Your book is' : `Your ${plural($lib.books.length, 'book')} are`} only stored on this device.
      {:else}
        <strong>{plural(status.changed, 'change')}</strong> since your last backup{status.days ? ` ${plural(status.days, 'day')} ago` : ''}.
      {/if}
    </p>
    <div class="row">
      <BackupButton />
      <button class="btn-ghost" onclick={later}>Later</button>
    </div>
  </section>
{/if}

<style>
  .reminder { background: color-mix(in srgb, var(--brand) 14%, var(--surface)); display: grid; gap: 8px; }
  p { margin: 0; }
</style>

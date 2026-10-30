<script lang="ts">
  import { backupFileName } from '../domain/backup';
  import type { Snapshot } from '../domain/types';
  import { library, toast } from '../stores/app';

  let { label = 'Back up now', primary = true, mode = 'auto' }: {
    label?: string;
    primary?: boolean;
    /** auto = share sheet where available (→ Google Drive, Files, mail…), else download. */
    mode?: 'auto' | 'download';
  } = $props();

  const lib = library();
  let prepared = $state<{ file: File; snapshot: Snapshot }>();

  // Phones only open the share sheet right after a tap, so the file is prepared ahead of time
  // (and refreshed whenever the library changes).
  async function build() {
    const snapshot = await lib.exportSnapshot();
    const json = JSON.stringify({ ...snapshot, settings: { ...snapshot.settings, lastBackupAt: snapshot.exportedAt } });
    return { snapshot, file: new File([json], backupFileName(snapshot.exportedAt), { type: 'application/json' }) };
  }

  $effect(() => {
    void $lib;
    prepared = undefined;
    let cancelled = false;
    const t = setTimeout(async () => {
      const next = await build();
      if (!cancelled) prepared = next;
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  function download(file: File) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }

  async function save() {
    // Normally ready; if tapped within the first moments, build now (sharing may then fall back to a download).
    const { file, snapshot } = prepared ?? (await build());
    const canShare = mode === 'auto' && navigator.canShare?.({ files: [file] });
    try {
      if (canShare) await navigator.share({ files: [file], title: 'Booked backup' });
      else download(file);
      await lib.markBackedUp(snapshot.exportedAt);
      toast(canShare ? 'Backup saved' : `Backup downloaded: ${file.name}`);
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return; // user closed the share sheet
      download(file); // sharing failed for another reason: fall back to a plain download
      await lib.markBackedUp(snapshot.exportedAt);
      toast(`Backup downloaded: ${file.name}`);
    }
  }
</script>

<button class={primary ? 'btn-primary' : ''} onclick={save}>{label}</button>

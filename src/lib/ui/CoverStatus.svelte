<script lang="ts">
  import { cleanTitle } from '../domain/book';
  import { formatBytes } from '../covers/sizes';
  import { plural } from '../format';
  import { covers, library, toast } from '../stores/app';

  const lib = library();
  const cache = covers();
  const status = cache.status;
  const version = cache.version;

  let online = $state(typeof navigator === 'undefined' || navigator.onLine);
  $effect(() => {
    const on = () => (online = true);
    const off = () => (online = false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  });

  const report = $derived.by(() => {
    void $version;
    void $status;
    return cache.diagnose($lib.books);
  });
  const settings = $derived($lib.settings.covers ?? {});
  const problems = $derived(report.items.filter((i) => i.kind !== 'odd'));
  const odd = $derived(report.items.filter((i) => i.kind === 'odd'));

  /** What a technical error usually means, in plain words. */
  function explain(error: string): string {
    if (/HTTP 429|HTTP 403/.test(error)) return 'The source is limiting requests (try again later).';
    if (/HTTP 404|HTTP 410/.test(error)) return 'No image at that address.';
    if (/HTTP 5\d\d/.test(error)) return 'The source had an error.';
    if (/Failed to fetch|NetworkError|Load failed/.test(error)) return 'No connection, or the source doesn’t allow saving (CORS).';
    if (/blank|not available/i.test(error)) return 'The source has no cover for this book.';
    if (/AbortError|timeout/i.test(error)) return 'The source took too long.';
    return '';
  }

  function when(ms: number | undefined): string {
    if (!ms) return '';
    const d = ms - Date.now();
    if (d <= 0) return 'due now';
    const min = Math.round(d / 60000);
    return min < 1 ? 'in under a minute' : min < 90 ? `in ${min} min` : min < 36 * 60 ? `in ${Math.round(min / 60)} h` : `in ${Math.round(min / 1440)} days`;
  }

  const host = (url: string) => {
    try {
      const u = new URL(url);
      return u.host + u.pathname.slice(0, 40) + (u.pathname.length > 40 ? '…' : '');
    } catch {
      return url.slice(0, 60);
    }
  };

  const policy = $derived(
    (settings.mode ?? 'wifi') === 'off' ? 'Saving is switched off.'
      : !online ? 'Offline: nothing can be downloaded.'
      : $status.decision === 'yes' ? 'Downloads are allowed now.'
      : $status.decision === 'ask' ? 'This device can’t tell whether it is on Wi-Fi: background downloads wait; covers on screen are still saved.'
      : 'Waiting for Wi-Fi (or data saver is on): covers on screen are still saved.'
  );

  async function retry(urls?: string[]) {
    const n = cache.retryFailed(urls);
    toast(n ? `Trying ${plural(n, 'cover')} again…` : 'Nothing to retry');
    if (n) cache.run(true).catch(() => {});
  }

  async function copyReport() {
    const text = JSON.stringify({
      at: new Date().toISOString(),
      online,
      settings: { mode: settings.mode ?? 'wifi', size: settings.size ?? 'medium', large: settings.full ?? 'all', helper: settings.helper ?? 'small' },
      decision: $status.decision,
      running: $status.running,
      summary: { ...report, items: undefined },
      problems: report.items.map((i) => ({ ...i, failedAt: i.failedAt && new Date(i.failedAt).toISOString(), nextTry: i.nextTry && new Date(i.nextTry).toISOString() }))
    }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      toast('Report copied');
    } catch {
      toast('Couldn’t copy. Long-press to select instead.');
    }
  }
</script>

<section class="card stack" id="cover-status">
  <h2>Cover status</h2>
  <dl class="tiles">
    <div><dt>Books</dt><dd>{report.books.toLocaleString()}</dd></div>
    <div><dt>Saved on this device</dt><dd>{report.saved.toLocaleString()} <span class="muted small">of {report.urls.toLocaleString()}</span></dd></div>
    <div><dt>With large image</dt><dd>{report.large.toLocaleString()}</dd></div>
    <div><dt>Waiting to download</dt><dd class:warn={report.notYet > 0}>{report.notYet.toLocaleString()}</dd></div>
    <div><dt>Failed</dt><dd class:bad={report.failed > 0}>{report.failed.toLocaleString()}</dd></div>
    <div><dt>Blank tile only</dt><dd class:warn={report.blank > 0}>{report.blank.toLocaleString()}</dd></div>
    <div><dt>Own photos</dt><dd>{report.ownPhotos.toLocaleString()}</dd></div>
    <div><dt>No cover</dt><dd class:warn={report.noCover > 0}>{report.noCover.toLocaleString()}</dd></div>
  </dl>
  <p class="small">
    {$status.running ? 'Downloading now… ' : ''}{policy}
    <span class="muted">Storage used: {formatBytes(report.bytes)}.</span>
  </p>
  <p class="muted small tech">
    mode {settings.mode ?? 'wifi'} · size {settings.size ?? 'medium'} · large {settings.full ?? 'all'} · helper {settings.helper ?? 'small'} ·
    {online ? 'online' : 'offline'} · decision {$status.decision}
  </p>

  <div class="row">
    <button disabled={!problems.length} onclick={() => retry()}>Retry all failed ({problems.length})</button>
    <button onclick={copyReport}>Copy technical report</button>
  </div>

  {#if problems.length}
    <details open>
      <summary>Problems ({problems.length})</summary>
      <ul class="list">
        {#each problems.slice(0, 60) as it (it.url)}
          <li>
            <div class="top">
              <strong>{cleanTitle(it.titles[0])}{it.titles.length > 1 ? ` + ${it.titles.length - 1}` : ''}</strong>
              <button class="btn-sm" onclick={() => retry([it.url])}>Retry</button>
            </div>
            <code>{it.error}</code>
            {#if explain(it.error)}<span class="small">{explain(it.error)}</span>{/if}
            <span class="muted small">
              {it.kind === 'blank' ? 'blank tile' : `${plural(it.failures, 'failure')} in a row`}{it.nextTry ? ` · next try ${when(it.nextTry)}` : ''}
            </span>
            <code class="url">{host(it.url)}</code>
          </li>
        {/each}
      </ul>
      {#if problems.length > 60}<p class="muted small">Showing 60 of {problems.length}. “Copy technical report” has all of them.</p>{/if}
    </details>
  {:else}
    <p class="muted small">No failed downloads.</p>
  {/if}

  {#if odd.length}
    <details>
      <summary>Saved but not book-shaped ({odd.length})</summary>
      <ul class="list">
        {#each odd.slice(0, 40) as it (it.url)}
          <li><strong>{cleanTitle(it.titles[0])}</strong><span class="muted small">{it.error}</span><code class="url">{host(it.url)}</code></li>
        {/each}
      </ul>
      <p class="muted small">Review them under “Review one by one…” to pick a better cover.</p>
    </details>
  {/if}
</section>

<style>
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 0; }
  .tiles div { background: var(--surface-2); border-radius: 12px; padding: 8px 10px; min-width: 0; }
  dt { font-size: 0.75rem; color: var(--muted); }
  dd { margin: 0; font-size: 1.2rem; font-weight: 700; font-variant-numeric: tabular-nums; }
  .warn { color: var(--warn); }
  .bad { color: var(--danger); }
  .tech { font-variant-numeric: tabular-nums; }
  summary { cursor: pointer; font-weight: 600; }
  .list { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
  .list li { display: grid; gap: 2px; border-top: 1px solid var(--line); padding-top: 8px; min-width: 0; }
  .top { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .top strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  code { font-size: 0.8rem; overflow-wrap: anywhere; }
  .url { color: var(--muted); }
  p { margin: 0; }
</style>

<script lang="ts">
  import type { Book } from '../domain/types';

  import { covers } from '../stores/app';

  let { book, size = 'md' }: { book: Pick<Book, 'title' | 'authors' | 'cover'>; size?: 'sm' | 'md' | 'lg' } = $props();
  let failed = $state(false);
  let retried = false;

  // Prefer the copy cached on this device (offline, no network); fall back to the URL.
  let local = $state<string>();
  let broken = $state(false);
  let tick = $state(0);
  $effect(() => {
    const url = book.cover;
    local = undefined;
    failed = false;
    retried = false;
    broken = false;
    let cache;
    try {
      cache = covers();
    } catch {
      return; // e.g. in component tests without the app
    }
    // Re-check whenever the cache changes (a new cover finished downloading), so a cover that
    // was missing when first shown appears without reloading the page.
    const stop = cache.version.subscribe((v) => {
      if (v === undefined) return;
      broken = cache.isBroken(url);
      cache.objectUrl(url).then((u) => {
        if (url === book.cover && u) local = u;
      });
    });
    return stop;
  });
  const src = $derived(broken ? undefined : (local ?? (book.cover ? withRetry(book.cover, tick) : undefined)));

  /** Reload once if the network image failed (e.g. a flaky request); bypass a cached error. */
  function withRetry(url: string, n: number): string {
    if (!n || url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + `r=${n}`;
  }
  function onError() {
    if (!retried) {
      retried = true;
      setTimeout(() => (tick += 1), 1500);
    } else failed = true;
  }

  // Stable pastel colour per title for placeholder covers.
  const hue = $derived([...book.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<div class="cover {size}" style:--hue={hue}>
  {#if src && !failed}
    <img {src} alt="" loading="lazy" decoding="async" onerror={onError} />
  {:else}
    <div class="placeholder">
      <span class="t">{book.title}</span>
      {#if book.authors[0]}<span class="a">{book.authors[0]}</span>{/if}
    </div>
  {/if}
</div>

<style>
  .cover { aspect-ratio: 2 / 3; border-radius: 6px; overflow: hidden; background: var(--surface-2); box-shadow: var(--shadow); }
  .sm { width: 44px; border-radius: 4px; }
  .lg { width: min(220px, 50vw); }
  img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .placeholder {
    height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 10% 9%;
    background: linear-gradient(160deg, hsl(var(--hue) 35% 42%), hsl(calc(var(--hue) + 30) 40% 28%));
    color: #fff; overflow: hidden;
  }
  .t { font-weight: 700; font-size: 0.85rem; line-height: 1.15; display: -webkit-box; -webkit-line-clamp: 5; line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
  .a { font-size: 0.7rem; opacity: 0.85; }
  .sm .placeholder { padding: 4px; }
  .sm .t { font-size: 0.45rem; }
  .sm .a { display: none; }
  .lg .t { font-size: 1.2rem; }
  .lg .a { font-size: 0.9rem; }
</style>

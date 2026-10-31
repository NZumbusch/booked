<script lang="ts">
  import { cleanTitle } from '../domain/book';
  import type { Book } from '../domain/types';

  import { isCoverShape } from '../covers/colors';
  import { covers } from '../stores/app';
  import { coverRetry } from './coverRetry';

  let { book, size = 'md' }: { book: Pick<Book, 'title' | 'authors' | 'cover'>; size?: 'sm' | 'md' | 'lg' } = $props();
  let failed = $state(false);
  let tries = 0;

  // Prefer the copy cached on this device (offline, no network); fall back to the URL.
  let local = $state<string>();
  let broken = $state(false);
  let tick = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Look in the cache again: a cover that wasn't saved yet may be now. */
  function refresh(url: string | undefined) {
    let cache;
    try {
      cache = covers();
    } catch {
      return; // e.g. in component tests without the app
    }
    broken = cache.isBroken(url);
    cache.objectUrl(url).then((u) => {
      if (url !== book.cover || !u || u === local) return;
      local = u;
      failed = false; // the saved copy works even if the network image didn't
      tries = 0;
    });
  }

  $effect(() => {
    const url = book.cover;
    local = undefined;
    failed = false;
    tries = 0;
    broken = false;
    clearTimeout(timer);
    let cache;
    try {
      cache = covers();
    } catch {
      return;
    }
    // Re-check whenever the cache changes (a cover finished downloading), so a cover that was
    // missing when first shown appears without reloading the page.
    const stopCache = cache.version.subscribe(() => refresh(url));
    // Back online / back in the app: try again what failed.
    const stopRetry = coverRetry.subscribe((n) => {
      if (n && failed && !broken) {
        failed = false;
        tries = 0;
        tick += 1;
      }
    });
    return () => {
      stopCache();
      stopRetry();
      clearTimeout(timer);
    };
  });
  const src = $derived(broken ? undefined : (local ?? (book.cover ? withRetry(book.cover, tick) : undefined)));

  /** A different address makes the browser load the image again instead of reusing a failed one. */
  function withRetry(url: string, n: number): string {
    if (!n || url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + `r=${n}`;
  }
  /** A wide title-page scan or similar isn't a cover: show the title instead of a zoomed-in crop. */
  function onLoad(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    if (!book.cover?.startsWith('data:') && !isCoverShape(img.naturalWidth, img.naturalHeight)) failed = true;
  }
  function onError() {
    if (local) {
      // The saved copy can't be shown (its temporary address was released): make a fresh one, else use the network image.
      const url = book.cover;
      local = undefined;
      try {
        covers().dropUrl(url);
      } catch {
        /* no app */
      }
      refresh(url);
      return;
    }
    if (tries < 3) {
      tries++;
      clearTimeout(timer);
      timer = setTimeout(() => (tick += 1), 1500 * tries * tries); // 1.5 s, 6 s, 13.5 s
    } else failed = true;
  }

  // Stable pastel colour per title for placeholder covers.
  const hue = $derived([...book.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
</script>

<div class="cover {size}" style:--hue={hue}>
  {#if src && !failed}
    <img {src} alt="" loading="lazy" decoding="async" onerror={onError} onload={onLoad} />
  {:else}
    <div class="placeholder">
      <span class="t">{cleanTitle(book.title)}</span>
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

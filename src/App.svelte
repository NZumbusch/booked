<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from './lib/router';
  import { openLibrary } from './lib/stores/app';
  import type { Library } from './lib/services/library';
  import NavBar from './lib/ui/NavBar.svelte';
  import Toasts from './lib/ui/Toasts.svelte';
  import AddBook from './routes/AddBook.svelte';
  import BatchScan from './routes/BatchScan.svelte';
  import BookDetail from './routes/BookDetail.svelte';
  import Books from './routes/Books.svelte';
  import Home from './routes/Home.svelte';
  import Locations from './routes/Locations.svelte';
  import Settings from './routes/Settings.svelte';

  let lib = $state<Library>();
  let error = $state('');

  onMount(() => {
    openLibrary().then((l) => (lib = l)).catch((e) => (error = String(e?.message ?? e)));
  });

  // Theme: explicit choice, or follow the system.
  $effect(() => {
    if (!lib) return;
    return lib.subscribe((s) => {
      const media = matchMedia('(prefers-color-scheme: dark)');
      const dark = s.settings.theme === 'dark' || (s.settings.theme === 'system' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    });
  });

  // Scroll to top on page change.
  $effect(() => {
    void $route.path;
    window.scrollTo(0, 0);
  });

  const [section, param] = $derived($route.parts);
</script>

{#if error}
  <div class="page empty">
    <span class="big">⚠️</span>
    <p>Could not open the local database: {error}</p>
    <p class="small">Private browsing modes sometimes block storage. Try a normal window.</p>
  </div>
{:else if lib}
  <main>
    {#if !section}
      <Home />
    {:else if section === 'books'}
      <Books />
    {:else if section === 'book' && param}
      {#key param}<BookDetail id={param} edit={$route.query.edit === '1'} />{/key}
    {:else if section === 'add'}
      {#key $route.query.mode}<AddBook mode={$route.query.mode === 'scan' || $route.query.mode === 'search' ? $route.query.mode : 'isbn'} />{/key}
    {:else if section === 'scan'}
      <BatchScan />
    {:else if section === 'locations'}
      {#key param}<Locations id={param ?? null} />{/key}
    {:else if section === 'settings'}
      <Settings />
    {:else}
      <div class="page empty"><span class="big">🧭</span><p>Page not found.</p><a class="btn" href="#/">Home</a></div>
    {/if}
  </main>
  <NavBar />
  <Toasts />
{/if}

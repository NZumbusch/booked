<script lang="ts">
  import { onMount } from 'svelte';
  import { route } from './lib/router';
  import { openLibrary } from './lib/stores/app';
  import { setGoogleApiKey } from './lib/metadata/lookup';
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
  import Terms from './routes/Terms.svelte';
  import Exchange from './routes/Exchange.svelte';
  import Join from './routes/Join.svelte';
  import Discover from './routes/Discover.svelte';
  import Topic from './routes/Topic.svelte';
  import Author from './routes/Author.svelte';
  import Lending from './routes/Lending.svelte';
  import MapView from './routes/MapView.svelte';
  import Print from './routes/Print.svelte';
  import Stats from './routes/Stats.svelte';

  let lib = $state<Library>();
  let error = $state('');

  onMount(() => {
    openLibrary().then((l) => (lib = l)).catch((e) => (error = String(e?.message ?? e)));
  });

  // Theme: explicit choice, or follow the system (live, also when it switches at sunset).
  $effect(() => {
    if (!lib) return;
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const theme = lib!.state.settings.theme;
      document.documentElement.dataset.theme = theme === 'dark' || (theme === 'system' && media.matches) ? 'dark' : 'light';
    };
    media.addEventListener('change', apply);
    let last = { theme: '', key: undefined as string | undefined, first: true };
    const unsubscribe = lib.subscribe((s) => {
      const { theme, googleBooksKey: key } = s.settings;
      if (!last.first && theme === last.theme && key === last.key) return; // book edits don't concern us
      last = { theme, key, first: false };
      setGoogleApiKey(key);
      apply();
    });
    return () => {
      media.removeEventListener('change', apply);
      unsubscribe();
    };
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
    {:else if section === 'tags'}
      <Terms kind={param === 'collections' || param === 'genres' ? param : 'tags'} />
    {:else if section === 'discover'}
      <Discover />
    {:else if section === 'topic' && param}
      {#key param}<Topic name={param} />{/key}
    {:else if section === 'author' && param}
      {#key param}<Author name={param} />{/key}
    {:else if section === 'join'}
      <Join />
    {:else if section === 'export'}
      <Exchange />
    {:else if section === 'print'}
      <Print loc={$route.query.loc ?? null} />
    {:else if section === 'lending'}
      <Lending />
    {:else if section === 'stats'}
      <Stats />
    {:else if section === 'map'}
      {#key param}<MapView mode={param === 'owned' ? 'owned' : param === 'stories' ? 'stories' : 'written'} />{/key}
    {:else if section === 'settings'}
      <Settings />
    {:else}
      <div class="page empty"><span class="big">🧭</span><p>Page not found.</p><a class="btn" href="#/">Home</a></div>
    {/if}
  </main>
  <NavBar />
  <Toasts />
{/if}

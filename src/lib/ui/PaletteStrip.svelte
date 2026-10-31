<script lang="ts">
  import { colorSortKey, rgbCss } from '../covers/colors';
  import { covers, library } from '../stores/app';

  /** "Colours of your library": one thin stripe per cached cover, along the colour wheel. */
  let { height = 56 }: { height?: number } = $props();
  const lib = library();
  const cache = covers();
  const version = cache.version;
  const colors = $derived.by(() => {
    void $version;
    const seen = new Set<string>();
    return $lib.books
      .map((b) => (b.cover && !seen.has(b.cover) && seen.add(b.cover) ? cache.meta(b.cover)?.analysis : undefined))
      .filter((a) => !!a)
      .sort((a, b) => colorSortKey(a!) - colorSortKey(b!))
      .map((a) => rgbCss(a!.color));
  });
</script>

{#if colors.length >= 5}
  <div class="strip" style:height="{height}px" role="img" aria-label="Cover colours of {colors.length} books, sorted along the colour wheel">
    {#each colors as c, i (i)}<span style:background={c}></span>{/each}
  </div>
{/if}

<style>
  .strip { display: flex; border-radius: 10px; overflow: hidden; }
  .strip span { flex: 1 1 0; min-width: 0; }
</style>

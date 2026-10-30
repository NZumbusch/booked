<script lang="ts">
  import type { SourceRef } from '../domain/types';

  let { ref }: { ref: SourceRef | undefined } = $props();
  let open = $state(false);

  const NAMES = { openlibrary: 'Open Library', googlebooks: 'Google Books', wikidata: 'Wikidata', manual: 'you' };
</script>

{#if ref}
  <span class="wrap">
    <button type="button" class="q" aria-expanded={open} aria-label="Where does this come from?" onclick={() => (open = !open)}>?</button>
    {#if open}
      <span class="pop small" role="note">
        From {#if ref.url}<a href={ref.url} target="_blank" rel="noopener">{NAMES[ref.source]} ↗</a>{:else}{NAMES[ref.source]}{/if}
        {#if ref.note}<br /><span class="muted">{ref.note}</span>{/if}
      </span>
    {/if}
  </span>
{/if}

<style>
  .wrap { position: relative; margin-left: 4px; }
  .q {
    position: relative; vertical-align: middle; min-height: 0; width: 18px; height: 18px; padding: 0; border-radius: 50%; font-size: 0.7rem; font-weight: 700;
    color: var(--muted); background: var(--surface-2); border: none;
  }
  /* Invisible padding keeps the tap target large without visual weight. */
  .q::after { content: ''; position: absolute; inset: -13px; }
  /* Opens inline below the value, so it never overflows the screen edge. */
  .pop {
    display: block; margin: 6px 0 2px;
    background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; box-shadow: var(--shadow);
    text-align: left; font-weight: 400;
  }
</style>

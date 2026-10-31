<script lang="ts">
  import type { Count } from '../domain/stats';

  /** Ranked horizontal bars: label, bar, count. One series, one hue. */
  let { items, href }: { items: (Count & { depth?: number })[]; href?: (c: Count) => string | undefined } = $props();
  const max = $derived(Math.max(1, ...items.map((i) => i.count)));
</script>

<ul class="bars">
  {#each items as item (item.key ?? item.label)}
    {@const link = href?.(item)}
    <li title="{item.label}: {item.count.toLocaleString()}" class:sub={item.depth}>
      {#if link}<a class="label" href={link}>{item.label}</a>{:else}<span class="label">{item.label}</span>{/if}
      <span class="track"><span class="bar" style:width="{(item.count / max) * 100}%"></span></span>
      <span class="n">{item.count.toLocaleString()}</span>
    </li>
  {/each}
</ul>

<style>
  .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  li { display: grid; grid-template-columns: minmax(80px, 38%) 1fr auto; gap: 10px; align-items: center; min-height: 28px; }
  .sub .label { padding-left: 14px; color: var(--muted); }
  .label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.9rem; text-decoration: none; }
  .track { height: 14px; display: block; }
  .bar { display: block; height: 100%; min-width: 2px; background: var(--chart-bar); border-radius: 0 4px 4px 0; }
  .n { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 0.85rem; min-width: 2.5em; text-align: right; }
</style>

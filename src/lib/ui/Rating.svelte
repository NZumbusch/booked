<script lang="ts">
  import Icon from './Icon.svelte';

  let { value = $bindable(), readonly = false, onchange }: {
    value?: number;
    readonly?: boolean;
    onchange?: (v: number | undefined) => void;
  } = $props();

  function set(n: number) {
    value = value === n ? undefined : n; // tap the same star again to clear
    onchange?.(value);
  }
</script>

<div class="stars" role={readonly ? 'img' : 'radiogroup'} aria-label="Rating: {value ?? 'none'} of 5">
  {#each [1, 2, 3, 4, 5] as n}
    {#if readonly}
      <span class:on={(value ?? 0) >= n}><Icon name="star" size={16} fill={(value ?? 0) >= n} /></span>
    {:else}
      <button type="button" class="btn-ghost star" class:on={(value ?? 0) >= n} aria-label="{n} star{n > 1 ? 's' : ''}"
        role="radio" aria-checked={value === n} onclick={() => set(n)}>
        <Icon name="star" size={26} fill={(value ?? 0) >= n} />
      </button>
    {/if}
  {/each}
</div>

<style>
  .stars { display: inline-flex; color: var(--line); }
  .on { color: var(--brand); }
  .star { width: 44px; padding: 0; min-height: 44px; }
</style>

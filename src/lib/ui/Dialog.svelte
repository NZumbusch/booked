<script lang="ts">
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';

  let { open = $bindable(false), title, children, actions }: {
    open?: boolean;
    title: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();

  let el: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });
</script>

<dialog bind:this={el} onclose={() => (open = false)} aria-label={title}>
  {#if open}
    <header class="spread">
      <h2>{title}</h2>
      <button class="btn-ghost btn-icon" aria-label="Close" onclick={() => (open = false)}><Icon name="close" /></button>
    </header>
    <div class="body">{@render children()}</div>
    {#if actions}<footer class="row">{@render actions()}</footer>{/if}
  {/if}
</dialog>

<style>
  header { padding: 12px 8px 0 20px; }
  header h2 { margin: 0; }
  .body { padding: 8px 20px 16px; display: grid; gap: 12px; }
  footer { padding: 0 20px 20px; justify-content: flex-end; }
</style>

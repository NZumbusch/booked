<script lang="ts">
  import Dialog from './Dialog.svelte';

  let { open = $bindable(false), title, message, confirmLabel = 'Delete', danger = true, onconfirm }: {
    open?: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    onconfirm: () => void;
  } = $props();
</script>

<Dialog bind:open {title}>
  <p>{message}</p>
  {#snippet actions()}
    <button onclick={() => (open = false)}>Cancel</button>
    <button class={danger ? 'btn-danger solid' : 'btn-primary'} onclick={() => { open = false; onconfirm(); }}>{confirmLabel}</button>
  {/snippet}
</Dialog>

<script lang="ts">
  import { dismissToast, toasts, undoLast } from '../stores/app';
</script>

<div class="toasts no-print" aria-live="polite">
  {#each $toasts as t (t.id)}
    <div class="toast">
      <span>{t.message}</span>
      {#if t.undo}
        <button class="btn-sm" onclick={() => { dismissToast(t.id); undoLast(); }}>Undo</button>
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(var(--nav-h) + var(--toast-offset, 0px) + 16px + env(safe-area-inset-bottom));
    display: grid; gap: 8px; z-index: 50; width: min(520px, calc(100vw - 24px));
  }
  .toast {
    background: var(--text); color: var(--bg); border-radius: 12px; padding: 10px 10px 10px 16px;
    display: flex; gap: 12px; align-items: center; justify-content: space-between; box-shadow: var(--shadow);
    min-height: 52px;
  }
  .toast button { background: transparent; color: var(--bg); border-color: color-mix(in srgb, var(--bg) 40%, transparent); }
</style>

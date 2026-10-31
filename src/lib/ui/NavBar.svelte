<script lang="ts">
  import { route } from '../router';
  import Icon, { type IconName } from './Icon.svelte';

  const items: { href: string; label: string; icon: IconName; match: string }[] = [
    { href: '#/', label: 'Home', icon: 'home', match: '' },
    { href: '#/books', label: 'Library', icon: 'books', match: 'books' },
    { href: '#/add', label: 'Add', icon: 'scan', match: 'add' },
    { href: '#/discover', label: 'Discover', icon: 'compass', match: 'discover' },
    { href: '#/locations', label: 'Places', icon: 'pin', match: 'locations' }
  ];
  const section = $derived(({ book: 'books', scan: 'add', tags: 'books', lending: '', stats: 'discover', map: 'discover', topic: 'discover', author: 'discover', wall: 'books', export: '', print: '', settings: '' } as Record<string, string>)[$route.parts[0]] ?? $route.parts[0] ?? '');
</script>

<nav aria-label="Main" class="no-print">
  {#each items as item}
    <a href={item.href} class:active={section === item.match} class:primary={item.match === 'add'}
      aria-current={section === item.match ? 'page' : undefined}>
      <span class="icon"><Icon name={item.icon} /></span>
      <span class="label">{item.label}</span>
    </a>
  {/each}
</nav>

<style>
  nav {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 40; height: calc(var(--nav-h) + env(safe-area-inset-bottom));
    padding-bottom: env(safe-area-inset-bottom); display: grid; grid-template-columns: repeat(5, 1fr);
    background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(12px);
    border-top: 1px solid var(--line);
  }
  a { display: grid; justify-items: center; align-content: center; gap: 2px; text-decoration: none; color: var(--muted); font-size: 0.72rem; }
  a.active { color: var(--text); font-weight: 600; }
  .primary .icon { background: var(--accent); color: var(--accent-text); border-radius: 999px; padding: 6px 14px; display: flex; }
  @media (min-width: 900px) {
    nav { max-width: 560px; margin: 0 auto 12px; border: 1px solid var(--line); border-radius: 20px; }
  }
</style>

import { readable } from 'svelte/store';

/** Ticks when the device is back online or the page comes back to the front: covers that failed to load try again. */
export const coverRetry = readable(0, (set) => {
  if (typeof window === 'undefined') return;
  let n = 0;
  const bump = () => set(++n);
  const visible = () => document.visibilityState === 'visible' && bump();
  window.addEventListener('online', bump);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', bump);
    document.removeEventListener('visibilitychange', visible);
  };
});

import { readable } from 'svelte/store';

/** Hash-based routing: works on GitHub Pages without server rewrites. */
export interface Route {
  path: string;
  parts: string[];
  query: Record<string, string>;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return {
    path,
    parts: path.split('/').filter(Boolean).map(decodeURIComponent),
    query: Object.fromEntries(new URLSearchParams(search))
  };
}

export function buildHash(path: string, query: Record<string, string | undefined | null> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export const route = readable<Route>(parseHash(typeof location === 'undefined' ? '' : location.hash), (set) => {
  const update = () => set(parseHash(location.hash));
  window.addEventListener('hashchange', update);
  return () => window.removeEventListener('hashchange', update);
});

export function navigate(path: string, query?: Record<string, string | undefined | null>, replace = false) {
  const hash = buildHash(path, query);
  if (replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

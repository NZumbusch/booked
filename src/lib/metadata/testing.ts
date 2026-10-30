import type { Fetcher } from './http';

/** A fake fetch: first route whose key is contained in the URL answers. Unmatched URLs 404. */
export function fakeFetch(routes: Record<string, unknown>, calls: string[] = []): Fetcher {
  return async (url: string) => {
    calls.push(url);
    const key = Object.keys(routes).find((k) => url.includes(k));
    const body = key === undefined ? undefined : routes[key];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (typeof body === 'number') return new Response('error', { status: body });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

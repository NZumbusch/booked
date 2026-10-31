import type { GeoPoint } from '../domain/types';
import { getJson, type Fetcher } from './http';

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
}

/** Free place search via OpenStreetMap Nominatim (no key; light, user-initiated use only). */
export async function geocode(query: string, f: Fetcher = fetch.bind(globalThis)): Promise<GeoPoint[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(query)}`;
  const hits = (await getJson<NominatimHit[]>(f, url, { headers: { Accept: 'application/json' } })) ?? [];
  return hits.map((h) => ({ lat: Number(h.lat), lon: Number(h.lon), label: h.display_name.split(',').slice(0, 3).join(',').trim() }));
}

/** Group map points that are (almost) the same place. */
export function clusterByPlace<T>(items: { point: GeoPoint; item: T }[], precision = 2): { point: GeoPoint; items: T[] }[] {
  const groups = new Map<string, { point: GeoPoint; items: T[] }>();
  for (const { point, item } of items) {
    const key = `${point.lat.toFixed(precision)},${point.lon.toFixed(precision)}`;
    const g = groups.get(key);
    if (g) g.items.push(item);
    else groups.set(key, { point, items: [item] });
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

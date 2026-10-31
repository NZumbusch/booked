import { describe, expect, it } from 'vitest';
import { clusterByPlace, geocode } from './geocode';
import { fakeFetch } from './testing';

describe('geocode', () => {
  it('maps Nominatim hits to points with short labels', async () => {
    const calls: string[] = [];
    const hits = await geocode('Zürich', fakeFetch({ 'nominatim.openstreetmap.org/search': [
      { lat: '47.3744489', lon: '8.5410422', display_name: 'Zürich, Bezirk Zürich, Zürich, Schweiz/Suisse/Svizzera/Svizra' }
    ] }, calls));
    expect(calls[0]).toContain('q=Z%C3%BCrich');
    expect(hits).toEqual([{ lat: 47.3744489, lon: 8.5410422, label: 'Zürich, Bezirk Zürich, Zürich' }]);
  });
});

describe('clusterByPlace', () => {
  it('groups nearby points, biggest first', () => {
    const c = clusterByPlace([
      { point: { lat: 48.714, lon: 8.737, label: 'Calw' }, item: 'a' },
      { point: { lat: 47.25, lon: -122.44, label: 'Tacoma' }, item: 'b' },
      { point: { lat: 48.7144, lon: 8.7375, label: 'Calw' }, item: 'c' }
    ]);
    expect(c.map((g) => [g.point.label, g.items])).toEqual([['Calw', ['a', 'c']], ['Tacoma', ['b']]]);
  });
});

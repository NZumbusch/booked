<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { Book, PlaceBasis } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { clusterByPlace } from '../lib/metadata/geocode';
  import { library } from '../lib/stores/app';

  let { mode = 'written' }: { mode?: 'written' | 'owned' } = $props();

  const lib = library();
  let el: HTMLDivElement | undefined = $state();
  let L: typeof import('leaflet') | undefined;
  let map: import('leaflet').Map | undefined;
  let layer: import('leaflet').LayerGroup | undefined;
  let failed = $state('');

  const BASIS: Record<PlaceBasis, string> = {
    written: 'written here', published: 'first published here', author: 'author’s home town', country: 'country of publication'
  };

  const writtenGroups = $derived(
    clusterByPlace($lib.books.filter((b) => b.writing?.place).map((b) => ({ point: b.writing!.place!, item: b })))
  );
  const placeGroups = $derived(
    lib.children(null).filter((p) => p.geo).map((p) => ({ place: p, count: ($lib && lib.counts()).get(p.id) ?? 0 }))
  );
  const placesWithoutGeo = $derived(lib.children(null).filter((p) => !p.geo).length);

  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

  onMount(async () => {
    try {
      const [leaflet] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);
      L = leaflet.default ?? leaflet;
      map = L.map(el!, { worldCopyJump: true }).setView([30, 10], 2);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      }).addTo(map);
      layer = L.layerGroup().addTo(map);
      draw();
    } catch (e) {
      failed = String(e);
    }
  });

  onDestroy(() => {
    // Stop any running zoom/pan animation first; removing mid-animation throws inside Leaflet.
    map?.stop();
    map?.off();
    map?.remove();
    map = undefined;
  });

  function radius(n: number) {
    return 6 + Math.min(18, Math.sqrt(n) * 3);
  }

  function draw() {
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const color = getComputedStyle(document.documentElement).getPropertyValue('--chart-bar').trim() || '#b5752c';
    const ring = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
    const points: [number, number][] = [];
    if (mode === 'written') {
      for (const g of writtenGroups) {
        const list = g.items
          .slice(0, 30)
          .map((b: Book) => `<li><a href="#/book/${b.id}">${esc(b.title)}</a>${b.authors[0] ? ` <span class="m">· ${esc(b.authors[0])}</span>` : ''}${b.writing?.placeBasis && b.writing.placeBasis !== 'written' ? ` <span class="m">(${BASIS[b.writing.placeBasis]})</span>` : ''}</li>`)
          .join('');
        const more = g.items.length > 30 ? `<li class="m">…and ${g.items.length - 30} more</li>` : '';
        L.circleMarker([g.point.lat, g.point.lon], { radius: radius(g.items.length), color: ring, weight: 2, fillColor: color, fillOpacity: 0.85 })
          .bindPopup(`<strong>${esc(g.point.label ?? '')}</strong><br><span class="m">${plural(g.items.length, 'book')}</span><ul>${list}${more}</ul>`, { maxHeight: 260 })
          .addTo(layer);
        points.push([g.point.lat, g.point.lon]);
      }
    } else {
      for (const { place, count } of placeGroups) {
        L.circleMarker([place.geo!.lat, place.geo!.lon], { radius: radius(count), color: ring, weight: 2, fillColor: color, fillOpacity: 0.85 })
          .bindPopup(`<strong>${esc(place.name)}</strong><br><a href="#/books?loc=${place.id}">${plural(count, 'book')}</a>`)
          .addTo(layer);
        points.push([place.geo!.lat, place.geo!.lon]);
      }
    }
    if (points.length === 1) map.setView(points[0], 10, { animate: false });
    else if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 10, animate: false });
  }

  $effect(() => {
    void mode;
    void writtenGroups;
    void placeGroups;
    draw();
  });
</script>

<div class="page stack">
  <h1>Map</h1>
  <div class="seg" role="tablist">
    <a role="tab" href="#/map/written" aria-selected={mode === 'written'} class:on={mode === 'written'}>Where they were written</a>
    <a role="tab" href="#/map/owned" aria-selected={mode === 'owned'} class:on={mode === 'owned'}>Where they are</a>
  </div>

  {#if mode === 'written'}
    <p class="muted small">
      {plural(writtenGroups.reduce((n, g) => n + g.items.length, 0), 'book')} in {plural(writtenGroups.length, 'place')}.
      Where the place of writing isn’t recorded, the place of first publication or the author’s home town is used (tap a dot for details).
      Books get this automatically from Wikidata when they’re added.
    </p>
  {:else if placesWithoutGeo}
    <p class="muted small">{plural(placesWithoutGeo, 'place')} without a map position. Set it under <a href="#/locations">Places</a> › Edit › Map position.</p>
  {/if}

  {#if failed}
    <div class="card empty"><p>The map couldn’t load ({failed}). It needs an internet connection.</p></div>
  {:else}
    <div class="map" bind:this={el}></div>
  {/if}
</div>

<style>
  .seg { display: grid; grid-template-columns: 1fr 1fr; background: var(--surface-2); border-radius: 999px; padding: 4px; gap: 4px; }
  .seg a { text-align: center; text-decoration: none; min-height: 40px; display: grid; place-items: center; border-radius: 999px; font-size: 0.9rem; padding: 0 6px; }
  .seg a.on { background: var(--surface); box-shadow: var(--shadow); font-weight: 600; }
  .map { height: calc(100dvh - 300px); min-height: 320px; border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); z-index: 0; background: var(--surface-2); }
  .map :global(.leaflet-popup-content) { margin: 10px 12px; font: inherit; font-size: 0.9rem; }
  .map :global(.leaflet-popup-content ul) { margin: 6px 0 0; padding-left: 16px; }
  .map :global(.leaflet-popup-content .m) { color: #6b6f76; }
</style>

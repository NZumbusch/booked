<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import { rgbCss } from '../lib/covers/colors';
  import { todayIso } from '../lib/domain/book';
  import { applyFilter, filterChips, filterFromQuery } from '../lib/domain/filters';
  import type { Book } from '../lib/domain/types';
  import { saveFile, stamp } from '../lib/files';
  import { plural } from '../lib/format';
  import { navigate, route } from '../lib/router';
  import { covers, library, toast } from '../lib/stores/app';
  import Icon from '../lib/ui/Icon.svelte';
  import { CELL_H, CELL_W, FIELD_ORDERS, fieldLayout, fieldTopics, hasTopic, type FieldItem, type FieldOrder, type FieldShape } from '../lib/wall/field';

  const lib = library();
  const cache = covers();
  const cacheStatus = cache.status;
  const cacheVersion = cache.version;

  // ---- options (kept in the URL with the library filter)
  const query = $derived($route.query);
  const order = $derived<FieldOrder>((query.order as FieldOrder) in FIELD_ORDERS ? (query.order as FieldOrder) : 'color');
  const shape = $derived<FieldShape>(query.shape === 'endless' ? 'endless' : 'disc');
  const topic = $derived(query.topic ?? '');
  const bubbles = $derived(query.style === 'bubbles');
  const niceOnly = $derived(query.all !== '1');
  const focusId = $derived(query.focus);
  const filter = $derived(filterFromQuery(query));
  const chips = $derived(filterChips(filter, $lib.locations));
  const setQuery = (patch: Record<string, string | undefined>) => navigate('/wall', { ...query, ...patch }, true);

  // ---- data
  const baseItems = $derived.by((): FieldItem[] => {
    void $cacheVersion;
    const books = applyFilter($lib.books, filter, { locations: $lib.locations, today: todayIso() }).filter((b) => b.cover);
    return books
      .map((book) => ({ book, analysis: cache.meta(book.cover)?.analysis, nice: cache.meta(book.cover)?.nice }))
      // Unknown (not yet cached) covers stay in; only covers known to be placeholders/odd are hidden.
      .filter((it) => !niceOnly || it.nice !== false);
  });
  const topics = $derived(fieldTopics(baseItems));
  const items = $derived(topic ? baseItems.filter((it) => hasTopic(it.book, topic)) : baseItems);
  const layout = $derived(fieldLayout(items, order, shape, $lib.locations));
  const period = $derived(layout.wrap);
  /** Cell → book, for hit-testing (with wrap-around). */
  const cellMap = $derived(new Map(layout.tiles.map((t) => [`${t.col},${t.row}`, t.id])));
  const byId = $derived(new Map(items.map((it) => [it.book.id, it])));
  const hiddenCount = $derived($lib.books.filter((b) => b.cover).length - items.length);
  const uncached = $derived(items.filter((it) => !cache.meta(it.book.cover)?.px).length);

  // ---- geometry (world units: a cover is 1 wide, 1.5 high; cells include a small gap)
  function worldOf(col: number, row: number): { x: number; y: number } {
    return { x: col * CELL_W, y: row * CELL_H };
  }
  const mod = (a: number, n: number) => ((a % n) + n) % n;

  // ---- camera
  let canvas: HTMLCanvasElement | undefined = $state();
  let wrap: HTMLDivElement | undefined = $state();
  let width = 0;
  let height = 0;
  let scale = 40; // screen px per world unit
  let ox = 0;
  let oy = 0;
  let dirty = true;
  let raf = 0;
  let selected = $state<Book>();

  function fit() {
    if (!width || !layout.tiles.length) return;
    if (period) {
      // Endless: start at a comfortable zoom in the middle of the field.
      scale = Math.max(14, Math.min(48, width / 9));
      ox = width / 2 - (period.cols * CELL_W * scale) / 2;
      oy = height / 2 - (period.rows * CELL_H * scale) / 2;
    } else {
      const b = layout.bounds;
      const w = (b.maxCol - b.minCol + 1) * CELL_W;
      const h = (b.maxRow - b.minRow + 1) * CELL_H;
      scale = Math.min(width / w, height / h) * 0.94;
      ox = width / 2 - ((b.minCol + b.maxCol + 1) / 2) * CELL_W * scale;
      oy = height / 2 - ((b.minRow + b.maxRow + 1) / 2) * CELL_H * scale;
    }
    dirty = true;
  }

  function focusOn(id: string, cellPx = 150) {
    const t = layout.tiles.find((x) => x.id === id);
    if (!t) return false;
    const p = worldOf(t.col, t.row);
    animateTo(cellPx, width / 2 - (p.x + 0.5) * cellPx, height / 2 - (p.y + 0.75) * cellPx);
    return true;
  }

  let anim: { from: [number, number, number]; to: [number, number, number]; t0: number } | undefined;
  function animateTo(s: number, x: number, y: number) {
    anim = { from: [scale, ox, oy], to: [s, x, y], t0: performance.now() };
    dirty = true;
  }

  // ---- images (decoded on demand for covers in view)
  const loading = new Set<string>();
  const ready = new Map<string, ImageBitmap>();
  function want(url: string) {
    if (ready.has(url) || loading.has(url) || loading.size > 8) return;
    loading.add(url);
    cache.bitmap(url).then((b) => {
      if (b) ready.set(url, b);
      // Keep memory bounded: forget the oldest decoded covers (the cache keeps its own LRU too).
      if (ready.size > 600) ready.delete(ready.keys().next().value!);
    }).finally(() => {
      loading.delete(url);
      dirty = true;
    });
  }

  // ---- drawing
  function css(name: string, fallback: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function draw() {
    raf = requestAnimationFrame(draw);
    if (anim) {
      const k = Math.min(1, (performance.now() - anim.t0) / 320);
      const e = 1 - (1 - k) ** 3;
      [scale, ox, oy] = anim.from.map((f, i) => f + (anim!.to[i] - f) * e) as [number, number, number];
      if (k >= 1) anim = undefined;
      dirty = true;
    }
    if (!dirty || !canvas) return;
    dirty = false;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = css('--bg', '#f7f5f0');
    ctx.fillRect(0, 0, width, height);
    const grey = css('--surface-2', '#ddd');
    const ring = css('--brand', '#c8863a');
    const cx = width / 2;
    const cy = height / 2;
    const reach = Math.max(width, height) * 0.62;
    const periodX = period ? period.cols * CELL_W : 0;
    const periodY = period ? period.rows * CELL_H : 0;
    // Visible world rectangle (plus a margin for fisheye drift).
    const vx0 = -ox / scale - 2;
    const vy0 = -oy / scale - 2;
    const vx1 = (width - ox) / scale + 2;
    const vy1 = (height - oy) / scale + 2;
    /** World x positions where a tile (or its endless copies) are visible. */
    const copies = (x: number, period: number, lo: number, hi: number): number[] => {
      if (!period) return x >= lo - 2 && x <= hi ? [x] : [];
      const out: number[] = [];
      for (let v = x + Math.ceil((lo - 2 - x) / period) * period; v <= hi; v += period) out.push(v);
      return out;
    };
    for (const t of layout.tiles) {
      const it = byId.get(t.id);
      if (!it) continue;
      const base = worldOf(t.col, t.row);
      for (const wx of copies(base.x, periodX, vx0, vx1)) {
        for (const wy of copies(base.y, periodY, vy0, vy1)) drawTile(ctx, it, t.id, wx, wy, { grey, ring, cx, cy, reach });
      }
    }
    // Floating labels: groups when zoomed out, subgroups at medium zoom.
    const showLevel = (lvl: 1 | 2) => (lvl === 1 ? scale < 40 : scale >= 40 && scale < 150);
    for (const l of layout.labels) {
      if (!showLevel(l.level)) continue;
      const size = l.level === 1 ? Math.max(13, Math.min(30, scale * 0.9 + Math.sqrt(l.count) * 0.6)) : Math.max(11, Math.min(20, scale * 0.35));
      ctx.font = `${l.level === 1 ? 700 : 600} ${size}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const wx of copies(l.x, periodX, vx0, vx1)) {
        for (const wy of copies(l.y, periodY, vy0, vy1)) {
          const x = wx * scale + ox;
          const y = wy * scale + oy;
          const text = l.level === 1 ? `${l.text} · ${l.count}` : l.text;
          const w = ctx.measureText(text).width + size;
          ctx.fillStyle = l.level === 1 ? css('--text', '#222') : css('--surface', '#fff');
          ctx.globalAlpha = 0.86;
          ctx.beginPath();
          ctx.roundRect(x - w / 2, y - size * 0.8, w, size * 1.6, size * 0.8);
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.fillStyle = l.level === 1 ? css('--bg', '#fff') : css('--text', '#222');
          ctx.fillText(text, x, y);
        }
      }
    }
    ctx.textAlign = 'start';
  }

  function drawTile(ctx: CanvasRenderingContext2D, it: FieldItem, id: string, wx: number, wy: number, o: { grey: string; ring: string; cx: number; cy: number; reach: number }) {
    let sx = wx * scale + ox;
    let sy = wy * scale + oy;
    let w = scale;
    let h = 1.5 * scale;
    if (bubbles) {
      // Apple-Watch-style: round covers that shrink and drift inwards towards the edges.
      sy += 0.25 * scale;
      h = w;
      const dx = sx + w / 2 - o.cx;
      const dy = sy + h / 2 - o.cy;
      const d = Math.min(1, Math.hypot(dx, dy) / o.reach);
      const f = Math.max(0.25, 1 - d * d * 0.75);
      const pull = 0.82 + 0.18 * f;
      sx = o.cx + dx * pull - (w * f) / 2;
      sy = o.cy + dy * pull - (h * f) / 2;
      w *= f * 1.1;
      h *= f * 1.1;
    }
    if (sx + w < 0 || sy + h < 0 || sx > width || sy > height) return;
    const url = it.book.cover!;
    const bmp = w >= 26 ? ready.get(url) : undefined;
    if (w >= 26 && !bmp && cache.meta(url)?.px) want(url);
    ctx.save();
    if (bubbles) {
      ctx.beginPath();
      ctx.arc(sx + w / 2, sy + h / 2, w / 2, 0, Math.PI * 2);
      ctx.clip();
    }
    if (bmp) {
      if (bubbles) {
        const side = Math.min(bmp.width, bmp.height);
        ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 3, side, side, sx, sy, w, h);
      } else ctx.drawImage(bmp, sx, sy, w, h);
    } else {
      ctx.fillStyle = it.analysis ? rgbCss(it.analysis.color) : o.grey;
      ctx.fillRect(sx, sy, w, h);
    }
    ctx.restore();
    if (id === focusId || id === selected?.id) {
      ctx.strokeStyle = o.ring;
      ctx.lineWidth = 3;
      if (bubbles) {
        ctx.beginPath();
        ctx.arc(sx + w / 2, sy + h / 2, w / 2 + 2, 0, Math.PI * 2);
        ctx.stroke();
      } else ctx.strokeRect(sx - 2, sy - 2, w + 4, h + 4);
    }
  }

  // ---- input
  const pointers = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; t: number; moved: boolean } | undefined;
  let pinch: { d: number; s: number; mx: number; my: number; ox: number; oy: number } | undefined;

  function zoomAt(factor: number, x: number, y: number) {
    const s = Math.max(2, Math.min(600, scale * factor));
    ox = x - ((x - ox) * s) / scale;
    oy = y - ((y - oy) * s) / scale;
    scale = s;
    dirty = true;
  }

  function local(e: PointerEvent | WheelEvent | MouseEvent) {
    const r = canvas!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function onDown(e: PointerEvent) {
    canvas!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    anim = undefined;
    if (pointers.size === 1) down = { ...p, t: performance.now(), moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, ox, oy };
      if (down) down.moved = true;
    }
  }

  function onMove(e: PointerEvent) {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const s = Math.max(2, Math.min(600, (pinch.s * d) / pinch.d));
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      ox = mx - ((pinch.mx - pinch.ox) * s) / pinch.s;
      oy = my - ((pinch.my - pinch.oy) * s) / pinch.s;
      scale = s;
      dirty = true;
      return;
    }
    ox += p.x - prev.x;
    oy += p.y - prev.y;
    if (down && Math.hypot(p.x - down.x, p.y - down.y) > 6) down.moved = true;
    dirty = true;
  }

  function onUp(e: PointerEvent) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = undefined;
    if (down && !down.moved && pointers.size === 0 && performance.now() - down.t < 450) tap(down.x, down.y);
    if (pointers.size === 0) down = undefined;
  }

  /** The cover under a screen point, if any (wrapping around in endless mode). */
  function hit(x: number, y: number): string | undefined {
    const wx = (x - ox) / scale;
    const wy = (y - oy) / scale;
    let col = Math.floor(wx / CELL_W);
    let row = Math.floor(wy / CELL_H);
    if (period) {
      col = mod(col, period.cols);
      row = mod(row, period.rows);
    }
    // Taps in the thin gaps count for the cover they belong to (fingers aren't precise).
    return cellMap.get(`${col},${row}`);
  }

  function tap(x: number, y: number) {
    const id = hit(x, y);
    if (!id) {
      selected = undefined;
      dirty = true;
      return;
    }
    if (scale < 110) {
      // Zoom in around the tapped point (works for every endless copy too).
      const s2 = 170;
      animateTo(s2, x - ((x - ox) * s2) / scale, y - ((y - oy) * s2) / scale);
      selected = byId.get(id)?.book;
    } else if (selected?.id === id) navigate(`/book/${id}`);
    else selected = byId.get(id)?.book;
    dirty = true;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = local(e);
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * 0.0018), p.x, p.y);
    else {
      ox -= e.deltaX;
      dirty = true;
    }
  }

  function onKey(e: KeyboardEvent) {
    const step = 80;
    if (e.key === '+' || e.key === '=') zoomAt(1.25, width / 2, height / 2);
    else if (e.key === '-') zoomAt(0.8, width / 2, height / 2);
    else if (e.key === 'ArrowLeft') ox += step;
    else if (e.key === 'ArrowRight') ox -= step;
    else if (e.key === 'ArrowUp') oy += step;
    else if (e.key === 'ArrowDown') oy -= step;
    else if (e.key === '0') fit();
    else return;
    e.preventDefault();
    dirty = true;
  }

  function resize() {
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    width = wrap.clientWidth;
    height = wrap.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    dirty = true;
  }

  let ro: ResizeObserver | undefined;
  onMount(() => {
    resize();
    ro = new ResizeObserver(() => resize());
    ro.observe(wrap!);
    raf = requestAnimationFrame(draw);
  });
  onDestroy(() => {
    cancelAnimationFrame(raf);
    ro?.disconnect();
  });

  // Re-fit when the arrangement changes; jump to a focused book once.
  let focusedOnce = false;
  $effect(() => {
    void layout;
    untrack(() => {
      fit();
      if (focusId && !focusedOnce && focusOn(focusId, 160)) {
        focusedOnce = true;
        selected = byId.get(focusId)?.book;
      }
    });
  });
  $effect(() => {
    void $cacheVersion;
    dirty = true;
  });

  // ---- poster export
  let exporting = $state(false);
  async function exportPoster() {
    exporting = true;
    try {
      const b = layout.bounds;
      const colsN = b.maxCol - b.minCol + 1;
      const rowsN = b.maxRow - b.minRow + 1;
      const cell = Math.max(24, Math.min(160, Math.floor(4096 / (colsN * CELL_W))));
      const pad = cell;
      const out = document.createElement('canvas');
      out.width = Math.round(colsN * CELL_W * cell + pad * 2);
      out.height = Math.round(rowsN * CELL_H * cell + pad * 2);
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = css('--bg', '#f7f5f0');
      ctx.fillRect(0, 0, out.width, out.height);
      let done = 0;
      for (const t of layout.tiles) {
        const it = byId.get(t.id)!;
        const x = pad + (t.col - b.minCol) * CELL_W * cell;
        const y = pad + (t.row - b.minRow) * CELL_H * cell;
        const bmp = cache.meta(it.book.cover)?.px ? await cache.bitmap(it.book.cover!) : undefined;
        if (bmp) ctx.drawImage(bmp, x, y, cell, cell * 1.5);
        else {
          ctx.fillStyle = it.analysis ? rgbCss(it.analysis.color) : css('--surface-2', '#ddd');
          ctx.fillRect(x, y, cell, cell * 1.5);
        }
        if (++done % 200 === 0) await new Promise((r) => setTimeout(r));
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const l of layout.labels.filter((x) => x.level === 1)) {
        const size = Math.round(cell * 0.9);
        ctx.font = `700 ${size}px system-ui, sans-serif`;
        const x = pad + (l.x - b.minCol * CELL_W) * cell;
        const y = pad + (l.y - b.minRow * CELL_H) * cell;
        const text = `${l.text} · ${l.count}`;
        const w = ctx.measureText(text).width + size;
        ctx.fillStyle = 'rgba(20,20,20,0.82)';
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - size * 0.8, w, size * 1.6, size * 0.8);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, x, y);
      }
      const blob = await new Promise<Blob>((res, rej) => out.toBlob((bl) => (bl ? res(bl) : rej(new Error('Export failed'))), 'image/jpeg', 0.9));
      const result = await saveFile(new File([blob], `booked-wall-${order}-${stamp()}.jpg`, { type: 'image/jpeg' }));
      if (result !== 'cancelled') toast('Poster saved');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      exporting = false;
    }
  }
</script>

<div class="wall">
  <header class="bar">
    <a class="btn btn-ghost btn-icon" href="#/books" aria-label="Back to library"><Icon name="back" /></a>
    <select value={order} aria-label="Arrange by" onchange={(e) => setQuery({ order: e.currentTarget.value === 'color' ? undefined : e.currentTarget.value })}>
      {#each Object.entries(FIELD_ORDERS) as [k, l]}<option value={k}>{l}</option>{/each}
    </select>
    <select value={topic} aria-label="Topic" onchange={(e) => setQuery({ topic: e.currentTarget.value || undefined })}>
      <option value="">All topics</option>
      {#each topics as t (t.name)}<option value={t.name}>{t.name} ({t.count})</option>{/each}
    </select>
  </header>
  {#if chips.length || hiddenCount || uncached}
    <div class="info small">
      {plural(items.length, 'cover')}
      {#each chips as c}<span class="chip">{c.label}</span>{/each}
      {#if niceOnly && hiddenCount}<button class="linkish" onclick={() => setQuery({ all: '1' })}>{hiddenCount} without a good cover hidden</button>
      {:else if !niceOnly}<button class="linkish" onclick={() => setQuery({ all: undefined })}>only good covers</button>{/if}
      {#if uncached && $cacheStatus.decision !== 'yes'}
        <button class="linkish" onclick={() => cache.run(true)}>{uncached} covers not saved yet: download</button>
      {:else if uncached}<span class="muted">saving {uncached} covers…</span>{/if}
    </div>
  {/if}

  <div class="stage" bind:this={wrap}>
    {#if items.length === 0}
      <div class="empty">
        <p>No covers to show{chips.length ? ' for this filter' : ''} yet.</p>
        <a class="btn" href="#/settings">Cover settings</a>
      </div>
    {/if}
    <div class="tools" role="toolbar" aria-label="Wall options">
      <button class:on={shape === 'endless'} aria-pressed={shape === 'endless'} title="Endless: scroll forever in every direction"
        aria-label="Endless scrolling" onclick={() => setQuery({ shape: shape === 'endless' ? undefined : 'endless' })}>∞</button>
      <button class:on={bubbles} aria-pressed={bubbles} title="Bubbles" aria-label="Bubbles" onclick={() => setQuery({ style: bubbles ? undefined : 'bubbles' })}>◉</button>
      <button aria-label="Back to the start" title="Back to the start" onclick={fit}>⤢</button>
      <button aria-label="Save as poster" title="Save as poster" disabled={exporting} onclick={exportPoster}>{exporting ? '…' : '⤓'}</button>
    </div>
    <canvas bind:this={canvas} tabindex="0" aria-label="Cover wall: drag to move, pinch or +/- to zoom, tap a cover"
      onpointerdown={onDown} onpointermove={onMove} onpointerup={onUp} onpointercancel={onUp} onwheel={onWheel} onkeydown={onKey}></canvas>
  </div>

  {#if selected}
    <div class="sel card">
      <div class="sel-text">
        <strong>{selected.title}</strong>
        <span class="muted small">{selected.authors.join(', ')}{selected.firstPublishedYear ? ` · ${selected.firstPublishedYear}` : ''} · {lib.label(selected.locationId)}</span>
      </div>
      <a class="btn btn-sm btn-primary" href="#/book/{selected.id}">Open</a>
    </div>
  {:else}
    <p class="hint muted small">Pinch or scroll to zoom · drag to move · tap a cover</p>
  {/if}
</div>

<style>
  .wall { position: fixed; inset: 0 0 calc(var(--nav-h) + env(safe-area-inset-bottom)) 0; display: flex; flex-direction: column; background: var(--bg); }
  .bar { display: flex; gap: 6px; align-items: center; padding: 8px 10px 4px; }
  .bar select { width: auto; min-height: 40px; border-radius: 999px; flex: 1; min-width: 0; max-width: 220px; padding: 0 10px; font-size: 0.95rem; }
  .tools { position: absolute; right: 10px; top: 10px; z-index: 2; display: grid; gap: 8px; }
  .tools button { width: 44px; min-height: 44px; padding: 0; border-radius: 50%; font-size: 1.15rem; box-shadow: var(--shadow); }
  .tools .on { background: var(--accent); color: var(--accent-text); border-color: transparent; }
  .info { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding: 0 12px 6px; color: var(--muted); }
  .linkish { min-height: 28px; padding: 0 8px; border: none; background: transparent; color: var(--text); text-decoration: underline; font-size: 0.85rem; }
  .stage { position: relative; flex: 1; min-height: 0; }
  canvas { display: block; touch-action: none; cursor: grab; outline: none; }
  canvas:active { cursor: grabbing; }
  .empty { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; gap: 8px; color: var(--muted); }
  .sel { position: absolute; left: 10px; right: 10px; bottom: 10px; display: flex; gap: 10px; align-items: center; padding: 10px 12px; }
  .sel-text { flex: 1; display: grid; min-width: 0; }
  .sel-text strong, .sel-text span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { position: absolute; left: 0; right: 0; bottom: 6px; text-align: center; margin: 0; pointer-events: none; }
</style>

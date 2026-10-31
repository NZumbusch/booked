<script lang="ts">
  import { tick } from 'svelte';
  import type { CoverOption } from '../metadata/covers';

  /**
   * Covers in loose overlapping piles. Tap one to pull it out (it glides to the centre, full
   * size); swipe sideways to flip through, swipe down or tap outside to put it back.
   */
  let { options, onchoose, onbroken }: { options: CoverOption[]; onchoose: (o: CoverOption) => void; onbroken?: (o: CoverOption) => void } = $props();

  const COLS = 3;
  const columns = $derived(Array.from({ length: COLS }, (_, c) => options.map((o, i) => ({ o, i })).filter(({ i }) => i % COLS === c)));
  // A little irregularity makes the piles look like real books, not a spreadsheet.
  const tilt = (i: number) => (((i * 37) % 7) - 3) * 0.45;
  const nudge = (i: number) => (((i * 53) % 5) - 2) * 1.2;

  let focus = $state<number>();
  let big: HTMLImageElement | undefined = $state();
  let overlay: HTMLDivElement | undefined = $state();
  let dragX = $state(0);
  let dragY = $state(0);
  let dragging = $state(false);
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPRING = 'cubic-bezier(0.2, 0.9, 0.25, 1.08)';

  const cardOf = (i: number) => document.querySelector<HTMLElement>(`[data-cover-index="${i}"]`);

  /** FLIP: animate the big cover from where the small one sits in the pile. */
  function fromCard(i: number): Keyframe {
    const card = cardOf(i)?.getBoundingClientRect();
    const target = big!.getBoundingClientRect();
    if (!card || !target.width) return { opacity: 0, transform: 'scale(0.8)' };
    const s = card.width / target.width;
    const dx = card.left + card.width / 2 - (target.left + target.width / 2);
    const dy = card.top + card.height / 2 - (target.top + target.height / 2);
    return { transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${tilt(i)}deg)`, opacity: 1 };
  }

  async function pullOut(i: number) {
    focus = i;
    await tick();
    if (!big || reduce) return;
    big.animate([fromCard(i), { transform: 'none' }], { duration: 460, easing: SPRING });
    overlay?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
  }

  async function putBack() {
    if (focus === undefined) return;
    const i = focus;
    if (big && overlay && !reduce) {
      const current = `translate(${dragX}px, ${dragY}px) rotate(${dragX * 0.04}deg)`;
      const fly = big.animate([{ transform: current }, fromCard(i)], { duration: 380, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards' });
      overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, easing: 'ease-in', fill: 'forwards' });
      await fly.finished.catch(() => {});
    }
    dragX = dragY = 0;
    focus = undefined;
  }

  /** Flip to the next/previous cover: the current one slides away, the new one slides in. */
  async function step(dir: 1 | -1) {
    if (focus === undefined) return;
    const next = focus + dir;
    if (next < 0 || next >= options.length) {
      // End of the pile: a small rubber-band bounce.
      big?.animate([{ transform: `translateX(${dragX}px)` }, { transform: `translateX(${-dir * 18}px)` }, { transform: 'none' }], { duration: 320, easing: 'ease-out' });
      dragX = 0;
      return;
    }
    if (big && !reduce) {
      await big.animate([{ transform: `translateX(${dragX}px) rotate(${dragX * 0.04}deg)` }, { transform: `translateX(${-dir * 120}%) rotate(${-dir * 8}deg)`, opacity: 0 }],
        { duration: 220, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    }
    dragX = 0;
    focus = next;
    await tick();
    if (big && !reduce) {
      big.getAnimations().forEach((a) => a.cancel());
      big.animate([{ transform: `translateX(${dir * 110}%) rotate(${dir * 6}deg)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: SPRING });
    }
    cardOf(next)?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- gestures on the pulled-out cover
  let start: { x: number; y: number; t: number } | undefined;
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, t: performance.now() };
    dragging = true;
  }
  function move(e: PointerEvent) {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // Lock to the main direction so a sideways swipe doesn't wobble vertically.
    if (Math.abs(dx) > Math.abs(dy)) [dragX, dragY] = [dx, 0];
    else [dragX, dragY] = [0, Math.max(0, dy) + Math.min(0, dy) * 0.2];
  }
  function up() {
    if (!start) return;
    const fast = performance.now() - start.t < 250;
    start = undefined;
    dragging = false;
    if (dragY > 110 || (fast && dragY > 40)) return putBack();
    if (dragX < -80 || (fast && dragX < -30)) return step(1);
    if (dragX > 80 || (fast && dragX > 30)) return step(-1);
    big?.animate([{ transform: `translate(${dragX}px, ${dragY}px) rotate(${dragX * 0.04}deg)` }, { transform: 'none' }], { duration: 300, easing: SPRING });
    dragX = dragY = 0;
  }
  function key(e: KeyboardEvent) {
    if (focus === undefined) return;
    if (e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Escape' || e.key === 'ArrowDown') putBack();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  const current = $derived(focus === undefined ? undefined : options[focus]);

  // The small picture is already loaded: show it at once, swap in the sharp one when it arrives.
  // Neighbours are fetched ahead so swiping stays instant.
  let sharp = $state(new Set<string>());
  $effect(() => {
    if (focus === undefined) return;
    for (const o of [options[focus], options[focus + 1], options[focus - 1]]) {
      if (!o || sharp.has(o.url)) continue;
      const img = new Image();
      img.onload = () => (sharp = new Set([...sharp, o.url]));
      img.src = o.url;
    }
  });
</script>

<svelte:window onkeydown={key} />

<div class="piles">
  {#each columns as col, c (c)}
    <div class="pile">
      {#each col as { o, i } (o.url)}
        <button class="pc" class:mine={o.sameEdition} class:out={focus === i} data-cover-index={i}
          style="--tilt: {tilt(i)}deg; --nudge: {nudge(i)}px; z-index: {i + 1}"
          onclick={() => pullOut(i)} aria-label={`Look at cover: ${o.label || 'other edition'}`}>
          <img src={o.thumb} alt="" loading="lazy" draggable="false" onerror={() => onbroken?.(o)} />
          {#if o.sameEdition}<span class="badge">Your edition</span>{/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

{#if current && focus !== undefined}
  <div class="overlay" bind:this={overlay} role="presentation" onclick={(e) => e.target === e.currentTarget && putBack()}>
    <div class="viewer">
      <img bind:this={big} class="big" class:dragging src={sharp.has(current.url) ? current.url : current.thumb} alt={current.label}
        style="transform: translate({dragX}px, {dragY}px) rotate({dragX * 0.04}deg); opacity: {1 - Math.min(0.5, dragY / 400)}"
        onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} draggable="false" />
      <div class="meta">
        {#if current.sameEdition}<span class="badge">Your edition</span>{/if}
        <span>{current.label || (current.source === 'googlebooks' ? 'Google Books' : 'Open Library')}</span>
        <span class="count">{focus + 1} / {options.length}</span>
      </div>
      <div class="actions">
        <button onclick={putBack}>Put back</button>
        <button class="btn-primary" onclick={() => onchoose(current)}>Use this cover</button>
      </div>
      <p class="hint">Swipe to flip through · swipe down to put back</p>
    </div>
  </div>
{/if}

<style>
  .piles { isolation: isolate; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 6px 4px 40px; align-items: start; }
  .pile { display: grid; }
  .pc {
    position: relative; display: block; padding: 0; border: none; background: none; min-height: 0; height: auto; border-radius: 6px;
    white-space: normal; cursor: pointer;
    /* Each cover covers most of the one above: a strip of every cover stays visible. */
    margin-top: -108%;
    transform: translateX(var(--nudge)) rotate(var(--tilt));
    transition: transform 0.25s cubic-bezier(0.2, 0.9, 0.25, 1.1), opacity 0.2s;
  }
  .pc:first-child { margin-top: 0; }
  .pc img { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; background: var(--surface-2);
    box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.18), 0 1px 2px rgba(0, 0, 0, 0.12); pointer-events: none; }
  .pc:hover, .pc:focus-visible { transform: translateX(var(--nudge)) translateY(-12%) rotate(calc(var(--tilt) * 0.3)); }
  .pc:active { transform: translateX(var(--nudge)) translateY(-16%) scale(1.02); }
  .pc.out { opacity: 0.15; }
  .pc.mine img { outline: 3px solid var(--brand); outline-offset: 1px; }
  .pc .badge { position: absolute; top: 4px; left: 4px; }

  .overlay { position: fixed; inset: 0; z-index: 10; display: grid; place-items: center; padding: 16px;
    background: color-mix(in srgb, var(--bg) 78%, transparent); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(14px); }
  .viewer { display: grid; gap: 14px; justify-items: center; width: min(100%, 380px); }
  .big { width: min(72vw, 320px, calc((100dvh - 240px) * 2 / 3)); aspect-ratio: 2 / 3; object-fit: cover; border-radius: 10px; touch-action: none; user-select: none; cursor: grab;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35), 0 4px 12px rgba(0, 0, 0, 0.2); background: var(--surface-2); }
  .big.dragging { cursor: grabbing; }
  .meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; text-align: center; font-weight: 600; }
  .count { color: var(--muted); font-weight: 500; font-variant-numeric: tabular-nums; }
  .actions { display: flex; gap: 10px; }
  .hint { margin: 0; color: var(--muted); font-size: 0.8rem; }
  @media (prefers-reduced-motion: reduce) { .pc { transition: none; } }
</style>

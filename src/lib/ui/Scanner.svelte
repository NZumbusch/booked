<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isbnFromBarcode, ScanGuard } from '../domain/scan';
  import { priceFromEan5 } from '../domain/price';
  import type { ListPrice } from '../domain/types';
  import { readIsbnText, stopOcr } from '../scanner/ocr';
  import {
    backCameras, canFocus, canTorch, centreCrop, focusAt, getDetector, needsRefocus, openCamera, readAddOn, refocus, saveCamera,
    savedCamera, scanZoom, setTorch, setZoom, tapToImagePoint, useContinuousFocus, zoomRange, type CameraInfo, type Detector
  } from '../scanner/camera';

  let { onscan, onprice, paused = false, compact = false }: {
    /** Called once per fresh sighting of a valid ISBN barcode. */
    onscan: (isbn: string) => void;
    /** Called shortly after, if the small price barcode next to the ISBN could be read. */
    onprice?: (isbn: string, price: ListPrice) => void;
    paused?: boolean;
    compact?: boolean;
  } = $props();

  let video: HTMLVideoElement | undefined = $state();
  let stream: MediaStream | undefined;
  let detector: Detector | undefined;
  let error = $state('');
  let ready = $state(false);
  let torch = $state(false);
  let torchAvailable = $state(false);
  let focusAvailable = $state(false);
  /** Back cameras to switch between (phones with several lenses). */
  let cameras = $state<CameraInfo[]>([]);
  let cameraId = $state<string>();
  let zoom = $state<number>();
  let zoomMax = $state(1);
  let lastHit = 0;
  let lastRefocus = 0;
  let ring = $state<{ x: number; y: number; n: number }>();
  let flash = $state(false);
  /** Read the ISBN printed as text (for old books whose barcode isn't an ISBN). */
  let textMode = $state(false);
  let ocrBusy = $state(false);
  let ocrError = $state('');
  let lastOcr = 0;
  let stopped = false;
  const guard = new ScanGuard(1500);

  /** Open a camera (or the default back camera) and set it up for close-up scanning. */
  async function start(deviceId?: string) {
    stream?.getTracks().forEach((t) => t.stop());
    stream = await openCamera(deviceId);
    if (stopped) return stop();
    cameraId = stream.getVideoTracks()[0]?.getSettings?.().deviceId;
    video!.srcObject = stream;
    await video!.play();
    torch = false;
    torchAvailable = canTorch(stream);
    focusAvailable = canFocus(stream);
    await useContinuousFocus(stream).catch(() => {});
    zoomMax = zoomRange(stream)?.max ?? 1;
    zoom = await scanZoom(stream).catch(() => undefined);
  }

  onMount(async () => {
    try {
      const chosen = savedCamera();
      [, detector] = await Promise.all([start(chosen), getDetector()]);
      if (stopped) return;
      ready = true;
      loop();
      // Camera names are only readable once the camera is allowed: now pick the main lens if the
      // browser handed us another one (ultra-wide and telephoto lenses focus badly up close).
      cameras = await backCameras().catch(() => []);
      const best = cameras[0];
      if (!chosen && best?.label && cameraId && best.deviceId !== cameraId && cameras.some((c) => c.deviceId === cameraId)) {
        await start(best.deviceId);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  /** Try the next back camera; the choice is kept for next time. */
  async function switchCamera() {
    if (cameras.length < 2) return;
    const i = cameras.findIndex((c) => c.deviceId === cameraId);
    const next = cameras[(i + 1) % cameras.length];
    saveCamera(next.deviceId);
    ready = false;
    try {
      await start(next.deviceId);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      ready = true;
    }
  }

  const ZOOMS = [1, 1.6, 2.5];
  async function cycleZoom() {
    if (!stream) return;
    const options = ZOOMS.filter((z) => z <= zoomMax);
    const i = options.findIndex((z) => Math.abs(z - (zoom ?? 1)) < 0.05);
    const next = options[(i + 1) % options.length];
    await setZoom(stream, next).then(() => (zoom = next)).catch(() => {});
  }
  const cameraName = $derived(cameras.find((c) => c.deviceId === cameraId)?.label ?? '');

  async function loop() {
    while (!stopped) {
      if (!paused && video && video.readyState >= 2 && detector) {
        try {
          // The WASM decoder (iPhone) gets the middle band only: much quicker, so more frames are read.
          const source = detector.kind === 'wasm' ? (centreCrop(video) ?? video) : video;
          const found = await detector.detect(source);
          if (found.length) lastHit = performance.now();
          for (const raw of found) {
            const isbn = isbnFromBarcode(raw);
            if (isbn && guard.see(isbn, performance.now())) {
              flash = true;
              setTimeout(() => (flash = false), 250);
              onscan(isbn);
              if (onprice) lookForPrice(isbn);
            }
          }
        } catch {
          // a dropped frame is fine
        }
      }
      // Cameras with only a one-shot focus: focus again every few seconds while nothing is found.
      const t = performance.now();
      if (stream && !paused && t - lastHit > 2500 && t - lastRefocus > 2500 && needsRefocus(stream)) {
        lastRefocus = t;
        refocus(stream).catch(() => {});
      }
      if (textMode && !paused && video && video.readyState >= 2 && !ocrBusy && performance.now() - lastOcr > 900) readText();
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  async function readText() {
    ocrBusy = true;
    ocrError = '';
    try {
      const isbn = await readIsbnText(video!);
      if (isbn && guard.see(isbn, performance.now())) {
        flash = true;
        setTimeout(() => (flash = false), 250);
        onscan(isbn);
      }
    } catch {
      ocrError = navigator.onLine ? 'Text reading couldn’t start.' : 'Text reading needs a connection the first time.';
      textMode = false;
    } finally {
      lastOcr = performance.now();
      ocrBusy = false;
    }
  }

  let priceSearch: string | undefined;
  /** Try a few frames for the price add-on; never delays the scan itself. */
  async function lookForPrice(isbn: string) {
    if (priceSearch === isbn) return;
    priceSearch = isbn;
    for (let i = 0; i < 4 && !stopped && priceSearch === isbn; i++) {
      try {
        const addon = video && (await readAddOn(video, isbn));
        const price = addon && priceFromEan5(addon);
        if (price) {
          onprice?.(isbn, price);
          break;
        }
        if (addon) break; // e.g. 90000 = no price printed
      } catch {
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    if (priceSearch === isbn) priceSearch = undefined;
  }

  function stop() {
    stopped = true;
    stream?.getTracks().forEach((t) => t.stop());
  }

  /** Tap the picture to focus there. */
  function tapFocus(e: MouseEvent) {
    if (!stream || !video?.videoWidth) return;
    const r = video.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    ring = { x, y, n: (ring?.n ?? 0) + 1 };
    setTimeout(() => ring && (ring = undefined), 900);
    const p = tapToImagePoint(x, y, { w: r.width, h: r.height }, { w: video.videoWidth, h: video.videoHeight });
    focusAt(stream, p.x, p.y).catch(() => {});
  }

  async function toggleTorch() {
    if (!stream) return;
    torch = !torch;
    await setTorch(stream, torch).catch(() => (torchAvailable = false));
  }

  onDestroy(() => {
    stop();
    stopOcr().catch(() => {});
  });
</script>

<div class="scanner" class:compact class:flash>
  {#if error}
    <div class="msg">
      <p>📷 {error}</p>
      <p class="small">You can still type the ISBN below.</p>
    </div>
  {:else}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline muted onclick={tapFocus}></video>
    {#key ring?.n}{#if ring}<div class="ring" style:left="{ring.x}px" style:top="{ring.y}px"></div>{/if}{/key}
    <div class="frame" aria-hidden="true"></div>
    {#if !ready}<div class="msg">Starting camera…</div>{/if}
    {#if paused && ready}<div class="msg dim">Paused</div>{/if}
    <button class="textmode btn-sm" onclick={() => (textMode = !textMode)} aria-pressed={textMode}>{textMode ? (ocrBusy ? 'Aa Reading…' : 'Aa Text on') : 'Aa Read text'}</button>
    {#if !textMode && !ocrError}<div class="hint soft">{focusAvailable ? 'Blurry? Tap to focus, or hold the book a bit further away' : 'Blurry? Hold the book a bit further away'}</div>{/if}
    {#if textMode}<div class="hint">Hold the printed ISBN (e.g. “ISBN 0-553-28058-9”) inside the frame</div>{/if}
    {#if ocrError}<div class="hint err">{ocrError}</div>{/if}
    <div class="tools">
      {#if zoom !== undefined && zoomMax > 1.2}
        <button class="btn-sm" onclick={cycleZoom} title="Zoom: hold the phone a little further away if the picture is blurry">{(zoom ?? 1).toFixed(1).replace('.0', '')}×</button>
      {/if}
      {#if cameras.length > 1}
        <button class="btn-sm" onclick={switchCamera} title="Use another camera{cameraName ? ` (now: ${cameraName})` : ''}" aria-label="Switch camera">🔄</button>
      {/if}
      {#if torchAvailable}
        <button class="btn-sm" onclick={toggleTorch} aria-pressed={torch}>{torch ? '🔦 On' : '🔦 Light'}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .scanner {
    position: relative; overflow: hidden; border-radius: 20px; background: #000; aspect-ratio: 4 / 3;
    width: 100%; max-height: 52dvh; transition: box-shadow 0.2s;
  }
  .scanner.compact { aspect-ratio: 16 / 9; max-height: 34dvh; }
  .scanner.flash { box-shadow: 0 0 0 4px var(--ok); }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .frame {
    position: absolute; left: 12%; right: 12%; top: 30%; bottom: 30%; border-radius: 14px;
    border: 3px solid rgb(255 255 255 / 0.85); box-shadow: 0 0 0 100vmax rgb(0 0 0 / 0.25);
  }
  .compact .frame { top: 22%; bottom: 22%; }
  .msg {
    position: absolute; inset: 0; display: grid; place-content: center; text-align: center; color: #fff; padding: 16px;
  }
  .msg.dim { background: rgb(0 0 0 / 0.5); font-weight: 600; }
  .textmode { position: absolute; left: 10px; bottom: 10px; background: rgb(0 0 0 / 0.5); color: #fff; border-color: transparent; }
  .textmode[aria-pressed='true'] { background: var(--ok); }
  .ring {
    position: absolute; width: 64px; height: 64px; margin: -32px 0 0 -32px; border: 2px solid #fff; border-radius: 50%;
    pointer-events: none; animation: focus-ring 0.9s ease-out forwards;
  }
  @keyframes focus-ring { from { transform: scale(1.5); opacity: 1; } to { transform: scale(0.8); opacity: 0; } }
  .hint.soft { opacity: 0.8; pointer-events: none; }
  .hint { position: absolute; left: 10px; right: 10px; top: 8px; text-align: center; color: #fff; font-size: 0.8rem; text-shadow: 0 1px 3px #000; }
  .tools { position: absolute; right: 10px; bottom: 10px; display: flex; gap: 6px; }
  .tools button { background: rgb(0 0 0 / 0.5); color: #fff; border-color: transparent; }
  .tools button[aria-pressed='true'] { background: var(--ok); }
</style>

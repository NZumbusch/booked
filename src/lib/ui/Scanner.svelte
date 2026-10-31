<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { isbnFromBarcode, ScanGuard } from '../domain/scan';
  import { priceFromEan5 } from '../domain/price';
  import type { ListPrice } from '../domain/types';
  import { readIsbnText, stopOcr } from '../scanner/ocr';
  import { canTorch, getDetector, openCamera, readAddOn, setTorch, type Detector } from '../scanner/camera';

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
  let flash = $state(false);
  /** Read the ISBN printed as text (for old books whose barcode isn't an ISBN). */
  let textMode = $state(false);
  let ocrBusy = $state(false);
  let ocrError = $state('');
  let lastOcr = 0;
  let stopped = false;
  const guard = new ScanGuard(1500);

  onMount(async () => {
    try {
      [stream, detector] = await Promise.all([openCamera(), getDetector()]);
      if (stopped) return stop();
      video!.srcObject = stream;
      await video!.play();
      torchAvailable = canTorch(stream);
      ready = true;
      loop();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  async function loop() {
    while (!stopped) {
      if (!paused && video && video.readyState >= 2 && detector) {
        try {
          for (const raw of await detector.detect(video)) {
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
    <video bind:this={video} playsinline muted></video>
    <div class="frame" aria-hidden="true"></div>
    {#if !ready}<div class="msg">Starting camera…</div>{/if}
    {#if paused && ready}<div class="msg dim">Paused</div>{/if}
    <button class="textmode btn-sm" onclick={() => (textMode = !textMode)} aria-pressed={textMode}>{textMode ? (ocrBusy ? 'Aa Reading…' : 'Aa Text on') : 'Aa Read text'}</button>
    {#if textMode}<div class="hint">Hold the printed ISBN (e.g. “ISBN 0-553-28058-9”) inside the frame</div>{/if}
    {#if ocrError}<div class="hint err">{ocrError}</div>{/if}
    {#if torchAvailable}
      <button class="torch btn-sm" onclick={toggleTorch} aria-pressed={torch}>{torch ? '🔦 On' : '🔦 Light'}</button>
    {/if}
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
  .hint { position: absolute; left: 10px; right: 10px; top: 8px; text-align: center; color: #fff; font-size: 0.8rem; text-shadow: 0 1px 3px #000; }
  .torch { position: absolute; right: 10px; bottom: 10px; background: rgb(0 0 0 / 0.5); color: #fff; border-color: transparent; }
</style>

import type { Worker } from 'tesseract.js';
import { isbnFromText } from '../domain/scan';

let worker: Promise<Worker> | undefined;

/** The OCR engine is large (~3 MB incl. language data), so it is only fetched the first time it is used. */
function engine(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, PSM } = await import('tesseract.js');
    const w = await createWorker('eng');
    await w.setParameters({
      tessedit_char_whitelist: '0123456789Xx-– ISBN:',
      tessedit_pageseg_mode: PSM.SPARSE_TEXT
    });
    return w;
  })().catch((e) => {
    worker = undefined;
    throw e;
  });
  return worker;
}

export async function stopOcr() {
  const w = await worker?.catch(() => undefined);
  worker = undefined;
  await w?.terminate();
}

/** Grab the part of the video inside the scan frame as a high-contrast greyscale image. */
export function captureFrame(video: HTMLVideoElement, area = { x: 0.04, y: 0.25, w: 0.92, h: 0.5 }): HTMLCanvasElement | undefined {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return undefined;
  // The video is shown with object-fit: cover, but the stream itself is uncropped: use a generous centre band.
  const sw = vw * area.w, sh = vh * area.h;
  const scale = Math.min(2, 1600 / sw);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = 'grayscale(1) contrast(1.6)';
  ctx.drawImage(video, vw * area.x, vh * area.y, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/** Read an ISBN printed as text from the current video frame. */
export async function readIsbnText(video: HTMLVideoElement): Promise<string | undefined> {
  const frame = captureFrame(video);
  if (!frame) return undefined;
  const w = await engine();
  const { data } = await w.recognize(frame);
  return isbnFromText(data.text);
}

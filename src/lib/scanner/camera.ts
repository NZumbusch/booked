/** Camera + barcode detection. Native BarcodeDetector where available (Android/Chrome), WASM ZXing elsewhere (iOS). */

export interface Detector {
  detect(source: HTMLVideoElement): Promise<string[]>;
  kind: 'native' | 'wasm';
}

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
interface NativeDetectorCtor {
  new (opts: { formats: string[] }): NativeDetector;
  getSupportedFormats(): Promise<string[]>;
}

const FORMATS = ['ean_13'];

async function nativeDetector(): Promise<Detector | undefined> {
  const Ctor = (globalThis as { BarcodeDetector?: NativeDetectorCtor }).BarcodeDetector;
  if (!Ctor) return undefined;
  try {
    if (!(await Ctor.getSupportedFormats()).includes('ean_13')) return undefined;
    const d = new Ctor({ formats: FORMATS });
    return { kind: 'native', detect: async (v) => (await d.detect(v)).map((b) => b.rawValue) };
  } catch {
    return undefined;
  }
}

async function wasmDetector(): Promise<Detector> {
  // Loaded lazily so the ~1 MB decoder only downloads when the camera is first used,
  // and served from our own origin (precached) instead of a CDN so it works offline.
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import('barcode-detector/ponyfill'),
    import('zxing-wasm/reader/zxing_reader.wasm?url')
  ]);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) }
  });
  const d = new BarcodeDetector({ formats: FORMATS as never });
  return { kind: 'wasm', detect: async (v) => (await d.detect(v)).map((b) => b.rawValue) };
}

let detectorPromise: Promise<Detector> | undefined;
export function getDetector(): Promise<Detector> {
  detectorPromise ??= nativeDetector().then((n) => n ?? wasmDetector());
  return detectorPromise;
}

export async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('This browser cannot use the camera. Open the app via https in Safari or Chrome.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
  } catch (e) {
    const name = (e as DOMException)?.name;
    if (name === 'NotAllowedError') throw new Error('Camera access was denied. Allow it in your browser settings to scan.');
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new Error('No camera found on this device.');
    throw e;
  }
}

export function canTorch(stream: MediaStream): boolean {
  const track = stream.getVideoTracks()[0];
  const caps = track?.getCapabilities?.() as { torch?: boolean } | undefined;
  return !!caps?.torch;
}

export async function setTorch(stream: MediaStream, on: boolean): Promise<void> {
  await stream.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
}

// ------------------------------------------------------------- feedback

let audio: AudioContext | undefined;

/** Short beep (+ vibration). `kind` = ok: one high tone; ask: two lower tones. */
export function feedback(kind: 'ok' | 'ask' | 'error') {
  try {
    navigator.vibrate?.(kind === 'ok' ? 60 : [60, 80, 60]);
    audio ??= new AudioContext();
    const tones = kind === 'ok' ? [1320] : kind === 'ask' ? [880, 660] : [330];
    tones.forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      const t = audio!.currentTime + i * 0.13;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.12);
    });
  } catch {
    // feedback is best-effort
  }
}

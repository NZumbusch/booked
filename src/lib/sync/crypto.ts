/**
 * End-to-end encryption for shared places: AES-GCM 256 with a random key that only lives in the
 * share link (after the "#", which browsers never send to a server). Data is gzipped first.
 */

const b64url = {
  encode(bytes: Uint8Array): string {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  }
};
export { b64url };

export function randomId(bytes = 16): string {
  return b64url.encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function generateKey(): string {
  return randomId(32);
}

async function importKey(key: string): Promise<CryptoKey> {
  const raw = b64url.decode(key);
  if (raw.length !== 32) throw new Error('Invalid share key');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Response(data as BodyInit).body!.pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** JSON → gzip → AES-GCM → "v1.<iv>.<ciphertext>" */
export async function encryptJson(value: unknown, key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = await pipe(new TextEncoder().encode(JSON.stringify(value)), new CompressionStream('gzip'));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(key), plain as BufferSource));
  return `v1.${b64url.encode(iv)}.${b64url.encode(cipher)}`;
}

export async function decryptJson<T>(payload: string, key: string): Promise<T> {
  const [version, iv, cipher] = payload.split('.');
  if (version !== 'v1' || !iv || !cipher) throw new Error('Unknown data format');
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64url.decode(iv) as BufferSource }, await importKey(key), b64url.decode(cipher) as BufferSource);
  } catch {
    throw new Error('Could not decrypt the shared data (wrong or damaged link?)');
  }
  const json = await pipe(new Uint8Array(plain), new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(json)) as T;
}

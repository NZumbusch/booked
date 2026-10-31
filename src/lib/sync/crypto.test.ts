import { describe, expect, it } from 'vitest';
import { b64url, decryptJson, encryptJson, generateKey } from './crypto';

describe('share encryption', () => {
  it('round-trips data and compresses it', async () => {
    const key = generateKey();
    const value = { books: Array.from({ length: 200 }, (_, i) => ({ id: `b${i}`, title: 'The same long title again and again' })) };
    const payload = await encryptJson(value, key);
    expect(payload.startsWith('v1.')).toBe(true);
    expect(payload.length).toBeLessThan(JSON.stringify(value).length / 4);
    expect(payload).not.toContain('title');
    expect(await decryptJson(payload, key)).toEqual(value);
  });

  it('fails clearly with the wrong key or tampered data', async () => {
    const payload = await encryptJson({ a: 1 }, generateKey());
    await expect(decryptJson(payload, generateKey())).rejects.toThrow(/decrypt/);
    const tampered = payload.slice(0, -4) + (payload.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    await expect(decryptJson(tampered, generateKey())).rejects.toThrow();
  });

  it('uses URL-safe base64', () => {
    const bytes = Uint8Array.from([251, 255, 254, 0, 1]);
    const s = b64url.encode(bytes);
    expect(s).not.toMatch(/[+/=]/);
    expect(b64url.decode(s)).toEqual(bytes);
    expect(generateKey()).toHaveLength(43);
  });
});

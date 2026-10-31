import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const env = { GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', ALLOWED_ORIGIN: 'https://me.github.io, http://localhost:5173' };
const req = (path: string, body: unknown, origin = 'https://me.github.io', method = 'POST') =>
  new Request(`https://booked-auth.example.workers.dev${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined
  });

function mockGoogle(response: Record<string, unknown>, status = 200) {
  const calls: { url: string; params: URLSearchParams }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, params: new URLSearchParams(String(init.body)) });
    return new Response(JSON.stringify(response), { status });
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe('token helper worker', () => {
  it('exchanges a sign-in code using the secret and the popup redirect URI', async () => {
    const calls = mockGoogle({ access_token: 'at', expires_in: 3599, refresh_token: 'rt', id_token: 'should-not-leak' });
    const res = await worker.fetch(req('/token', { code: 'c0de' }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://me.github.io');
    expect(await res.json()).toEqual({ access_token: 'at', expires_in: 3599, refresh_token: 'rt' });
    expect(Object.fromEntries(calls[0].params)).toEqual({
      client_id: 'cid', client_secret: 'secret', code: 'c0de', grant_type: 'authorization_code', redirect_uri: 'postmessage'
    });
  });

  it('refreshes access tokens', async () => {
    const calls = mockGoogle({ access_token: 'at2', expires_in: 3599 });
    const res = await worker.fetch(req('/refresh', { refresh_token: 'rt' }), env);
    expect(await res.json()).toEqual({ access_token: 'at2', expires_in: 3599 });
    expect(calls[0].params.get('grant_type')).toBe('refresh_token');
  });

  it('passes on Google errors (e.g. revoked access)', async () => {
    mockGoogle({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    const res = await worker.fetch(req('/refresh', { refresh_token: 'old' }), env);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_grant');
  });

  it('rejects other origins and answers CORS preflights', async () => {
    mockGoogle({});
    expect((await worker.fetch(req('/token', { code: 'x' }, 'https://evil.example'), env)).status).toBe(403);
    const pre = await worker.fetch(req('/token', null, 'http://localhost:5173', 'OPTIONS'), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('rejects malformed requests', async () => {
    mockGoogle({});
    expect((await worker.fetch(req('/token', {}), env)).status).toBe(400);
    expect((await worker.fetch(req('/other', { code: 'x' }), env)).status).toBe(400);
  });
});

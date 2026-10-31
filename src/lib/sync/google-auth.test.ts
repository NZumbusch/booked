import { beforeEach, describe, expect, it } from 'vitest';
import type { Fetcher } from '../metadata/http';
import { GoogleAuth, type Gis } from './google-auth';
import { SyncAuthError } from './target';

/** Fake Google Identity Services: grants immediately, records what was requested. */
function fakeGis(log: string[]): Gis {
  return {
    accounts: {
      oauth2: {
        initTokenClient: (cfg) => ({ requestAccessToken: () => { log.push('token-popup'); cfg.callback({ access_token: 'at-popup', expires_in: 3600 }); } }),
        initCodeClient: (cfg) => ({ requestCode: () => { log.push('code-popup'); cfg.callback({ code: 'c0de' }); } }),
        revoke: (t) => log.push(`revoke ${t}`)
      }
    }
  };
}

function fakeHelper(calls: string[], refreshResult: () => { status: number; body: unknown }): Fetcher {
  return async (url, init) => {
    const body = JSON.parse(String(init?.body));
    calls.push(`${url.replace('https://helper.example', '')} ${JSON.stringify(body)}`);
    if (url.endsWith('/token')) return new Response(JSON.stringify({ access_token: 'at1', expires_in: 3600, refresh_token: 'rt' }));
    if (url.endsWith('/refresh')) {
      const r = refreshResult();
      return new Response(JSON.stringify(r.body), { status: r.status });
    }
    return new Response('{}');
  };
}

beforeEach(() => localStorage.clear());
const expireAccess = () => {
  const saved = JSON.parse(localStorage.getItem('booked.driveAuth')!);
  saved.access.expiresAt = Date.now() - 1;
  localStorage.setItem('booked.driveAuth', JSON.stringify(saved));
};

describe('GoogleAuth without helper', () => {
  it('uses the token popup, and needs a reconnect after expiry', async () => {
    const log: string[] = [];
    const auth = new GoogleAuth('cid', { gis: async () => fakeGis(log) });
    await expect(auth.accessToken()).rejects.toBeInstanceOf(SyncAuthError);
    await auth.connect();
    expect(log).toEqual(['token-popup']);
    expect(await auth.accessToken()).toBe('at-popup');
    expireAccess();
    const later = new GoogleAuth('cid', { gis: async () => fakeGis(log) });
    expect(later.connected).toBe(false);
    expect(later.everConnected).toBe(true);
    await expect(later.accessToken()).rejects.toBeInstanceOf(SyncAuthError);
  });
});

describe('GoogleAuth with token helper', () => {
  it('signs in once and then refreshes silently', async () => {
    const log: string[] = [];
    const calls: string[] = [];
    const opts = { helperUrl: 'https://helper.example/', gis: async () => fakeGis(log), fetcher: fakeHelper(calls, () => ({ status: 200, body: { access_token: 'at2', expires_in: 3600 } })) };
    const auth = new GoogleAuth('cid', opts);
    await auth.connect();
    expect(log).toEqual(['code-popup']);
    expect(calls[0]).toBe('/token {"code":"c0de"}');

    expireAccess();
    const later = new GoogleAuth('cid', opts); // e.g. the next day
    expect(later.connected).toBe(true);
    const [a, b] = await Promise.all([later.accessToken(), later.accessToken()]);
    expect([a, b]).toEqual(['at2', 'at2']);
    expect(calls.filter((c) => c.startsWith('/refresh'))).toHaveLength(1); // concurrent calls share one refresh
    expect(log).toEqual(['code-popup']); // no new popup
  });

  it('asks to sign in again when access was revoked', async () => {
    const calls: string[] = [];
    const opts = { helperUrl: 'https://helper.example', gis: async () => fakeGis([]), fetcher: fakeHelper(calls, () => ({ status: 400, body: { error: 'invalid_grant' } })) };
    const auth = new GoogleAuth('cid', opts);
    await auth.connect();
    expireAccess();
    const later = new GoogleAuth('cid', opts);
    await expect(later.accessToken()).rejects.toBeInstanceOf(SyncAuthError);
    expect(later.connected).toBe(false);
  });

  it('treats helper outages as temporary (not a sign-out)', async () => {
    const opts = { helperUrl: 'https://helper.example', gis: async () => fakeGis([]), fetcher: fakeHelper([], () => ({ status: 502, body: {} })) };
    const auth = new GoogleAuth('cid', opts);
    await auth.connect();
    expireAccess();
    const later = new GoogleAuth('cid', opts);
    await expect(later.accessToken()).rejects.not.toBeInstanceOf(SyncAuthError);
    expect(later.connected).toBe(true);
  });

  it('revokes via the helper on disconnect', async () => {
    const calls: string[] = [];
    const auth = new GoogleAuth('cid', { helperUrl: 'https://helper.example', gis: async () => fakeGis([]), fetcher: fakeHelper(calls, () => ({ status: 200, body: {} })) });
    await auth.connect();
    await auth.disconnect();
    expect(calls.at(-1)).toBe('/revoke {"token":"rt"}');
    expect(auth.connected).toBe(false);
  });
});

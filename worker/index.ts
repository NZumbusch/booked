/**
 * Booked token helper: a tiny Cloudflare Worker that lets the browser app stay signed in to
 * Google Drive. It holds the OAuth client secret (which a public web app can't), exchanges the
 * one-time sign-in code for a refresh token, and later turns that refresh token into fresh
 * hourly access tokens. It stores nothing.
 *
 * Config (wrangler.toml [vars] + secret):
 *   GOOGLE_CLIENT_ID      the OAuth client ID (…apps.googleusercontent.com)
 *   GOOGLE_CLIENT_SECRET  secret: `npx wrangler secret put GOOGLE_CLIENT_SECRET`
 *   ALLOWED_ORIGIN        where the app runs, e.g. https://you.github.io (comma-separate several)
 */

export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
}

async function google(url: string, params: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: 'bad_response' };
  }
  return { status: res.status, body };
}

/** Only pass on what the app needs (never echo the id_token or anything else). */
const pick = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in b).map((k) => [k, b[k]]));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

    let input: Record<string, string>;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'invalid_request' }, 400, origin);
    }
    const base = { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };
    const path = new URL(request.url).pathname;

    if (path === '/token' && input.code) {
      // Popup sign-in (Google Identity Services code client) uses the special redirect URI "postmessage".
      const r = await google(TOKEN_URL, { ...base, code: input.code, grant_type: 'authorization_code', redirect_uri: 'postmessage' });
      return json(pick(r.body, ['access_token', 'expires_in', 'refresh_token', 'scope', 'error', 'error_description']), r.status, origin);
    }
    if (path === '/refresh' && input.refresh_token) {
      const r = await google(TOKEN_URL, { ...base, refresh_token: input.refresh_token, grant_type: 'refresh_token' });
      return json(pick(r.body, ['access_token', 'expires_in', 'scope', 'error', 'error_description']), r.status, origin);
    }
    if (path === '/revoke' && input.token) {
      const r = await google(REVOKE_URL, { token: input.token });
      return json({ revoked: r.status === 200 }, 200, origin);
    }
    return json({ error: 'invalid_request' }, 400, origin);
  }
};

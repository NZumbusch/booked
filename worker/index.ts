/**
 * Booked token helper: a tiny Cloudflare Worker that lets the browser app stay signed in to
 * Google Drive. It holds the OAuth client secret (which a public web app can't), exchanges the
 * one-time sign-in code for a refresh token, and later turns that refresh token into fresh
 * hourly access tokens. It stores nothing.
 *
 * It also stores shared places (optional, needs a D1 database bound as DB): one encrypted blob per
 * place with a version number. The data is encrypted on the phone with a key that only exists in
 * the share link, so this Worker (and Cloudflare) only ever see ciphertext.
 *
 * Config (wrangler.toml [vars] + secret):
 *   GOOGLE_CLIENT_ID      the OAuth client ID (…apps.googleusercontent.com)
 *   GOOGLE_CLIENT_SECRET  secret: `npx wrangler secret put GOOGLE_CLIENT_SECRET`
 *   ALLOWED_ORIGIN        where the app runs, e.g. https://you.github.io (comma-separate several)
 */

/** The subset of Cloudflare's D1 API we use. */
export interface D1Like {
  prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta: { changes: number } }> } };
}

export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  ALLOWED_ORIGIN: string;
  /** Optional: enables shared places. */
  DB?: D1Like;
}

const MAX_SPACE_BYTES = 4 * 1024 * 1024;

function randomToken(bytes = 16): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Shared places: /space (create), /space/:id (GET read, PUT update), /space/:id/delete (owner). */
async function spaces(request: Request, env: Env, path: string, origin: string): Promise<Response> {
  if (!env.DB) return json({ error: 'sharing_not_enabled' }, 501, origin);
  const db = env.DB;
  const [, , id, action] = path.split('/'); // "", "space", id?, action?
  const now = new Date().toISOString();

  if (request.method === 'GET' && id) {
    const row = await db.prepare('SELECT version, data FROM spaces WHERE id = ?').bind(id).first<{ version: number; data: string }>();
    return row ? json({ version: row.version, data: row.data }, 200, origin) : json({ error: 'not_found' }, 404, origin);
  }

  let input: { data?: string; version?: number; adminToken?: string };
  try {
    input = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400, origin);
  }
  if (input.data !== undefined && (typeof input.data !== 'string' || input.data.length > MAX_SPACE_BYTES)) {
    return json({ error: 'too_large' }, 413, origin);
  }

  if (request.method === 'POST' && !id && input.data) {
    const newId = randomToken(16);
    const adminToken = randomToken(24);
    await db.prepare('INSERT INTO spaces (id, version, data, admin_hash, updated_at) VALUES (?, 1, ?, ?, ?)')
      .bind(newId, input.data, await sha256(adminToken), now).run();
    return json({ id: newId, version: 1, adminToken }, 201, origin);
  }
  if (request.method === 'PUT' && id && input.data && typeof input.version === 'number') {
    // Optimistic concurrency: only update if nobody else wrote since this client read.
    const r = await db.prepare('UPDATE spaces SET data = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?')
      .bind(input.data, now, id, input.version).run();
    if (r.meta.changes === 1) return json({ version: input.version + 1 }, 200, origin);
    const row = await db.prepare('SELECT version FROM spaces WHERE id = ?').bind(id).first<{ version: number }>();
    return row ? json({ error: 'conflict', version: row.version }, 409, origin) : json({ error: 'not_found' }, 404, origin);
  }
  if (request.method === 'POST' && id && action === 'delete' && input.adminToken) {
    const r = await db.prepare('DELETE FROM spaces WHERE id = ? AND admin_hash = ?').bind(id, await sha256(input.adminToken)).run();
    return r.meta.changes === 1 ? json({ deleted: true }, 200, origin) : json({ error: 'forbidden' }, 403, origin);
  }
  return json({ error: 'invalid_request' }, 400, origin);
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function cors(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
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

/** Cover hosts the image pass-through may fetch from (so the app can read pixels for colours). */
const IMAGE_HOSTS = /(^|\.)(books\.google\.com|googleusercontent\.com|covers\.openlibrary\.org|archive\.org)$/;

async function image(request: Request, origin: string): Promise<Response> {
  const target = new URL(request.url).searchParams.get('url') ?? '';
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return new Response('Bad url', { status: 400, headers: cors(origin) });
  }
  if (url.protocol !== 'https:' || !IMAGE_HOSTS.test(url.hostname)) return new Response('Host not allowed', { status: 403, headers: cors(origin) });
  const upstream = await fetch(url.toString(), { redirect: 'follow' });
  const type = upstream.headers.get('Content-Type') ?? '';
  if (!upstream.ok || !type.startsWith('image/')) return new Response('Not an image', { status: 502, headers: cors(origin) });
  return new Response(upstream.body, {
    headers: { ...cors(origin), 'Content-Type': type, 'Cache-Control': 'public, max-age=2592000' }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    if (request.method === 'GET' && new URL(request.url).pathname === '/img') return image(request, origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    const path = new URL(request.url).pathname;
    if (path === '/space' || path.startsWith('/space/')) return spaces(request, env, path, origin);
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);

    let input: Record<string, string>;
    try {
      input = await request.json();
    } catch {
      return json({ error: 'invalid_request' }, 400, origin);
    }
    const base = { client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET };

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

import { describe, expect, it } from 'vitest';
import worker, { type D1Like } from './index';

/** In-memory stand-in for the four D1 statements the Worker uses. */
function fakeD1(): D1Like & { rows: Map<string, { version: number; data: string; admin_hash: string }> } {
  const rows = new Map<string, { version: number; data: string; admin_hash: string }>();
  return {
    rows,
    prepare(sql: string) {
      return {
        bind(...v: unknown[]) {
          return {
            async first<T>() {
              const r = rows.get(v[0] as string);
              return (r ? { version: r.version, data: r.data } : null) as T | null;
            },
            async run() {
              if (sql.startsWith('INSERT')) rows.set(v[0] as string, { version: 1, data: v[1] as string, admin_hash: v[2] as string });
              if (sql.startsWith('UPDATE')) {
                const r = rows.get(v[2] as string);
                if (!r || r.version !== v[3]) return { meta: { changes: 0 } };
                rows.set(v[2] as string, { ...r, data: v[0] as string, version: r.version + 1 });
              }
              if (sql.startsWith('DELETE')) {
                const r = rows.get(v[0] as string);
                if (!r || r.admin_hash !== v[1]) return { meta: { changes: 0 } };
                rows.delete(v[0] as string);
              }
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
}

const ORIGIN = 'https://me.github.io';
const call = (env: object, method: string, path: string, body?: unknown, origin = ORIGIN) =>
  worker.fetch(new Request(`https://w.example${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  }), { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', ALLOWED_ORIGIN: ORIGIN, ...env });

describe('shared places storage', () => {
  it('creates, reads and updates with version checks', async () => {
    const DB = fakeD1();
    const created = await (await call({ DB }, 'POST', '/space', { data: 'v1.cipher' })).json();
    expect(created).toMatchObject({ version: 1 });
    expect(created.id).toMatch(/^[\w-]{20,}$/);
    expect(DB.rows.get(created.id)?.admin_hash).not.toBe(created.adminToken); // only a hash is stored

    expect(await (await call({ DB }, 'GET', `/space/${created.id}`)).json()).toEqual({ version: 1, data: 'v1.cipher' });
    const ok = await call({ DB }, 'PUT', `/space/${created.id}`, { version: 1, data: 'v1.new' });
    expect(await ok.json()).toEqual({ version: 2 });

    const stale = await call({ DB }, 'PUT', `/space/${created.id}`, { version: 1, data: 'v1.lost' });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: 'conflict', version: 2 });
  });

  it('only the owner can delete', async () => {
    const DB = fakeD1();
    const { id, adminToken } = await (await call({ DB }, 'POST', '/space', { data: 'x' })).json();
    expect((await call({ DB }, 'POST', `/space/${id}/delete`, { adminToken: 'guess' })).status).toBe(403);
    expect((await call({ DB }, 'POST', `/space/${id}/delete`, { adminToken })).status).toBe(200);
    expect((await call({ DB }, 'GET', `/space/${id}`)).status).toBe(404);
  });

  it('explains when sharing is not set up, and still checks the origin', async () => {
    expect((await call({}, 'GET', '/space/abc')).status).toBe(501);
    expect((await call({ DB: fakeD1() }, 'GET', '/space/abc', undefined, 'https://evil.example')).status).toBe(403);
  });

  it('rejects oversized data', async () => {
    expect((await call({ DB: fakeD1() }, 'POST', '/space', { data: 'x'.repeat(5 * 1024 * 1024) })).status).toBe(413);
  });
});

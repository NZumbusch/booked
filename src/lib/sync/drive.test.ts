import { describe, expect, it } from 'vitest';
import { EMPTY_SYNC } from '../domain/sync';
import type { Fetcher } from '../metadata/http';
import { DriveTarget } from './drive';
import { SyncAuthError, SyncConflict } from './target';

/** A tiny fake of the Drive v3 endpoints we use. */
function fakeDrive() {
  const state = { file: undefined as undefined | { id: string; version: number; content: string }, calls: [] as string[] };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
  const fetcher: Fetcher = async (url, init) => {
    state.calls.push(`${init?.method ?? 'GET'} ${url.replace(/\?.*/, '')}`);
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    if (url.includes('spaces=appDataFolder')) return json({ files: state.file ? [{ id: state.file.id, version: String(state.file.version) }] : [] });
    if (url.includes('alt=media')) return new Response(state.file!.content);
    if (init?.method === 'POST') {
      const body = String(init.body);
      expect(body).toContain('"parents":["appDataFolder"]');
      const content = body.split('\r\n\r\n')[2].split('\r\n--')[0];
      state.file = { id: 'f1', version: 1, content };
      return json({ id: 'f1', version: '1' });
    }
    if (init?.method === 'PATCH') {
      state.file = { id: 'f1', version: state.file!.version + 1, content: String(init.body) };
      return json({ id: 'f1', version: String(state.file.version) });
    }
    return json({}, 404);
  };
  return { state, fetcher };
}

const data = { ...EMPTY_SYNC, books: [{ id: 'b' }] } as never;

describe('DriveTarget', () => {
  it('creates the file in appDataFolder, then updates it', async () => {
    const { state, fetcher } = fakeDrive();
    const t = new DriveTarget(async () => 'tok', fetcher);
    expect(await t.read()).toBeUndefined();
    const v1 = await t.write(data, undefined);
    expect(v1).toBe('1');
    const read = await t.read();
    expect(read).toEqual({ data, version: '1' });
    expect(await t.write(data, '1')).toBe('2');
    expect(state.calls.filter((c) => c.startsWith('PATCH'))).toHaveLength(1);
  });

  it('detects concurrent writes', async () => {
    const { fetcher } = fakeDrive();
    const t = new DriveTarget(async () => 'tok', fetcher);
    await t.write(data, undefined);
    await expect(t.write(data, undefined)).rejects.toBeInstanceOf(SyncConflict);
    await expect(t.write(data, '0')).rejects.toBeInstanceOf(SyncConflict);
  });

  it('maps 401 to a sign-in error', async () => {
    const t = new DriveTarget(async () => 'tok', async () => new Response('', { status: 401 }));
    await expect(t.read()).rejects.toBeInstanceOf(SyncAuthError);
  });
});

import type { SyncData } from '../domain/sync';
import type { Fetcher } from '../metadata/http';
import { decryptJson, encryptJson } from './crypto';
import { SyncConflict, type SyncTarget } from './target';

/** A shared place stored (encrypted) by the token helper Worker. */
export class SpaceTarget implements SyncTarget {
  private base: string;

  constructor(helperUrl: string, private id: string, private key: string, private f: Fetcher = fetch.bind(globalThis)) {
    this.base = helperUrl.trim().replace(/\/+$/, '');
  }

  /** Upload the first version; returns the new place's id and the owner's admin token. */
  static async create(helperUrl: string, data: SyncData, key: string, f: Fetcher = fetch.bind(globalThis)): Promise<{ id: string; adminToken: string }> {
    const res = await f(`${helperUrl.trim().replace(/\/+$/, '')}/space`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: await encryptJson(data, key) })
    });
    if (res.status === 501) throw new Error('Sharing isn’t enabled on your helper yet (the D1 database is missing, see README).');
    if (!res.ok) throw new Error(`Could not create the shared place (HTTP ${res.status})`);
    return res.json();
  }

  async read(): Promise<{ data: SyncData; version: string } | undefined> {
    const res = await this.f(`${this.base}/space/${this.id}`);
    if (res.status === 404) throw new Error('This shared place no longer exists (the owner stopped sharing it).');
    if (!res.ok) throw new Error(`Shared place unavailable (HTTP ${res.status})`);
    const body = (await res.json()) as { version: number; data: string };
    return { data: await decryptJson<SyncData>(body.data, this.key), version: String(body.version) };
  }

  async write(data: SyncData, expectedVersion: string | undefined): Promise<string> {
    const res = await this.f(`${this.base}/space/${this.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: Number(expectedVersion ?? 0), data: await encryptJson(data, this.key) })
    });
    if (res.status === 409) throw new SyncConflict();
    if (!res.ok) throw new Error(`Could not save the shared place (HTTP ${res.status})`);
    return String(((await res.json()) as { version: number }).version);
  }

  async remove(adminToken: string): Promise<void> {
    await this.f(`${this.base}/space/${this.id}/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminToken })
    });
  }
}

import { get, writable, type Readable } from 'svelte/store';
import { descendantIds } from '../domain/locations';
import { EMPTY_BOOKKEEPING, exportSpace } from '../domain/spaces';
import type { Id, SpaceConfig } from '../domain/types';
import type { Library } from '../services/library';
import { generateKey } from './crypto';
import { SyncService, type SyncOutcome, type SyncStatus } from './service';
import { forgetSpace, spaceSource } from './space-source';
import { SpaceTarget } from './space-target';

const DEBOUNCE_MS = 8_000;
const PERIODIC_MS = 2 * 60_000;

export interface JoinParams {
  id: string;
  key: string;
  helperUrl: string;
  rootLocationId: Id;
  name: string;
}

/** Builds the link that lets family join a shared place. Everything secret sits after the "#". */
export function shareLink(cfg: SpaceConfig, appUrl = `${location.origin}${location.pathname}`): string {
  const q = new URLSearchParams({ s: cfg.id, k: cfg.key, h: cfg.helperUrl, r: cfg.rootLocationId, n: cfg.name });
  return `${appUrl}#/join?${q}`;
}

export function parseJoin(query: Record<string, string>): JoinParams | undefined {
  const { s, k, h, r, n } = query;
  if (!s || !k || !h || !r || !/^https:\/\//.test(h)) return undefined;
  return { id: s, key: k, helperUrl: h, rootLocationId: r, name: n || 'Shared place' };
}

/** Runs the shared places of this device: sharing, joining, leaving and keeping them in sync. */
export class SpacesController {
  private services = new Map<string, SyncService>();
  private statuses$ = writable<Record<string, SyncStatus>>({});
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastData: unknown[] = [];
  private syncing = false;

  constructor(private lib: Library) {
    lib.subscribe((s) => {
      this.reconcile(s.settings.spaces ?? []);
      const data = [s.books, s.locations];
      if (data.some((d, i) => d !== this.lastData[i])) {
        const first = this.lastData.length === 0;
        this.lastData = data;
        if (!first && !this.syncing) this.schedule(DEBOUNCE_MS);
      }
    });
    window.addEventListener('online', () => this.schedule(1000));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.schedule(1000));
    setInterval(() => this.schedule(0), PERIODIC_MS);
    this.schedule(1500);
  }

  get statuses(): Readable<Record<string, SyncStatus>> {
    return this.statuses$;
  }

  get spaces(): SpaceConfig[] {
    return this.lib.state.settings.spaces ?? [];
  }

  /** The shared place a location belongs to (itself or an ancestor shared). */
  spaceOf(locationId: Id | null): SpaceConfig | undefined {
    if (!locationId) return undefined;
    return this.spaces.find((s) => descendantIds(this.lib.state.locations, s.rootLocationId).includes(locationId));
  }

  private reconcile(spaces: SpaceConfig[]) {
    for (const id of [...this.services.keys()]) {
      if (!spaces.some((s) => s.id === id)) this.services.delete(id);
    }
    for (const cfg of spaces) {
      if (this.services.has(cfg.id)) continue;
      const svc = new SyncService(spaceSource(this.lib, cfg.id, cfg.rootLocationId), new SpaceTarget(cfg.helperUrl, cfg.id, cfg.key));
      svc.setStatus({ state: 'idle', lastSyncAt: cfg.lastSyncAt });
      svc.status.subscribe((st) => this.statuses$.update((all) => ({ ...all, [cfg.id]: st })));
      this.services.set(cfg.id, svc);
    }
  }

  private schedule(ms: number) {
    if (!this.services.size || !navigator.onLine) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncAll().catch(() => {}), ms);
  }

  async syncAll(): Promise<void> {
    this.syncing = true;
    try {
      for (const id of this.services.keys()) await this.syncOne(id).catch(() => {});
    } finally {
      this.syncing = false;
    }
  }

  async syncOne(id: string): Promise<SyncOutcome | undefined> {
    const svc = this.services.get(id);
    if (!svc) return undefined;
    const outcome = await svc.sync();
    await this.updateConfig(id, { lastSyncAt: new Date().toISOString() });
    return outcome;
  }

  private async updateConfig(id: string, patch: Partial<SpaceConfig>) {
    await this.lib.updateSettings({ spaces: this.spaces.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }

  /** Share a place or room: uploads its books (encrypted) and returns the config for the link. */
  async share(rootLocationId: Id): Promise<SpaceConfig> {
    const existing = this.spaces.find((s) => s.rootLocationId === rootLocationId);
    if (existing) return existing;
    const helperUrl = this.lib.state.settings.sync?.helperUrl;
    if (!helperUrl) throw new Error('Sharing needs the Cloudflare helper. Set it up under Settings › Sync › Stay signed in (see README).');
    const key = generateKey();
    const data = exportSpace(await this.lib.exportSyncData(), rootLocationId, EMPTY_BOOKKEEPING);
    const { id, adminToken } = await SpaceTarget.create(helperUrl, data, key);
    const cfg: SpaceConfig = {
      id, key, helperUrl, adminToken, rootLocationId, role: 'owner', name: this.lib.label(rootLocationId), lastSyncAt: new Date().toISOString()
    };
    await this.lib.updateSettings({ spaces: [...this.spaces, cfg] });
    await this.syncOne(id); // records what is shared now
    return cfg;
  }

  async join(p: JoinParams): Promise<SpaceConfig> {
    const existing = this.spaces.find((s) => s.id === p.id);
    if (existing) return existing;
    const cfg: SpaceConfig = { ...p, role: 'member' };
    await this.lib.updateSettings({ spaces: [...this.spaces, cfg] });
    try {
      await this.syncOne(p.id);
    } catch (e) {
      await this.lib.updateSettings({ spaces: this.spaces.filter((s) => s.id !== p.id) });
      throw e;
    }
    return cfg;
  }

  /** Stop syncing this place on this device. Optionally remove its books from this library too. */
  async leave(id: string, removeBooks: boolean): Promise<void> {
    const cfg = this.spaces.find((s) => s.id === id);
    if (!cfg) return;
    await this.lib.updateSettings({ spaces: this.spaces.filter((s) => s.id !== id) });
    await forgetSpace(this.lib, id);
    if (removeBooks && this.lib.location(cfg.rootLocationId)) {
      const inside = new Set(descendantIds(this.lib.state.locations, cfg.rootLocationId));
      const ids = this.lib.state.books.filter((b) => b.locationId && inside.has(b.locationId)).map((b) => b.id);
      if (ids.length) await this.lib.deleteBooks(ids);
    }
  }

  /** Owner: delete the shared copy from the server; everyone's link stops working. */
  async stopSharing(id: string): Promise<void> {
    const cfg = this.spaces.find((s) => s.id === id);
    if (cfg?.adminToken) await new SpaceTarget(cfg.helperUrl, cfg.id, cfg.key).remove(cfg.adminToken);
    await this.leave(id, false);
  }

  status(id: string): SyncStatus | undefined {
    return get(this.statuses$)[id];
  }
}

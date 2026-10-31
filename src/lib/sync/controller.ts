import { get, writable, type Readable } from 'svelte/store';
import type { Library } from '../services/library';
import { DriveTarget } from './drive';
import { GoogleAuth, loadGis } from './google-auth';
import { SyncService, type SyncOutcome, type SyncStatus } from './service';

/** How long to wait after a change before syncing it (edits often come in bursts). */
const DEBOUNCE_MS = 15_000;
const PERIODIC_MS = 5 * 60_000;

/**
 * Glue between the library, Google sign-in and the sync service: builds them from settings,
 * syncs on start, after changes, when coming back online/visible and every few minutes.
 */
export class SyncController {
  private auth: GoogleAuth | undefined;
  private service: SyncService | undefined;
  private clientId: string | undefined;
  private status$ = writable<SyncStatus>({ state: 'off' });
  private unsubscribeStatus: (() => void) | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastData: unknown[] = [];

  constructor(private lib: Library) {
    lib.subscribe((s) => {
      this.configure(s.settings.sync?.clientId, !!s.settings.sync?.enabled);
      // Only book/location changes trigger a sync (not theme or view switches).
      const data = [s.books, s.locations];
      if (data.some((d, i) => d !== this.lastData[i])) {
        const first = this.lastData.length === 0;
        this.lastData = data;
        if (!first && get(this.status$).state !== 'syncing') this.schedule(DEBOUNCE_MS);
      }
    });
    window.addEventListener('online', () => this.schedule(1000));
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.schedule(1000));
    setInterval(() => this.schedule(0), PERIODIC_MS);
  }

  get status(): Readable<SyncStatus> {
    return this.status$;
  }

  get connected(): boolean {
    return !!this.auth?.connected;
  }

  private configure(clientId: string | undefined, enabled: boolean) {
    const id = enabled ? clientId?.trim() || undefined : undefined;
    if (id === this.clientId) return;
    this.clientId = id;
    this.unsubscribeStatus?.();
    if (!id) {
      this.auth = undefined;
      this.service = undefined;
      this.status$.set({ state: 'off' });
      return;
    }
    this.auth = new GoogleAuth(id);
    const auth = this.auth;
    this.service = new SyncService(this.lib, new DriveTarget(() => auth.accessToken()));
    const last = this.lib.state.settings.sync?.lastSyncAt;
    this.service.setStatus({ state: auth.connected ? 'idle' : 'needs-auth', lastSyncAt: last });
    this.unsubscribeStatus = this.service.status.subscribe((s) => this.status$.set(s));
    loadGis().catch(() => {}); // preload so "Connect" opens Google's window right away
    if (auth.connected) this.schedule(1000);
  }

  private schedule(ms: number) {
    if (!this.service || !this.auth?.connected) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.syncNow().catch(() => {}), ms);
  }

  /** Sign in with Google (call from a tap), then sync. */
  async connect(): Promise<SyncOutcome | undefined> {
    if (!this.auth) throw new Error('Enter your Google OAuth client ID first');
    await this.auth.connect();
    return this.syncNow();
  }

  async syncNow(): Promise<SyncOutcome | undefined> {
    if (!this.service) return undefined;
    const outcome = await this.service.sync();
    await this.lib.updateSettings({ sync: { ...this.lib.state.settings.sync, lastSyncAt: new Date().toISOString() } });
    return outcome;
  }

  async disconnect(): Promise<void> {
    await this.auth?.disconnect();
    this.service?.setStatus({ state: 'needs-auth', lastSyncAt: this.lib.state.settings.sync?.lastSyncAt });
  }
}

import { get, writable, type Readable } from 'svelte/store';
import { syncConfig } from '../config';
import type { Library } from '../services/library';
import { DriveTarget } from './drive';
import { GoogleAuth } from './google-auth';
import { librarySource, SyncService, type SyncOutcome, type SyncStatus } from './service';

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
  private configKey: string | undefined;
  /** One automatic reconnect attempt per expiry, so a closed/blocked window doesn't loop. */
  private autoTried = false;

  constructor(private lib: Library) {
    lib.subscribe((s) => {
      const cfg = syncConfig(s.settings);
      this.configure(cfg.clientId, cfg.enabled, cfg.helperUrl);
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
    // Capture phase: runs inside the user's tap, which browsers require to open Google's window.
    document.addEventListener('click', (e) => this.autoReconnect(e), true);
  }

  /**
   * Without a token helper, Google sign-ins expire after an hour. Renew on the first tap
   * afterwards: Google's window flashes briefly (no consent screen, the user agreed before).
   */
  private autoReconnect(e: Event) {
    const sync = this.lib.state.settings.sync;
    const auth = this.auth;
    if (!auth || !syncConfig(this.lib.state.settings).enabled || sync?.autoReconnect === false) return;
    if (auth.connected || !auth.everConnected || this.autoTried) return;
    if ((e.target as Element | null)?.closest?.('[data-sync-connect]')) return; // explicit buttons handle it
    if (!navigator.onLine) return;
    this.autoTried = true;
    auth.connect()
      .then(() => this.syncNow())
      .catch(() => this.service?.setStatus({ state: 'needs-auth', lastSyncAt: this.lib.state.settings.sync?.lastSyncAt }));
  }

  get status(): Readable<SyncStatus> {
    return this.status$;
  }

  get connected(): boolean {
    return !!this.auth?.connected;
  }

  private configure(clientId: string | undefined, enabled: boolean, helperUrl: string | undefined) {
    const id = enabled ? clientId?.trim() || undefined : undefined;
    const key = `${id}|${helperUrl?.trim() ?? ''}`;
    if (key === this.configKey) return;
    this.configKey = key;
    this.clientId = id;
    this.unsubscribeStatus?.();
    if (!id) {
      this.auth = undefined;
      this.service = undefined;
      this.status$.set({ state: 'off' });
      return;
    }
    this.auth = new GoogleAuth(id, { helperUrl });
    const auth = this.auth;
    this.service = new SyncService(librarySource(this.lib), new DriveTarget(() => auth.accessToken()));
    const last = this.lib.state.settings.sync?.lastSyncAt;
    this.service.setStatus({ state: auth.connected ? 'idle' : 'needs-auth', lastSyncAt: last });
    this.unsubscribeStatus = this.service.status.subscribe((s) => this.status$.set(s));
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
    this.autoTried = false;
    return this.syncNow();
  }

  get usesHelper(): boolean {
    return !!this.auth?.usesHelper;
  }

  async syncNow(): Promise<SyncOutcome | undefined> {
    if (!this.service) return undefined;
    const outcome = await this.service.sync();
    this.autoTried = false;
    await this.lib.updateSettings({ sync: { ...this.lib.state.settings.sync, lastSyncAt: new Date().toISOString() } });
    return outcome;
  }

  async disconnect(): Promise<void> {
    await this.auth?.disconnect();
    this.service?.setStatus({ state: 'needs-auth', lastSyncAt: this.lib.state.settings.sync?.lastSyncAt });
  }
}

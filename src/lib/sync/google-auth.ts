import type { Fetcher } from '../metadata/http';
import { SyncAuthError } from './target';

/** Only the app's own hidden Drive folder: Booked can't see any of your other files. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const STORE_KEY = 'booked.driveAuth';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface CodeResponse {
  code?: string;
  error?: string;
}
type ErrorCallback = (e: { type: string; message?: string }) => void;
export interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: { client_id: string; scope: string; callback: (r: TokenResponse) => void; error_callback?: ErrorCallback }): {
        requestAccessToken(overrides?: { prompt?: string }): void;
      };
      initCodeClient(config: {
        client_id: string; scope: string; ux_mode: 'popup'; callback: (r: CodeResponse) => void; error_callback?: ErrorCallback;
      }): { requestCode(): void };
      revoke(token: string, done?: () => void): void;
    };
  };
}

let gisPromise: Promise<Gis> | undefined;

/** Load Google Identity Services once (needs to be online). */
export function loadGis(): Promise<Gis> {
  gisPromise ??= new Promise<Gis>((resolve, reject) => {
    const existing = (window as unknown as { google?: Gis }).google;
    if (existing?.accounts?.oauth2) return resolve(existing);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve((window as unknown as { google: Gis }).google);
    s.onerror = () => {
      gisPromise = undefined;
      reject(new Error('Could not load Google sign-in (offline?)'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

interface Stored {
  clientId: string;
  access?: { value: string; expiresAt: number };
  /** Only with a token helper: long-lived, turns into new access tokens without any UI. */
  refresh?: string;
  /** The user connected at least once (enables automatic reconnecting). */
  everConnected?: boolean;
}

export interface GoogleAuthOptions {
  /** URL of the optional token helper (Cloudflare Worker) that keeps you signed in. */
  helperUrl?: string;
  fetcher?: Fetcher;
  gis?: () => Promise<Gis>;
}

/**
 * Google sign-in for Drive sync, without a backend of our own.
 * - Without a helper: browser token flow, tokens last about an hour; reconnecting is one tap
 *   (and can happen automatically on the next tap, see SyncController).
 * - With a helper: sign in once; the helper turns a refresh token into new access tokens silently.
 */
export class GoogleAuth {
  private state: Stored;
  private gis: Gis | undefined;
  private refreshing: Promise<string> | undefined;
  private helper: string | undefined;
  private f: Fetcher;
  private loadGisFn: () => Promise<Gis>;

  constructor(private clientId: string, opts: GoogleAuthOptions = {}) {
    this.helper = opts.helperUrl?.trim().replace(/\/+$/, '') || undefined;
    this.f = opts.fetcher ?? fetch.bind(globalThis);
    this.loadGisFn = opts.gis ?? loadGis;
    this.state = { clientId };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Stored | null;
      if (saved?.clientId === clientId) this.state = saved;
    } catch {
      // nothing stored
    }
    // Load Google's script early so a later tap can open its window immediately.
    this.loadGisFn().then((g) => (this.gis = g)).catch(() => {});
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      // keep in memory only
    }
  }

  private get accessValid(): boolean {
    return !!this.state.access && this.state.access.expiresAt - 60_000 > Date.now();
  }

  /** Can sync right now without the user doing anything. */
  get connected(): boolean {
    return this.accessValid || (!!this.helper && !!this.state.refresh);
  }

  /** Signed in before, so reconnecting needs no consent screen. */
  get everConnected(): boolean {
    return !!this.state.everConnected;
  }

  get usesHelper(): boolean {
    return !!this.helper;
  }

  /** A valid access token, refreshed silently via the helper when possible. */
  async accessToken(): Promise<string> {
    if (this.accessValid) return this.state.access!.value;
    if (this.helper && this.state.refresh) {
      this.refreshing ??= this.refresh().finally(() => (this.refreshing = undefined));
      return this.refreshing;
    }
    throw new SyncAuthError('Google Drive sign-in expired. Tap “Reconnect” to continue syncing.');
  }

  private async callHelper(path: string, body: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.f(`${this.helper}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const err = String(data.error ?? `HTTP ${res.status}`);
      // invalid_grant = access was revoked or the refresh token expired: the user must sign in again.
      if (err === 'invalid_grant' || res.status === 401) {
        this.state = { ...this.state, refresh: undefined, access: undefined };
        this.save();
        throw new SyncAuthError('Google Drive access was revoked or expired. Tap “Reconnect” to sign in again.');
      }
      throw new Error(`Token helper error: ${err}`);
    }
    return data;
  }

  private storeAccess(token: string, expiresIn: number | undefined) {
    this.state = { ...this.state, access: { value: token, expiresAt: Date.now() + (expiresIn ?? 3600) * 1000 }, everConnected: true };
    this.save();
  }

  private async refresh(): Promise<string> {
    const data = await this.callHelper('/refresh', { refresh_token: this.state.refresh! });
    this.storeAccess(String(data.access_token), Number(data.expires_in));
    return String(data.access_token);
  }

  /**
   * Interactive sign-in. Call it from a tap: when Google's script is already loaded, the window
   * opens synchronously within that tap (which browsers require for popups).
   */
  connect(): Promise<void> {
    if (this.gis) return this.request(this.gis);
    return this.loadGisFn().then((g) => {
      this.gis = g;
      return this.request(g);
    });
  }

  private request(gis: Gis): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const onError: ErrorCallback = (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.message ?? e.type));
      if (this.helper) {
        // Code flow: the helper exchanges the code (with the secret) for a refresh + access token.
        gis.accounts.oauth2.initCodeClient({
          client_id: this.clientId,
          scope: DRIVE_SCOPE,
          ux_mode: 'popup',
          error_callback: onError,
          callback: async (r) => {
            if (!r.code) return reject(new Error(r.error ?? 'Google sign-in failed'));
            try {
              const data = await this.callHelper('/token', { code: r.code });
              if (data.refresh_token) this.state = { ...this.state, refresh: String(data.refresh_token) };
              this.storeAccess(String(data.access_token), Number(data.expires_in));
              resolve();
            } catch (e) {
              reject(e);
            }
          }
        }).requestCode();
      } else {
        gis.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: DRIVE_SCOPE,
          error_callback: onError,
          callback: (r) => {
            if (!r.access_token) return reject(new Error(r.error ?? 'Google sign-in failed'));
            this.storeAccess(r.access_token, r.expires_in);
            resolve();
          }
        }).requestAccessToken({ prompt: '' });
      }
    });
  }

  async disconnect(): Promise<void> {
    const { access, refresh } = this.state;
    this.state = { clientId: this.clientId };
    this.save();
    if (refresh && this.helper) await this.callHelper('/revoke', { token: refresh }).catch(() => {});
    else if (access) (this.gis ?? (await this.loadGisFn().catch(() => undefined)))?.accounts.oauth2.revoke(access.value);
  }
}

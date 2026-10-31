import { SyncAuthError } from './target';

/** Only the app's own hidden Drive folder: Booked can't see any of your other files. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const STORE_KEY = 'booked.driveToken';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): TokenClient;
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

/**
 * Browser-only OAuth token flow (no backend, no secret). Tokens last about an hour; after that a
 * tap on "Reconnect" gets a new one, usually without showing a consent screen again.
 */
export class GoogleAuth {
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private clientId: string) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (saved?.clientId === clientId && saved.expiresAt > Date.now()) this.token = saved;
    } catch {
      // no stored token
    }
  }

  get connected(): boolean {
    return !!this.token && this.token.expiresAt - 60_000 > Date.now();
  }

  /** Current token, or SyncAuthError if the user has to (re)connect. */
  async accessToken(): Promise<string> {
    if (this.connected) return this.token!.value;
    throw new SyncAuthError('Google Drive sign-in expired. Tap “Reconnect” to continue syncing.');
  }

  /** Interactive sign-in. Call from a tap so the browser allows the Google window. */
  async connect(): Promise<void> {
    const gis = await loadGis();
    await new Promise<void>((resolve, reject) => {
      const client = gis.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: DRIVE_SCOPE,
        callback: (r) => {
          if (!r.access_token) return reject(new Error(r.error ?? 'Google sign-in failed'));
          this.token = { value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
          try {
            localStorage.setItem(STORE_KEY, JSON.stringify({ ...this.token, clientId: this.clientId }));
          } catch {
            // keep in memory only
          }
          resolve();
        },
        error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed' : e.message ?? e.type))
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  async disconnect(): Promise<void> {
    const token = this.token?.value;
    this.token = undefined;
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      // ignore
    }
    if (token) {
      const gis = await loadGis().catch(() => undefined);
      gis?.accounts.oauth2.revoke(token);
    }
  }
}

import type { Settings } from './domain/types';

/**
 * Connection details built into this copy of the app (set as repository variables on GitHub and
 * baked in at build time), so nobody has to paste them into Settings on each device.
 * None of them is a secret: Google and Cloudflare only accept them from the app's own address.
 * A value entered in Settings still takes precedence (e.g. someone running their own copy).
 */
const env = import.meta.env as Record<string, string | undefined>;
const clean = (v: string | undefined) => v?.trim() || undefined;

export const BUILT_IN = {
  googleClientId: clean(env.VITE_GOOGLE_CLIENT_ID),
  helperUrl: clean(env.VITE_SYNC_HELPER_URL)?.replace(/\/+$/, ''),
  googleBooksKey: clean(env.VITE_GOOGLE_BOOKS_KEY)
};

/** The Google client ID, helper and on/off state actually in effect. */
export function syncConfig(s: Settings, builtIn = BUILT_IN): { clientId?: string; helperUrl?: string; enabled: boolean } {
  const own = clean(s.sync?.clientId);
  const clientId = own ?? builtIn.googleClientId;
  return {
    clientId,
    helperUrl: clean(s.sync?.helperUrl) ?? builtIn.helperUrl,
    // Your own ID is switched on by saving it; the built-in one is ready unless you turned sync off.
    enabled: !!clientId && (own ? !!s.sync?.enabled : s.sync?.enabled !== false)
  };
}

export const helperUrlOf = (s: Settings, builtIn = BUILT_IN) => syncConfig(s, builtIn).helperUrl;
export const booksKeyOf = (s: Settings, builtIn = BUILT_IN) => clean(s.googleBooksKey) ?? builtIn.googleBooksKey;

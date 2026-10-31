import { describe, expect, it } from 'vitest';
import { booksKeyOf, helperUrlOf, syncConfig } from './config';
import type { Settings } from './domain/types';

const built = { googleClientId: 'built.apps.googleusercontent.com', helperUrl: 'https://booked-auth.x.workers.dev', googleBooksKey: 'AIzaBuilt' };
const none = { googleClientId: undefined, helperUrl: undefined, googleBooksKey: undefined };
const settings = (s: Partial<Settings> = {}) => s as Settings;

describe('built-in connection details', () => {
  it('nothing to paste: the built-in client ID and helper are ready to connect', () => {
    expect(syncConfig(settings(), built)).toEqual({ clientId: built.googleClientId, helperUrl: built.helperUrl, enabled: true });
    expect(booksKeyOf(settings(), built)).toBe('AIzaBuilt');
  });

  it('values entered in Settings win', () => {
    const s = settings({ googleBooksKey: 'AIzaMine', sync: { clientId: 'mine', enabled: true, helperUrl: 'https://mine.dev' } });
    expect(syncConfig(s, built)).toEqual({ clientId: 'mine', helperUrl: 'https://mine.dev', enabled: true });
    expect(booksKeyOf(s, built)).toBe('AIzaMine');
  });

  it('sync can still be switched off', () => {
    expect(syncConfig(settings({ sync: { enabled: false } }), built).enabled).toBe(false);
  });

  it('without built-in values it behaves as before: off until an ID is saved', () => {
    expect(syncConfig(settings(), none)).toEqual({ clientId: undefined, helperUrl: undefined, enabled: false });
    expect(syncConfig(settings({ sync: { clientId: 'mine', enabled: true } }), none).enabled).toBe(true);
    expect(helperUrlOf(settings(), none)).toBeUndefined();
  });
});

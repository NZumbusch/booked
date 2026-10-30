import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { backupStatus, parseBackup, backupFileName } from './backup';
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from './types';

const day = 24 * 3600 * 1000;
const t0 = Date.parse('2026-11-01T10:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const book = (id: string, updated: number) => ({ ...createBook({ title: id }, { id, now: iso(updated) }) });

describe('backupStatus', () => {
  it('is not due for an empty library', () => {
    expect(backupStatus(undefined, [], t0).due).toBe(false);
  });

  it('is due when there are books and no backup yet', () => {
    const s = backupStatus(undefined, [book('a', t0)], t0);
    expect(s).toMatchObject({ due: true, changed: 1, never: true });
  });

  it('counts books changed since the last backup', () => {
    const books = [book('a', t0 - 2 * day), book('b', t0 - 1000), book('c', t0)];
    expect(backupStatus(iso(t0 - day), books, t0)).toMatchObject({ changed: 2, due: false });
  });

  it('is due after many changes', () => {
    const books = Array.from({ length: 25 }, (_, i) => book(String(i), t0));
    expect(backupStatus(iso(t0 - 1000), books, t0).due).toBe(true);
  });

  it('is due after a week with any change', () => {
    expect(backupStatus(iso(t0 - 8 * day), [book('a', t0 - day)], t0)).toMatchObject({ due: true, days: 8 });
    expect(backupStatus(iso(t0 - 8 * day), [book('a', t0 - 9 * day)], t0).due).toBe(false);
  });
});

describe('parseBackup', () => {
  const valid = {
    app: 'booked', schemaVersion: SCHEMA_VERSION, exportedAt: iso(t0),
    books: [book('a', t0)], locations: [], moves: [], settings: DEFAULT_SETTINGS
  };

  it('accepts a valid backup', () => {
    expect(parseBackup(JSON.stringify(valid)).books).toHaveLength(1);
  });

  it('rejects non-JSON and foreign files with a clear message', () => {
    expect(() => parseBackup('nope')).toThrow(/not a Booked backup/);
    expect(() => parseBackup('{"books":[]}')).toThrow(/not a Booked backup/);
  });

  it('rejects backups from a newer app version', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, schemaVersion: SCHEMA_VERSION + 1 }))).toThrow(/newer version/);
  });

  it('rejects damaged records', () => {
    expect(() => parseBackup(JSON.stringify({ ...valid, books: [{ id: 'x' }] }))).toThrow(/damaged/);
  });

  it('fills in fields missing from older backups', () => {
    const s = parseBackup(JSON.stringify({ ...valid, moves: undefined, settings: undefined }));
    expect(s.moves).toEqual([]);
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
  });
});

describe('backupFileName', () => {
  it('includes date and time so backups never overwrite each other', () => {
    expect(backupFileName('2026-11-01T10:05:09.123Z')).toBe('booked-backup-2026-11-01-1005.json');
  });
});

import { DEFAULT_SETTINGS, SCHEMA_VERSION, type Book, type Snapshot, type Timestamp } from './types';

const DAY = 24 * 3600 * 1000;
/** Remind after this many changed books… */
const DUE_CHANGES = 20;
/** …or after this many days with at least one change. */
const DUE_DAYS = 7;

export interface BackupStatus {
  due: boolean;
  never: boolean;
  /** Books added or edited since the last backup. */
  changed: number;
  /** Whole days since the last backup. */
  days?: number;
}

export function backupStatus(lastBackupAt: Timestamp | undefined, books: Pick<Book, 'updatedAt'>[], now = Date.now()): BackupStatus {
  if (!lastBackupAt) return { due: books.length > 0, never: true, changed: books.length };
  const changed = books.filter((b) => b.updatedAt > lastBackupAt).length;
  const days = Math.floor((now - Date.parse(lastBackupAt)) / DAY);
  return { due: changed >= DUE_CHANGES || (changed > 0 && days >= DUE_DAYS), never: false, changed, days };
}

export function backupFileName(exportedAt: Timestamp): string {
  const [date, time] = exportedAt.split('T');
  return `booked-backup-${date}-${time.slice(0, 5).replace(':', '')}.json`;
}

/** Parse and validate a backup file's text. Throws a user-readable message. */
export function parseBackup(text: string): Snapshot {
  let data: Partial<Snapshot>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a Booked backup (it isn’t valid JSON).');
  }
  if (data?.app !== 'booked' || !Array.isArray(data.books) || !Array.isArray(data.locations)) {
    throw new Error('This file is not a Booked backup.');
  }
  if ((data.schemaVersion ?? 1) > SCHEMA_VERSION) {
    throw new Error('This backup was made by a newer version of Booked. Update the app (reload it) and try again.');
  }
  const badBook = data.books.find((b) => !b || typeof b.id !== 'string' || typeof b.title !== 'string');
  const badLoc = data.locations.find((l) => !l || typeof l.id !== 'string' || typeof l.name !== 'string');
  if (badBook || badLoc) throw new Error('This backup looks damaged (some records are incomplete). Nothing was changed.');
  return {
    app: 'booked',
    schemaVersion: data.schemaVersion ?? 1,
    exportedAt: data.exportedAt ?? new Date(0).toISOString(),
    books: data.books,
    locations: data.locations,
    moves: data.moves ?? [],
    settings: { ...DEFAULT_SETTINGS, ...data.settings }
  };
}

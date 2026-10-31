/**
 * Booked data schema (v1).
 *
 * Everything is plain JSON so a full backup is just `JSON.stringify(snapshot)`.
 * IDs are random strings; dates are ISO-8601 strings (`YYYY-MM-DD` for calendar
 * dates, full timestamps for audit fields).
 */

export type Id = string;
/** `YYYY-MM-DD` */
export type IsoDate = string;
/** Full ISO timestamp, e.g. `2026-10-30T12:00:00.000Z` */
export type Timestamp = string;

// ---------------------------------------------------------------- locations

/** Place (e.g. "Flat A") > Room (e.g. "Living room") > Shelf (optional). */
export type LocationKind = 'place' | 'room' | 'shelf';

export interface Location {
  id: Id;
  kind: LocationKind;
  name: string;
  /** null for places; a place id for rooms; a room id for shelves. */
  parentId: Id | null;
  /** Sort order among siblings (ascending). */
  order: number;
  /** Optional geo position of a place, for the map. */
  geo?: GeoPoint;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface GeoPoint {
  lat: number;
  lon: number;
  /** Human label, e.g. "Paris, France". */
  label?: string;
}

// ---------------------------------------------------------------- books

export type BookFormat = 'hardcover' | 'paperback' | 'ebook' | 'audiobook' | 'other';
export type ReadingStatus = 'unread' | 'reading' | 'read' | 'abandoned';
export type Ownership = 'owned' | 'wishlist';

export interface Lending {
  to: string;
  lentOn: IsoDate;
  dueOn?: IsoDate;
}

/**
 * How `WritingInfo.place` was determined, best first:
 * written = Wikidata "location of creation"; published = place of first publication;
 * author = the author's home town (birthplace); country = only the country of publication is known.
 */
export type PlaceBasis = 'written' | 'published' | 'author' | 'country';

/** Where and when a work was written — powers the "where was this written" map. */
export interface WritingInfo {
  /** Year the work was written (or started). */
  year?: number;
  yearEnd?: number;
  place?: GeoPoint;
  placeBasis?: PlaceBasis;
}

export type SourceId = 'openlibrary' | 'googlebooks' | 'wikidata' | 'manual';

/** Where a piece of metadata came from, shown behind a "?" next to the field. */
export interface SourceRef {
  source: SourceId;
  /** Link to the record at the source. */
  url?: string;
  /** Extra explanation, e.g. "author's birthplace". */
  note?: string;
}

export interface Book {
  id: Id;

  // --- bibliographic (mostly auto-filled from online sources)
  title: string;
  subtitle?: string;
  authors: string[];
  /** Translators, editors, illustrators… kept free-form: "Name (role)". */
  contributors?: string[];
  publisher?: string;
  publishedYear?: number;
  /** Year the *work* was first published (vs. this edition). */
  firstPublishedYear?: number;
  edition?: string;
  language?: string;
  originalLanguage?: string;
  pageCount?: number;
  format?: BookFormat;
  isbn10?: string;
  isbn13?: string;
  /** Other identifiers: oclc, lccn, olid (Open Library), gbid (Google Books), wikidata… */
  identifiers?: Record<string, string>;
  description?: string;
  /** Remote URL or `data:` URL for uploaded covers. */
  cover?: string;
  genres: string[];
  /** Finer-grained subjects / topics from catalogues. */
  subjects?: string[];
  series?: string;
  seriesNumber?: string;
  writing?: WritingInfo;
  /** Which providers contributed metadata, e.g. ["openlibrary","googlebooks"]. */
  sources?: SourceId[];
  /** Online details still to be fetched in the background (survives restarts / offline). */
  pendingLookup?: boolean;
  /** Per-field origin of auto-filled data, keyed by field name (e.g. "description", "writing"). */
  provenance?: Record<string, SourceRef>;

  // --- my data
  ownership: Ownership;
  /** Deepest location node (place, room or shelf). null = no location. */
  locationId: Id | null;
  tags: string[];
  collections: string[];
  status: ReadingStatus;
  /** 1–5, or undefined for unrated. */
  rating?: number;
  startedOn?: IsoDate;
  finishedOn?: IsoDate;
  notes?: string;
  condition?: string;
  purchasedOn?: IsoDate;
  /** Price in the user's currency (see settings). */
  price?: number;
  signed: boolean;
  copies: number;
  lending?: Lending;
  /** Shared places: someone took this book out of the shared place (into their own room). */
  away?: { by: string; since: Timestamp };

  /** Who added it (shared places: the member's name). */
  addedBy?: string;

  // --- metadata
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** Fields the user may set when creating a book; the rest gets defaults. */
export type BookDraft = Partial<Omit<Book, 'id' | 'createdAt' | 'updatedAt'>> & { title: string };

// ---------------------------------------------------------------- history & undo

/** One entry in a book's location history. Labels are snapshots so renames don't rewrite history. */
export interface MoveRecord {
  id: Id;
  bookId: Id;
  fromId: Id | null;
  toId: Id | null;
  fromLabel: string;
  toLabel: string;
  at: Timestamp;
  /** Groups moves made by the same action (bulk move, room move…). */
  batchId: Id;
}

/** Enough state to revert one user action. */
export interface UndoEntry {
  id: Id;
  label: string;
  at: Timestamp;
  /** Books as they were before the action (absent = book did not exist). */
  booksBefore: Book[];
  /** Ids of books the action created (to delete on undo). */
  createdBookIds: Id[];
  locationsBefore: Location[];
  createdLocationIds: Id[];
  /** Move records written by the action (to delete on undo). */
  moveIds: Id[];
}

// ---------------------------------------------------------------- settings

export interface Settings {
  defaultLocationId: Id | null;
  theme: 'system' | 'light' | 'dark';
  dateFormat: 'iso' | 'dmy' | 'mdy';
  currency: string;
  view: 'grid' | 'list';
  /** Named library filters, stored as URL query params. */
  savedFilters?: SavedFilter[];
  /** Optional free Google Books API key for a reliable 1,000 lookups/day. */
  googleBooksKey?: string;
  /** Your name, shown to family on books you add to a shared place. */
  userName?: string;
  /** Places/rooms shared with family (per device; the key never leaves the share link). */
  spaces?: SpaceConfig[];
  /** Google Drive sync (per device). */
  sync?: {
    clientId?: string;
    enabled?: boolean;
    lastSyncAt?: Timestamp;
    /** Optional token helper (Cloudflare Worker) that keeps you signed in. */
    helperUrl?: string;
    /** Without a helper: renew the sign-in on the first tap after it expired (default on). */
    autoReconnect?: boolean;
  };
  /** When the last backup file was made (for reminders). */
  lastBackupAt?: Timestamp;
}

export interface SpaceConfig {
  /** Server-side id of the shared place. */
  id: string;
  /** Encryption key (from the share link). */
  key: string;
  /** Token helper (Cloudflare Worker) that stores the encrypted data. */
  helperUrl: string;
  /** The shared location (same id for every member). */
  rootLocationId: Id;
  name: string;
  role: 'owner' | 'member';
  /** Owner only: allows deleting the shared data from the server. */
  adminToken?: string;
  lastSyncAt?: Timestamp;
}

export interface SavedFilter {
  id: Id;
  name: string;
  query: Record<string, string>;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultLocationId: null,
  theme: 'system',
  dateFormat: 'dmy',
  currency: 'EUR',
  view: 'grid'
};

/** A full, self-contained backup of the library. */
export interface Snapshot {
  app: 'booked';
  schemaVersion: number;
  exportedAt: Timestamp;
  books: Book[];
  locations: Location[];
  moves: MoveRecord[];
  settings: Settings;
}

export const SCHEMA_VERSION = 1;

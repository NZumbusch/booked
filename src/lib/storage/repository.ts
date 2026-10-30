import type { Book, Id, Location, MoveRecord, Settings, Snapshot, UndoEntry } from '../domain/types';

/** A set of writes that must be applied atomically. */
export interface ChangeSet {
  putBooks?: Book[];
  deleteBookIds?: Id[];
  putLocations?: Location[];
  deleteLocationIds?: Id[];
  putMoves?: MoveRecord[];
  deleteMoveIds?: Id[];
  pushUndo?: UndoEntry;
  deleteUndoIds?: Id[];
}

export interface LoadedState {
  books: Book[];
  locations: Location[];
  settings: Settings;
}

/**
 * Storage boundary. The app only talks to this interface, so a different
 * backend (or a sync layer such as Google Drive) can be added without
 * touching the UI or domain code.
 */
export interface Repository {
  load(): Promise<LoadedState>;
  commit(changes: ChangeSet): Promise<void>;
  movesFor(bookId: Id): Promise<MoveRecord[]>;
  latestUndo(): Promise<UndoEntry | undefined>;
  saveSettings(settings: Settings): Promise<void>;
  exportSnapshot(): Promise<Snapshot>;
  /** Replace everything with the snapshot's contents. */
  importSnapshot(snapshot: Snapshot): Promise<void>;
}

/** Number of undoable actions kept. */
export const UNDO_LIMIT = 20;

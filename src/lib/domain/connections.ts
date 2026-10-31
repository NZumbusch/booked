import { fold } from './query';
import type { Book } from './types';
import type { AuthorKnowledge, Ref, WorkKnowledge } from '../metadata/knowledge';

/** Books in your library that share something interesting. */
export interface SharedGroup {
  kind: 'movement' | 'setting' | 'award' | 'subject' | 'basedOn';
  id: string;
  label: string;
  books: Book[];
}

export interface Influence {
  /** The influenced author (in your library). */
  author: Ref;
  /** Who influenced them. */
  by: Ref;
  /** True if you also own books by the influencing author. */
  byOwned: boolean;
}

export interface SeriesStatus {
  id: string;
  label: string;
  volumes: { id: string; label: string; position?: string; owned?: Book }[];
  missing: number;
}

export const KIND_LABEL: Record<SharedGroup['kind'], string> = {
  movement: 'Movement', setting: 'Set in', award: 'Award', subject: 'About', basedOn: 'Based on'
};

/** Map Wikidata work id → your books with that id. */
export function booksByWork(books: Book[]): Map<string, Book[]> {
  const m = new Map<string, Book[]>();
  for (const b of books) {
    const id = b.identifiers?.wikidata;
    if (id) m.set(id, [...(m.get(id) ?? []), b]);
  }
  return m;
}

/** Each distinct work counts once (two copies of Dune are not "two books set on Arrakis"). */
function uniqueWorks(books: Book[]): Book[] {
  const seen = new Set<string>();
  return books.filter((b) => {
    const k = b.identifiers?.wikidata ?? b.id;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function sharedGroups(books: Book[], works: Map<string, WorkKnowledge>, minBooks = 2): SharedGroup[] {
  const groups = new Map<string, SharedGroup>();
  const add = (kind: SharedGroup['kind'], r: Ref, b: Book) => {
    const key = `${kind}:${r.id}`;
    const g = groups.get(key) ?? { kind, id: r.id, label: r.label, books: [] };
    if (!g.books.includes(b)) g.books.push(b);
    groups.set(key, g);
  };
  for (const b of uniqueWorks(books)) {
    const w = b.identifiers?.wikidata ? works.get(b.identifiers.wikidata) : undefined;
    if (!w) continue;
    w.movements.forEach((r) => add('movement', r, b));
    w.settings.forEach((r) => add('setting', r, b));
    w.awards.forEach((r) => add('award', r, b));
    w.subjects.forEach((r) => add('subject', r, b));
    w.basedOn.forEach((r) => add('basedOn', r, b));
  }
  const order: SharedGroup['kind'][] = ['basedOn', 'movement', 'setting', 'award', 'subject'];
  return [...groups.values()]
    .filter((g) => g.books.length >= minBooks)
    .sort((a, b) => b.books.length - a.books.length || order.indexOf(a.kind) - order.indexOf(b.kind) || a.label.localeCompare(b.label));
}

/** Authors in your library and who influenced them; influences you also own come first. */
export function influences(works: Map<string, WorkKnowledge>, authors: Map<string, AuthorKnowledge>, books: Book[]): Influence[] {
  const owned = new Set<string>();
  for (const b of books) {
    const w = b.identifiers?.wikidata ? works.get(b.identifiers.wikidata) : undefined;
    w?.authors.forEach((a) => owned.add(a.id));
  }
  const out: Influence[] = [];
  for (const id of owned) {
    const a = authors.get(id);
    a?.influencedBy.forEach((by) => out.push({ author: { id, label: a.label }, by, byOwned: owned.has(by.id) }));
  }
  return out.sort((x, y) => Number(y.byOwned) - Number(x.byOwned) || x.author.label.localeCompare(y.author.label));
}

/** Series you've started, with every known volume marked owned or missing. */
export function seriesStatus(books: Book[], works: Map<string, WorkKnowledge>): SeriesStatus[] {
  const byWork = booksByWork(books);
  const byTitle = new Map(books.map((b) => [fold(b.title), b]));
  const result = new Map<string, SeriesStatus>();
  for (const b of books) {
    const w = b.identifiers?.wikidata ? works.get(b.identifiers.wikidata) : undefined;
    for (const s of w?.series ?? []) {
      if (result.has(s.id)) continue;
      // Only numbered volumes (skips audiobook editions and similar entries without a position).
      const volumes = (w?.seriesWorks ?? [])
        .filter((v) => v.series === s.id && v.position)
        .map((v) => ({ id: v.id, label: v.label, position: v.position, owned: byWork.get(v.id)?.[0] ?? byTitle.get(fold(v.label)) }));
      if (volumes.length < 2) continue;
      result.set(s.id, { id: s.id, label: s.label, volumes, missing: volumes.filter((v) => !v.owned).length });
    }
  }
  return [...result.values()].sort((a, b) => a.missing - b.missing || a.label.localeCompare(b.label));
}

/** Everything connecting one book to the rest of your library (for its detail page). */
export function connectionsOf(book: Book, books: Book[], works: Map<string, WorkKnowledge>): { group: SharedGroup; others: Book[] }[] {
  const id = book.identifiers?.wikidata;
  if (!id) return [];
  return sharedGroups(books, works)
    .filter((g) => g.books.some((b) => b.identifiers?.wikidata === id))
    .map((g) => ({ group: g, others: g.books.filter((b) => b.identifiers?.wikidata !== id) }))
    .filter((c) => c.others.length);
}

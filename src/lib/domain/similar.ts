import { fold } from './query';
import type { Book } from './types';

/**
 * "More like this" from your own shelves: books share features (authors, series, subjects,
 * genres, tags, era, place of writing); rare shared features count more than common ones.
 */

const WEIGHTS = { author: 3, series: 3, subject: 1.2, genre: 1.5, tag: 1, collection: 0.6, decade: 0.4, place: 0.6 } as const;
type Kind = keyof typeof WEIGHTS;

export function features(b: Book): Map<string, Kind> {
  const f = new Map<string, Kind>();
  const add = (kind: Kind, v: string | undefined) => v && f.set(`${kind}:${fold(v.trim())}`, kind);
  b.authors.forEach((a) => add('author', a));
  add('series', b.series);
  (b.subjects ?? []).forEach((s) => add('subject', s));
  b.genres.forEach((g) => add('genre', g));
  b.tags.forEach((t) => add('tag', t));
  b.collections.forEach((c) => add('collection', c));
  const year = b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
  if (year) add('decade', String(Math.floor(year / 10) * 10));
  add('place', b.writing?.place?.label);
  return f;
}

export interface SimilarityIndex {
  byBook: Map<string, Map<string, Kind>>;
  /** Inverse document frequency per feature. */
  idf: Map<string, number>;
  /** Feature → books having it (for fast candidate lookup). */
  postings: Map<string, string[]>;
}

export function buildIndex(books: Book[]): SimilarityIndex {
  const byBook = new Map<string, Map<string, Kind>>();
  const postings = new Map<string, string[]>();
  for (const b of books) {
    const f = features(b);
    byBook.set(b.id, f);
    for (const key of f.keys()) postings.set(key, [...(postings.get(key) ?? []), b.id]);
  }
  const n = Math.max(1, books.length);
  const idf = new Map([...postings].map(([k, ids]) => [k, Math.log(1 + n / ids.length)]));
  return { byBook, idf, postings };
}

export interface Match {
  id: string;
  score: number;
  /** The shared features that matter most, for "because …" labels. */
  reasons: string[];
}

export function similarTo(bookId: string, index: SimilarityIndex, limit = 8): Match[] {
  const mine = index.byBook.get(bookId);
  if (!mine) return [];
  const scores = new Map<string, { score: number; reasons: [string, number][] }>();
  for (const [key, kind] of mine) {
    const ids = index.postings.get(key) ?? [];
    if (ids.length > 400) continue; // too common to say anything ("Fiction")
    const w = WEIGHTS[kind] * (index.idf.get(key) ?? 0);
    for (const id of ids) {
      if (id === bookId) continue;
      const e = scores.get(id) ?? { score: 0, reasons: [] };
      e.score += w;
      e.reasons.push([key, w]);
      scores.set(id, e);
    }
  }
  return [...scores.entries()]
    .map(([id, e]) => ({ id, score: e.score, reasons: e.reasons.sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => describe(k)) }))
    .filter((m) => m.score > 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function describe(key: string): string {
  const [kind, value] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const label: Record<string, string> = { author: 'same author', series: 'same series', decade: `written in the ${value}s`, place: `written in ${value}` };
  return label[kind] ?? value;
}

/** The book least like the rest of your library: LibraryThing-style "odd one out". */
export function oddOneOut(books: Book[], index: SimilarityIndex): Book | undefined {
  let best: { book: Book; score: number } | undefined;
  for (const b of books) {
    const s = similarTo(b.id, index, 5).reduce((n, m) => n + m.score, 0);
    if (!best || s < best.score) best = { book: b, score: s };
  }
  return books.length > 3 ? best?.book : undefined;
}

/** Topics (subjects + genres) across the library, most common first, merged case-insensitively. */
export function topTopics(books: Book[], limit = 24): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const b of books) {
    for (const t of new Set([...(b.subjects ?? []), ...b.genres].map((x) => x.trim()).filter(Boolean))) {
      const k = fold(t);
      const e = counts.get(k);
      if (e) e.count++;
      else counts.set(k, { name: t, count: 1 });
    }
  }
  return [...counts.values()].filter((t) => t.count > 1 || counts.size < 12).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, limit);
}

export function booksOnTopic(books: Book[], topic: string): Book[] {
  const k = fold(topic);
  return books.filter((b) => [...(b.subjects ?? []), ...b.genres].some((t) => fold(t) === k));
}

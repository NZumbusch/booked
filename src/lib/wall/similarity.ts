import { fold } from '../domain/query';
import type { Book } from '../domain/types';
import { canonicalTopic, topicTree, type TopicTree } from './topicTree';

/**
 * How alike two books are, for arranging the cover wall by topic. Catalogue topics alone are too
 * patchy (many books have none, and the three volumes of a trilogy may share none), so several
 * signals are combined into one weighted profile per book:
 *
 * - series (strongest) and author
 * - topics: your AI topics (if any), genres and subjects, rarer ones weighing more (IDF), the very
 *   common ones ("Fiction") not at all
 * - a little: publisher line (dtv, Reclam…), decade of the work, language
 *
 * Similarity is the cosine of two profiles (0 = nothing in common, 1 = same profile).
 */

export type FeatureKind = 'series' | 'author' | 'ai' | 'genre' | 'subject' | 'line' | 'decade' | 'lang';

interface Feature {
  key: string;
  kind: FeatureKind;
  label: string;
}

/** Base weight per kind, before rarity. */
const KIND_WEIGHT: Record<FeatureKind, number> = {
  series: 3.2, author: 2.2, ai: 2.4, genre: 1.2, subject: 1, line: 0.8, decade: 0.45, lang: 0.4
};

/** Kinds whose rarity scales their weight (a series or an author is meaningful however common). */
const RARITY: Record<FeatureKind, boolean> = {
  series: false, author: false, ai: true, genre: true, subject: true, line: false, decade: true, lang: true
};

const clean = (s: string) => s.replace(/[;,/:]+\s*$/, '').trim();

function featuresOf(b: Book): Feature[] {
  const out: Feature[] = [];
  const add = (kind: FeatureKind, label: string | undefined) => {
    const l = label && clean(label);
    if (!l) return;
    if (kind === 'genre' || kind === 'subject' || kind === 'ai') {
      // one vocabulary for genres, subjects and AI topics, synonyms merged ("Krimi" = "Detective and mystery stories")
      const t = canonicalTopic(l);
      // your own topics keep your wording; catalogue words get the merged name
      if (t) out.push({ key: t.key, kind, label: kind === 'ai' ? l : t.label });
      return;
    }
    out.push({ key: `${kind}:${fold(l)}`, kind, label: l });
  };
  if (b.series) add('series', b.series.replace(/\s*[;:].*$/, ''));
  b.authors.slice(0, 3).forEach((a) => add('author', a));
  if (b.aiTopics?.length) {
    // Your topic path is the topic: the catalogue's genres and subjects don't count for this book.
    b.aiTopics.forEach((t) => add('ai', t));
  } else {
    // No path yet: the catalogue stands in, so the book still lands somewhere sensible.
    b.genres.forEach((t) => add('genre', t));
    (b.subjects ?? []).forEach((t) => add('subject', t));
  }
  if (b.line) add('line', b.line);
  const y = b.writing?.year ?? b.firstPublishedYear;
  if (y) add('decade', `${Math.floor(y / 10) * 10}s`);
  if (b.language) add('lang', b.language);
  const seen = new Set<string>();
  return out.filter((f) => !seen.has(f.key) && !!seen.add(f.key));
}

export interface SimilarityModel {
  /** Sparse similarities: sim[i].get(j) (0 when absent). Symmetric. */
  sim: Map<number, number>[];
  /** The most similar other books, best first (at most 12). */
  nearest: number[][];
  /** Each book's features with their final weight, for naming regions of the wall. */
  features: { key: string; kind: FeatureKind; label: string; w: number; df: number }[][];
  /** Broad › specific topics (several levels), and each book's path in it. */
  tree: TopicTree;
  /** Display name per topic key. */
  topicLabel: Map<string, string>;
}

const isTopic = (k: FeatureKind) => k === 'ai' || k === 'genre' || k === 'subject';

/**
 * Pairs are found through shared features (an inverted index), so the cost stays far below n²:
 * features shared by more than a large share of the library are ignored (they say nothing).
 */
export function similarityModel(books: Book[]): SimilarityModel {
  const n = books.length;
  const feats = books.map(featuresOf);
  const df = new Map<string, number>();
  for (const fs of feats) for (const f of fs) df.set(f.key, (df.get(f.key) ?? 0) + 1);
  const common = Math.max(25, n * 0.35);
  const weighted = feats.map((fs) =>
    fs
      .map((f) => {
        const d = df.get(f.key)!;
        if (d < 2 || (RARITY[f.kind] && d > common)) return { ...f, w: 0, df: d };
        // Rarer topics count more, but at most 1.5×: a subject only two books share is often catalogue
        // noise, and must not outweigh a shared series or author.
        const rarity = RARITY[f.kind] ? Math.min(1.5, Math.max(0.35, (1.5 * Math.log(n / d)) / Math.log(Math.max(3, n / 2)))) : 1;
        return { ...f, w: KIND_WEIGHT[f.kind] * rarity, df: d };
      })
  );
  // The topic tree; a book's broad topic (its root) always carries some weight, so a whole branch
  // (all the fiction, all the history) stays together on the map, with its sub-topics inside.
  const topicLabel = new Map<string, string>();
  // names: your own wording wins over the catalogue's
  for (const fs of weighted) for (const f of fs) if (f.kind === 'ai' && !topicLabel.has(f.key)) topicLabel.set(f.key, f.label);
  for (const fs of weighted) for (const f of fs) if (isTopic(f.kind) && !topicLabel.has(f.key)) topicLabel.set(f.key, f.label);
  const ai = books.map((b) => (b.aiTopics ?? []).map((t) => canonicalTopic(t)?.key).filter((k): k is string => !!k));
  const tree = topicTree(weighted.map((fs) => fs.filter((f) => isTopic(f.kind))), ai);
  weighted.forEach((fs, i) => {
    const path = tree.paths[i];
    for (const f of fs) if (path.length > 1 && f.key === path[0]) f.w = Math.max(f.w, 0.9);
  });
  const norms = weighted.map((fs) => Math.sqrt(fs.reduce((s, f) => s + f.w * f.w, 0)) || 1);
  const index = new Map<string, { i: number; w: number }[]>();
  weighted.forEach((fs, i) => fs.forEach((f) => {
    if (f.w <= 0) return;
    const list = index.get(f.key);
    if (list) list.push({ i, w: f.w });
    else index.set(f.key, [{ i, w: f.w }]);
  }));
  const sim: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const list of index.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const x = list[a], y = list[b];
        const add = (x.w * y.w) / (norms[x.i] * norms[y.i]);
        sim[x.i].set(y.i, (sim[x.i].get(y.i) ?? 0) + add);
        sim[y.i].set(x.i, (sim[y.i].get(x.i) ?? 0) + add);
      }
    }
  }
  const nearest = sim.map((m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([j]) => j));
  return { sim, nearest, features: weighted, tree, topicLabel };
}

import { fold } from '../domain/query';
import type { Book } from '../domain/types';
import type { SimilarityModel } from './similarity';
import { canonicalTopic } from './topicTree';

/**
 * The order in which books are laid onto the wall's topic map, so that the map reads like a well
 * kept library: every topic one connected region inside its broad topic's region, and topics that
 * are alike side by side (Philosophy next to Political science, Crime next to Thrillers).
 *
 * - Topics are compared by their books: authors and series they share, overlapping catalogue
 *   subjects, era and language (an affinity between 0 and 1).
 * - At every level of the topic tree, the sibling topics go in a chain where each is followed by the
 *   one most like it; inside a topic, books follow their most similar book.
 * - The resulting sequence is laid along a space-filling curve, which keeps neighbours in the
 *   sequence neighbours on the map.
 */

interface Node {
  key: string;
  children: Map<string, Node>;
  /** Books whose path ends here. */
  direct: number[];
  /** Books at this node or below. */
  all: number[];
}

/** A book's profile for comparing topics (catalogue subjects count here even for books with a path). */
function profile(b: Book): string[] {
  const out: string[] = [];
  for (const a of b.authors.slice(0, 3)) out.push(`a:${fold(a)}`);
  if (b.series) out.push(`s:${fold(b.series.replace(/\s*[;:].*$/, ''))}`);
  for (const t of [...b.genres, ...(b.subjects ?? [])]) {
    const c = canonicalTopic(t);
    if (c) out.push(c.key);
  }
  const y = b.writing?.year ?? b.firstPublishedYear;
  if (y) out.push(`d:${Math.floor(y / 25) * 25}`);
  if (b.language) out.push(`l:${b.language}`);
  return out;
}

const WEIGHT: Record<string, number> = { a: 2, s: 2.5, t: 1, d: 0.5, l: 0.4 };

export interface TopicOrder {
  /** The book sequence for copy round `round` (each round starts the broad topics elsewhere, so copies meet other neighbours). */
  sequence(round: number): number[];
  /** How many path levels two books share (0 = different broad topics). */
  shared(a: number, b: number): number;
  /** Affinity between the broad topics (for checking, and tests). */
  affinity(a: string, b: string): number;
}

export function topicOrder(books: Book[], model: SimilarityModel): TopicOrder {
  const n = books.length;
  const paths = model.tree.paths;
  // ---- the tree
  const root: Node = { key: '', children: new Map(), direct: [], all: [] };
  const unsorted: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = paths[i];
    if (!p.length) {
      unsorted.push(i);
      continue;
    }
    let node = root;
    for (const k of p) {
      let c = node.children.get(k);
      if (!c) node.children.set(k, (c = { key: k, children: new Map(), direct: [], all: [] }));
      c.all.push(i);
      node = c;
    }
    node.direct.push(i);
  }

  // ---- topic profiles (IDF-weighted, normalised), compared by cosine
  const profiles = books.map(profile);
  const df = new Map<string, number>();
  for (const ps of profiles) for (const f of new Set(ps)) df.set(f, (df.get(f) ?? 0) + 1);
  const vectors = new Map<Node, Map<string, number>>();
  const vectorOf = (node: Node) => {
    let v = vectors.get(node);
    if (v) return v;
    v = new Map();
    for (const i of node.all) {
      for (const f of profiles[i]) {
        const d = df.get(f)!;
        if (d < 2 || d > n * 0.6) continue;
        v.set(f, (v.get(f) ?? 0) + (WEIGHT[f[0]] ?? 1) * Math.log(1 + n / d));
      }
    }
    const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1;
    for (const [k, x] of v) v.set(k, x / norm);
    vectors.set(node, v);
    return v;
  };
  const cosine = (a: Node, b: Node) => {
    const va = vectorOf(a), vb = vectorOf(b);
    let s = 0;
    for (const [k, x] of va.size < vb.size ? va : vb) s += x * ((va.size < vb.size ? vb : va).get(k) ?? 0);
    return s;
  };

  /**
   * Siblings in a chain where alike topics are neighbours: biggest first, then each topic is put
   * where it fits best (between the two it is most like, or at an end next to its closest one).
   * Better than "always the most similar next": that leaves the odd ones dangling at the end.
   */
  const chainNodes = (nodes: Node[]): Node[] => {
    const bySize = [...nodes].sort((a, b) => b.all.length - a.all.length);
    if (bySize.length < 3) return bySize;
    const out: Node[] = [bySize[0]];
    for (const node of bySize.slice(1)) {
      let at = out.length, best = -Infinity;
      for (let i = 0; i <= out.length; i++) {
        const left = out[i - 1], right = out[i];
        const gain = (left ? cosine(left, node) : 0) + (right ? cosine(node, right) : 0) - (left && right ? cosine(left, right) : 0);
        if (gain > best) { best = gain; at = i; }
      }
      out.splice(at, 0, node);
    }
    return out;
  };
  /** Books in a chain, each followed by its most similar book left. */
  const chainBooks = (ids: number[]): number[] => {
    if (ids.length < 3) return ids;
    const left = new Set(ids);
    let cur = ids[0];
    const out = [cur];
    left.delete(cur);
    while (left.size) {
      let best = -1, bestS = -1;
      for (const j of model.nearest[cur]) if (left.has(j)) { best = j; break; }
      if (best < 0) for (const j of left) { const s = model.sim[cur].get(j) ?? 0; if (s > bestS) { best = j; bestS = s; } }
      out.push(best);
      left.delete(best);
      cur = best;
    }
    return out;
  };

  const orderCache = new Map<Node, Node[]>();
  const kids = (node: Node) => {
    let o = orderCache.get(node);
    if (!o) orderCache.set(node, (o = chainNodes([...node.children.values()])));
    return o;
  };
  const walk = (node: Node, out: number[]) => {
    // books with no finer topic go in the middle of their topic, between its sub-topics
    const children = kids(node);
    const half = Math.ceil(children.length / 2);
    children.slice(0, half).forEach((c) => walk(c, out));
    out.push(...chainBooks(node.direct));
    children.slice(half).forEach((c) => walk(c, out));
  };
  const top = kids(root);
  let base: number[] | undefined;
  const unsortedChain = chainBooks(unsorted);

  return {
    sequence(round) {
      // One cyclic order for every round of copies, started a good third further along each time: the
      // map keeps one topic order throughout, and a book's copies end up far apart by construction.
      if (!base) {
        base = [];
        for (const t of top) walk(t, base);
        base.push(...unsortedChain);
      }
      const shift = Math.round((round * base.length * 0.37) % base.length);
      return [...base.slice(shift), ...base.slice(0, shift)];
    },
    shared(a, b) {
      const pa = paths[a], pb = paths[b];
      let s = 0;
      while (s < pa.length && s < pb.length && pa[s] === pb[s]) s++;
      return s;
    },
    affinity(a, b) {
      const na = root.children.get(a), nb = root.children.get(b);
      return na && nb ? cosine(na, nb) : 0;
    }
  };
}

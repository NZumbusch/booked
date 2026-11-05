import type { Book, Id } from './types';

/**
 * Your topic paths (broad › specific, e.g. Belletristik › Kriminalroman › Skandinavischer Krimi) as
 * one tree, and the edits on it. A node is identified by its full path, so "Krimi" under
 * Belletristik and "Krimi" elsewhere are different topics. Every edit returns the new path for each
 * book it touches, to be saved as one undoable step.
 */

export interface PathNode {
  name: string;
  /** Full path from the top, including this node. */
  path: string[];
  /** Books exactly at this node (their path ends here). */
  direct: Id[];
  /** Books at this node or below. */
  total: number;
  children: PathNode[];
}

type WithPath = Pick<Book, 'id' | 'aiTopics'>;

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const startsWith = (path: string[], prefix: string[]) => prefix.length <= path.length && prefix.every((x, i) => x === path[i]);

/** The tree of all paths in use; biggest topics first. */
export function pathTree(books: WithPath[]): PathNode[] {
  const root: PathNode = { name: '', path: [], direct: [], total: 0, children: [] };
  for (const b of books) {
    const p = b.aiTopics ?? [];
    if (!p.length) continue;
    let node = root;
    node.total++;
    for (let d = 0; d < p.length; d++) {
      let child = node.children.find((c) => c.name === p[d]);
      if (!child) {
        child = { name: p[d], path: p.slice(0, d + 1), direct: [], total: 0, children: [] };
        node.children.push(child);
      }
      child.total++;
      node = child;
    }
    node.direct.push(b.id);
  }
  const sort = (n: PathNode) => {
    n.children.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

/** Every node, depth-first (for pickers): with its depth. */
export function flatten(nodes: PathNode[], depth = 0): { node: PathNode; depth: number }[] {
  return nodes.flatMap((n) => [{ node: n, depth }, ...flatten(n.children, depth + 1)]);
}

export type PathChanges = Map<Id, string[] | undefined>;

function remap(books: WithPath[], node: string[], fn: (rest: string[]) => string[] | undefined): PathChanges {
  const out: PathChanges = new Map();
  for (const b of books) {
    const p = b.aiTopics ?? [];
    if (!startsWith(p, node)) continue;
    const next = fn(p.slice(node.length));
    const clean = next?.map((t) => t.trim()).filter(Boolean);
    const value = clean?.length ? clean : undefined;
    if (!value ? p.length : !same(value, p)) out.set(b.id, value);
  }
  return out;
}

/**
 * Rename the topic at `node` (only there, on every book below it). Renaming it to the name of a
 * sibling merges the two, sub-topics included.
 */
export function renameNode(books: WithPath[], node: string[], name: string): PathChanges {
  const n = name.trim();
  if (!n || !node.length) return new Map();
  const parent = node.slice(0, -1);
  return remap(books, node, (rest) => [...parent, n, ...rest]);
}

/**
 * Move the topic at `node` (with everything below it) under `to` ([] = make it a broad topic).
 * If `to` already has a topic of that name, they merge. Moving a topic into itself does nothing.
 */
export function moveNode(books: WithPath[], node: string[], to: string[]): PathChanges {
  if (!node.length || startsWith(to, node)) return new Map();
  const name = node[node.length - 1];
  return remap(books, node, (rest) => [...to, name, ...rest]);
}

/** Merge the topic at `node` into `into` (anywhere in the tree): its books and sub-topics go there. */
export function mergeNode(books: WithPath[], node: string[], into: string[]): PathChanges {
  if (!node.length || !into.length || startsWith(into, node)) return new Map();
  return remap(books, node, (rest) => [...into, ...rest]);
}

/**
 * Remove the topic at `node`.
 * - `lift`: its sub-topics move up one level (Belletristik › Krimi › Nordic → Belletristik › Nordic)
 * - `drop`: its books (and those of its sub-topics) go to the topic above it, sub-topics and all
 *   (a broad topic removed this way leaves its books without a path)
 */
export function removeNode(books: WithPath[], node: string[], mode: 'lift' | 'drop'): PathChanges {
  if (!node.length) return new Map();
  const parent = node.slice(0, -1);
  return remap(books, node, (rest) => (mode === 'lift' ? [...parent, ...rest] : parent));
}

/** Add a sub-topic level under `node` for some of its books (e.g. split "Krimi" into "Nordic noir"). */
export function setPath(books: WithPath[], ids: Id[], path: string[]): PathChanges {
  const want = new Set(ids);
  const out: PathChanges = new Map();
  for (const b of books) if (want.has(b.id) && !same(b.aiTopics ?? [], path)) out.set(b.id, path.length ? path : undefined);
  return out;
}

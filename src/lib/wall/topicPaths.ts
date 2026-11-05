import type { Book } from '../domain/types';
import { similarityModel } from './similarity';

export interface LibraryTopics {
  /** Topic paths in use ("Fiction > Crime & mystery"), as a tree in reading order. */
  vocabulary: string[];
  /** The path the wall uses for a book (your own topics, else worked out from the catalogue). */
  pathOf: (bookId: string) => string[];
  /** Has the book any topic at all (own or usable catalogue topic)? */
  hasTopic: (b: Book) => boolean;
}

/** The library's current topic tree: offered to the AI, and as suggestions when you set a topic yourself. */
export function libraryTopics(books: Book[]): LibraryTopics {
  const model = similarityModel(books);
  const name = (k: string) => model.topicLabel.get(k) ?? k.replace(/^t:/, '');
  const paths = model.tree.paths.map((p) => p.map(name));
  const index = new Map(books.map((b, i) => [b.id, i]));
  const count = new Map<string, number>();
  for (const p of paths) for (let k = 1; k <= p.length; k++) {
    const text = p.slice(0, k).join(' > ');
    count.set(text, (count.get(text) ?? 0) + 1);
  }
  // own topics count even on a single book; worked-out ones from two books on
  for (const b of books) if (b.aiTopics?.length) for (let k = 1; k <= b.aiTopics.length; k++) {
    const text = b.aiTopics.slice(0, k).join(' > ');
    count.set(text, Math.max(2, count.get(text) ?? 0));
  }
  const vocabulary = [...count.entries()].filter(([, n]) => n >= 2).map(([t]) => t).sort((a, b) => a.localeCompare(b));
  return {
    vocabulary,
    pathOf: (id) => paths[index.get(id) ?? -1] ?? [],
    hasTopic: (b) => !!b.aiTopics?.length || (paths[index.get(b.id) ?? -1]?.length ?? 0) > 0
  };
}

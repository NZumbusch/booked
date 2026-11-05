import { describe, expect, it } from 'vitest';
import { flatten, mergeNode, moveNode, pathTree, removeNode, renameNode, setPath } from './pathTree';

const books = [
  { id: 'a', aiTopics: ['Belletristik', 'Krimi', 'Nordic'] },
  { id: 'b', aiTopics: ['Belletristik', 'Krimi'] },
  { id: 'c', aiTopics: ['Belletristik', 'Kriminalroman'] },
  { id: 'd', aiTopics: ['Belletristik', 'Lyrik'] },
  { id: 'e', aiTopics: ['Philosophie', 'Krimi'] },
  { id: 'f' }
];
const apply = (changes: Map<string, string[] | undefined>) =>
  books.map((b) => ({ id: b.id, aiTopics: changes.has(b.id) ? changes.get(b.id) : b.aiTopics }));

describe('topic path tree', () => {
  it('builds the tree with counts, biggest first, a node per place', () => {
    const t = pathTree(books);
    expect(t.map((n) => [n.name, n.total])).toEqual([['Belletristik', 4], ['Philosophie', 1]]);
    const krimi = t[0].children[0];
    expect([krimi.name, krimi.total, krimi.direct]).toEqual(['Krimi', 2, ['b']]);
    expect(flatten(t).map(({ node, depth }) => `${depth}:${node.name}`)).toEqual([
      '0:Belletristik', '1:Krimi', '2:Nordic', '1:Kriminalroman', '1:Lyrik', '0:Philosophie', '1:Krimi'
    ]);
  });

  it('renames only at that place; renaming onto a sibling merges', () => {
    const r = renameNode(books, ['Belletristik', 'Krimi'], 'Kriminalroman');
    expect(r.get('a')).toEqual(['Belletristik', 'Kriminalroman', 'Nordic']);
    expect(r.get('b')).toEqual(['Belletristik', 'Kriminalroman']);
    expect(r.has('e')).toBe(false); // Philosophie › Krimi is another topic
    const merged = pathTree(apply(r))[0].children.find((n) => n.name === 'Kriminalroman')!;
    expect(merged.total).toBe(3);
    expect(renameNode(books, ['Belletristik'], 'belletristik').size).toBe(4); // capitalisation alone works
  });

  it('moves a topic with its sub-topics, to the top or under another one', () => {
    expect(moveNode(books, ['Belletristik', 'Lyrik'], []).get('d')).toEqual(['Lyrik']);
    expect(moveNode(books, ['Belletristik', 'Krimi'], ['Philosophie']).get('a')).toEqual(['Philosophie', 'Krimi', 'Nordic']);
    expect(moveNode(books, ['Belletristik'], ['Belletristik', 'Krimi']).size).toBe(0); // not into itself
  });

  it('merges a topic into any other', () => {
    const m = mergeNode(books, ['Philosophie', 'Krimi'], ['Belletristik', 'Krimi']);
    expect(m.get('e')).toEqual(['Belletristik', 'Krimi']);
  });

  it('removes a topic: lifting its sub-topics, or dropping to the topic above', () => {
    const lift = removeNode(books, ['Belletristik', 'Krimi'], 'lift');
    expect(lift.get('a')).toEqual(['Belletristik', 'Nordic']);
    expect(lift.get('b')).toEqual(['Belletristik']);
    const drop = removeNode(books, ['Belletristik', 'Krimi'], 'drop');
    expect(drop.get('a')).toEqual(['Belletristik']);
    expect(removeNode(books, ['Philosophie'], 'drop').get('e')).toBeUndefined(); // no path left
    expect(removeNode(books, ['Philosophie'], 'drop').has('e')).toBe(true);
  });

  it('sets a path for chosen books', () => {
    expect(setPath(books, ['b', 'f'], ['Belletristik', 'Krimi', 'Nordic'])).toEqual(new Map([
      ['b', ['Belletristik', 'Krimi', 'Nordic']], ['f', ['Belletristik', 'Krimi', 'Nordic']]
    ]));
  });
});

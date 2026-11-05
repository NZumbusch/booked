import { describe, expect, it } from 'vitest';
import { canonicalTopic, topicTree } from './topicTree';

const k = (label: string) => canonicalTopic(label)!.key;

describe('topic tree', () => {
  it('merges catalogue synonyms (English and German) and drops noise', () => {
    expect(k('Detective and mystery stories')).toBe(k('Krimi'));
    expect(k('Jugendbuch')).toBe(k('Juvenile fiction'));
    expect(canonicalTopic('Kriminalroman')!.label).toBe('Crime & mystery');
    expect(canonicalTopic('German language materials')).toBeUndefined();
  });

  it('puts narrower topics under broader ones they mostly come with, on several levels', () => {
    const book = (...labels: string[]) => labels.map((l) => ({ key: k(l), w: 1 }));
    const topics = [
      ...Array.from({ length: 4 }, () => book('Fiction', 'Krimi', 'Scandinavian crime')),
      ...Array.from({ length: 3 }, () => book('Fiction', 'Krimi')),
      ...Array.from({ length: 4 }, () => book('Fiction', 'Love stories')),
      ...Array.from({ length: 5 }, () => book('Fiction')),
      ...Array.from({ length: 4 }, () => book('History'))
    ];
    const t = topicTree(topics, topics.map(() => []));
    expect(t.parent.get(k('Krimi'))).toBe(k('Fiction'));
    expect(t.parent.get(k('Love stories'))).toBe(k('Fiction'));
    expect(t.parent.get(k('Scandinavian crime'))).toBe(k('Krimi'));
    expect(t.paths[0]).toEqual([k('Fiction'), k('Krimi'), k('Scandinavian crime')]);
    expect(t.paths[19]).toEqual([k('History')]);
  });

  it('takes AI topic paths as given (broad first)', () => {
    const t = topicTree([[]], [[k('Fiction'), k('Krimi'), k('Nordic noir')]]);
    expect(t.paths[0]).toEqual([k('Fiction'), k('Krimi'), k('Nordic noir')]);
  });
});

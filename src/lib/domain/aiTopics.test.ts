import { describe, expect, it } from 'vitest';
import { createBook } from './book';
import { aiTopicPrompts, aiVocabulary, booksFor, parseAiTopics, parsePath, pathText, PART_SIZE, topLevels } from './aiTopics';

const now = '2026-11-05T10:00:00.000Z';
const book = (i: number, extra: Record<string, unknown> = {}) =>
  createBook({ title: `Title ${i}`, authors: [`Author ${i}`], firstPublishedYear: 1990 + i, genres: ['Fiction'], ...extra }, { id: `id${i}`, now });

describe('AI topics', () => {
  it('writes a numbered prompt with the books and the rules, in parts for big libraries', () => {
    const [p] = aiTopicPrompts([book(1, { series: 'Preußische Trilogie' }), book(2)], 'de');
    expect(p.ids).toEqual(['id1', 'id2']);
    expect(p.text).toContain('1: Title 1 | Author 1 | 1991 | series: Preußische Trilogie | catalogue: Fiction');
    expect(p.text).toContain('German');
    expect(p.text).toContain('search the web');
    const many = aiTopicPrompts(Array.from({ length: PART_SIZE + 5 }, (_, i) => book(i)), 'en', ['Fiction > Crime & mystery', 'History']);
    expect(many.map((x) => x.ids.length)).toEqual([PART_SIZE, 5]);
    expect(many[1].text).toContain('part 2 of 2');
    expect(many[1].text).toContain('  Fiction > Crime & mystery\n  History');
    expect(many[1].text).toContain('make a new topic');
  });

  it('reads answers in the usual shapes and reports what it couldn\'t read', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const answer = [
      'Here you go:',
      '1: Belletristik > Kriminalroman > Skandinavischer Krimi',
      '- **2.** Philosophie › Politische Philosophie',
      '3) Geschichte / Preußen',
      '4: ',
      '99: Out of range',
      '5 - "Lyrik" > Moderne Lyrik.'
    ].join('\n');
    const r = parseAiTopics(answer, ids);
    expect(r.paths.get('a')).toEqual(['Belletristik', 'Kriminalroman', 'Skandinavischer Krimi']);
    expect(r.paths.get('b')).toEqual(['Philosophie', 'Politische Philosophie']);
    expect(r.paths.get('c')).toEqual(['Geschichte', 'Preußen']);
    expect(r.paths.get('e')).toEqual(['Lyrik', 'Moderne Lyrik']);
    expect(r.paths.has('d')).toBe(false);
    expect(r.skipped).toEqual(['4:', '99: Out of range']);
    expect(topLevels(r.paths)[0]).toEqual({ name: 'Belletristik', count: 1 });
  });

  it('picks the books to ask about', () => {
    const books = [book(1, { aiTopics: ['Fiction'] }), book(2), book(3, { genres: [] })];
    const catalogue = (b: { genres: string[] }) => b.genres.length > 0;
    expect(booksFor('unsorted', books, catalogue).map((b) => b.id)).toEqual(['id2', 'id3']);
    expect(booksFor('none', books, catalogue).map((b) => b.id)).toEqual(['id3']);
    expect(booksFor('all', books, catalogue)).toHaveLength(3);
    expect(parsePath(' Fiction › Crime  > Nordic noir ')).toEqual(['Fiction', 'Crime', 'Nordic noir']);
    expect(pathText(['A', 'B'])).toBe('A > B');
  });

  it('collects the vocabulary already in use, most used first', () => {
    expect(aiVocabulary([{ aiTopics: ['Fiction', 'Crime'] }, { aiTopics: ['Fiction'] }, {}])).toEqual(['Fiction', 'Crime']);
  });
});

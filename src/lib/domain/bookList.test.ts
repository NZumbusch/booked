import { describe, expect, it } from 'vitest';
import { parseBookList } from './bookList';

describe('parseBookList', () => {
  it('reads the AI format, with empty fields and volumes', () => {
    const list = parseBookList(`Author | Title | Publisher | Year | Series or edition | Volume
Theodor Fontane | Der Stechlin | Nymphenburger | 1959 | Sämtliche Werke | Bd. 8
Theodor Fontane | Quitt |  |  | Sämtliche Werke | 6
| Das Nibelungenlied | Reclam | | |`);
    expect(list).toEqual([
      { title: 'Der Stechlin', authors: ['Theodor Fontane'], publisher: 'Nymphenburger', year: 1959, series: 'Sämtliche Werke', seriesNumber: '8' },
      { title: 'Quitt', authors: ['Theodor Fontane'], publisher: undefined, year: undefined, series: 'Sämtliche Werke', seriesNumber: '6' },
      { title: 'Das Nibelungenlied', authors: [], publisher: 'Reclam', year: undefined, series: undefined, seriesNumber: undefined }
    ]);
  });

  it('reads hand-typed lines', () => {
    expect(parseBookList(`- Theodor Fontane: Effi Briest
2. Fontane – Der Stechlin (Nymphenburger 1959)
Buddenbrooks, 1922
Max Frisch - Homo faber`)).toEqual([
      { title: 'Effi Briest', authors: ['Theodor Fontane'], publisher: undefined, year: undefined },
      { title: 'Der Stechlin', authors: ['Fontane'], publisher: 'Nymphenburger', year: 1959 },
      { title: 'Buddenbrooks', authors: [], publisher: undefined, year: 1922 },
      { title: 'Homo faber', authors: ['Max Frisch'], publisher: undefined, year: undefined }
    ]);
  });

  it('keeps hyphenated titles whole', () => {
    expect(parseBookList('Die Schleswig-Holstein-Frage')[0].title).toBe('Die Schleswig-Holstein-Frage');
  });
});

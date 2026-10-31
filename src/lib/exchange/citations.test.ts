import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import { splitPersonName, toBibtex, toCslJson, toRis } from './citations';

const now = '2026-10-30T10:00:00.000Z';
const dune = createBook({
  title: 'Dune', authors: ['Frank Herbert'], publishedYear: 1987, firstPublishedYear: 1965, publisher: 'Ace & Co',
  isbn13: '9780441172719', pageCount: 535, language: 'en', tags: ['sf']
}, { id: '1', now });

describe('names', () => {
  it('splits common name shapes', () => {
    expect(splitPersonName('Frank Herbert')).toEqual({ given: 'Frank', family: 'Herbert' });
    expect(splitPersonName('Ursula K. Le Guin')).toEqual({ given: 'Ursula K.', family: 'Le Guin' });
    expect(splitPersonName('Ludwig van Beethoven')).toEqual({ given: 'Ludwig', family: 'van Beethoven' });
    expect(splitPersonName('Mann, Thomas')).toEqual({ given: 'Thomas', family: 'Mann' });
    expect(splitPersonName('Homer')).toEqual({ family: 'Homer' });
  });
});

describe('CSL-JSON', () => {
  it('produces Zotero-importable book items', () => {
    const [item] = JSON.parse(toCslJson([dune]));
    expect(item).toMatchObject({
      type: 'book', title: 'Dune', author: [{ given: 'Frank', family: 'Herbert' }], issued: { 'date-parts': [[1987]] },
      'original-date': { 'date-parts': [[1965]] }, ISBN: '9780441172719', 'number-of-pages': 535
    });
    expect(item).not.toHaveProperty('note');
  });
});

describe('RIS', () => {
  it('writes tagged lines ending with ER', () => {
    const ris = toRis([dune]);
    expect(ris).toContain('TY  - BOOK\r\nTI  - Dune\r\nAU  - Herbert, Frank\r\nPY  - 1987');
    expect(ris).toContain('KW  - sf');
    expect(ris.trim().endsWith('ER  -')).toBe(true);
  });
});

describe('BibTeX', () => {
  it('escapes special characters and makes unique keys', () => {
    const bib = toBibtex([dune, dune]);
    expect(bib).toContain('@book{herbert1987dune,');
    expect(bib).toContain('@book{herbert1987dunea,');
    expect(bib).toContain('publisher = {Ace \\& Co}');
    expect(bib).toContain('author = {Herbert, Frank}');
  });
});

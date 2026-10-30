import { describe, expect, it } from 'vitest';
import { cleanIsbn, isValidIsbn10, isValidIsbn13, isbn10To13, isbn13To10, normalizeIsbn, isbnKeys } from './isbn';

describe('isbn', () => {
  it('cleans separators and lowercase x', () => {
    expect(cleanIsbn(' 0-306-40615-2 ')).toBe('0306406152');
    expect(cleanIsbn('080442957x')).toBe('080442957X');
  });

  it('validates ISBN-10 checksums', () => {
    expect(isValidIsbn10('0306406152')).toBe(true);
    expect(isValidIsbn10('080442957X')).toBe(true);
    expect(isValidIsbn10('0306406153')).toBe(false);
    expect(isValidIsbn10('12345')).toBe(false);
  });

  it('validates ISBN-13 checksums', () => {
    expect(isValidIsbn13('9780306406157')).toBe(true);
    expect(isValidIsbn13('9780306406158')).toBe(false);
    expect(isValidIsbn13('978030640615')).toBe(false);
  });

  it('converts between 10 and 13', () => {
    expect(isbn10To13('0306406152')).toBe('9780306406157');
    expect(isbn13To10('9780306406157')).toBe('0306406152');
    expect(isbn13To10('9790000000001')).toBeUndefined(); // 979 has no ISBN-10
  });

  it('normalizes any input into both forms', () => {
    expect(normalizeIsbn('0-306-40615-2')).toEqual({ isbn10: '0306406152', isbn13: '9780306406157' });
    expect(normalizeIsbn('978-0-306-40615-7')).toEqual({ isbn10: '0306406152', isbn13: '9780306406157' });
    expect(normalizeIsbn('not an isbn')).toBeUndefined();
  });

  it('builds a comparable key set for duplicate detection', () => {
    expect(isbnKeys({ isbn10: '0306406152' })).toEqual(['9780306406157']);
    expect(isbnKeys({ isbn13: '9780306406157', isbn10: '0306406152' })).toEqual(['9780306406157']);
    expect(isbnKeys({})).toEqual([]);
  });
});

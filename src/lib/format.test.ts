import { describe, expect, it } from 'vitest';
import { formatDate, plural } from './format';

describe('format', () => {
  it('formats dates per setting', () => {
    expect(formatDate('2026-03-04', 'dmy')).toBe('04.03.2026');
    expect(formatDate('2026-03-04', 'mdy')).toBe('03/04/2026');
    expect(formatDate('2026-03-04T10:00:00Z', 'iso')).toBe('2026-03-04');
    expect(formatDate(undefined, 'iso')).toBe('');
  });
  it('pluralizes', () => {
    expect(plural(1, 'book')).toBe('1 book');
    expect(plural(1200, 'book')).toBe('1,200 books');
  });
});

describe('languageName', () => {
  it('names ISO codes and passes unknown ones through', async () => {
    const { languageName } = await import('./format');
    expect(languageName('de')).toBe('German');
    expect(languageName(undefined)).toBeUndefined();
    expect(languageName('not a code!')).toBe('not a code!');
  });
});

describe('ordinal', () => {
  it('handles teens and units', async () => {
    const { ordinal } = await import('./format');
    expect([1, 2, 3, 4, 11, 12, 13, 19, 20, 21, 22, 23, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '19th', '20th', '21st', '22nd', '23rd', '111th']);
  });
});

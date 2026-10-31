import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, toCsv } from './csv';

describe('csv', () => {
  it('parses quotes, escaped quotes and newlines inside fields', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi""\nthere"\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"\nthere']]);
  });
  it('handles BOM, empty fields and blank lines', () => {
    expect(parseCsv('﻿a,,c\n\n1,2,\n')).toEqual([['a', '', 'c'], ['1', '2', '']]);
  });
  it('detects semicolon and tab delimiters', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips', () => {
    const rows = [['title', 'notes'], ['Dune', 'line 1\nline "2"'], ['A, B', ' padded ']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

import { describe, expect, it } from 'vitest';
import { parseHash, buildHash } from './router';

describe('router', () => {
  it('parses paths, params and query', () => {
    expect(parseHash('#/book/abc?edit=1')).toEqual({ path: '/book/abc', parts: ['book', 'abc'], query: { edit: '1' } });
    expect(parseHash('')).toEqual({ path: '/', parts: [], query: {} });
  });
  it('builds hashes, dropping empty query values', () => {
    expect(buildHash('/books', { q: 'dune hugo', loc: '', sort: undefined })).toBe('#/books?q=dune+hugo');
    expect(buildHash('/')).toBe('#/');
  });
});

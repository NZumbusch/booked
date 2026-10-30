import { describe, expect, it } from 'vitest';
import { createBook, findDuplicates, applyPatch, splitList, isOverdue, missingMetadata } from './book';

const now = '2026-10-30T10:00:00.000Z';

describe('createBook', () => {
  it('fills defaults', () => {
    const b = createBook({ title: '  Dune ' }, { id: 'b1', now });
    expect(b).toMatchObject({
      id: 'b1', title: 'Dune', authors: [], genres: [], tags: [], collections: [],
      status: 'unread', ownership: 'owned', signed: false, copies: 1, locationId: null,
      createdAt: now, updatedAt: now
    });
  });

  it('normalizes ISBNs, lists and rating', () => {
    const b = createBook(
      { title: 'X', isbn10: '0-306-40615-2', authors: [' Ann ', '', 'Ann'], tags: ['a', 'A ', 'b'], rating: 9 },
      { id: 'b', now }
    );
    expect(b.isbn13).toBe('9780306406157');
    expect(b.isbn10).toBe('0306406152');
    expect(b.authors).toEqual(['Ann']);
    expect(b.tags).toEqual(['a', 'b']);
    expect(b.rating).toBe(5);
  });

  it('rejects empty titles', () => {
    expect(() => createBook({ title: ' ' }, { id: 'x', now })).toThrow(/title/i);
  });
});

describe('applyPatch', () => {
  it('updates fields, keeps identity and bumps updatedAt', () => {
    const b = createBook({ title: 'A' }, { id: 'b', now });
    const later = '2026-11-01T00:00:00.000Z';
    const p = applyPatch(b, { title: 'B', id: 'hacked', createdAt: 'x' } as never, later);
    expect(p).toMatchObject({ id: 'b', title: 'B', createdAt: now, updatedAt: later });
  });
});

describe('findDuplicates', () => {
  const a = createBook({ title: 'A', isbn13: '9780306406157' }, { id: 'a', now });
  const b = createBook({ title: 'B' }, { id: 'b', now });
  it('matches across ISBN-10/13', () => {
    expect(findDuplicates([a, b], { isbn10: '0306406152' }).map((x) => x.id)).toEqual(['a']);
  });
  it('ignores books without ISBN and the book itself', () => {
    expect(findDuplicates([a, b], {})).toEqual([]);
    expect(findDuplicates([a, b], { id: 'a', isbn13: '9780306406157' })).toEqual([]);
  });
});

describe('helpers', () => {
  it('splits comma lists', () => {
    expect(splitList(' a, b ,, c ')).toEqual(['a', 'b', 'c']);
  });
  it('detects overdue loans', () => {
    const b = createBook({ title: 'A', lending: { to: 'Sam', lentOn: '2026-01-01', dueOn: '2026-02-01' } }, { id: 'a', now });
    expect(isOverdue(b, '2026-02-02')).toBe(true);
    expect(isOverdue(b, '2026-02-01')).toBe(false);
  });
  it('flags missing metadata', () => {
    expect(missingMetadata(createBook({ title: 'A' }, { id: 'a', now }))).toBe(true);
    expect(missingMetadata(createBook({ title: 'A', authors: ['x'], publishedYear: 2000, isbn13: '9780306406157' }, { id: 'a', now }))).toBe(false);
  });
});

describe('fillMissing', () => {
  it('only fills empty fields and merges provenance', async () => {
    const { fillMissing } = await import('./book');
    const b = createBook({ title: 'Mine', authors: [], notes: 'keep', genres: ['A'] }, { id: 'a', now });
    const patch = fillMissing(b, {
      title: 'Theirs', authors: ['X'], publisher: 'P', genres: ['B'],
      provenance: { authors: { source: 'openlibrary' }, title: { source: 'openlibrary' } }, sources: ['openlibrary']
    });
    expect(patch).toEqual({
      authors: ['X'], publisher: 'P', provenance: { authors: { source: 'openlibrary' } }, sources: ['openlibrary']
    });
  });
});

describe('provenance on edit', () => {
  it('drops the source of a field the user changed by hand', () => {
    const b = createBook({ title: 'A', publisher: 'X', provenance: { publisher: { source: 'openlibrary' }, title: { source: 'openlibrary' } } }, { id: 'a', now });
    const p = applyPatch(b, { publisher: 'Y', title: 'A' }, now);
    expect(p.provenance).toEqual({ title: { source: 'openlibrary' } });
  });
  it('keeps provenance supplied with the patch', () => {
    const b = createBook({ title: 'A' }, { id: 'a', now });
    const p = applyPatch(b, { publisher: 'Y', provenance: { publisher: { source: 'wikidata' } } }, now);
    expect(p.provenance).toEqual({ publisher: { source: 'wikidata' } });
  });
});

describe('provenance via forms', () => {
  it('drops stale provenance even when the form echoes it back', () => {
    const prov = { publisher: { source: 'openlibrary' as const } };
    const b = createBook({ title: 'A', publisher: 'X', provenance: prov }, { id: 'a', now });
    expect(applyPatch(b, { publisher: 'Y', provenance: prov }, now).provenance).toBeUndefined();
  });
});

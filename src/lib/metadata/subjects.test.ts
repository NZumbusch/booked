import { describe, expect, it } from 'vitest';
import ecology from './fixtures/ol-subject-ecology.json';
import { olSubject, subjectSlug } from './subjects';
import { fakeFetch } from './testing';

describe('Open Library subjects', () => {
  it('builds slugs', () => {
    expect(subjectSlug('Human ecology')).toBe('human_ecology');
    expect(subjectSlug(' Ökologie ')).toBe('ökologie');
    expect(subjectSlug('Fiction, science fiction')).toBe('fiction_science_fiction');
  });
  it('maps works and related topics, dropping catalogue noise', async () => {
    const calls: string[] = [];
    const s = (await olSubject('Ecology', fakeFetch({ '/subjects/ecology.json': ecology }, calls)))!;
    expect(calls[0]).toContain('details=true');
    expect(s.workCount).toBe(24900);
    expect(s.works[0]).toMatchObject({ olWorkId: 'OL893414W', title: 'Dune', authors: ['Frank Herbert'], year: 1965 });
    expect(s.related.map((r) => r.name)).toContain('Human ecology');
    expect(s.related.map((r) => r.name)).not.toContain('Juvenile literature');
  });
  it('returns undefined for unknown topics', async () => {
    expect(await olSubject('nothing here', fakeFetch({}))).toBeUndefined();
  });
});

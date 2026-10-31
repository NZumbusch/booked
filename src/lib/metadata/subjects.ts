import { getJson, type Fetcher } from './http';

/** Open Library subject pages: the best-known works on a topic and related topics. */
export interface SubjectInfo {
  name: string;
  workCount: number;
  works: { olWorkId: string; title: string; authors: string[]; year?: number; cover?: string; editionCount: number }[];
  related: { name: string; count: number }[];
}

interface OlSubject {
  name: string;
  work_count: number;
  works: { key: string; title: string; edition_count: number; cover_id?: number; authors?: { name: string }[]; first_publish_year?: number }[];
  subjects?: { name: string; count: number }[];
}

/** "Human ecology" → "human_ecology" (Open Library's subject slug). */
export function subjectSlug(name: string): string {
  return name.trim().toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '');
}

const NOISE = /^(fiction|juvenile literature|congresses|history|accessible book|protected daisy|in library|large type books)$/i;

export async function olSubject(name: string, f: Fetcher = fetch.bind(globalThis), limit = 24): Promise<SubjectInfo | undefined> {
  const s = await getJson<OlSubject>(f, `https://openlibrary.org/subjects/${encodeURIComponent(subjectSlug(name))}.json?details=true&limit=${limit}`, { timeoutMs: 20000 });
  if (!s || !s.work_count) return undefined;
  return {
    name: s.name,
    workCount: s.work_count,
    works: s.works.map((w) => ({
      olWorkId: w.key.split('/').pop()!,
      title: w.title,
      authors: (w.authors ?? []).map((a) => a.name),
      year: w.first_publish_year,
      cover: w.cover_id ? `https://covers.openlibrary.org/b/id/${w.cover_id}-M.jpg?default=false` : undefined,
      editionCount: w.edition_count
    })),
    related: (s.subjects ?? []).filter((x) => !NOISE.test(x.name) && x.name.toLowerCase() !== s.name.toLowerCase()).slice(0, 12)
  };
}

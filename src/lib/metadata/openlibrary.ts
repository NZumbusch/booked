import type { BookFormat } from '../domain/types';
import { getJson, parseYear, plainText, type Fetcher } from './http';
import type { Candidate, MetaFields, ProviderResult } from './types';

const OL = 'https://openlibrary.org';
const SEARCH_FIELDS = [
  'key', 'title', 'subtitle', 'author_name', 'author_key', 'first_publish_year', 'cover_i',
  'edition_count', 'subject', 'language', 'number_of_pages_median'
].join(',');

type Text = string | { value: string };
interface OlEdition {
  key: string;
  title?: string;
  subtitle?: string;
  authors?: { key: string }[];
  works?: { key: string }[];
  publishers?: string[];
  publish_date?: string;
  publish_places?: string[];
  number_of_pages?: number;
  physical_format?: string;
  languages?: { key: string }[];
  edition_name?: string;
  series?: string[];
  covers?: number[];
  isbn_10?: string[];
  isbn_13?: string[];
  description?: Text;
  contributors?: { role?: string; name: string }[];
  identifiers?: Record<string, string[]>;
  subjects?: string[];
}
interface OlWork {
  key: string;
  title?: string;
  description?: Text;
  subjects?: string[];
  covers?: number[];
  first_publish_date?: string;
  authors?: { author: { key: string } }[];
}
interface OlAuthor {
  key: string;
  name?: string;
  remote_ids?: { wikidata?: string };
}
interface OlSearchDoc {
  key: string;
  title: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  cover_i?: number;
  edition_count?: number;
  subject?: string[];
  language?: string[];
  number_of_pages_median?: number;
}
interface OlSearch {
  docs: OlSearchDoc[];
}

export interface OlLookup {
  result: ProviderResult;
  workId?: string;
  /** Wikidata ids of the authors, for enrichment. */
  authorQids: string[];
}

/** MARC language codes (as used by Open Library) → ISO 639-1. */
const LANG: Record<string, string> = {
  eng: 'en', ger: 'de', fre: 'fr', spa: 'es', ita: 'it', por: 'pt', dut: 'nl', swe: 'sv', dan: 'da', nor: 'no',
  fin: 'fi', pol: 'pl', cze: 'cs', rus: 'ru', jpn: 'ja', chi: 'zh', gre: 'el', heb: 'he', ara: 'ar', tur: 'tr',
  hun: 'hu', lat: 'la', kor: 'ko', ukr: 'uk', rum: 'ro', cat: 'ca'
};
export const marcToIso = (code: string) => LANG[code] ?? code;

const text = (t: Text | undefined) => plainText(typeof t === 'string' ? t : t?.value);
const tail = (key: string | undefined) => key?.split('/').pop();
// default=false makes a missing cover a 404 (→ placeholder) instead of a blank 1×1 image.
const coverUrl = (id: number | undefined, size: 'M' | 'L') =>
  id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg?default=false` : undefined;

function format(physical: string | undefined): BookFormat | undefined {
  const p = physical?.toLowerCase() ?? '';
  if (!p) return undefined;
  if (p.includes('hard')) return 'hardcover';
  if (p.includes('paper') || p.includes('soft')) return 'paperback';
  if (p.includes('ebook') || p.includes('e-book') || p.includes('electronic')) return 'ebook';
  if (p.includes('audio')) return 'audiobook';
  return 'other';
}

/** Catalogue housekeeping that isn't about the book's content. */
const NOISE = /^(new york times|large type|large print|accessible book|protected daisy|in library|lending library|open library|long now|reading level|award winner|.*award winner|nyt)/;

/** Drop machine tags ("nyt:…", "award:…"), catalogue noise and near-duplicates ("Science-fiction" = "Science fiction"). */
export function cleanSubjects(subjects: string[] | undefined, max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of subjects ?? []) {
    const lower = s.toLowerCase().trim();
    const key = lower.replace(/[^\p{L}\p{N}]+/gu, '');
    if (!key || /^[a-z_]+:/.test(lower) || NOISE.test(lower) || seen.has(key)) continue;
    seen.add(key);
    out.push(s.trim());
    if (out.length >= max) break;
  }
  return out;
}

/** Settle a request: network/HTTP errors become undefined, but we remember that something failed. */
async function soft<T>(p: Promise<T | undefined>, errors: unknown[]): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    errors.push(e);
    return undefined;
  }
}

async function authorsOf(keys: string[], f: Fetcher, errors: unknown[]): Promise<OlAuthor[]> {
  const found = await Promise.all(keys.slice(0, 4).map((k) => soft(getJson<OlAuthor>(f, `${OL}/authors/${k}.json`), errors)));
  return found.filter((a): a is OlAuthor => !!a);
}

export async function olByIsbn(isbn: string, f: Fetcher): Promise<OlLookup | undefined> {
  const errors: unknown[] = [];
  const [edition, search] = await Promise.all([
    soft(getJson<OlEdition>(f, `${OL}/isbn/${isbn}.json`), errors),
    soft(getJson<OlSearch>(f, `${OL}/search.json?isbn=${isbn}&limit=1&fields=${SEARCH_FIELDS}`), errors)
  ]);
  const doc = search?.docs?.[0];
  if (!edition && !doc) {
    if (errors.length === 2) throw errors[0]; // offline / service down, not "unknown ISBN"
    return undefined;
  }

  const workId = tail(edition?.works?.[0]?.key) ?? tail(doc?.key);
  const work = workId ? await soft(getJson<OlWork>(f, `${OL}/works/${workId}.json`), errors) : undefined;
  const authorKeys = (edition?.authors?.map((a) => tail(a.key)!) ?? work?.authors?.map((a) => tail(a.author.key)!) ?? doc?.author_key ?? []);
  const authors = await authorsOf(authorKeys, f, errors);

  const editionId = tail(edition?.key);
  const fields: MetaFields = {
    title: edition?.title ?? doc?.title,
    subtitle: edition?.subtitle ?? doc?.subtitle,
    authors: doc?.author_name ?? authors.map((a) => a.name!).filter(Boolean),
    contributors: edition?.contributors?.map((c) => (c.role ? `${c.name} (${c.role.toLowerCase()})` : c.name)),
    publisher: edition?.publishers?.[0],
    publishedYear: parseYear(edition?.publish_date),
    firstPublishedYear: doc?.first_publish_year ?? parseYear(work?.first_publish_date),
    edition: edition?.edition_name,
    language: edition?.languages?.[0] ? marcToIso(tail(edition.languages[0].key)!) : undefined,
    pageCount: edition?.number_of_pages ?? (edition ? undefined : doc?.number_of_pages_median),
    format: format(edition?.physical_format),
    isbn10: edition?.isbn_10?.[0],
    isbn13: edition?.isbn_13?.[0],
    description: text(edition?.description) ?? text(work?.description),
    cover: coverUrl(edition?.covers?.[0], 'L') ?? coverUrl(doc?.cover_i, 'L'),
    subjects: cleanSubjects(work?.subjects ?? edition?.subjects ?? doc?.subject),
    series: edition?.series?.[0],
    identifiers: compact({
      olid: editionId,
      olwork: workId,
      goodreads: edition?.identifiers?.goodreads?.[0],
      librarything: edition?.identifiers?.librarything?.[0]
    })
  };
  return {
    result: {
      source: 'openlibrary',
      fields,
      url: editionId ? `${OL}/books/${editionId}` : workId ? `${OL}/works/${workId}` : undefined
    },
    workId,
    authorQids: authors.map((a) => a.remote_ids?.wikidata).filter((q): q is string => !!q)
  };
}

/** Work-level details for a search candidate (no specific edition). */
export async function olWork(workId: string, f: Fetcher): Promise<OlLookup | undefined> {
  const errors: unknown[] = [];
  const work = await getJson<OlWork>(f, `${OL}/works/${workId}.json`);
  if (!work) return undefined;
  const authors = await authorsOf(work.authors?.map((a) => tail(a.author.key)!) ?? [], f, errors);
  return {
    result: {
      source: 'openlibrary',
      url: `${OL}/works/${workId}`,
      fields: {
        title: work.title,
        authors: authors.map((a) => a.name!).filter(Boolean),
        description: text(work.description),
        subjects: cleanSubjects(work.subjects),
        cover: coverUrl(work.covers?.[0], 'L'),
        firstPublishedYear: parseYear(work.first_publish_date),
        identifiers: { olwork: workId }
      }
    },
    workId,
    authorQids: authors.map((a) => a.remote_ids?.wikidata).filter((q): q is string => !!q)
  };
}

export async function olSearch(query: string, f: Fetcher, limit = 20): Promise<Candidate[]> {
  const url = `${OL}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=${SEARCH_FIELDS}`;
  const res = await getJson<OlSearch>(f, url);
  return (res?.docs ?? []).map((d) => ({
    key: `ol:${d.key}`,
    title: d.title,
    subtitle: d.subtitle,
    authors: d.author_name ?? [],
    year: d.first_publish_year,
    cover: coverUrl(d.cover_i, 'M'),
    editionCount: d.edition_count,
    olWorkId: tail(d.key),
    authorOlIds: d.author_key,
    source: 'openlibrary' as const
  }));
}

function compact(o: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>;
}

/** One request: the search index entry for an ISBN (title, authors, year, cover). Used for instant results. */
export async function olQuickIsbn(isbn: string, f: Fetcher): Promise<ProviderResult | undefined> {
  const res = await getJson<OlSearch>(f, `${OL}/search.json?isbn=${isbn}&limit=1&fields=${SEARCH_FIELDS}`, { timeoutMs: 4000 });
  const d = res?.docs?.[0];
  if (!d) return undefined;
  const workId = tail(d.key);
  return {
    source: 'openlibrary',
    url: workId ? `${OL}/works/${workId}` : undefined,
    fields: {
      title: d.title,
      subtitle: d.subtitle,
      authors: d.author_name,
      firstPublishedYear: d.first_publish_year,
      cover: coverUrl(d.cover_i, 'L'),
      subjects: cleanSubjects(d.subject),
      identifiers: workId ? { olwork: workId } : undefined
    }
  };
}

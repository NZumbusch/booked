import { cleanList } from '../domain/book';
import { normalizeIsbn } from '../domain/isbn';
import type { BookDraft, SourceId, SourceRef } from '../domain/types';
import { isCoverShape, isKnownPlaceholder } from '../covers/colors';
import { dnbById, dnbByIsbn, dnbSearch, type DnbHit } from './dnb';
import { isbnCoverUrls } from './covers';
import { gbByIsbn, gbSearch } from './googlebooks';
import { HttpError, type Fetcher } from './http';
import { olByIsbn, olQuickIsbn, olSearch, olWork } from './openlibrary';
import type { Candidate, MetaFields, ProviderResult } from './types';
import { titlesMatch, wdEnrich } from './wikidata';

export type LookupDraft = Partial<BookDraft>;

/** App-wide lookup settings (set from the user's settings). */
const config: { googleApiKey?: string } = {};
export function setGoogleApiKey(key: string | undefined) {
  config.googleApiKey = key?.trim() || undefined;
}

export interface LookupResult {
  /** found = at least one source knew the book; notfound = all answered "unknown"; error = couldn't ask (offline…). */
  status: 'found' | 'notfound' | 'error';
  draft: LookupDraft;
  /** Non-fatal problems, e.g. one source over quota. */
  warnings: string[];
}

const NAMES: Record<SourceId, string> = {
  openlibrary: 'Open Library', googlebooks: 'Google Books', dnb: 'Deutsche Nationalbibliothek', wikidata: 'Wikidata', manual: 'Manual'
};

/** Fields where a later source is more trustworthy than the default order (Open Library › Google › Wikidata). */
const PREFER: Partial<Record<keyof MetaFields, SourceId[]>> = {
  firstPublishedYear: ['wikidata', 'openlibrary', 'googlebooks'],
  // Google's publisher/description are often marketing copy, but its genres are cleaner than OL subjects.
  genres: ['googlebooks', 'wikidata', 'openlibrary'],
  // The DNB carries the fixed German book price; Google only sometimes has one.
  listPrice: ['dnb', 'googlebooks']
};
const UNION: (keyof MetaFields)[] = ['genres'];

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Combine provider results into a draft with per-field provenance. */
export function mergeResults(results: ProviderResult[]): LookupDraft {
  const draft: LookupDraft = {};
  const provenance: Record<string, SourceRef> = {};
  const ref = (r: ProviderResult): SourceRef => (r.url ? { source: r.source, url: r.url } : { source: r.source });
  const keys = new Set(results.flatMap((r) => Object.keys(r.fields))) as Set<keyof MetaFields>;

  for (const key of keys) {
    if (key === 'identifiers') continue;
    const order = PREFER[key];
    const ranked = order ? [...results].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source)) : results;
    const withValue = ranked.filter((r) => !isEmpty(r.fields[key]));
    if (!withValue.length) continue;
    if (UNION.includes(key)) {
      (draft as Record<string, unknown>)[key] = cleanList(withValue.flatMap((r) => r.fields[key] as string[])).slice(0, 8);
    } else {
      (draft as Record<string, unknown>)[key] = withValue[0].fields[key];
    }
    provenance[key] = withValue[0].provenance?.[key] ?? ref(withValue[0]);
  }

  const identifiers = Object.assign({}, ...results.map((r) => r.fields.identifiers ?? {}));
  if (Object.keys(identifiers).length) draft.identifiers = identifiers;
  draft.sources = results.map((r) => r.source);
  draft.provenance = provenance;
  return draft;
}

function describe(source: SourceId, e: unknown): string {
  return `${NAMES[source]}: ${e instanceof HttpError ? `HTTP ${e.status}` : 'unreachable'}`;
}

async function attempt<T>(source: SourceId, p: Promise<T>, warnings: string[]): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    warnings.push(describe(source, e));
    return { ok: false };
  }
}

export type ImageProbe = (url: string) => Promise<boolean>;

/** Browser image probe: does the URL load as an image? (No CORS needed.) */
export const browserProbe: ImageProbe = (url) =>
  new Promise((resolve) => {
    if (typeof Image === 'undefined') return resolve(true);
    const img = new Image();
    const timer = setTimeout(() => resolve(false), 6000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 1 && isCoverShape(img.naturalWidth, img.naturalHeight) && !isKnownPlaceholder(url, img.naturalWidth, img.naturalHeight));
    };
    img.onerror = () => { clearTimeout(timer); resolve(false); };
    img.src = url;
  });

/** First cover (in source priority order) that actually exists. */
export async function pickCover(results: ProviderResult[], probe: ImageProbe): Promise<{ url: string; result: ProviderResult } | undefined> {
  for (const r of results) {
    if (r.fields.cover && (await probe(r.fields.cover))) return { url: r.fields.cover, result: r };
  }
  return undefined;
}

/** Look up an ISBN across all free sources. Never throws for network problems. */
export async function lookupIsbn(input: string, f: Fetcher = fetch.bind(globalThis), probe: ImageProbe = browserProbe): Promise<LookupResult> {
  const isbn = normalizeIsbn(input);
  if (!isbn) throw new Error(`Not a valid ISBN: ${input}`);
  const warnings: string[] = [];
  const base: LookupDraft = { isbn13: isbn.isbn13, isbn10: isbn.isbn10 };

  const [ol, gb, dnb] = await Promise.all([
    attempt('openlibrary', olByIsbn(isbn.isbn13, f), warnings),
    attempt('googlebooks', gbByIsbn(isbn.isbn13, f, config.googleApiKey), warnings),
    attempt('dnb', dnbByIsbn(isbn.isbn13, f), warnings)
  ]);
  const olValue = ol.ok ? ol.value : undefined;
  const gbValue = gb.ok ? gb.value : undefined;
  const dnbValue = dnb.ok ? dnb.value : undefined;
  if (!olValue && !gbValue && !dnbValue) {
    return { status: !ol.ok && !gb.ok && !dnb.ok ? 'error' : 'notfound', draft: base, warnings };
  }

  const results: ProviderResult[] = [];
  if (olValue) results.push(olValue.result);
  if (gbValue) results.push(gbValue);
  if (dnbValue) results.push(dnbValue);
  const wd = await attempt('wikidata', wdEnrich({
    olWorkId: olValue?.workId,
    authorQids: olValue?.authorQids ?? [],
    title: olValue?.result.fields.title ?? gbValue?.fields.title ?? dnbValue?.fields.title
  }, f), warnings);
  if (wd.ok && wd.value) results.push(wd.value);

  const draft = { ...mergeResults(results), ...base };
  // Covers of this very edition first (Open Library's edition record, Google's and the DNB's record
  // for the ISBN). The work's cover is only a last resort: it is often another edition's.
  let cover = await pickCover(results, probe);
  if (!cover) {
    const { last } = isbnCoverUrls({ isbn13: isbn.isbn13, isbn10: isbn.isbn10 });
    for (const url of last) {
      if (await probe(url)) {
        cover = { url, result: gbValue ?? results[0] };
        break;
      }
    }
  }
  if (!cover && olValue?.workCover && (await probe(olValue.workCover))) cover = { url: olValue.workCover, result: olValue.result };
  if (cover) {
    draft.cover = cover.url;
    draft.provenance!.cover = cover.result.url ? { source: cover.result.source, url: cover.result.url } : { source: cover.result.source };
  } else {
    delete draft.cover;
    delete draft.provenance!.cover;
  }
  return { status: 'found', draft, warnings };
}

/**
 * Fast first answer for the add form: one request each to Open Library's search index and
 * Google Books, whichever finds the book first, capped at `timeoutMs`. Full details are filled
 * in later in the background (see services/enrich).
 */
export async function quickLookupIsbn(input: string, f: Fetcher = fetch.bind(globalThis), timeoutMs = 3000): Promise<LookupResult> {
  const isbn = normalizeIsbn(input);
  if (!isbn) throw new Error(`Not a valid ISBN: ${input}`);
  const base: LookupDraft = { isbn13: isbn.isbn13, isbn10: isbn.isbn10 };
  const warnings: string[] = [];
  let failures = 0;
  const names: SourceId[] = ['openlibrary', 'googlebooks', 'dnb'];
  const providers: Promise<ProviderResult | undefined>[] = [
    olQuickIsbn(isbn.isbn13, f),
    gbByIsbn(isbn.isbn13, f, config.googleApiKey),
    dnbByIsbn(isbn.isbn13, f)
  ].map((p, i) =>
    p.catch((e) => {
      failures++;
      warnings.push(describe(names[i], e));
      return undefined;
    })
  );
  const firstFound = new Promise<ProviderResult | undefined>((resolve) => {
    let pending = providers.length;
    for (const p of providers) {
      p.then((r) => {
        if (r) resolve(r);
        else if (--pending === 0) resolve(undefined);
      });
    }
  });
  const timeout = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const winner = await Promise.race([firstFound, timeout]);
  if (winner === 'timeout') return { status: 'error', draft: base, warnings: [...warnings, 'Lookup is slow; details will be added in the background'] };
  if (!winner) return { status: failures === providers.length ? 'error' : 'notfound', draft: base, warnings };
  return { status: 'found', draft: { ...mergeResults([winner]), ...base }, warnings };
}

/** Free-text search (title, author…): Open Library first, Google Books as fallback. */
export async function searchBooks(query: string, f: Fetcher = fetch.bind(globalThis)): Promise<Candidate[]> {
  try {
    const hits = await olSearch(query, f);
    if (hits.length) return hits;
  } catch {
    // fall through to Google Books
  }
  return gbSearch(query, f, config.googleApiKey);
}

/** Full details for a chosen search hit (work-level; no edition-specific ISBN). */
export async function lookupCandidate(c: Candidate, f: Fetcher = fetch.bind(globalThis)): Promise<LookupResult> {
  const warnings: string[] = [];
  const results: ProviderResult[] = [];
  if (c.gb) results.push(c.gb);
  let authorQids: string[] = [];
  if (c.olWorkId) {
    const ol = await attempt('openlibrary', olWork(c.olWorkId, f), warnings);
    if (ol.ok && ol.value) {
      results.push(ol.value.result);
      authorQids = ol.value.authorQids;
    }
  }
  const wd = await attempt('wikidata', wdEnrich({ olWorkId: c.olWorkId, authorQids, title: c.title }, f), warnings);
  if (wd.ok && wd.value) results.push(wd.value);
  const base: LookupDraft = { title: c.title, subtitle: c.subtitle, authors: c.authors, cover: c.cover?.replace('-M.jpg', '-L.jpg') };
  if (c.year) base.firstPublishedYear = c.year;
  return { status: 'found', draft: { ...base, ...mergeResults(results) }, warnings };
}

/** Editions in the German National Library by free text (finds books from before ISBNs, with publisher, year and volume). */
export async function searchEditions(query: string, f: Fetcher = fetch.bind(globalThis)): Promise<DnbHit[]> {
  return dnbSearch(query, f);
}

/**
 * What can be said about the *work* regardless of edition: description, first published, topics,
 * where it was written. For books without an ISBN, where an edition's publisher, year, pages or cover
 * found online would most likely be another edition's.
 */
const WORK_FIELDS = ['description', 'firstPublishedYear', 'originalLanguage', 'genres', 'subjects', 'writing'] as const;

function workOnly(draft: LookupDraft): LookupDraft {
  const out: LookupDraft = {};
  const provenance: Record<string, SourceRef> = {};
  for (const k of WORK_FIELDS) {
    if (isEmpty(draft[k])) continue;
    (out as Record<string, unknown>)[k] = draft[k];
    if (draft.provenance?.[k]) provenance[k] = draft.provenance[k];
  }
  const ids = draft.identifiers ?? {};
  const keep = Object.fromEntries(Object.entries(ids).filter(([k]) => k === 'olwork' || k === 'wikidata'));
  if (Object.keys(keep).length) out.identifiers = keep;
  out.provenance = provenance;
  out.sources = draft.sources;
  return out;
}

const surname = (name: string) => name.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/[\s,]+/).filter(Boolean).pop() ?? '';

/**
 * Work-level details for a book without ISBN: its DNB record if it came from there (that edition's own data),
 * then the work on Open Library + Wikidata by title and author (only work facts).
 */
export async function lookupWithoutIsbn(
  book: { title: string; authors: string[]; identifiers?: Record<string, string> },
  f: Fetcher = fetch.bind(globalThis)
): Promise<LookupResult> {
  const warnings: string[] = [];
  let edition: LookupDraft = {};
  let failed = 0;
  const dnbId = book.identifiers?.dnb;
  if (dnbId) {
    const r = await attempt('dnb', dnbById(dnbId, f), warnings);
    if (!r.ok) failed++;
    else if (r.value) edition = mergeResults([r.value]);
  }
  let work: LookupDraft = {};
  const author = book.authors[0];
  if (book.title.trim()) {
    const hits = await attempt('openlibrary', olSearch(`${book.title} ${author ?? ''}`.trim(), f, 10), warnings);
    if (!hits.ok) failed++;
    else {
      const hit = hits.value.find((h) => titlesMatch(h.title, book.title) && (!author || h.authors.some((a) => surname(a) === surname(author))));
      if (hit) {
        const found = await lookupCandidate(hit, f);
        warnings.push(...found.warnings);
        work = workOnly(found.draft);
      }
    }
  }
  const any = Object.keys(edition).length || WORK_FIELDS.some((k) => !isEmpty(work[k])) || work.identifiers;
  if (!any) return { status: failed && failed === (dnbId ? 2 : 1) ? 'error' : 'notfound', draft: {}, warnings };
  // The edition's own record wins where both know something (e.g. the DNB's subject headings).
  const workFields = Object.fromEntries(Object.entries(work).filter(([k, v]) => !isEmpty(v) && k !== 'provenance' && k !== 'sources' && k !== 'identifiers'));
  const draft: LookupDraft = { ...workFields, ...edition };
  draft.identifiers = { ...edition.identifiers, ...work.identifiers };
  draft.provenance = { ...work.provenance, ...edition.provenance };
  draft.sources = [...new Set([...(edition.sources ?? []), ...(work.sources ?? [])])];
  return { status: 'found', draft, warnings };
}

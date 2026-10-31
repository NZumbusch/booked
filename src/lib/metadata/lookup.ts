import { cleanList } from '../domain/book';
import { normalizeIsbn } from '../domain/isbn';
import type { BookDraft, SourceId, SourceRef } from '../domain/types';
import { dnbByIsbn } from './dnb';
import { isbnCoverUrls } from './covers';
import { gbByIsbn, gbSearch } from './googlebooks';
import { HttpError, type Fetcher } from './http';
import { olByIsbn, olQuickIsbn, olSearch, olWork } from './openlibrary';
import type { Candidate, MetaFields, ProviderResult } from './types';
import { wdEnrich } from './wikidata';

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
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 1); };
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
  let cover = await pickCover(results, probe);
  if (!cover) {
    // The catalogues' records have no cover: ask the cover services by ISBN directly.
    const { early } = isbnCoverUrls({ isbn13: isbn.isbn13, isbn10: isbn.isbn10 });
    for (const url of early) {
      if (await probe(url)) {
        cover = { url, result: results[0] };
        break;
      }
    }
  }
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

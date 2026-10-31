import { cleanList } from '../domain/book';
import type { GeoPoint, PlaceBasis, SourceRef, WritingInfo } from '../domain/types';
import { getJson, type Fetcher } from './http';
import type { ProviderResult } from './types';

const SPARQL = 'https://query.wikidata.org/sparql';
const ENTITY = 'http://www.wikidata.org/entity/';
const LANGS = 'en,de,fr,es,it,mul';
const TITLE_LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'sv', 'pt', 'mul'];

type Binding = Record<string, { value: string } | undefined>;
interface SparqlResult {
  results: { bindings: Binding[] };
}

const q = (s: string) => JSON.stringify(s); // SPARQL string literal
const qid = (uri: string | undefined) => uri?.replace(ENTITY, '');
const isQid = (s: string) => /^Q\d+$/.test(s);

/** Find the work by Open Library id, or by author + exact title (any language). Editions are excluded. */
export function workQuery(olWorkId: string | undefined, authorQids: string[], title: string | undefined): string | undefined {
  const branches: string[] = [];
  if (olWorkId && /^OL\d+W$/.test(olWorkId)) branches.push(`{ ?work wdt:P648 ${q(olWorkId)} . }`);
  const authors = authorQids.filter(isQid);
  if (authors.length && title?.trim()) {
    // Exact label lookups are index hits (fast); a case-insensitive FILTER would scan every label.
    const t = title.trim();
    const variants = [...new Set([t, t[0].toUpperCase() + t.slice(1)])];
    const labels = variants.flatMap((x) => TITLE_LANGS.map((l) => `${q(x)}@${l}`)).join(' ');
    branches.push(`{
    VALUES ?author { ${authors.map((a) => `wd:${a}`).join(' ')} }
    VALUES ?label { ${labels} }
    ?work rdfs:label ?label ; wdt:P50 ?author .
  }`);
  }
  if (!branches.length) return undefined;
  return `SELECT DISTINCT ?work ?workLabel ?inception ?published ?creationPlace ?creationPlaceLabel ?creationCoord
  ?pubPlace ?pubPlaceLabel ?pubCoord ?pubIsCountry ?langCode ?genreLabel ?sitelinks ?anyLabel WHERE {
  ${branches.join(' UNION ')}
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q3331189 }            # not an edition
  FILTER NOT EXISTS { ?work wdt:P31/wdt:P279* wd:Q11424 }     # not a film
  OPTIONAL { ?work wikibase:sitelinks ?sitelinks }
  # All titles of the work, to check it really is this book (catalogues sometimes mis-merge works).
  OPTIONAL { { ?work rdfs:label ?anyLabel } UNION { ?work wdt:P1476 ?anyLabel }
             FILTER(LANG(?anyLabel) IN ("en", "de", "fr", "es", "it", "nl", "sv", "pt", "mul", "")) }
  OPTIONAL { ?work wdt:P571 ?inception }
  OPTIONAL { ?work wdt:P577 ?published }
  OPTIONAL { ?work wdt:P1071 ?creationPlace . OPTIONAL { ?creationPlace wdt:P625 ?creationCoord } }
  OPTIONAL { ?work wdt:P291 ?pubPlace . OPTIONAL { ?pubPlace wdt:P625 ?pubCoord }
             BIND(EXISTS { ?pubPlace wdt:P297 [] } AS ?pubIsCountry) }
  OPTIONAL { ?work wdt:P407 ?lang . ?lang wdt:P218 ?langCode }
  OPTIONAL { ?work wdt:P136 ?genre }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
} LIMIT 200`;
}

/** Birthplace (and residence) of the authors, with coordinates. */
export function authorQuery(authorQids: string[]): string | undefined {
  const authors = authorQids.filter(isQid);
  if (!authors.length) return undefined;
  return `SELECT DISTINCT ?author ?authorLabel ?birthPlace ?birthPlaceLabel ?birthCoord WHERE {
  VALUES ?author { ${authors.map((a) => `wd:${a}`).join(' ')} }
  OPTIONAL { ?author wdt:P19 ?birthPlace . OPTIONAL { ?birthPlace wdt:P625 ?birthCoord } }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
}`;
}

const ARTICLE = /^(the|a|an|der|die|das|le|la|les|l'|el|il|lo|de|het|een)\s+/;
const normTitle = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().split(/[:.(]/)[0].replace(ARTICLE, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Does a Wikidata title fit a book title? Equal after normalizing, or one is a long prefix of the
 * other ("Steppenwolf" ≈ "Der Steppenwolf: Roman"), but "Dune" ≠ "Dune Messiah".
 */
export function titlesMatch(a: string, b: string): boolean {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length < y.length ? [x, y] : [y, x];
  return long.startsWith(short + ' ') && short.length / long.length >= 0.75;
}

/** "Point(lon lat)" → GeoPoint */
export function parsePoint(wkt: string | undefined, label?: string): GeoPoint | undefined {
  const m = wkt?.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/);
  return m ? { lon: Number(m[1]), lat: Number(m[2]), ...(label ? { label } : {}) } : undefined;
}

const yearOf = (iso: string | undefined) => {
  const m = iso?.match(/^(-?\d{1,4})-/);
  return m ? Number(m[1]) : undefined;
};
const minOf = (xs: (number | undefined)[]) => {
  const ns = xs.filter((x): x is number => x !== undefined);
  return ns.length ? Math.min(...ns) : undefined;
};

async function sparql(f: Fetcher, query: string): Promise<Binding[]> {
  const res = await getJson<SparqlResult>(f, `${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    timeoutMs: 15000,
    headers: { Accept: 'application/sparql-results+json' }
  });
  return res?.results.bindings ?? [];
}

const v = (b: Binding, k: string) => b[k]?.value;

/**
 * Enrich with Wikidata: when/where the work was written, original language, genres.
 * Place priority: location of creation › city of first publication › author's birthplace › country of publication.
 */
export async function wdEnrich(
  input: { olWorkId?: string; authorQids: string[]; title?: string },
  f: Fetcher
): Promise<ProviderResult | undefined> {
  const wq = workQuery(input.olWorkId, input.authorQids, input.title);
  const aq = authorQuery(input.authorQids);
  if (!wq && !aq) return undefined;
  const [workRows, authorRows] = await Promise.all([wq ? sparql(f, wq) : [], aq ? sparql(f, aq) : []]);

  // Several works can share a title (e.g. a novel and a series named after it): prefer the best known.
  const byWork = new Map<string, Binding[]>();
  for (const row of workRows) {
    const id = qid(v(row, 'work'))!;
    byWork.set(id, [...(byWork.get(id) ?? []), row]);
  }
  // Keep only works whose title fits the book (when we know the title), then the best known.
  const fits = (rows: Binding[]) => !input.title || rows.every((r) => !v(r, 'anyLabel')) || rows.some((r) => titlesMatch(v(r, 'anyLabel')!, input.title!));
  const fame = (rows: Binding[]) => Number(v(rows[0], 'sitelinks') ?? 0);
  const [workId, rows = []] = [...byWork.entries()].filter(([, r]) => fits(r)).sort((a, b) => fame(b[1]) - fame(a[1]))[0] ?? [];

  const pick = (key: string) => rows.map((r) => v(r, key)).find(Boolean);
  const writing: WritingInfo = {};
  const provenance: Record<string, SourceRef> = {};
  const workUrl = workId ? `https://www.wikidata.org/wiki/${workId}` : undefined;

  const inception = minOf(rows.map((r) => yearOf(v(r, 'inception'))));
  const published = minOf(rows.map((r) => yearOf(v(r, 'published'))));
  if (inception) writing.year = inception;

  const place = (coordKey: string, labelKey: string, rowFilter: (r: Binding) => boolean = () => true) => {
    const row = rows.find((r) => v(r, coordKey) && rowFilter(r));
    return row ? parsePoint(v(row, coordKey), v(row, labelKey)) : undefined;
  };
  const author = authorRows.find((r) => v(r, 'birthCoord'));
  const candidates: [PlaceBasis, GeoPoint | undefined, string, string | undefined][] = [
    ['written', place('creationCoord', 'creationPlaceLabel'), 'Wikidata “location of creation” of the work', workUrl],
    ['published', place('pubCoord', 'pubPlaceLabel', (r) => v(r, 'pubIsCountry') !== 'true'), 'Wikidata “place of publication” of the work', workUrl],
    ['author', author && parsePoint(v(author, 'birthCoord'), v(author, 'birthPlaceLabel')),
      `Birthplace of ${author && v(author, 'authorLabel')} (Wikidata); where the work was written is not recorded`,
      author && `https://www.wikidata.org/wiki/${qid(v(author, 'author'))}`],
    ['country', place('pubCoord', 'pubPlaceLabel'), 'Only the country of publication is known (Wikidata)', workUrl]
  ];
  const best = candidates.find(([, p]) => p);
  if (best) {
    writing.place = best[1];
    writing.placeBasis = best[0];
    provenance.writing = { source: 'wikidata', note: best[2], url: best[3] };
  } else if (writing.year) {
    provenance.writing = { source: 'wikidata', note: 'Wikidata “inception” of the work', url: workUrl };
  }

  const genres = cleanList(rows.map((r) => v(r, 'genreLabel') ?? '').filter((g) => g && !isQid(g))).slice(0, 6);
  const fields = {
    firstPublishedYear: published,
    originalLanguage: pick('langCode'),
    genres: genres.length ? genres : undefined,
    writing: writing.year || writing.place ? writing : undefined,
    identifiers: workId ? { wikidata: workId } : undefined
  };
  if (!workId && !best) return undefined;
  return { source: 'wikidata', url: workUrl, fields, provenance };
}

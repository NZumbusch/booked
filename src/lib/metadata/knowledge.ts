import type { GeoPoint } from '../domain/types';
import { getJson, type Fetcher } from './http';
import { parsePoint } from './wikidata';

/**
 * Wikidata knowledge for Discover: per work (series with position, based on, main subjects,
 * where the story is set, awards, literary movement, authors) and per author (life, places,
 * movements, influences, languages, Wikipedia articles). Queries are batched for the library.
 */

const SPARQL = 'https://query.wikidata.org/sparql';
const LANGS = 'de,en,mul,fr,es,it';
const ENTITY = 'http://www.wikidata.org/entity/';
const isQid = (s: string) => /^Q\d+$/.test(s);
const qid = (uri: string | undefined) => uri?.replace(ENTITY, '');

export interface Ref {
  id: string;
  label: string;
  /** For influences: a person (→ author page) rather than an idea or movement (→ topic). */
  person?: boolean;
}

export interface WorkKnowledge {
  id: string;
  series: (Ref & { position?: string })[];
  basedOn: Ref[];
  subjects: Ref[];
  settings: (Ref & { point?: GeoPoint })[];
  awards: Ref[];
  movements: Ref[];
  authors: Ref[];
  /** Other works in the same series with their position (for "missing volumes"). */
  seriesWorks?: { series: string; id: string; label: string; position?: string }[];
}

export interface AuthorKnowledge {
  id: string;
  label: string;
  born?: string;
  died?: string;
  birthPlace?: string;
  deathPlace?: string;
  movements: Ref[];
  influencedBy: Ref[];
  influenced: Ref[];
  notableWorks: Ref[];
  /** ISO 639-1 codes: native language first, then writing languages. */
  languages: string[];
  /** Wikipedia article titles by language code. */
  wikipedia: Record<string, string>;
}

type Binding = Record<string, { value: string } | undefined>;
const v = (b: Binding, k: string) => b[k]?.value;

async function sparql(f: Fetcher, query: string): Promise<Binding[]> {
  const res = await getJson<{ results: { bindings: Binding[] } }>(f, `${SPARQL}?format=json&query=${encodeURIComponent(query)}`, {
    timeoutMs: 30000,
    headers: { Accept: 'application/sparql-results+json' }
  });
  return res?.results.bindings ?? [];
}

export function worksQuery(ids: string[]): string {
  return `SELECT ?work ?prop ?val ?valLabel ?coord ?ord WHERE {
  VALUES ?work { ${ids.filter(isQid).map((i) => `wd:${i}`).join(' ')} }
  { ?work p:P179 ?st . ?st ps:P179 ?val . OPTIONAL { ?st pq:P1545 ?ord } BIND("series" AS ?prop) }
  UNION { ?work wdt:P144 ?val . BIND("basedOn" AS ?prop) }
  UNION { ?work wdt:P921 ?val . BIND("subject" AS ?prop) }
  UNION { ?work wdt:P840 ?val . OPTIONAL { ?val wdt:P625 ?coord } BIND("setting" AS ?prop) }
  UNION { ?work wdt:P166 ?val . BIND("award" AS ?prop) }
  UNION { ?work wdt:P135 ?val . BIND("movement" AS ?prop) }
  UNION { ?work wdt:P50 ?val . BIND("author" AS ?prop) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
}`;
}

export function seriesQuery(seriesIds: string[]): string {
  return `SELECT ?series ?work ?workLabel ?ord WHERE {
  VALUES ?series { ${seriesIds.filter(isQid).map((i) => `wd:${i}`).join(' ')} }
  ?work p:P179 ?st . ?st ps:P179 ?series . OPTIONAL { ?st pq:P1545 ?ord }
  FILTER NOT EXISTS { ?work wdt:P31 wd:Q3331189 }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
} LIMIT 500`;
}

export function authorsQuery(ids: string[]): string {
  return `SELECT ?a ?aLabel ?prop ?val ?valLabel ?code ?human WHERE {
  VALUES ?a { ${ids.filter(isQid).map((i) => `wd:${i}`).join(' ')} }
  { ?a wdt:P569 ?val . BIND("born" AS ?prop) }
  UNION { ?a wdt:P570 ?val . BIND("died" AS ?prop) }
  UNION { ?a wdt:P19 ?val . BIND("birthPlace" AS ?prop) }
  UNION { ?a wdt:P20 ?val . BIND("deathPlace" AS ?prop) }
  UNION { ?a wdt:P135 ?val . BIND("movement" AS ?prop) }
  UNION { ?a wdt:P737 ?val . BIND(EXISTS { ?val wdt:P31 wd:Q5 } AS ?human) BIND("influencedBy" AS ?prop) }
  UNION { ?val wdt:P737 ?a . ?val wdt:P106/wdt:P279* wd:Q36180 . BIND("influenced" AS ?prop) }
  UNION { ?a wdt:P800 ?val . BIND("notableWork" AS ?prop) }
  UNION { ?a wdt:P103 ?val . ?val wdt:P218 ?code . BIND("native" AS ?prop) }
  UNION { ?a wdt:P1412 ?val . ?val wdt:P218 ?code . BIND("writes" AS ?prop) }
  UNION { ?val schema:about ?a ; schema:isPartOf ?site . FILTER(?site IN (<https://de.wikipedia.org/>, <https://en.wikipedia.org/>))
          BIND(IF(?site = <https://de.wikipedia.org/>, "de", "en") AS ?code) BIND("wikipedia" AS ?prop) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "${LANGS}". }
}`;
}

/** Find a person by exact name (any of our languages); the best-known match wins. */
export function authorByNameQuery(name: string): string {
  const q = JSON.stringify(name.trim());
  return `SELECT ?a (MAX(?links) AS ?n) WHERE {
  VALUES ?label { ${['de', 'en', 'mul', 'fr'].map((l) => `${q}@${l}`).join(' ')} }
  ?a rdfs:label ?label ; wdt:P31 wd:Q5 .
  OPTIONAL { ?a wikibase:sitelinks ?links }
} GROUP BY ?a ORDER BY DESC(?n) LIMIT 1`;
}

const ref = (b: Binding): Ref => ({ id: qid(v(b, 'val'))!, label: v(b, 'valLabel') ?? qid(v(b, 'val'))! });
const pushUnique = <T extends { id: string }>(list: T[], item: T) => {
  if (item.id && !list.some((x) => x.id === item.id)) list.push(item);
};
const isLabel = (r: Ref) => !isQid(r.label); // drop items without a readable label

export function parseWorks(rows: Binding[]): Map<string, WorkKnowledge> {
  const works = new Map<string, WorkKnowledge>();
  for (const row of rows) {
    const id = qid(v(row, 'work'))!;
    const w = works.get(id) ?? { id, series: [], basedOn: [], subjects: [], settings: [], awards: [], movements: [], authors: [] };
    works.set(id, w);
    const r = ref(row);
    if (!isLabel(r)) continue;
    switch (v(row, 'prop')) {
      case 'series': pushUnique(w.series, { ...r, position: v(row, 'ord') }); break;
      case 'basedOn': pushUnique(w.basedOn, r); break;
      case 'subject': pushUnique(w.subjects, r); break;
      case 'setting': pushUnique(w.settings, { ...r, point: parsePoint(v(row, 'coord'), r.label) }); break;
      case 'award': pushUnique(w.awards, r); break;
      case 'movement': pushUnique(w.movements, r); break;
      case 'author': pushUnique(w.authors, r); break;
    }
  }
  return works;
}

export function parseSeries(rows: Binding[]): WorkKnowledge['seriesWorks'] {
  const out: NonNullable<WorkKnowledge['seriesWorks']> = [];
  for (const row of rows) {
    const id = qid(v(row, 'work'))!;
    const label = v(row, 'workLabel') ?? id;
    if (isQid(label) || out.some((x) => x.id === id)) continue;
    out.push({ series: qid(v(row, 'series'))!, id, label, position: v(row, 'ord') });
  }
  const num = (p?: string) => (p && /^\d+(\.\d+)?$/.test(p) ? Number(p) : Infinity);
  return out.sort((a, b) => num(a.position) - num(b.position));
}

export function parseAuthors(rows: Binding[]): Map<string, AuthorKnowledge> {
  const authors = new Map<string, AuthorKnowledge>();
  for (const row of rows) {
    const id = qid(v(row, 'a'))!;
    const a = authors.get(id) ?? {
      id, label: v(row, 'aLabel') ?? id, movements: [], influencedBy: [], influenced: [], notableWorks: [], languages: [], wikipedia: {}
    };
    authors.set(id, a);
    const prop = v(row, 'prop');
    const val = v(row, 'val');
    if (prop === 'born') a.born ??= val?.slice(0, 10);
    else if (prop === 'died') a.died ??= val?.slice(0, 10);
    else if (prop === 'birthPlace') a.birthPlace ??= v(row, 'valLabel');
    else if (prop === 'deathPlace') a.deathPlace ??= v(row, 'valLabel');
    else if (prop === 'wikipedia' && val) a.wikipedia[v(row, 'code')!] = decodeURIComponent(val.split('/wiki/')[1] ?? '');
    else if (prop === 'native' || prop === 'writes') {
      const code = v(row, 'code');
      if (code && !a.languages.includes(code)) prop === 'native' ? a.languages.unshift(code) : a.languages.push(code);
    } else {
      const r = ref(row);
      if (!isLabel(r)) continue;
      if (prop === 'movement') pushUnique(a.movements, r);
      if (prop === 'influencedBy') pushUnique(a.influencedBy, { ...r, person: v(row, 'human') !== 'false' });
      if (prop === 'influenced') pushUnique(a.influenced, r);
      if (prop === 'notableWork') pushUnique(a.notableWorks, r);
    }
  }
  return authors;
}

/** Wikipedia language for an author: their own if German or English, otherwise German, then English. */
export function bioLanguage(a: Pick<AuthorKnowledge, 'languages' | 'wikipedia'>): 'de' | 'en' | undefined {
  const own = a.languages.find((l) => l === 'de' || l === 'en') as 'de' | 'en' | undefined;
  if (own && a.wikipedia[own]) return own;
  if (a.wikipedia.de) return 'de';
  if (a.wikipedia.en) return 'en';
  return undefined;
}

export interface WikiSummary {
  title: string;
  extract: string;
  description?: string;
  thumbnail?: string;
  url: string;
  lang: string;
}

export async function wikipediaSummary(lang: string, title: string, f: Fetcher = fetch.bind(globalThis)): Promise<WikiSummary | undefined> {
  const s = await getJson<{ title: string; extract: string; description?: string; thumbnail?: { source: string }; content_urls?: { desktop?: { page?: string } } }>(
    f, `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`
  );
  if (!s?.extract) return undefined;
  return { title: s.title, extract: s.extract, description: s.description, thumbnail: s.thumbnail?.source, url: s.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`, lang };
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function fetchWorks(ids: string[], f: Fetcher = fetch.bind(globalThis)): Promise<Map<string, WorkKnowledge>> {
  const all = new Map<string, WorkKnowledge>();
  for (const chunk of chunks(ids.filter(isQid), 80)) {
    for (const [id, w] of parseWorks(await sparql(f, worksQuery(chunk)))) all.set(id, w);
  }
  // Empty records for works Wikidata knows nothing about, so we don't ask again.
  for (const id of ids) if (!all.has(id)) all.set(id, { id, series: [], basedOn: [], subjects: [], settings: [], awards: [], movements: [], authors: [] });
  const seriesIds = [...new Set([...all.values()].flatMap((w) => w.series.map((s) => s.id)))];
  for (const chunk of chunks(seriesIds, 40)) {
    const seriesWorks = parseSeries(await sparql(f, seriesQuery(chunk))) ?? [];
    for (const w of all.values()) {
      const mine = seriesWorks.filter((s) => w.series.some((x) => x.id === s.series));
      if (mine.length) w.seriesWorks = [...(w.seriesWorks ?? []), ...mine];
    }
  }
  return all;
}

export async function fetchAuthors(ids: string[], f: Fetcher = fetch.bind(globalThis)): Promise<Map<string, AuthorKnowledge>> {
  const all = new Map<string, AuthorKnowledge>();
  for (const chunk of chunks(ids.filter(isQid), 40)) {
    for (const [id, a] of parseAuthors(await sparql(f, authorsQuery(chunk)))) all.set(id, a);
  }
  return all;
}

export async function findAuthorId(name: string, f: Fetcher = fetch.bind(globalThis)): Promise<string | undefined> {
  const rows = await sparql(f, authorByNameQuery(name));
  return qid(v(rows[0] ?? {}, 'a'));
}

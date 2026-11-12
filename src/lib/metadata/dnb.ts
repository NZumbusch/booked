import { parsePriceNote, preferredPrice } from '../domain/price';
import type { Fetcher } from './http';
import { marcToIso } from './openlibrary';
import type { ProviderResult } from './types';

/**
 * Deutsche Nationalbibliothek (free SRU interface, MARC 21 records): strong for German-language
 * books and the only free source for the fixed German list price (field 020 $c).
 */
const SRU = 'https://services.dnb.de/sru/dnb';

// DNB marks non-sorting articles with control characters (e.g. "\u0098Der\u009C Steppenwolf").
const clean = (s: string | undefined) => s?.replace(/\u0098([^\u009C]*['’])\u009C\s*/g, '$1').replace(/[\u0098\u009C]/g, '').replace(/\s*[/:;,.]\s*$/, '').trim() || undefined;

/** "Hesse, Hermann" → "Hermann Hesse" */
export function uninvert(name: string): string {
  const [last, first] = name.split(',', 2).map((s) => s.trim());
  return first ? `${first} ${last}` : last;
}

const ROLES: Record<string, string> = {
  trl: 'translator', edt: 'editor', ill: 'illustrator', aui: 'introduction',
  'übersetzer': 'translator', 'übersetzerin': 'translator', herausgeber: 'editor', herausgeberin: 'editor',
  illustrator: 'illustrator', illustratorin: 'illustrator', 'verfasser eines vorworts': 'introduction', 'verfasser eines nachworts': 'afterword'
};

/** Subject-chain form terms that describe the kind of text, not what it's about. */
const FORM_TERMS = new Set(['Belletristische Darstellung', 'Fiktionale Darstellung', 'Aufsatzsammlung', 'Anthologie', 'Bildband', 'Einführung', 'Lehrbuch', 'Ratgeber', 'Quelle', 'Biografie']);

/** DNB abbreviates publishers ("Dt. Taschenbuch-Verl"); spell the common abbreviations out. */
export function expandPublisher(p: string | undefined): string | undefined {
  if (!p) return p;
  return p.replace(/\bVerl\.?-Handl(?:ung|\.)?/g, 'Verlagshandlung').replace(/\bVerl\.?-Anst(?:alt|\.)?/g, 'Verlagsanstalt').replace(/\bDt\.\s*/g, 'Deutscher ').replace(/\bVerl\b\.?$/, 'Verlag').replace(/-Verl\b\.?/, '-Verlag');
}

/**
 * Paperback lines number every title ("Goldmann ; 47841", "dtv ; 13057", "Diogenes-Taschenbuch ; 22953"):
 * that's the publisher's catalogue number, not a series worth completing.
 */
export function publisherSeries(series: string | undefined, number: string | undefined, publisher: string | undefined): boolean {
  if (!series) return false;
  if (Number(number?.match(/\d+/)?.[0] ?? 0) >= 1000) return true;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-zäöüß]/g, '');
  const a = norm(series);
  const b = norm(publisher ?? '');
  // "Suhrkamp-Taschenbuch Wissenschaft" (stw) is a scholarly series people collect, unlike a paperback line.
  if (/wissenschaft/.test(a)) return false;
  return /taschenb/.test(a) || (!!b && b.startsWith(a));
}

/** "Bd. 24 : Abt. 3. Fontane als …" → "24"; "Bd. 23 [= Abt. 3 …]." → "23"; "554" → "554"; anything else as it is. */
export function volumeNumber(v: string | undefined): string | undefined {
  const t = clean(v?.replace(/\[[^\]]*\]?/g, ' ').replace(/\s+/g, ' '));
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return undefined;
  const m = t.match(/^(?:Bd|Bde|Band|Vol|Nr|No|Teil|T|Tl)\.?\s*(\d+\s?[a-z]?)\b/i) ?? t.match(/^(\d+\s?[a-z]?)(?:\s*[:,.]|$)/i);
  return m ? m[1].replace(/\s/g, '') : t;
}

/** A part title without the statement of responsibility and the cataloguers' bracketed notes. */
function partTitleOf(p: string | undefined): string | undefined {
  const t = p?.split(/\s+[:/]\s+/)[0].replace(/\s*\[[^\]]*\]\s*/g, ' ').replace(/\s+/g, ' ');
  return clean(t);
}

/** The multi-volume work (Gesamtausgabe, Werke…) a record is one volume of. */
export interface DnbSet {
  title: string;
  /** This record's volume in the set, e.g. "8", "18a", "Abt. 5, Kriegsbücher". */
  number?: string;
  /** Further part inside the volume, e.g. "T. 1". */
  part?: string;
}

export interface DnbHit {
  result: ProviderResult;
  set?: DnbSet;
}

function parseMarc(marc: Element): DnbHit | undefined {
  const fields = (tag: string) => [...marc.getElementsByTagNameNS('*', 'datafield')].filter((f) => f.getAttribute('tag') === tag);
  const sub = (f: Element | undefined, code: string) =>
    f ? [...f.getElementsByTagNameNS('*', 'subfield')].filter((s) => s.getAttribute('code') === code).map((s) => (s.textContent ?? '').normalize('NFC')) : [];
  // ↑ DNB writes umlauts decomposed (o + combining ¨); NFC makes "Röhl" searchable and comparable.
  const first = (tag: string, code: string) => sub(fields(tag)[0], code)[0];
  const control = (tag: string) => [...marc.getElementsByTagNameNS('*', 'controlfield')].find((f) => f.getAttribute('tag') === tag)?.textContent ?? undefined;

  // Multi-volume works: $a is the set ("Werkausgabe"), $n the volume ("Bd. 5."), $p the part's own title
  // ("Das Prinzip Hoffnung : in 5 Teilen"), $n again the part ("Kap. 1 - 32").
  const set = clean(first('245', 'a')?.replace(/\s*\[[^\]]*\]/g, ''));
  const partTitle = partTitleOf(sub(fields('245')[0], 'p')[0]);
  const ns = sub(fields('245')[0], 'n');
  const volume = ns.map((n) => clean(n)).filter(Boolean).join(', ');
  const title = partTitle ?? set;
  if (!title) return undefined;
  const authors = [...fields('100'), ...fields('700').filter((f) => sub(f, '4').includes('aut'))]
    .map((f) => sub(f, 'a')[0]).filter(Boolean).map((n) => uninvert(clean(n)!));
  const contributors = fields('700')
    // $t = a work (e.g. the original of a translation), not a person who worked on this book.
    .filter((f) => !sub(f, '4').includes('aut') && !sub(f, 't').length)
    .map((f) => {
      const role = ROLES[sub(f, '4')[0] ?? ''] ?? ROLES[(sub(f, 'e')[0] ?? '').toLowerCase()];
      const name = uninvert(clean(sub(f, 'a')[0]) ?? '');
      return name && role ? `${name} (${role})` : name;
    }).filter((c) => c && !authors.includes(c));
  const prices = fields('020').flatMap((f) => parsePriceNote(sub(f, 'c').join(' ')));
  const price = preferredPrice(prices);
  const pages = first('300', 'a')?.match(/(\d+)\s*(?:S\.|Seiten|pages|p\.)/)?.[1];
  const year = (first('264', 'c') ?? first('260', 'c'))?.match(/\d{4}/)?.[0];
  const subjects = [...new Set([...fields('689'), ...fields('650')].map((f) => clean(sub(f, 'a')[0])).filter((s): s is string => !!s && !FORM_TERMS.has(s)))];
  const publisher = expandPublisher(clean(first('264', 'b') ?? first('260', 'b')));
  // "Sämtliche Werke / Theodor Fontane; Bd. 21 : Abt. 3" in $a alone (older records): the volume is after the semicolon.
  const [series490, vol490] = (first('490', 'a') ?? '').split(/\s*;\s*(?=(?:Bd|Band|Abt|Vol|Nr|T|Teil)\.?\s)/);
  const seriesName = clean(series490?.split(/\s+\/\s+/)[0]) ?? clean(first('800', 't')) ?? clean(first('830', 'a'));
  const seriesVol = first('490', 'v') ?? vol490 ?? first('800', 'v') ?? first('830', 'v');
  const isLine = publisherSeries(seriesName, clean(seriesVol), publisher);
  // Older records put the set into the title ("Sämtliche Werke. Bd. 8. Der Stechlin") instead of a series field.
  const titleSet = partTitle && set && ns.length ? set : undefined;
  const series = isLine ? undefined : seriesName ?? titleSet;
  const seriesNumber = !series ? undefined : seriesName ? volumeNumber(seriesVol) : volumeNumber(ns[0]);
  const line = isLine ? seriesName : undefined;
  const idn = control('001');
  const isbns = fields('020').map((f) => sub(f, 'a')[0]?.replace(/[^\dX]/gi, '')).filter(Boolean);
  const isbn13 = isbns.find((i) => i.length === 13);
  const isbn10 = isbns.find((i) => i.length === 10);

  // The set this record is a volume of: a collected edition (titleSet, or a real series that isn't a paperback line)
  // whose number reads like a volume.
  // A series numbered like the volumes of an edition ("Bd. 9", "Abt. 5", "12") wins over the set in the title
  // (Fontane's "Wanderungen, Bd. 1" is volume 9 of the Sämtliche Werke); a scholarly series number (stw 554) doesn't.
  const editionLike = !!seriesName && !isLine && !!seriesVol && (/^\s*(Bd|Band|Abt|Vol|T|Teil)\b/i.test(seriesVol) || Number(volumeNumber(seriesVol)?.match(/^\d+/)?.[0] ?? 999) < 100);
  let dnbSet: DnbSet | undefined;
  if (editionLike) dnbSet = { title: seriesName!, number: volumeNumber(seriesVol) };
  else if (titleSet) dnbSet = { title: titleSet, number: volumeNumber(ns[0]), part: ns.slice(1).map((n) => partTitleOf(n)).filter(Boolean).join(', ') || undefined };

  return {
    set: dnbSet,
    result: {
      source: 'dnb',
      url: idn ? `https://d-nb.info/${idn}` : undefined,
      fields: {
        title,
        subtitle: partTitle ? [set, volume].filter(Boolean).join(', ') || undefined : clean(first('245', 'b')),
        authors: authors.length ? authors : undefined,
        contributors: contributors.length ? contributors : undefined,
        publisher,
        publishedYear: year ? Number(year) : undefined,
        edition: clean(first('250', 'a')),
        language: first('041', 'a') ? marcToIso(first('041', 'a')) : undefined,
        pageCount: pages ? Number(pages) : undefined,
        isbn13,
        isbn10,
        series,
        seriesNumber,
        line,
        subjects: subjects.length ? subjects.slice(0, 12) : undefined,
        listPrice: price ? { amount: price.amount, currency: price.currency, source: 'dnb' } : undefined,
        identifiers: idn ? { dnb: idn } : undefined
      }
    }
  };
}

/** The MARC records in an SRU answer (the SRU envelope also uses <record>; MARC records are the ones with datafields). */
function marcRecords(xml: string): Element[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  return [...doc.getElementsByTagNameNS('*', 'record')].filter((r) => [...r.children].some((c) => c.localName === 'datafield'));
}

export function parseDnbRecord(xml: string): ProviderResult | undefined {
  const marc = marcRecords(xml)[0];
  return marc ? parseMarc(marc)?.result : undefined;
}

export function parseDnbRecords(xml: string): DnbHit[] {
  return marcRecords(xml).map(parseMarc).filter((h): h is DnbHit => !!h);
}

async function sru(query: string, f: Fetcher, max: number, timeoutMs = 10000): Promise<string | undefined> {
  const url = `${SRU}?version=1.1&operation=searchRetrieve&query=${encodeURIComponent(query)}&recordSchema=MARC21-xml&maximumRecords=${max}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await f(url, { signal: ctrl.signal });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`DNB HTTP ${res.status}`);
    const xml = await res.text();
    if (/<numberOfRecords>0</.test(xml)) return undefined;
    return xml;
  } finally {
    clearTimeout(timer);
  }
}

/** CQL words: quotes and CQL operators stripped, so free text can't break the query. */
function words(text: string): string[] {
  return text.replace(/["()=<>/\\]/g, ' ').split(/\s+/).filter((w) => w && !/^(and|or|not|prox)$/i.test(w));
}

/** Free-text search of the DNB catalogue (every book published in Germany since 1913, also without ISBN). */
export async function dnbSearch(text: string, f: Fetcher): Promise<DnbHit[]> {
  const ws = words(text);
  if (!ws.length) return [];
  const q = ws.map((w) => `woe=${w}`).join(' and ');
  // The DNB lists newest first, so old editions (the ones without ISBN) would be cut off: ask for the oldest too.
  const [oldest, newest] = await Promise.allSettled([sru(`${q} sortBy jhr/sort.ascending`, f, 60), sru(q, f, 20)]);
  if (oldest.status === 'rejected' && newest.status === 'rejected') throw oldest.reason;
  const hits = [oldest, newest].flatMap((r) => (r.status === 'fulfilled' && r.value ? parseDnbRecords(r.value) : []));
  const seen = new Set<string>();
  return hits.filter((h) => {
    const id = h.result.url ?? JSON.stringify(h.result.fields);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Every volume of a set the DNB knows: same set title, author and publisher. */
export async function dnbSetVolumes(set: { title: string; author?: string; publisher?: string }, f: Fetcher): Promise<DnbHit[]> {
  const q = [`tit="${words(set.title).join(' ')}"`];
  const surname = set.author?.split(/\s+/).pop();
  if (surname) q.push(`per=${words(surname).join(' ')}`);
  const vlg = words(set.publisher ?? '')[0];
  if (vlg && vlg.length > 2) q.push(`vlg=${vlg}`);
  const xml = await sru(q.join(' and '), f, 100, 15000);
  return xml ? parseDnbRecords(xml) : [];
}

/** One record by its DNB id (for books added from a DNB search hit). */
export async function dnbById(idn: string, f: Fetcher): Promise<ProviderResult | undefined> {
  const xml = await sru(`idn=${idn.replace(/[^\dX]/gi, '')}`, f, 1);
  return xml ? parseDnbRecord(xml) : undefined;
}

export async function dnbByIsbn(isbn: string, f: Fetcher): Promise<ProviderResult | undefined> {
  const xml = await sru(`num=${isbn}`, f, 1);
  return xml ? parseDnbRecord(xml) : undefined;
}

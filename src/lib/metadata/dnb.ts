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
const clean = (s: string | undefined) => s?.replace(/[\u0098\u009C]/g, '').replace(/\s*[/:;,.]\s*$/, '').trim() || undefined;

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
  return p.replace(/\bDt\.\s*/g, 'Deutscher ').replace(/\bVerl\b\.?$/, 'Verlag').replace(/-Verl\b\.?/, '-Verlag');
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

export function parseDnbRecord(xml: string): ProviderResult | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const record = doc.getElementsByTagNameNS('*', 'record');
  // The SRU envelope also uses <record>; the MARC record is the one with datafields.
  const marc = [...record].find((r) => r.getElementsByTagNameNS('*', 'datafield').length);
  if (!marc) return undefined;
  const fields = (tag: string) => [...marc.getElementsByTagNameNS('*', 'datafield')].filter((f) => f.getAttribute('tag') === tag);
  const sub = (f: Element | undefined, code: string) =>
    f ? [...f.getElementsByTagNameNS('*', 'subfield')].filter((s) => s.getAttribute('code') === code).map((s) => (s.textContent ?? '').normalize('NFC')) : [];
  // ↑ DNB writes umlauts decomposed (o + combining ¨); NFC makes "Röhl" searchable and comparable.
  const first = (tag: string, code: string) => sub(fields(tag)[0], code)[0];
  const control = (tag: string) => [...marc.getElementsByTagNameNS('*', 'controlfield')].find((f) => f.getAttribute('tag') === tag)?.textContent ?? undefined;

  // Multi-volume works: $a is the set ("Werkausgabe"), $n the volume ("Bd. 5."), $p the part's own title
  // ("Das Prinzip Hoffnung : in 5 Teilen"), $n again the part ("Kap. 1 - 32").
  const set = clean(first('245', 'a'));
  const partTitle = clean(sub(fields('245')[0], 'p')[0]?.split(/\s+:\s+/)[0]);
  const volume = sub(fields('245')[0], 'n').map((n) => clean(n)).filter(Boolean).join(', ');
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
  const series = publisherSeries(clean(first('490', 'a')), clean(first('490', 'v')), publisher) ? undefined : clean(first('490', 'a'));
  const idn = control('001');

  return {
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
      series,
      seriesNumber: series ? clean(first('490', 'v')) : undefined,
      subjects: subjects.length ? subjects.slice(0, 12) : undefined,
      listPrice: price ? { amount: price.amount, currency: price.currency, source: 'dnb' } : undefined,
      identifiers: idn ? { dnb: idn } : undefined
    }
  };
}

export async function dnbByIsbn(isbn: string, f: Fetcher): Promise<ProviderResult | undefined> {
  const url = `${SRU}?version=1.1&operation=searchRetrieve&query=num%3D${isbn}&recordSchema=MARC21-xml&maximumRecords=1`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await f(url, { signal: ctrl.signal });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`DNB HTTP ${res.status}`);
    const xml = await res.text();
    if (/<numberOfRecords>0</.test(xml)) return undefined;
    return parseDnbRecord(xml);
  } finally {
    clearTimeout(timer);
  }
}

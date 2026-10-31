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

export function parseDnbRecord(xml: string): ProviderResult | undefined {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const record = doc.getElementsByTagNameNS('*', 'record');
  // The SRU envelope also uses <record>; the MARC record is the one with datafields.
  const marc = [...record].find((r) => r.getElementsByTagNameNS('*', 'datafield').length);
  if (!marc) return undefined;
  const fields = (tag: string) => [...marc.getElementsByTagNameNS('*', 'datafield')].filter((f) => f.getAttribute('tag') === tag);
  const sub = (f: Element | undefined, code: string) =>
    f ? [...f.getElementsByTagNameNS('*', 'subfield')].filter((s) => s.getAttribute('code') === code).map((s) => s.textContent ?? '') : [];
  const first = (tag: string, code: string) => sub(fields(tag)[0], code)[0];
  const control = (tag: string) => [...marc.getElementsByTagNameNS('*', 'controlfield')].find((f) => f.getAttribute('tag') === tag)?.textContent ?? undefined;

  const title = clean(first('245', 'a'));
  if (!title) return undefined;
  const authors = [...fields('100'), ...fields('700').filter((f) => sub(f, '4').includes('aut'))]
    .map((f) => sub(f, 'a')[0]).filter(Boolean).map((n) => uninvert(clean(n)!));
  const contributors = fields('700')
    .filter((f) => !sub(f, '4').includes('aut'))
    .map((f) => {
      const role = { trl: 'translator', edt: 'editor', ill: 'illustrator', aui: 'introduction' }[sub(f, '4')[0] ?? ''];
      const name = uninvert(clean(sub(f, 'a')[0]) ?? '');
      return name && role ? `${name} (${role})` : name;
    }).filter(Boolean);
  const prices = fields('020').flatMap((f) => parsePriceNote(sub(f, 'c').join(' ')));
  const price = preferredPrice(prices);
  const pages = first('300', 'a')?.match(/(\d+)\s*(?:S\.|Seiten|pages|p\.)/)?.[1];
  const year = (first('264', 'c') ?? first('260', 'c'))?.match(/\d{4}/)?.[0];
  const subjects = [...new Set([...fields('689'), ...fields('650')].map((f) => clean(sub(f, 'a')[0])).filter((s): s is string => !!s))];
  const idn = control('001');

  return {
    source: 'dnb',
    url: idn ? `https://d-nb.info/${idn}` : undefined,
    fields: {
      title,
      subtitle: clean(first('245', 'b')),
      authors: authors.length ? authors : undefined,
      contributors: contributors.length ? contributors : undefined,
      publisher: clean(first('264', 'b') ?? first('260', 'b')),
      publishedYear: year ? Number(year) : undefined,
      edition: clean(first('250', 'a')),
      language: first('041', 'a') ? marcToIso(first('041', 'a')) : undefined,
      pageCount: pages ? Number(pages) : undefined,
      series: clean(first('490', 'a')),
      seriesNumber: clean(first('490', 'v')),
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

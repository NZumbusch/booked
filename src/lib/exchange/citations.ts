import type { Book } from '../domain/types';

/** Formats Zotero (and most reference managers) import directly: CSL-JSON, RIS, BibTeX. */

const PARTICLES = new Set(['von', 'van', 'de', 'der', 'den', 'da', 'di', 'du', 'le', 'la', 'del', 'della', 'ten', 'ter', 'zu', 'af']);

/** "Ursula K. Le Guin" → { given: "Ursula K.", family: "Le Guin" }; "Mann, Thomas" → { given: "Thomas", family: "Mann" }. */
export function splitPersonName(name: string): { given?: string; family: string } {
  const n = name.trim();
  if (n.includes(',')) {
    const [family, given] = n.split(',', 2).map((s) => s.trim());
    return given ? { given, family } : { family };
  }
  const parts = n.split(/\s+/);
  if (parts.length === 1) return { family: parts[0] };
  // Pull particles ("von", "de", "Le" before the last word) into the family name.
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  return { given: parts.slice(0, i).join(' '), family: parts.slice(i).join(' ') };
}

const year = (b: Book) => b.publishedYear ?? b.firstPublishedYear;

export function toCslJson(books: Book[]): string {
  const items = books.map((b) => ({
    id: b.isbn13 ?? b.id,
    type: 'book',
    title: b.subtitle ? `${b.title}: ${b.subtitle}` : b.title,
    author: b.authors.map(splitPersonName),
    ...(year(b) ? { issued: { 'date-parts': [[year(b)]] } } : {}),
    ...(b.firstPublishedYear && b.firstPublishedYear !== b.publishedYear ? { 'original-date': { 'date-parts': [[b.firstPublishedYear]] } } : {}),
    publisher: b.publisher,
    ISBN: b.isbn13 ?? b.isbn10,
    'number-of-pages': b.pageCount,
    language: b.language,
    edition: b.edition,
    'collection-title': b.series,
    'collection-number': b.seriesNumber,
    abstract: b.description,
    note: b.notes
  }));
  return JSON.stringify(items, (_k, v) => (v === undefined || v === '' ? undefined : v), 2);
}

export function toRis(books: Book[]): string {
  return books
    .map((b) => {
      const lines: [string, string | number | undefined][] = [
        ['TY', 'BOOK'],
        ['TI', b.title],
        ['T2', b.subtitle],
        ...b.authors.map((a): [string, string] => {
          const { given, family } = splitPersonName(a);
          return ['AU', given ? `${family}, ${given}` : family];
        }),
        ['PY', year(b)],
        ['PB', b.publisher],
        ['SN', b.isbn13 ?? b.isbn10],
        ['ET', b.edition],
        ['T3', b.series],
        ['SP', b.pageCount],
        ['LA', b.language],
        ['AB', b.description?.replace(/\s*\n\s*/g, ' ')],
        ...b.tags.map((t): [string, string] => ['KW', t]),
        ['N1', b.notes?.replace(/\s*\n\s*/g, ' ')]
      ];
      return [...lines.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${k}  - ${v}`), 'ER  - '].join('\r\n');
    })
    .join('\r\n\r\n') + '\r\n';
}

function bibEscape(s: string): string {
  return s.replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
}

export function toBibtex(books: Book[]): string {
  const used = new Map<string, number>();
  return books
    .map((b) => {
      const first = b.authors[0] ? splitPersonName(b.authors[0]).family : 'anon';
      const word = b.title.split(/\s+/).find((w) => w.length > 3 && !/^(the|der|die|das|und|and)$/i.test(w)) ?? b.title.split(/\s+/)[0];
      const base = `${first}${year(b) ?? ''}${word}`.normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'book';
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      const key = n ? `${base}${String.fromCharCode(97 + ((n - 1) % 26))}` : base;
      const fields: [string, string | number | undefined][] = [
        ['title', b.subtitle ? `${b.title}: ${b.subtitle}` : b.title],
        ['author', b.authors.map((a) => {
          const { given, family } = splitPersonName(a);
          return given ? `${family}, ${given}` : family;
        }).join(' and ') || undefined],
        ['year', year(b)],
        ['publisher', b.publisher],
        ['edition', b.edition],
        ['series', b.series],
        ['isbn', b.isbn13 ?? b.isbn10],
        ['pagetotal', b.pageCount],
        ['language', b.language],
        ['keywords', b.tags.join(', ') || undefined]
      ];
      const body = fields
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `  ${k} = {${typeof v === 'number' ? v : bibEscape(String(v))}}`)
        .join(',\n');
      return `@book{${key},\n${body}\n}`;
    })
    .join('\n\n') + '\n';
}

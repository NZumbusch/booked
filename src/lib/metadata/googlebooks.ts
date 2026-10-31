import { cleanList } from '../domain/book';
import { getJson, parseYear, plainText, type Fetcher } from './http';
import type { Candidate, ProviderResult } from './types';

const API = 'https://www.googleapis.com/books/v1/volumes';

interface Volume {
  id: string;
  saleInfo?: { isEbook?: boolean; listPrice?: { amount?: number; currencyCode?: string } };
  volumeInfo: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: { type: string; identifier: string }[];
    pageCount?: number;
    categories?: string[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
    language?: string;
  };
}
interface Volumes {
  totalItems?: number;
  items?: Volume[];
}

/** "Fiction / Science Fiction / General" → ["Fiction", "Science Fiction"]. */
export function splitCategories(categories: string[] | undefined): string[] {
  return cleanList((categories ?? []).flatMap((c) => c.split('/')).filter((c) => !/^\s*general\s*$/i.test(c)));
}

function cover(v: Volume): string | undefined {
  const url = v.volumeInfo.imageLinks?.thumbnail ?? v.volumeInfo.imageLinks?.smallThumbnail;
  return url?.replace(/^http:/, 'https:').replace(/&edge=curl/, '');
}

function toResult(v: Volume): ProviderResult {
  const i = v.volumeInfo;
  const id = (type: string) => i.industryIdentifiers?.find((x) => x.type === type)?.identifier;
  return {
    source: 'googlebooks',
    url: `https://books.google.com/books?id=${v.id}`,
    fields: {
      title: i.title,
      subtitle: i.subtitle,
      authors: i.authors,
      publisher: i.publisher,
      publishedYear: parseYear(i.publishedDate),
      description: plainText(i.description),
      pageCount: i.pageCount || undefined,
      language: i.language,
      isbn10: id('ISBN_10'),
      isbn13: id('ISBN_13'),
      genres: splitCategories(i.categories),
      cover: cover(v),
      // Google's prices are mostly for its e-books; only a print price is a meaningful list price.
      listPrice: v.saleInfo?.isEbook === false && v.saleInfo.listPrice?.amount && v.saleInfo.listPrice.currencyCode
        ? { amount: v.saleInfo.listPrice.amount, currency: v.saleInfo.listPrice.currencyCode, source: 'googlebooks' }
        : undefined,
      identifiers: { gbid: v.id }
    }
  };
}

/** Optional API key: without one Google's shared anonymous quota applies (often exhausted). */
const withKey = (url: string, key?: string) => (key?.trim() ? `${url}&key=${encodeURIComponent(key.trim())}` : url);

export async function gbByIsbn(isbn: string, f: Fetcher, key?: string): Promise<ProviderResult | undefined> {
  const res = await getJson<Volumes>(f, withKey(`${API}?q=isbn:${isbn}`, key));
  const v = res?.items?.[0];
  return v ? toResult(v) : undefined;
}

export async function gbSearch(query: string, f: Fetcher, key?: string, limit = 20): Promise<Candidate[]> {
  const res = await getJson<Volumes>(f, withKey(`${API}?q=${encodeURIComponent(query)}&maxResults=${limit}`, key));
  return (res?.items ?? []).map((v) => {
    const r = toResult(v);
    return {
      key: `gb:${v.id}`,
      title: r.fields.title ?? 'Untitled',
      subtitle: r.fields.subtitle,
      authors: r.fields.authors ?? [],
      year: r.fields.publishedYear,
      cover: r.fields.cover,
      source: 'googlebooks' as const,
      gb: r
    };
  });
}

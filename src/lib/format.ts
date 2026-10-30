import type { IsoDate, Settings, ReadingStatus, BookFormat } from './domain/types';

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  unread: 'Unread', reading: 'Reading', read: 'Read', abandoned: 'Abandoned'
};

export const FORMAT_LABEL: Record<BookFormat, string> = {
  hardcover: 'Hardcover', paperback: 'Paperback', ebook: 'E-book', audiobook: 'Audiobook', other: 'Other'
};

export function formatDate(iso: IsoDate | undefined, format: Settings['dateFormat']): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!d) return iso;
  if (format === 'dmy') return `${d}.${m}.${y}`;
  if (format === 'mdy') return `${m}/${d}/${y}`;
  return `${y}-${m}-${d}`;
}

export function formatPrice(value: number | undefined, currency: string): string {
  if (value === undefined || value === null || Number.isNaN(value)) return '';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? word : many}`;
}

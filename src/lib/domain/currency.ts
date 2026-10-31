import type { ListPrice } from './types';

/** The fixed euro conversion rate of the German mark (exact, since 1999). */
export const DEM_PER_EUR = 1.95583;

/** EUR per 1 unit of each currency: rough values, used until live rates are fetched (Settings). */
export const DEFAULT_EUR_PER: Record<string, number> = {
  EUR: 1, GBP: 1.17, USD: 0.92, CHF: 1.07, AUD: 0.6, NZD: 0.55, CAD: 0.67, SEK: 0.088, NOK: 0.086, DKK: 0.134, PLN: 0.23, CZK: 0.041, JPY: 0.0062
};

export const currencyName = (c: string) => (c === 'DEM' ? 'DM (German mark)' : c);

/** EUR per 1 unit of `currency`, or undefined if unknown. DEM is always the exact fixed rate. */
export function eurPer(currency: string, rates?: Record<string, number>): number | undefined {
  if (currency === 'DEM') return 1 / DEM_PER_EUR;
  return rates?.[currency] ?? DEFAULT_EUR_PER[currency];
}

export function convert(amount: number, from: string, to: string, rates?: Record<string, number>): number | undefined {
  if (from === to) return amount;
  const a = eurPer(from, rates);
  const b = eurPer(to, rates);
  return a && b ? (amount * a) / b : undefined;
}

export interface ValueTotal {
  /** Everything that could be converted, in `currency`. */
  amount: number;
  currency: string;
  /** Books counted in `amount`. */
  books: number;
  /** Currencies other than `currency` that were converted, with how many books. */
  converted: { currency: string; books: number }[];
  /** Prices in currencies without a known rate: not included. */
  unknown: { currency: string; books: number }[];
}

/** One total in `home`: the paid price where known (in `home`), else the list price converted from its own currency. */
export function totalValue(books: { price?: number; listPrice?: ListPrice }[], home: string, rates?: Record<string, number>): ValueTotal {
  let amount = 0, counted = 0;
  const converted = new Map<string, number>();
  const unknown = new Map<string, number>();
  for (const b of books) {
    const p = b.price !== undefined ? { amount: b.price, currency: home } : b.listPrice;
    if (!p) continue;
    const v = convert(p.amount, p.currency, home, rates);
    if (v === undefined) {
      unknown.set(p.currency, (unknown.get(p.currency) ?? 0) + 1);
      continue;
    }
    amount += v;
    counted++;
    if (p.currency !== home) converted.set(p.currency, (converted.get(p.currency) ?? 0) + 1);
  }
  const list = (m: Map<string, number>) => [...m.entries()].map(([currency, n]) => ({ currency, books: n })).sort((a, b) => b.books - a.books);
  return { amount: Math.round(amount * 100) / 100, currency: home, books: counted, converted: list(converted), unknown: list(unknown) };
}

import type { ListPrice } from './types';

/**
 * Prices printed in catalogue records, e.g. the DNB's MARC 020 $c:
 *   "kart. : EUR 12.00 (DE), EUR 12.40 (AT), sfr 17.90 (freier Preis)"
 * Returns all prices found, in order.
 */
export function parsePriceNote(note: string | undefined): { amount: number; currency: string; country?: string }[] {
  if (!note) return [];
  const out: { amount: number; currency: string; country?: string }[] = [];
  // DM = pre-2002 German mark (older DNB records); kept as DEM rather than silently converted.
  const CUR: Record<string, string> = { eur: 'EUR', '€': 'EUR', dm: 'DEM', sfr: 'CHF', chf: 'CHF', fr: 'CHF', gbp: 'GBP', '£': 'GBP', usd: 'USD', '$': 'USD', us$: 'USD' };
  const re = /(EUR|€|DM|sfr|CHF|GBP|£|USD|US\$|\$)\s*(\d{1,4}(?:[.,]\d{2})?)(?:\s*\((DE|AT|CH)\))?/gi;
  for (const m of note.matchAll(re)) {
    const currency = CUR[m[1].toLowerCase()];
    const amount = Number(m[2].replace(',', '.'));
    if (currency && amount > 0) out.push({ amount, currency, country: m[3]?.toUpperCase() });
  }
  return out;
}

/** The price to use for Germany: the (DE) price if marked, else EUR, else the old DM price, else the first. */
export function preferredPrice(prices: { amount: number; currency: string; country?: string }[]) {
  return prices.find((p) => p.country === 'DE') ?? prices.find((p) => p.currency === 'EUR') ?? prices.find((p) => p.currency === 'DEM') ?? prices[0];
}

/**
 * The small 5-digit add-on barcode next to the ISBN on many English-language books encodes the
 * suggested retail price: first digit = currency, rest = price in cents.
 * 90000 = no price; 99xxx and other 9xxxx = internal codes.
 */
export function priceFromEan5(addon: string): ListPrice | undefined {
  if (!/^\d{5}$/.test(addon)) return undefined;
  const currency = { '0': 'GBP', '1': 'GBP', '3': 'AUD', '4': 'NZD', '5': 'USD', '6': 'CAD' }[addon[0]];
  const amount = Number(addon.slice(1)) / 100;
  if (!currency || amount <= 0) return undefined;
  return { amount, currency, source: 'barcode' };
}

/** Sum prices per currency (purchase price wins over list price when both exist). */
export function collectionValue(books: { price?: number; listPrice?: ListPrice }[], homeCurrency: string): { currency: string; amount: number; books: number }[] {
  const sums = new Map<string, { amount: number; books: number }>();
  for (const b of books) {
    const p = b.price !== undefined ? { amount: b.price, currency: homeCurrency } : b.listPrice;
    if (!p) continue;
    const e = sums.get(p.currency) ?? { amount: 0, books: 0 };
    e.amount += p.amount;
    e.books++;
    sums.set(p.currency, e);
  }
  return [...sums.entries()]
    .map(([currency, v]) => ({ currency, amount: Math.round(v.amount * 100) / 100, books: v.books }))
    .sort((a, b) => (a.currency === homeCurrency ? -1 : b.currency === homeCurrency ? 1 : b.books - a.books));
}

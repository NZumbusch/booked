import { describe, expect, it } from 'vitest';
import { convert, DEM_PER_EUR, totalValue } from './currency';

describe('currency', () => {
  it('converts the German mark exactly', () => {
    expect(convert(19.5583, 'DEM', 'EUR')).toBeCloseTo(10, 6);
    expect(convert(10, 'EUR', 'DEM')).toBeCloseTo(10 * DEM_PER_EUR, 6);
  });
  it('uses fetched rates over the built-in ones, and leaves unknown currencies out', () => {
    expect(convert(10, 'USD', 'EUR', { USD: 0.5 })).toBe(5);
    expect(convert(10, 'XYZ', 'EUR')).toBeUndefined();
  });
  it('totals mixed currencies in one, preferring the paid price', () => {
    const t = totalValue([
      { listPrice: { amount: 19.5583, currency: 'DEM', source: 'dnb' } },
      { listPrice: { amount: 12, currency: 'EUR', source: 'dnb' } },
      { price: 5, listPrice: { amount: 99, currency: 'USD', source: 'barcode' } },
      { listPrice: { amount: 8, currency: 'USD', source: 'barcode' } },
      { listPrice: { amount: 3, currency: 'XYZ', source: 'manual' } },
      {}
    ], 'EUR', { USD: 0.5 });
    expect(t).toMatchObject({ amount: 31, books: 4, currency: 'EUR' });
    expect(t.converted).toEqual([{ currency: 'DEM', books: 1 }, { currency: 'USD', books: 1 }]);
    expect(t.unknown).toEqual([{ currency: 'XYZ', books: 1 }]);
  });
  it('works for a home currency other than EUR', () => {
    expect(convert(10, 'EUR', 'CHF', { CHF: 0.5 })).toBe(20);
  });
});

import { describe, expect, it } from 'vitest';
import { collectionValue, parsePriceNote, preferredPrice, priceFromEan5 } from './price';

describe('catalogue price notes', () => {
  it('reads DE/AT/CH prices in the DNB style', () => {
    const p = parsePriceNote('kart. : EUR 12.00 (DE), EUR 12.40 (AT), sfr 17.90 (freier Preis)');
    expect(p).toEqual([
      { amount: 12, currency: 'EUR', country: 'DE' },
      { amount: 12.4, currency: 'EUR', country: 'AT' },
      { amount: 17.9, currency: 'CHF', country: undefined }
    ]);
    expect(preferredPrice(p)).toEqual({ amount: 12, currency: 'EUR', country: 'DE' });
  });
  it('accepts comma decimals and symbols, ignores notes without prices', () => {
    expect(parsePriceNote('Gb. : € 24,95')).toEqual([{ amount: 24.95, currency: 'EUR', country: undefined }]);
    expect(parsePriceNote('Pp.')).toEqual([]);
    expect(parsePriceNote(undefined)).toEqual([]);
  });
});

describe('EAN-5 price add-on', () => {
  it('decodes currency and amount', () => {
    expect(priceFromEan5('51699')).toEqual({ amount: 16.99, currency: 'USD', source: 'barcode' });
    expect(priceFromEan5('00799')).toEqual({ amount: 7.99, currency: 'GBP', source: 'barcode' });
    expect(priceFromEan5('62495')).toEqual({ amount: 24.95, currency: 'CAD', source: 'barcode' });
  });
  it('ignores "no price" and internal codes', () => {
    expect(priceFromEan5('90000')).toBeUndefined();
    expect(priceFromEan5('99123')).toBeUndefined();
    expect(priceFromEan5('50000')).toBeUndefined();
    expect(priceFromEan5('123')).toBeUndefined();
  });
});

describe('collectionValue', () => {
  it('sums per currency, preferring what you paid', () => {
    const v = collectionValue([
      { price: 10, listPrice: { amount: 20, currency: 'EUR', source: 'dnb' } },
      { listPrice: { amount: 12.5, currency: 'EUR', source: 'dnb' } },
      { listPrice: { amount: 16.99, currency: 'USD', source: 'barcode' } },
      {}
    ], 'EUR');
    expect(v).toEqual([{ currency: 'EUR', amount: 22.5, books: 2 }, { currency: 'USD', amount: 16.99, books: 1 }]);
  });
});

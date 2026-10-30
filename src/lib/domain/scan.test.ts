import { describe, expect, it } from 'vitest';
import { ScanGuard, isbnFromBarcode, classifyScan } from './scan';

describe('isbnFromBarcode', () => {
  it('accepts Bookland EAN-13 (978/979) with valid checksum', () => {
    expect(isbnFromBarcode('9780441172719')).toBe('9780441172719');
    expect(isbnFromBarcode('9780441172718')).toBeUndefined();
  });
  it('rejects other barcodes and price add-ons', () => {
    expect(isbnFromBarcode('4006381333931')).toBeUndefined(); // a pen
    expect(isbnFromBarcode('51299')).toBeUndefined();
  });
});

describe('ScanGuard', () => {
  it('reports a code once while it stays in view', () => {
    const g = new ScanGuard(1500);
    expect(g.see('A', 0)).toBe(true);
    expect(g.see('A', 100)).toBe(false);
    expect(g.see('A', 1400)).toBe(false);
    expect(g.see('A', 2800)).toBe(false); // still continuously visible
  });

  it('reports it again after it has left the view', () => {
    const g = new ScanGuard(1500);
    g.see('A', 0);
    expect(g.see('A', 2000)).toBe(true);
  });

  it('handles different codes independently', () => {
    const g = new ScanGuard(1500);
    expect(g.see('A', 0)).toBe(true);
    expect(g.see('B', 10)).toBe(true);
    expect(g.see('A', 20)).toBe(false);
  });
});

describe('classifyScan', () => {
  it('adds new books straight away', () => {
    expect(classifyScan('1', { inSession: 0, inLibrary: 0 })).toEqual({ action: 'add' });
  });
  it('asks when the book was already scanned in this session', () => {
    expect(classifyScan('1', { inSession: 1, inLibrary: 1 })).toEqual({ action: 'confirm', reason: 'session' });
  });
  it('asks when the book is already in the library', () => {
    expect(classifyScan('1', { inSession: 0, inLibrary: 2 })).toEqual({ action: 'confirm', reason: 'library' });
  });
});

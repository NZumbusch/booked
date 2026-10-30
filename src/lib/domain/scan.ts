import { isValidIsbn13 } from './isbn';

/** ISBN-13 from an EAN-13 barcode, or undefined for non-book barcodes. */
export function isbnFromBarcode(raw: string): string | undefined {
  const code = raw.replace(/\D/g, '');
  return /^97[89]\d{10}$/.test(code) && isValidIsbn13(code) ? code : undefined;
}

/**
 * Cameras report the same barcode many times per second. A code counts as a new scan only
 * after it has been out of view for `holdMs`, so holding a book still never adds it twice.
 */
export class ScanGuard {
  private lastSeen = new Map<string, number>();

  constructor(private holdMs = 1500) {}

  /** Returns true when this sighting is a fresh scan. */
  see(code: string, now: number): boolean {
    const last = this.lastSeen.get(code);
    this.lastSeen.set(code, now);
    return last === undefined || now - last > this.holdMs;
  }
}

export type ScanDecision = { action: 'add' } | { action: 'confirm'; reason: 'session' | 'library' };

/** A repeated ISBN is never silently added: the user confirms it is really another copy. */
export function classifyScan(_isbn: string, seen: { inSession: number; inLibrary: number }): ScanDecision {
  if (seen.inSession > 0) return { action: 'confirm', reason: 'session' };
  if (seen.inLibrary > 0) return { action: 'confirm', reason: 'library' };
  return { action: 'add' };
}

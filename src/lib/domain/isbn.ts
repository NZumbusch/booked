export function cleanIsbn(input: string): string {
  return input.replace(/[^0-9xX]/g, '').toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const digit = isbn[i] === 'X' ? 10 : Number(isbn[i]);
    sum += digit * (10 - i);
  }
  return sum % 11 === 0;
}

function isbn13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidIsbn13(isbn: string): boolean {
  return /^\d{13}$/.test(isbn) && isbn13CheckDigit(isbn.slice(0, 12)) === Number(isbn[12]);
}

export function isbn10To13(isbn10: string): string {
  const first12 = '978' + isbn10.slice(0, 9);
  return first12 + isbn13CheckDigit(first12);
}

export function isbn13To10(isbn13: string): string | undefined {
  if (!isbn13.startsWith('978')) return undefined;
  const first9 = isbn13.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(first9[i]) * (10 - i);
  const check = (11 - (sum % 11)) % 11;
  return first9 + (check === 10 ? 'X' : String(check));
}

/** Parse any ISBN-ish string into both forms, or undefined if invalid. */
export function normalizeIsbn(input: string): { isbn10?: string; isbn13: string } | undefined {
  const isbn = cleanIsbn(input);
  if (isValidIsbn13(isbn)) {
    const isbn10 = isbn13To10(isbn);
    return isbn10 ? { isbn10, isbn13: isbn } : { isbn13: isbn };
  }
  if (isValidIsbn10(isbn)) return { isbn10: isbn, isbn13: isbn10To13(isbn) };
  return undefined;
}

/** Canonical ISBN-13 keys for a book, used to detect duplicates. */
export function isbnKeys(book: { isbn10?: string; isbn13?: string }): string[] {
  const keys = new Set<string>();
  for (const raw of [book.isbn13, book.isbn10]) {
    if (!raw) continue;
    const n = normalizeIsbn(raw);
    if (n) keys.add(n.isbn13);
  }
  return [...keys];
}

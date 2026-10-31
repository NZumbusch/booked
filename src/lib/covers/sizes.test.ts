import { describe, expect, it } from 'vitest';
import { estimateBytes, formatBytes, sourceUrl } from './sizes';

describe('cover sizes', () => {
  it('estimates from the rule of thumb, then from real averages', () => {
    expect(formatBytes(estimateBytes(5000, 'medium'))).toBe('195 MB');
    expect(formatBytes(estimateBytes(1000, 'xl'))).toBe('225 MB');
    // 100 covers cached at 540px averaging 30 KB → large (900px) ≈ 30 KB × (900/540)² ≈ 83 KB
    const est = estimateBytes(1000, 'large', { bytes: 100 * 30 * 1024, covers: 100, px: 540 });
    expect(formatBytes(est)).toBe('81 MB');
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB');
  });
  it('requests big enough source images', () => {
    expect(sourceUrl('https://covers.openlibrary.org/b/id/1-M.jpg?default=false', 'large')).toBe('https://covers.openlibrary.org/b/id/1-L.jpg?default=false');
    expect(sourceUrl('https://covers.openlibrary.org/b/id/1-L.jpg', 'small')).toBe('https://covers.openlibrary.org/b/id/1-M.jpg');
    expect(sourceUrl('https://books.google.com/books/content?id=x&zoom=1&source=gbs_api', 'large')).toContain('zoom=0');
    expect(sourceUrl('https://books.google.com/books/content?id=x&zoom=1', 'small')).toContain('zoom=1');
  });
});

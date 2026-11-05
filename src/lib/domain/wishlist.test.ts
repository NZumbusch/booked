import { describe, expect, it } from 'vitest';
import type { Book } from './types';
import { sortWishes, wishlistText } from './wishlist';

const wish = (p: Partial<Book>): Book => ({
  id: p.title!, title: '', authors: [], genres: [], tags: [], collections: [], status: 'unread', ownership: 'wishlist',
  locationId: null, copies: 1, signed: false, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...p
});

describe('wishlist', () => {
  const books = [
    wish({ title: 'Older', authors: ['A'], createdAt: '2026-01-01T00:00:00Z' }),
    wish({ title: 'Newer', authors: ['B'], createdAt: '2026-03-01T00:00:00Z', isbn13: '9783518188354', publisher: 'Suhrkamp' }),
    wish({ title: 'Wanted most', authors: ['C'], mustHave: true, notes: 'the green\nedition' })
  ];
  it('lists must-haves first, then newest', () => {
    expect(sortWishes(books).map((b) => b.title)).toEqual(['Wanted most', 'Newer', 'Older']);
  });
  it('shares as text with details, notes and a legend', () => {
    expect(wishlistText(books)).toBe(
      'My wishlist\n\n★ Wanted most – C\n   the green edition\n• Newer – B (Suhrkamp, ISBN 9783518188354)\n• Older – A\n\n★ = most wanted'
    );
  });
});

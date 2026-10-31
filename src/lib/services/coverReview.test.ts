import { describe, expect, it } from 'vitest';
import { createBook } from '../domain/book';
import type { Book } from '../domain/types';
import { reviewQueue } from './coverReview';

const b = (id: string, extra: Partial<Book> = {}) => createBook({ title: id, ...extra }, { id, now: '2026-01-01T00:00:00.000Z' });

describe('reviewQueue', () => {
  const books = [
    b('Zebra', { cover: 'z' }),
    b('Goethe 3', { series: 'Goethe', seriesNumber: '3', cover: 'x' }),
    b('Goethe 10', { series: 'Goethe', seriesNumber: '10' }),
    b('Goethe 2', { series: 'Goethe', seriesNumber: '2' }),
    b('Apfel'),
    b('Wish', { ownership: 'wishlist' })
  ];

  it('missing: books without a usable cover, series volumes together and in numeric order', () => {
    expect(reviewQueue(books, 'missing').map((x) => x.id)).toEqual(['Goethe 2', 'Goethe 10', 'Apfel']);
  });
  it('series: every book in a series, in order', () => {
    expect(reviewQueue(books, 'series').map((x) => x.id)).toEqual(['Goethe 2', 'Goethe 3', 'Goethe 10']);
  });
  it('all: series first, then the rest by title; wishlist books are skipped', () => {
    expect(reviewQueue(books, 'all').map((x) => x.id)).toEqual(['Goethe 2', 'Goethe 3', 'Goethe 10', 'Apfel', 'Zebra']);
  });
  it('counts a broken cover as missing', () => {
    expect(reviewQueue(books, 'missing', (c) => c === 'z').map((x) => x.id)).toContain('Zebra');
  });
});

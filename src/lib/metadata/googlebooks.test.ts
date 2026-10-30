import { describe, expect, it } from 'vitest';
import volumes from './fixtures/gb-isbn.json';
import { fakeFetch } from './testing';
import { gbByIsbn, gbSearch, splitCategories } from './googlebooks';

describe('Google Books', () => {
  it('maps a volume to fields', async () => {
    const r = await gbByIsbn('9780441172719', fakeFetch({ 'q=isbn:9780441172719': volumes }));
    expect(r!.fields).toMatchObject({
      title: 'Dune', authors: ['Frank Herbert'], publisher: 'Penguin', publishedYear: 1990, pageCount: 548,
      language: 'en', isbn10: '0441172717', isbn13: '9780441172719', genres: ['Fiction', 'Science Fiction'],
      identifiers: { gbid: 'B1hSG45JCX4C' }
    });
    expect(r!.fields.description).toBe('Set on the desert planet Arrakis, Dune is the story of the boy Paul Atreides.');
    expect(r!.fields.cover).toBe('https://books.google.com/books/content?id=B1hSG45JCX4C&printsec=frontcover&img=1&zoom=1&source=gbs_api');
    expect(r!.url).toBe('https://books.google.com/books?id=B1hSG45JCX4C');
  });

  it('sends the API key when one is configured', async () => {
    const calls: string[] = [];
    await gbByIsbn('9780441172719', fakeFetch({ 'q=isbn': volumes }, calls), ' my key ');
    expect(calls[0]).toBe('https://www.googleapis.com/books/v1/volumes?q=isbn:9780441172719&key=my%20key');
    await gbByIsbn('9780441172719', fakeFetch({ 'q=isbn': volumes }, calls), '');
    expect(calls[1]).not.toContain('key=');
  });

  it('returns undefined when nothing is found', async () => {
    expect(await gbByIsbn('9780441172719', fakeFetch({ 'q=isbn': { totalItems: 0 } }))).toBeUndefined();
  });

  it('throws on quota errors so the caller can report it', async () => {
    await expect(gbByIsbn('9780441172719', fakeFetch({ 'q=isbn': 429 }))).rejects.toThrow(/429/);
  });

  it('searches', async () => {
    const hits = await gbSearch('dune', fakeFetch({ 'q=dune': volumes }));
    expect(hits[0]).toMatchObject({ title: 'Dune', authors: ['Frank Herbert'], year: 1990, source: 'googlebooks' });
  });

  it('splits BISAC-style categories', () => {
    expect(splitCategories(['Fiction / Science Fiction / General', 'Fiction / Classics'])).toEqual(['Fiction', 'Science Fiction', 'Classics']);
  });
});

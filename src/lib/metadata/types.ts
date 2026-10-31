import type { Book, SourceId, SourceRef } from '../domain/types';

/** Bibliographic fields a provider can fill in. */
export type MetaFields = Partial<Pick<Book,
  | 'title' | 'subtitle' | 'authors' | 'contributors' | 'publisher' | 'publishedYear' | 'firstPublishedYear'
  | 'edition' | 'language' | 'originalLanguage' | 'pageCount' | 'format' | 'isbn10' | 'isbn13'
  | 'description' | 'cover' | 'genres' | 'subjects' | 'series' | 'seriesNumber' | 'line' | 'writing' | 'listPrice'
>> & { identifiers?: Record<string, string> };

/** One provider's answer: fields plus where each came from. */
export interface ProviderResult {
  source: SourceId;
  fields: MetaFields;
  /** Link to the record at the provider (default provenance for every field). */
  url?: string;
  /** Field-specific provenance overrides, e.g. an explanatory note for `writing`. */
  provenance?: Record<string, SourceRef>;
}

/** A search hit shown in "search by title/author". */
export interface Candidate {
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  year?: number;
  cover?: string;
  editionCount?: number;
  /** Open Library work id (OL…W) for fetching full details. */
  olWorkId?: string;
  authorOlIds?: string[];
  source: SourceId;
  /** Full Google Books record when the hit came from there. */
  gb?: ProviderResult;
}

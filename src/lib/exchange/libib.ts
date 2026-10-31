import { pathOf } from '../domain/locations';
import type { Book, Location, ReadingStatus } from '../domain/types';

/** Libib's CSV export columns (kept in this order for compatibility), followed by Booked's extra fields. */
export const LIBIB_COLUMNS = [
  'item_type', 'title', 'creators', 'first_name', 'last_name', 'ean_isbn13', 'upc_isbn10', 'description', 'publisher',
  'publish_date', 'group', 'tags', 'notes', 'price', 'length', 'number_of_discs', 'number_of_players', 'age_group',
  'ensemble', 'aspect_ratio', 'esrb', 'rating', 'review', 'review_date', 'status', 'began', 'completed', 'added', 'copies'
] as const;

export const EXTRA_COLUMNS = [
  'subtitle', 'format', 'language', 'original_language', 'genres', 'subjects', 'series', 'series_number', 'edition',
  'first_published', 'location', 'location_place', 'location_room', 'location_shelf', 'ownership', 'condition', 'signed',
  'purchase_date', 'lent_to', 'lent_on', 'due_on', 'cover_url', 'written_place', 'written_lat', 'written_lon'
] as const;

const LIBIB_STATUS: Record<ReadingStatus, string> = {
  unread: 'Not begun', reading: 'In progress', read: 'Completed', abandoned: 'Abandoned'
};

function splitName(name: string): [string, string] {
  if (name.includes(',')) {
    const [last, first] = name.split(',', 2).map((s) => s.trim());
    return [first, last];
  }
  const parts = name.trim().split(/\s+/);
  return [parts.slice(0, -1).join(' '), parts[parts.length - 1] ?? ''];
}

export function libibRows(books: Book[], locations: Location[]): string[][] {
  const header = [...LIBIB_COLUMNS, ...EXTRA_COLUMNS] as string[];
  const rows = books.map((b) => {
    const [first, last] = b.authors[0] ? splitName(b.authors[0]) : ['', ''];
    const path = pathOf(locations, b.locationId);
    const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));
    const libib: Record<(typeof LIBIB_COLUMNS)[number], string> = {
      item_type: 'book', title: b.title, creators: b.authors.join(', '), first_name: first, last_name: last,
      ean_isbn13: s(b.isbn13), upc_isbn10: s(b.isbn10), description: s(b.description), publisher: s(b.publisher),
      publish_date: s(b.publishedYear), group: b.collections.join(', '), tags: b.tags.join(', '), notes: s(b.notes),
      price: s(b.price), length: s(b.pageCount), number_of_discs: '', number_of_players: '', age_group: '', ensemble: '',
      aspect_ratio: '', esrb: '', rating: s(b.rating), review: '', review_date: '', status: LIBIB_STATUS[b.status],
      began: s(b.startedOn), completed: s(b.finishedOn), added: b.createdAt.slice(0, 10), copies: s(b.copies)
    };
    const extra: Record<(typeof EXTRA_COLUMNS)[number], string> = {
      subtitle: s(b.subtitle), format: s(b.format), language: s(b.language), original_language: s(b.originalLanguage),
      genres: b.genres.join(', '), subjects: (b.subjects ?? []).join(', '), series: s(b.series), series_number: s(b.seriesNumber),
      edition: s(b.edition), first_published: s(b.firstPublishedYear), location: path.map((l) => l.name).join(' › '),
      location_place: s(path[0]?.name), location_room: s(path[1]?.name), location_shelf: s(path[2]?.name),
      ownership: b.ownership, condition: s(b.condition), signed: b.signed ? 'yes' : '', purchase_date: s(b.purchasedOn),
      lent_to: s(b.lending?.to), lent_on: s(b.lending?.lentOn), due_on: s(b.lending?.dueOn),
      cover_url: b.cover?.startsWith('data:') ? '' : s(b.cover), written_place: s(b.writing?.place?.label),
      written_lat: s(b.writing?.place?.lat), written_lon: s(b.writing?.place?.lon)
    };
    return [...LIBIB_COLUMNS.map((c) => libib[c]), ...EXTRA_COLUMNS.map((c) => extra[c])];
  });
  return [header, ...rows];
}

import type { DnbHit } from './dnb';
import { mergeResults, type LookupDraft } from './lookup';

/** One volume of a multi-volume edition, as the DNB lists it. */
export interface SetVolume {
  hit: DnbHit;
  /** "8", "18a", "Abt. 5, Kriegsbücher"; undefined when the catalogue gives none. */
  number?: string;
  /** Part inside the volume ("T. 1"). */
  part?: string;
  title: string;
  year?: number;
}

/** A multi-volume edition (Gesamtausgabe, Werke…): one set title, author and publisher. */
export interface EditionSet {
  key: string;
  title: string;
  author?: string;
  publisher?: string;
  firstYear?: number;
  lastYear?: number;
  volumes: SetVolume[];
}

const fold = (s: string | undefined) => (s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** "Nymphenburger Verl.-Handl." and "Nymphenburger Verlagshandlung" are the same publisher. */
const publisherKey = (p: string | undefined) => fold(p).split(' ')[0] ?? '';
const surnameKey = (a: string | undefined) => fold(a).split(' ').pop() ?? '';

export function setKey(hit: DnbHit): string | undefined {
  if (!hit.set) return undefined;
  const f = hit.result.fields;
  return [fold(hit.set.title), surnameKey(f.authors?.[0]), publisherKey(f.publisher)].join('|');
}

/** Natural order of volume numbers: 1, 2, … 9, 10, 13, 13a, 14 …; unnumbered ones last. */
export function compareVolumeNumbers(a: string | undefined, b: string | undefined): number {
  const na = a?.match(/^(\d+)\s*([a-z]?)/i);
  const nb = b?.match(/^(\d+)\s*([a-z]?)/i);
  if (na && nb) return Number(na[1]) - Number(nb[1]) || na[2].localeCompare(nb[2]);
  if (na) return -1;
  if (nb) return 1;
  return (a ?? '￿').localeCompare(b ?? '￿', 'de', { numeric: true });
}

function compareVolumes(a: SetVolume, b: SetVolume): number {
  return compareVolumeNumbers(a.number, b.number) ||
    (a.part ?? '').localeCompare(b.part ?? '', 'de', { numeric: true }) ||
    a.title.localeCompare(b.title, 'de');
}

/**
 * Group search hits into editions. Records of the set as a whole (no volume number and titled like the set)
 * are left out; the same volume listed twice (e.g. a reprint) is shown once, the earliest.
 */
export function groupSets(hits: DnbHit[]): EditionSet[] {
  const sets = new Map<string, EditionSet>();
  for (const hit of hits) {
    const key = setKey(hit);
    if (!key || !hit.set) continue;
    const f = hit.result.fields;
    const title = f.title ?? '';
    if (!hit.set.number && fold(title) === fold(hit.set.title)) continue;
    let set = sets.get(key);
    if (!set) {
      set = { key, title: hit.set.title, author: f.authors?.[0], publisher: f.publisher, volumes: [] };
      sets.set(key, set);
    }
    const vol: SetVolume = { hit, number: hit.set.number, part: hit.set.part, title, year: f.publishedYear };
    const same = set.volumes.findIndex((v) => v.number === vol.number && fold(v.part) === fold(vol.part) && fold(v.title) === fold(vol.title));
    if (same >= 0) {
      if (vol.year && (!set.volumes[same].year || vol.year < set.volumes[same].year!)) set.volumes[same] = vol;
      continue;
    }
    set.volumes.push(vol);
  }
  for (const set of sets.values()) {
    set.volumes.sort(compareVolumes);
    const years = set.volumes.map((v) => v.year).filter((y): y is number => !!y);
    if (years.length) {
      set.firstYear = Math.min(...years);
      set.lastYear = Math.max(...years);
    }
    // The longest publisher spelling is usually the unabbreviated one.
    set.publisher = set.volumes.map((v) => v.hit.result.fields.publisher).filter(Boolean).sort((a, b) => b!.length - a!.length)[0] ?? set.publisher;
  }
  return [...sets.values()].sort((a, b) => b.volumes.length - a.volumes.length);
}

/** "Bd. 8", "Bd. 22, T. 1", "Abt. 5, Kriegsbücher" */
export function volumeLabel(v: Pick<SetVolume, 'number' | 'part'>): string {
  const n = v.number ? (/^\d/.test(v.number) ? `Bd. ${v.number}` : v.number) : '';
  return [n, v.part].filter(Boolean).join(', ');
}

/** "T. 1" → "1": the part of a volume, stored as the book's volume (to tell the parts apart). */
const partNumber = (part: string | undefined) => part?.match(/(\d+\w?)/)?.[1] ?? part;

/** Book details for one volume of a set: the DNB record, filed under the set's series name with its number. */
export function volumeDraft(v: SetVolume, seriesName: string): LookupDraft {
  const draft = mergeResults([v.hit.result]);
  draft.series = seriesName.trim() || undefined;
  draft.seriesNumber = v.number;
  draft.volume = partNumber(v.part);
  // Volumes of an old edition often share one ISBN (or the ISBN of the whole set): keep it, but it says little.
  return draft;
}

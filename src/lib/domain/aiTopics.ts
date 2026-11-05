import type { Book, Id } from './types';

/**
 * "Improve topics with AI": Booked writes a prompt listing your books, you paste it into any chat AI
 * (ChatGPT, Claude, Gemini…), and paste the answer back. Each book then gets a topic path, broad to
 * specific ("Fiction > Crime & mystery > Nordic noir"), which arranges and labels the cover wall.
 * No account or key is needed, and nothing is sent anywhere by Booked itself.
 */

/** Books per prompt: big libraries are done in parts, so each part fits a chat message. */
export const PART_SIZE = 300;

export type TopicLanguage = 'de' | 'en';

export interface PromptPart {
  /** Book ids by the number used in the prompt (1-based). */
  ids: Id[];
  text: string;
  part: number;
  parts: number;
}

const short = (s: string | undefined, max: number) => (s && s.length > max ? `${s.slice(0, max - 1)}…` : s ?? '');

function line(b: Book, n: number): string {
  const year = b.writing?.year ?? b.firstPublishedYear ?? b.publishedYear;
  const topics = [...(b.aiTopics?.length ? [b.aiTopics.join(' > ')] : []), ...b.genres, ...(b.subjects ?? [])].slice(0, 5);
  return [
    `${n}: ${short(b.title, 90)}`,
    b.authors.length ? short(b.authors.slice(0, 2).join(', '), 60) : undefined,
    year ? String(year) : undefined,
    b.series ? `series: ${short(b.series, 50)}` : undefined,
    topics.length ? `catalogue: ${short(topics.join('; '), 120)}` : undefined
  ].filter(Boolean).join(' | ');
}

/**
 * The prompt(s) for these books (numbered within each part). `vocabulary`: topic paths that exist
 * already ("Fiction > Crime & mystery"), offered to the AI to sort into; it may add new ones.
 */
export function aiTopicPrompts(books: Book[], lang: TopicLanguage, vocabulary: string[] = []): PromptPart[] {
  const parts = Math.max(1, Math.ceil(books.length / PART_SIZE));
  const out: PromptPart[] = [];
  for (let p = 0; p < parts; p++) {
    const chunk = books.slice(p * PART_SIZE, (p + 1) * PART_SIZE);
    const de = lang === 'de';
    const known = vocabulary.length
      ? [
          '',
          'Topics that already exist in my library (broad > specific). Sort books into these wherever they fit, using exactly these names. If a book really doesn\'t fit any of them, make a new topic (or a new sub-topic under an existing one) in the same style:',
          ...vocabulary.slice(0, 120).map((v) => `  ${v}`)
        ]
      : [];
    const text = [
      `I'm arranging my home library by topic${parts > 1 ? ` (part ${p + 1} of ${parts})` : ''}. For every book below, give a topic path from broad to specific, with 2 or 3 levels, for example:`,
      de ? '  12: Belletristik > Kriminalroman > Skandinavischer Krimi' : '  12: Fiction > Crime & mystery > Nordic noir',
      de ? '  13: Philosophie > Politische Philosophie' : '  13: Philosophy > Political philosophy',
      ...known,
      '',
      'Rules:',
      `- Write the topic names in ${de ? 'German' : 'English'}.`,
      '- Use one consistent set of about 8–15 broad topics for the whole library, and the same names every time (not "Krimi" once and "Kriminalroman" another time).',
      '- Books that belong together (same series, same author writing in the same field, similar subject) should get the same path.',
      '- Use what you know about each book and author. If you are not completely sure what a book is about, search the web for it (title and author) before deciding. The catalogue words are only hints and are often wrong or too general.',
      '- Answer only with the lines "number: path", one per book, nothing else. Keep the numbers as given.',
      '',
      'Books:',
      ...chunk.map((b, i) => line(b, i + 1))
    ].join('\n');
    out.push({ ids: chunk.map((b) => b.id), text, part: p + 1, parts });
  }
  return out;
}

/** Which books to ask about. */
export type AiScope = 'unsorted' | 'all' | 'none';

/**
 * - unsorted: books without topics of your own (from the AI or set by hand); the default
 * - all: every book (topics of your own get revised)
 * - none: only books with no topic at all (no own topic and no usable catalogue topic)
 */
export function booksFor(scope: AiScope, books: Book[], hasCatalogueTopic: (b: Book) => boolean): Book[] {
  if (scope === 'all') return books;
  if (scope === 'unsorted') return books.filter((b) => !b.aiTopics?.length);
  return books.filter((b) => !b.aiTopics?.length && !hasCatalogueTopic(b));
}

/** "A > B > C" ⇄ ["A", "B", "C"]. */
export const pathText = (p: string[] | undefined) => (p ?? []).join(' > ');
export function parsePath(text: string): string[] {
  return text.split(/\s*(?:>|›|→|»|\/)\s*/).map((t) => t.trim()).filter(Boolean).slice(0, 4);
}

export interface ParsedTopics {
  /** Book id → topic path (broad first). */
  paths: Map<Id, string[]>;
  /** Lines that couldn't be read (shown so you can check). */
  skipped: string[];
}

/**
 * Read the AI's answer: lines like "12: A > B > C" (also "12. A › B", "12) A / B", with or without
 * markdown bullets or bold). Numbers refer to the prompt part's `ids`.
 */
export function parseAiTopics(answer: string, ids: Id[]): ParsedTopics {
  const paths = new Map<Id, string[]>();
  const skipped: string[] = [];
  for (const raw of answer.split(/\r?\n/)) {
    const l = raw.replace(/\*\*/g, '').replace(/^[\s>*\-•`]+/, '').trim();
    if (!l) continue;
    const m = l.match(/^#?(\d{1,5})\s*[:.)\]–-]\s*(.+)$/);
    if (!m) {
      if (/^\d/.test(l)) skipped.push(raw.trim());
      continue;
    }
    const id = ids[Number(m[1]) - 1];
    const path = m[2]
      .replace(/`/g, '')
      .split(/\s*(?:>|›|→|»|\/|\|)\s*/)
      .map((t) => t.trim().replace(/^["'„“]|["'“”]$/g, '').replace(/[.;,]+$/, ''))
      .filter((t) => t && t.length <= 60)
      .slice(0, 4);
    if (!id || !path.length) {
      skipped.push(raw.trim());
      continue;
    }
    paths.set(id, path);
  }
  return { paths, skipped };
}

/** Broad topics in an answer with how many books each got (for the preview). */
export function topLevels(paths: Map<Id, string[]>): { name: string; count: number }[] {
  const n = new Map<string, number>();
  for (const p of paths.values()) n.set(p[0], (n.get(p[0]) ?? 0) + 1);
  return [...n.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

/** All topic names already in use (so later parts reuse them). */
export function aiVocabulary(books: Pick<Book, 'aiTopics'>[]): string[] {
  const n = new Map<string, number>();
  for (const b of books) for (const t of b.aiTopics ?? []) n.set(t, (n.get(t) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** One line of a typed or AI-written book list. */
export interface ListedBook {
  title: string;
  authors: string[];
  publisher?: string;
  year?: number;
  series?: string;
  seriesNumber?: string;
}

/** The request for a chat AI that reads book spines or title pages from photos. */
export const SHELF_PROMPT = `I'm attaching photos of my bookshelf (book spines) or of title pages. List every book you can read, one per line, exactly in this form:

Author | Title | Publisher | Year | Series or edition | Volume

Rules:
- One line per physical book (each volume of a multi-volume edition on its own line, with its volume number).
- Leave a field empty when it isn't visible (keep the | separators); don't guess years or publishers.
- Author as "First name Last name". Several authors separated by ";".
- No headings, numbering, explanations or code blocks: only the lines.`;

const clean = (s: string | undefined) => s?.replace(/\s+/g, ' ').trim() || undefined;

/** "Bd. 8", "Band 8", "Vol. 8", "8" → "8" */
function volume(s: string | undefined): string | undefined {
  const t = clean(s);
  return t?.match(/^(?:bd|band|vol|volume|nr|no|teil|t)\.?\s*(\S+)/i)?.[1] ?? t;
}

/**
 * Lines like "Author | Title | Publisher | Year | Series | Volume" (as the AI is asked to write them), or typed
 * by hand: "Theodor Fontane: Effi Briest", "Fontane – Der Stechlin (Nymphenburger 1959)", or just a title.
 */
export function parseBookList(text: string): ListedBook[] {
  const out: ListedBook[] = [];
  for (let raw of text.split(/\r?\n/)) {
    raw = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^`+|`+$/g, '').trim();
    if (!raw || /^author\s*\|/i.test(raw) || /^[-|\s]+$/.test(raw)) continue;
    if (raw.includes('|')) {
      const [a, t, p, y, s, v] = raw.split('|').map((x) => clean(x));
      if (!t) continue;
      out.push({
        title: t,
        authors: (a ?? '').split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean),
        publisher: p,
        year: y?.match(/\d{4}/) ? Number(y.match(/\d{4}/)![0]) : undefined,
        series: s,
        seriesNumber: volume(v)
      });
      continue;
    }
    // Free form: an optional "(Publisher Year)" or ", Year" at the end
    let rest = raw;
    let publisher: string | undefined;
    let year: number | undefined;
    const paren = rest.match(/\s*\(([^()]*)\)\s*$/);
    if (paren) {
      const inner = paren[1];
      const y = inner.match(/\b(1[5-9]\d\d|20\d\d)\b/);
      if (y) year = Number(y[1]);
      publisher = clean(inner.replace(/\b(1[5-9]\d\d|20\d\d)\b/, '').replace(/[,;]\s*$/, ''));
      rest = rest.slice(0, paren.index);
    } else {
      const y = rest.match(/,\s*(1[5-9]\d\d|20\d\d)\s*$/);
      if (y) {
        year = Number(y[1]);
        rest = rest.slice(0, y.index);
      }
    }
    const sep = rest.match(/^(.+?)\s*(?::|\s[–—-]\s)\s*(.+)$/);
    const title = clean(sep ? sep[2] : rest);
    if (!title) continue;
    out.push({ title, authors: sep ? [clean(sep[1])!] : [], publisher, year });
  }
  return out;
}

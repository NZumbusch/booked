import { fold } from '../domain/query';

/**
 * Topic tree for the cover wall: broad topics with sub-topics on several levels, worked out from
 * your own books. Topic B goes under topic A when most books about B are also about A and A is
 * broader (more books), e.g. Fiction › Crime & mystery › Police procedural. Your AI topics, if
 * set, give the path directly (broad first).
 */

/**
 * Catalogue words for the same thing (English and German, as they come from Open Library, Google
 * Books and the DNB), merged into one topic. Keys are folded (lower case, no accents).
 */
const SYNONYMS: [string, RegExp][] = [
  ['Fiction', /^(fiction|fiction,? general|general fiction|belletristik|roman(e)?|novels?|erzahlende literatur|fiction \/ general|modern fiction|modern (&|and) contemporary fiction.*|literary fiction|ficcion|fiktion|continental european fiction.*)$/],
  ['Literary criticism', /^(literary criticism|criticism and interpretation|literaturwissenschaft|literaturkritik|criticism)$/],
  ['Crime & mystery', /^(detective and mystery stories|detective fiction|crime fiction|crime|mystery|mystery fiction|mysteries|krimi(nalroman)?s?|kriminalliteratur|thriller(s)?|fiction,? mystery (and|&) detective.*|police procedural.*|fiction,? crime)$/],
  ['Romance', /^(romance|romance fiction|love stories|liebesroman(e)?|liebesgeschichten?|fiction,? romance.*)$/],
  ['Fantasy', /^(fantasy|fantasy fiction|fiction,? fantasy.*)$/],
  ['Science fiction', /^(science fiction|science-fiction|sf|fiction,? science fiction.*)$/],
  ['Historical fiction', /^(historical fiction|historischer roman|historische romane|fiction,? historical.*)$/],
  ["Children's & young adult", /^(juvenile fiction|juvenile literature|children'?s fiction|children'?s literature|children'?s stories|jugendbuch|kinderbuch|kinder- und jugendliteratur|young adult fiction)$/],
  ['Poetry', /^(poetry|poems|lyrik|gedichte)$/],
  ['Drama', /^(drama|plays|theater|theatre|schauspiel)$/],
  ['Essays', /^(essays?|essay)$/],
  ['Biography & memoir', /^(biography|biographies|biographie|autobiography|autobiographie|memoirs?|erinnerungen|erlebnisbericht|biography (&|and) autobiography.*)$/],
  ['History', /^(history|geschichte)$/],
  ['Philosophy', /^(philosophy|philosophie)$/],
  ['Short stories', /^(short stories|erzahlungen|kurzgeschichten|german short stories)$/]
];

/** Catalogue noise that never makes a good topic name. */
const NOISE = /^(general|literature|literary collections|language readers|german language materials|in literature|fiction in german|large type books|accessible book|protected daisy)$/;

/** The topic a catalogue word stands for: merged synonyms, or the word itself. */
export function canonicalTopic(label: string): { key: string; label: string } | undefined {
  const f = fold(label).replace(/\s+/g, ' ').trim();
  if (!f || NOISE.test(f)) return undefined;
  for (const [name, re] of SYNONYMS) if (re.test(f)) return { key: `t:${fold(name)}`, label: name };
  return { key: `t:${f}`, label };
}

export interface TopicTree {
  /** Broader topic of each topic (absent = a root). */
  parent: Map<string, string>;
  /** Each book's path from broad to specific (topic keys). */
  paths: string[][];
}

/**
 * `topics[i]`: the topic keys of book i (with their weights); `ai[i]`: the book's AI topic path, if any.
 * Topics on fewer than `minBooks` books take no part (too small to name a region).
 */
export function topicTree(topics: { key: string; w: number }[][], ai: string[][], minBooks = 3): TopicTree {
  const df = new Map<string, number>();
  for (const ts of topics) for (const t of ts) df.set(t.key, (df.get(t.key) ?? 0) + 1);
  const usable = (k: string) => (df.get(k) ?? 0) >= minBooks;
  const co = new Map<string, Map<string, number>>();
  for (const ts of topics) {
    const keys = [...new Set(ts.map((t) => t.key))].filter(usable);
    for (const a of keys) for (const b of keys) {
      if (a === b) continue;
      let m = co.get(b);
      if (!m) co.set(b, (m = new Map()));
      m.set(a, (m.get(a) ?? 0) + 1);
    }
  }
  // B under A: at least 60% of B's books also have A, and A is broader. The most specific such A wins.
  const parent = new Map<string, string>();
  for (const [b, m] of co) {
    const nb = df.get(b)!;
    let best: string | undefined;
    for (const [a, both] of m) {
      const na = df.get(a)!;
      if (na <= nb || both / nb < 0.6) continue;
      if (!best || na < df.get(best)! || (na === df.get(best)! && a < best)) best = a;
    }
    if (best) parent.set(b, best);
  }
  // AI paths add their own links (broad › specific), and win over the catalogue's.
  for (const path of ai) for (let k = 1; k < path.length; k++) if (path[k] !== path[k - 1]) parent.set(path[k], path[k - 1]);
  const chain = (k: string): string[] => {
    const out = [k];
    const seen = new Set(out);
    let p = parent.get(k);
    while (p && !seen.has(p) && out.length < 6) {
      out.unshift(p);
      seen.add(p);
      p = parent.get(p);
    }
    return out;
  };
  const paths = topics.map((ts, i) => {
    if (ai[i]?.length) return chain(ai[i][ai[i].length - 1]);
    // the book's most specific usable topic (deepest in the tree; then the strongest)
    let best: string[] = [];
    let bestW = -1;
    for (const t of ts) {
      if (!usable(t.key)) continue;
      const c = chain(t.key);
      if (c.length > best.length || (c.length === best.length && t.w > bestW)) {
        best = c;
        bestW = t.w;
      }
    }
    return best;
  });
  return { parent, paths };
}

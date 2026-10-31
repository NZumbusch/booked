import { writable, type Readable } from 'svelte/store';
import { fold } from '../domain/query';
import {
  bioLanguage, fetchAuthors, fetchWorks, findAuthorId, wikipediaSummary,
  type AuthorKnowledge, type WikiSummary, type WorkKnowledge
} from '../metadata/knowledge';
import type { Library } from './library';

const MAX_AGE = 30 * 24 * 3600 * 1000;

interface Cached<T> {
  at: number;
  value: T;
}

export interface KnowledgeState {
  works: Map<string, WorkKnowledge>;
  authors: Map<string, AuthorKnowledge>;
  busy: boolean;
  error?: string;
  /** Books with a Wikidata id (only those can be connected). */
  coverage: { known: number; total: number };
}

/**
 * Cached Wikidata knowledge about the library's works and authors (kept on the device, refreshed
 * after 30 days). Discover reads from here; only new or stale items are fetched.
 */
export class KnowledgeStore {
  private works = new Map<string, Cached<WorkKnowledge>>();
  private authors = new Map<string, Cached<AuthorKnowledge>>();
  private loaded: Promise<void>;
  private state$ = writable<KnowledgeState>({ works: new Map(), authors: new Map(), busy: false, coverage: { known: 0, total: 0 } });
  private running: Promise<void> | undefined;

  constructor(private lib: Library) {
    this.loaded = this.load();
  }

  get state(): Readable<KnowledgeState> {
    return this.state$;
  }

  private async load() {
    const w = (await this.lib.getMeta<Record<string, Cached<WorkKnowledge>>>('kn:works')) ?? {};
    const a = (await this.lib.getMeta<Record<string, Cached<AuthorKnowledge>>>('kn:authors')) ?? {};
    this.works = new Map(Object.entries(w));
    this.authors = new Map(Object.entries(a));
    this.publish();
  }

  private async save() {
    await this.lib.setMeta('kn:works', Object.fromEntries(this.works));
    await this.lib.setMeta('kn:authors', Object.fromEntries(this.authors));
  }

  private publish(patch: Partial<KnowledgeState> = {}) {
    const ids = this.lib.state.books.map((b) => b.identifiers?.wikidata).filter(Boolean);
    this.state$.update((s) => ({
      ...s,
      works: new Map([...this.works].map(([k, v]) => [k, v.value])),
      authors: new Map([...this.authors].map(([k, v]) => [k, v.value])),
      coverage: { known: ids.length, total: this.lib.state.books.length },
      ...patch
    }));
  }

  /** Fetch knowledge for works/authors that are new or stale. Safe to call often. */
  refresh(force = false): Promise<void> {
    this.running ??= this.doRefresh(force).finally(() => (this.running = undefined));
    return this.running;
  }

  private async doRefresh(force: boolean) {
    await this.loaded;
    const fresh = (c: Cached<unknown> | undefined) => !force && c && Date.now() - c.at < MAX_AGE;
    const workIds = [...new Set(this.lib.state.books.map((b) => b.identifiers?.wikidata).filter((x): x is string => !!x))];
    const missingWorks = workIds.filter((id) => !fresh(this.works.get(id)));
    if (!missingWorks.length) {
      const authorIds = [...new Set([...this.works.values()].flatMap((w) => w.value.authors.map((a) => a.id)))];
      if (authorIds.every((id) => fresh(this.authors.get(id)))) return;
    }
    this.publish({ busy: true, error: undefined });
    try {
      if (missingWorks.length) {
        for (const [id, w] of await fetchWorks(missingWorks)) this.works.set(id, { at: Date.now(), value: w });
      }
      const authorIds = [...new Set([...this.works.values()].flatMap((w) => w.value.authors.map((a) => a.id)))];
      const missingAuthors = authorIds.filter((id) => !fresh(this.authors.get(id)));
      if (missingAuthors.length) {
        const found = await fetchAuthors(missingAuthors);
        for (const id of missingAuthors) {
          // Remember "nothing known" too, so we don't ask again on every visit.
          const label = [...this.works.values()].flatMap((w) => w.value.authors).find((a) => a.id === id)?.label ?? id;
          const value = found.get(id) ?? { id, label, movements: [], influencedBy: [], influenced: [], notableWorks: [], languages: [], wikipedia: {} };
          this.authors.set(id, { at: Date.now(), value });
        }
      }
      await this.save();
      this.publish({ busy: false });
    } catch (e) {
      this.publish({ busy: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** An author by name: from the library's knowledge if known, else looked up on Wikidata. */
  async author(name: string): Promise<AuthorKnowledge | undefined> {
    await this.loaded;
    const known = [...this.authors.values()].find((a) => fold(a.value.label) === fold(name));
    if (known) return known.value;
    const id = (await this.lib.getMeta<string>(`kn:authorId:${fold(name)}`)) ?? (await findAuthorId(name));
    if (!id) return undefined;
    await this.lib.setMeta(`kn:authorId:${fold(name)}`, id);
    const cached = this.authors.get(id);
    if (cached && Date.now() - cached.at < MAX_AGE) return cached.value;
    const a = (await fetchAuthors([id])).get(id);
    if (a) {
      this.authors.set(id, { at: Date.now(), value: a });
      await this.save();
      this.publish();
    }
    return a;
  }

  /** Wikipedia intro for an author, in their language (German/English), cached on the device. */
  async bio(a: AuthorKnowledge): Promise<WikiSummary | undefined> {
    const lang = bioLanguage(a);
    if (!lang) return undefined;
    const key = `kn:bio:${a.id}:${lang}`;
    const cached = await this.lib.getMeta<Cached<WikiSummary>>(key);
    if (cached && Date.now() - cached.at < MAX_AGE) return cached.value;
    const s = await wikipediaSummary(lang, a.wikipedia[lang]);
    if (s) await this.lib.setMeta(key, { at: Date.now(), value: s });
    return s ?? cached?.value;
  }
}

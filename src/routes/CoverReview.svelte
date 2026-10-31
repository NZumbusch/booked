<script lang="ts">
  import { booksKeyOf } from '../lib/config';
  import { lookDistance, sampleImage } from '../lib/covers/cache';
  import { isCoverShape, looksLikePlaceholder, type CoverAnalysis } from '../lib/covers/colors';
  import { cleanTitle, displayTitle } from '../lib/domain/book';
  import { facet } from '../lib/domain/filters';
  import type { Book, Id } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { fileToCoverDataUrl } from '../lib/images';
  import { alternativeCovers, isbnCovers, type CoverOption } from '../lib/metadata/covers';
  import { dnbByIsbn } from '../lib/metadata/dnb';
  import { reviewQueue, type ReviewScope } from '../lib/services/coverReview';
  import { groupOf, LOOK_LIMIT, siblingLooks } from '../lib/services/seriesCovers';
  import { covers, library, toast } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  /** A guided pass over the books: for each one, its series, a suggested cover and similar alternatives. */
  const lib = library();
  const cache = covers();

  let scope = $state<ReviewScope>('missing');
  let queue = $state<Id[]>([]);
  let started = $state(false);
  let pos = $state(0);
  let changed = $state(0);

  const counts = $derived({
    missing: reviewQueue($lib.books, 'missing', (u) => cache.isBroken(u)).length,
    series: reviewQueue($lib.books, 'series').length,
    all: reviewQueue($lib.books, 'all').length
  });

  function start() {
    queue = reviewQueue(lib.state.books, scope, (u) => cache.isBroken(u)).map((b) => b.id);
    pos = 0;
    changed = 0;
    started = true;
  }

  const book = $derived(started && pos < queue.length ? $lib && lib.book(queue[pos]) : undefined);
  const finished = $derived(started && pos >= queue.length);

  // ---- the book's own details (edited here, saved with the cover)
  let title = $state('');
  let series = $state('');
  let number = $state('');
  let volume = $state('');
  const seriesNames = $derived(facet($lib.books, (b) => (b.series ? [b.series] : [])));

  // ---- cover options
  interface Option extends CoverOption {
    look?: CoverAnalysis;
    bad?: boolean;
  }
  let options = $state<Option[]>([]);
  let loading = $state(false);
  let error = $state('');
  let selected = $state<string>();
  /** Once you tap an option yourself, the selection stops following the suggestion. */
  let picked = $state(false);
  /** What was chosen in this walk-through, so later volumes can match it before it is saved on the device. */
  const chosenLooks = new Map<Id, CoverAnalysis>();
  let run = 0;

  /** The look of the rest of this book's series: saved covers plus the ones chosen in this walk-through. */
  function reference(b: Book): CoverAnalysis[] {
    const g = groupOf(b);
    const saved = siblingLooks(lib.state.books, b, (c) => cache.meta(c)?.analysis);
    const session = lib.state.books.filter((x) => x.id !== b.id && g && groupOf(x)?.key === g.key && chosenLooks.has(x.id)).map((x) => chosenLooks.get(x.id)!);
    return [...saved, ...session];
  }

  const refs = $derived(book ? $lib && reference(book) : []);
  const distance = (o: Option) => (o.look && refs.length ? Math.min(...refs.map((r) => lookDistance(o.look!, r))) : Infinity);
  const ranked = $derived(
    options
      .filter((o) => !o.bad)
      .map((o, i) => ({ o, i, d: distance(o) }))
      .sort((x, y) =>
        refs.length
          ? (x.o.sameEdition ? -1 : 0) - (y.o.sameEdition ? -1 : 0) || x.d - y.d || x.i - y.i
          : (x.o.sameEdition ? 0 : x.o.sameLanguage ? 1 : 2) - (y.o.sameEdition ? 0 : y.o.sameLanguage ? 1 : 2) || x.i - y.i
      )
  );
  const suggestion = $derived(ranked.find((r) => !refs.length || r.d <= LOOK_LIMIT || r.o.sameEdition)?.o);
  const suggestionWhy = $derived(
    !suggestion ? '' : suggestion.sameEdition ? 'Same edition (matching ISBN)' : refs.length && distance(suggestion) <= LOOK_LIMIT ? 'Looks like the rest of the series' : 'Best match'
  );
  const chosen = $derived(options.find((o) => o.url === selected));

  $effect(() => {
    const b = book;
    if (!b) return;
    title = b.title;
    series = b.series ?? '';
    number = b.seriesNumber ?? '';
    volume = b.volume ?? '';
    load(b);
  });

  async function load(b: Book) {
    const mine = ++run;
    loading = true;
    error = '';
    options = [];
    selected = undefined;
    picked = false;
    // 1. an unknown series can often be read from the German National Library
    if (!b.series && (b.isbn13 || b.isbn10)) {
      dnbByIsbn((b.isbn13 ?? b.isbn10)!, fetch.bind(globalThis))
        .then((r) => {
          if (mine !== run || !r) return;
          if (r.fields.series && !series) {
            series = r.fields.series;
            number ||= r.fields.seriesNumber ?? '';
          }
        })
        .catch(() => {});
    }
    // 2. candidate covers: by ISBN, and other editions of the work
    const { early, last } = await isbnCovers(b, fetch.bind(globalThis));
    const byIsbn: Option[] = [...early, ...last].map((u) => ({
      url: u, thumb: u, label: u.includes('openlibrary') ? 'Open Library (ISBN)' : u.includes('dnb.de') ? 'DNB (ISBN)' : 'Google Books (ISBN)',
      source: u.includes('openlibrary') ? 'openlibrary' : 'googlebooks', sameEdition: true
    }));
    try {
      const alt = await alternativeCovers(b, fetch.bind(globalThis), booksKeyOf(lib.state.settings));
      if (mine !== run) return;
      const seen = new Set<string>();
      options = [...byIsbn, ...alt].filter((o) => !seen.has(o.thumb) && seen.add(o.thumb));
    } catch {
      if (mine !== run) return;
      options = byIsbn;
      error = navigator.onLine ? 'The catalogues didn’t answer; showing what the ISBN gives.' : 'You’re offline.';
    }
    loading = false;
    // 3. colours of each candidate (a few at a time), to rank look-alikes first and drop blanks and scans
    let i = 0;
    const todo = options.slice(0, 60);
    const worker = async () => {
      while (i < todo.length && mine === run) {
        const o = todo[i++];
        try {
          const { analysis, w, h } = await sampleImage(o.thumb);
          if (mine !== run) return;
          const bad = !isCoverShape(w, h) || looksLikePlaceholder(analysis);
          options = options.map((x) => (x.thumb === o.thumb ? { ...x, look: analysis, bad } : x));
        } catch {
          // can't read its colours (no CORS, offline…): it stays unranked
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  // the selection follows the suggestion (it can change as colours come in) until the user picks something
  $effect(() => {
    if (!picked && suggestion && !loading) selected = suggestion.url;
  });

  const clean = (s: string) => s.trim() || undefined;

  async function save(useCover: boolean) {
    const b = book;
    if (!b) return;
    const patch: Partial<Book> = { title: title.trim() || b.title, series: clean(series), seriesNumber: clean(number), volume: clean(volume) };
    if (useCover && chosen) {
      patch.cover = chosen.url;
      if (chosen.look) chosenLooks.set(b.id, chosen.look);
    }
    const differs = (Object.keys(patch) as (keyof Book)[]).some((k) => patch[k] !== b[k]);
    if (differs) {
      try {
        await lib.updateBook(b.id, patch);
        changed++;
      } catch (e) {
        return toast(e instanceof Error ? e.message : String(e));
      }
    }
    next();
  }

  const next = () => (pos += 1);
  const back = () => (pos = Math.max(0, pos - 1));

  async function photo(e: Event & { currentTarget: HTMLInputElement }) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      const url = await fileToCoverDataUrl(file, 900);
      options = [{ url, thumb: url, label: 'Your photo', source: 'openlibrary', sameEdition: true }, ...options];
      selected = url;
      picked = true;
    } catch {
      toast('That image couldn’t be read');
    }
  }

  function stop() {
    cache.run().catch(() => {});
    started = false;
  }

  const seriesMates = $derived(book && groupOf(book) ? $lib.books.filter((x) => groupOf(x)?.key === groupOf(book!)!.key) : []);
</script>

<div class="page stack">
  <header class="spread">
    <div class="row">
      <a class="btn btn-ghost btn-icon" href="#/settings" aria-label="Back"><Icon name="back" /></a>
      <h1>Review covers</h1>
    </div>
    {#if started && !finished}<button class="btn-sm" onclick={stop}>Stop</button>{/if}
  </header>

  {#if !started}
    <section class="card stack">
      <h2>Go through your books one by one</h2>
      <p class="muted small">
        For each book you see its series, a suggested cover and similar alternatives. Volumes of a series come together, in order, and the
        suggestions look like the volumes you already chose.
      </p>
      <label class="choice"><input type="radio" bind:group={scope} value="missing" />
        <span><strong>Books without a cover</strong><br /><span class="muted small">{plural(counts.missing, 'book')}</span></span></label>
      <label class="choice"><input type="radio" bind:group={scope} value="series" />
        <span><strong>Books in a series</strong><br /><span class="muted small">{plural(counts.series, 'book')}: make a series look alike</span></span></label>
      <label class="choice"><input type="radio" bind:group={scope} value="all" />
        <span><strong>Every book</strong><br /><span class="muted small">{plural(counts.all, 'book')}</span></span></label>
      <button class="btn-primary big" disabled={!counts[scope]} onclick={start}>Start</button>
    </section>
  {:else if finished}
    <section class="card stack center">
      <h2>All done</h2>
      <p>{changed ? `${plural(changed, 'book')} updated.` : 'Nothing changed.'}</p>
      <div class="row center-row">
        <button onclick={stop}>Back to start</button>
        <a class="btn btn-primary" href="#/books">Library</a>
      </div>
    </section>
  {:else if book}
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax={queue.length} aria-valuenow={pos + 1}>
      <span style:width="{((pos + 1) / queue.length) * 100}%"></span>
    </div>
    <p class="muted small">{pos + 1} of {queue.length}</p>

    <section class="card stack">
      <div class="head">
        <div class="thumb"><Cover book={book} size="md" /></div>
        <div class="stack">
          <label class="field">Title<input bind:value={title} /></label>
          {#if cleanTitle(book.title) !== book.title}<p class="muted small">Shown as “{displayTitle({ title, volume })}”.</p>{/if}
          <p class="muted small">{book.authors.join(', ')}{book.isbn13 ? ` · ${book.isbn13}` : ''}</p>
        </div>
      </div>
      <div class="three">
        <label class="field">Series<input bind:value={series} list="rv-series" placeholder="none" /></label>
        <label class="field">No.<input bind:value={number} inputmode="numeric" /></label>
        <label class="field">Volume<input bind:value={volume} /></label>
      </div>
      <datalist id="rv-series">{#each seriesNames as s (s.value)}<option value={s.value}></option>{/each}</datalist>
      {#if book.line && !book.series}<p class="muted small">Publisher line: {book.line}</p>{/if}
      {#if seriesMates.length > 1}
        <div class="mates" aria-label="Other volumes of this series">
          {#each seriesMates.slice(0, 14) as m (m.id)}
            <span class="mate" class:me={m.id === book.id} title={displayTitle(m)}><Cover book={m} size="sm" /></span>
          {/each}
          {#if seriesMates.length > 14}<span class="muted small">+{seriesMates.length - 14}</span>{/if}
        </div>
      {/if}
    </section>

    <section class="card stack">
      <h2>Cover</h2>
      {#if loading}
        <p class="muted">Looking for covers…</p>
      {:else if !ranked.length}
        <p class="muted">No cover found. {error}</p>
      {:else}
        {#if chosen}
          <div class="pick">
            <img class="big-cover" src={chosen.thumb} alt="" />
            <div class="stack">
              <span class="badge">{chosen.url === suggestion?.url ? `Suggested · ${suggestionWhy}` : 'Your choice'}</span>
              <span class="muted small">{chosen.label}</span>
              {#if refs.length && chosen.look}<span class="muted small">{distance(chosen) <= LOOK_LIMIT ? 'Looks like the other volumes' : 'Different look from the other volumes'}</span>{/if}
            </div>
          </div>
        {/if}
        <p class="muted small">{ranked.length} options{refs.length ? ', most similar to the other volumes first' : ''}. Tap one to choose it.</p>
        <div class="grid">
          {#each ranked.slice(0, 36) as r (r.o.thumb)}
            <button class="opt" class:sel={r.o.url === selected} onclick={() => { selected = r.o.url; picked = true; }} aria-label={r.o.label}>
              <img src={r.o.thumb} alt="" loading="lazy" onerror={() => (options = options.map((x) => (x.thumb === r.o.thumb ? { ...x, bad: true } : x)))}
                onload={(e) => { const im = e.currentTarget as HTMLImageElement; if (!isCoverShape(im.naturalWidth, im.naturalHeight)) options = options.map((x) => (x.thumb === r.o.thumb ? { ...x, bad: true } : x)); }} />
            </button>
          {/each}
        </div>
      {/if}
      <label class="btn upload">📷 Use my own photo<input type="file" accept="image/*" onchange={photo} /></label>
    </section>

    <div class="actions">
      <button onclick={back} disabled={pos === 0}>Back</button>
      <button onclick={() => save(false)}>{book.cover ? 'Keep cover' : 'Skip cover'}</button>
      <button class="btn-primary" disabled={!chosen} onclick={() => save(true)}>
        {chosen && chosen.url === suggestion?.url ? 'Use suggestion' : 'Use this cover'}
      </button>
    </div>
  {/if}
</div>

<style>
  .big { min-height: 56px; }
  .choice { display: flex; gap: 12px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
  .choice input { width: 20px; min-height: 20px; }
  .center { text-align: center; }
  .center-row { justify-content: center; }
  .progress { height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
  .progress span { display: block; height: 100%; background: var(--brand); transition: width 0.2s; }
  .head { display: flex; gap: 14px; align-items: flex-start; }
  .head > .stack { flex: 1; min-width: 0; }
  /* The cover has no width of its own: give it a fixed one so the fields get the rest. */
  .thumb { flex: none; width: min(96px, 26vw); }
  .head .field input { width: 100%; min-width: 0; }
  .three { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .three label:first-child { grid-column: 1 / -1; }
  .mates { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .mate { border-radius: 6px; opacity: 0.8; }
  .mate.me { outline: 2px solid var(--brand); outline-offset: 2px; opacity: 1; }
  .pick { display: flex; gap: 14px; align-items: flex-start; }
  .big-cover { width: min(150px, 38vw); aspect-ratio: 2 / 3; object-fit: cover; border-radius: 6px; box-shadow: var(--shadow); }
  .badge { font-weight: 700; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 8px; }
  .opt { padding: 0; border: 2px solid transparent; border-radius: 8px; background: none; min-height: 0; overflow: hidden; }
  .opt.sel { border-color: var(--brand); }
  .opt img { display: block; width: 100%; aspect-ratio: 2 / 3; object-fit: cover; }
  .upload { position: relative; overflow: hidden; justify-self: start; }
  .upload input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .stack > * { min-width: 0; }
  .actions { position: sticky; bottom: calc(var(--nav-h) + 8px); display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1.4fr); gap: 8px; background: var(--bg, #fff); padding: 8px 0; }
  .actions button { min-width: 0; padding-inline: 12px; }
  p { margin: 0; }
</style>

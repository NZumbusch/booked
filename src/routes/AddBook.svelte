<script lang="ts">
  import { normalizeIsbn } from '../lib/domain/isbn';
  import { onWishlist, todayIso } from '../lib/domain/book';
  import { DEFAULT_LOAN_DAYS, lenders } from '../lib/domain/borrowing';
  import type { Book, BookDraft, ListPrice } from '../lib/domain/types';
  import { mergeResults, quickLookupIsbn, searchBooks, searchEditions, type LookupResult } from '../lib/metadata/lookup';
  import type { DnbHit } from '../lib/metadata/dnb';
  import { groupSets, setKey, volumeLabel, type EditionSet } from '../lib/metadata/dnbSets';
  import SetPicker from '../lib/ui/SetPicker.svelte';
  import BookList from '../lib/ui/BookList.svelte';
  import type { Candidate } from '../lib/metadata/types';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { feedback } from '../lib/scanner/camera';
  import { attempt, enricher, library } from '../lib/stores/app';
  import BookForm from '../lib/ui/BookForm.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Scanner from '../lib/ui/Scanner.svelte';

  type Mode = 'scan' | 'isbn' | 'search' | 'list';
  /** `wish`: adding to the wishlist (no room; not part of the library). */
  /** `borrow`: a book borrowed from a library or a friend (on your shelf, to give back by a date). */
  let { mode: initialMode = 'isbn', wish = false, borrow = false }: { mode?: Mode; wish?: boolean; borrow?: boolean } = $props();

  const lib = library();
  // svelte-ignore state_referenced_locally
  let mode = $state<Mode>(initialMode);
  let isbnInput = $state('');
  let isbnError = $state('');
  let busy = $state(''); // non-empty = what we're waiting for

  let searchInput = $state('');
  let hits = $state<Candidate[]>();
  let searchError = $state('');
  /** Editions from the German National Library: also books from before ISBNs. */
  let editions = $state.raw<DnbHit[]>();
  const sets = $derived(groupSets(editions ?? []));
  const bigSets = $derived(sets.filter((st) => st.volumes.length >= 2));
  /** A set of volumes being added from the checklist. */
  let chosenSet = $state.raw<EditionSet>();

  /** Form state: undefined = still choosing how to add. */
  let initial = $state<Partial<Book>>();
  let notice = $state<{ kind: 'found' | 'notfound' | 'error'; text: string }>();
  let formKey = $state(0);
  let retryIsbn = $state<string>();

  // Duplicate confirmation
  let dupOpen = $state(false);
  let dups = $state<Book[]>([]);
  let pendingDraft = $state.raw<BookDraft>();
  let pendingAfterLookup = $state<string>();
  /** ISBN the user already confirmed as "another copy", so the form doesn't ask again. */
  let confirmedIsbn = $state<string>();

  /** Prices read from the add-on barcode while scanning, by ISBN-13. */
  const scannedPrices = new Map<string, ListPrice>();

  const SOURCE_NAMES: Record<string, string> = { openlibrary: 'Open Library', googlebooks: 'Google Books', dnb: 'DNB', wikidata: 'Wikidata' };

  function openForm(prefill: Partial<Book>, result?: LookupResult) {
    initial = wish
      ? { locationId: null, status: 'unread', copies: 1, ...prefill, ownership: 'wishlist' }
      : borrow
        ? { locationId: $lib.settings.defaultLocationId, status: 'unread', copies: 1, ...prefill, ownership: 'borrowed' }
        : { locationId: $lib.settings.defaultLocationId, status: 'unread', ownership: 'owned', copies: 1, ...prefill };
    formKey++;
    const later = 'More details (description, genres, where it was written…) are added automatically after you save.';
    if (!result) notice = undefined;
    else if (result.status === 'found') {
      notice = { kind: 'found', text: `Found via ${(result.draft.sources ?? []).map((s) => SOURCE_NAMES[s] ?? s).join(', ')}. ${later}` };
    } else if (result.status === 'notfound') {
      notice = { kind: 'notfound', text: 'Nothing found right away. Fill in the title; the full catalogues are searched again after you save.' };
    } else {
      notice = { kind: 'error', text: 'The catalogues are slow or unreachable. Save now; details are fetched automatically once they answer.' };
    }
  }

  /** ISBN from scanner or keyboard: ask about duplicates first, then look up. */
  function handleIsbn(raw: string) {
    const isbn = normalizeIsbn(raw);
    if (!isbn) {
      isbnError = 'That doesn’t look like a valid ISBN (10 or 13 digits).';
      feedback('error');
      return;
    }
    isbnError = '';
    const existing = lib.duplicatesOf(isbn);
    if (existing.length) {
      feedback('ask');
      dups = existing;
      pendingAfterLookup = isbn.isbn13;
      pendingDraft = undefined;
      dupOpen = true;
      return;
    }
    if (mode === 'scan') feedback('ok');
    lookup(isbn.isbn13);
  }

  /** One quick request (≤3 s); everything else is filled in after saving. */
  async function lookup(isbn13: string) {
    busy = 'Looking up the book…';
    retryIsbn = isbn13;
    try {
      const result = await quickLookupIsbn(isbn13);
      const scanned = scannedPrices.get(isbn13);
      if (scanned && !result.draft.listPrice) result.draft.listPrice = scanned;
      openForm(result.draft as Partial<Book>, result);
    } finally {
      busy = '';
    }
  }

  async function search(e: SubmitEvent) {
    e.preventDefault();
    if (!searchInput.trim()) return;
    busy = 'Searching…';
    searchError = '';
    const q = searchInput.trim();
    const [works, eds] = await Promise.allSettled([searchBooks(q), searchEditions(q)]);
    hits = works.status === 'fulfilled' ? works.value : [];
    editions = eds.status === 'fulfilled' ? eds.value : [];
    if (works.status === 'rejected' && eds.status === 'rejected') {
      hits = undefined;
      editions = undefined;
      searchError = 'Couldn’t reach the online catalogues. Are you offline?';
    }
    busy = '';
  }

  /** A DNB edition: its own record (publisher, year, pages, series and volume) goes straight into the form. */
  function pickEdition(hit: DnbHit) {
    const draft = mergeResults([hit.result]);
    openForm(draft as Partial<Book>, { status: 'found', draft, warnings: [] });
  }

  /** The set a single hit belongs to (to add its other volumes too). */
  function setOf(hit: DnbHit): EditionSet | undefined {
    const key = setKey(hit);
    return key ? sets.find((s) => s.key === key) : undefined;
  }

  function setsAdded(added: Book[]) {
    chosenSet = undefined;
    if (added.length === 1) navigate(`/book/${added[0].id}`);
    else navigate(wish ? '/wishlist' : '/books');
  }

  /** Open the form right away with what the search hit already has; details follow after saving. */
  function pick(c: Candidate) {
    const draft = c.gb
      ? mergeResults([c.gb])
      : {
          title: c.title, subtitle: c.subtitle, authors: c.authors, firstPublishedYear: c.year,
          cover: c.cover?.replace('-M.jpg', '-L.jpg'), identifiers: c.olWorkId ? { olwork: c.olWorkId } : undefined,
          sources: [c.source], provenance: { title: { source: c.source } }
        };
    openForm(draft as Partial<Book>, { status: 'found', draft, warnings: [] });
  }

  /** "Save & next volume": the form opens again with what volumes of one set share. */
  let next = false;
  async function submitNext(draft: BookDraft) {
    next = true;
    await submit(draft);
  }

  async function submit(draft: BookDraft) {
    const existing = draft.isbn13 || draft.isbn10 ? lib.duplicatesOf(draft) : lib.likelySame(draft);
    const confirmed = !!confirmedIsbn && normalizeIsbn(draft.isbn13 ?? draft.isbn10 ?? '')?.isbn13 === confirmedIsbn;
    if (existing.length && !confirmed) {
      dups = existing;
      pendingDraft = draft;
      pendingAfterLookup = undefined;
      dupOpen = true;
      return;
    }
    await add(draft);
  }

  async function add(draft: BookDraft) {
    const andNext = next;
    next = false;
    // Everything gets completed in the background: by ISBN, or (old books) by its DNB record and the work's title and author.
    const pendingLookup = !!(draft.isbn13 || draft.isbn10 || draft.identifiers?.olwork || draft.identifiers?.dnb || draft.title.trim()) || undefined;
    const scanned = draft.isbn13 ? scannedPrices.get(draft.isbn13) : undefined;
    if (scanned && !draft.listPrice) draft = { ...draft, listPrice: scanned };
    const toWishlist = draft.ownership === 'wishlist';
    const book = await attempt(() => lib.addBook({ ...draft, pendingLookup }),
      toWishlist ? `“${draft.title}” is on your wishlist` : `Added “${draft.title}”`, { undo: true });
    if (!book) return;
    if (pendingLookup) enricher().enqueue(book.id);
    if (andNext) {
      openForm(nextVolume(book));
      window.scrollTo?.({ top: 0 });
    }
    else navigate(toWishlist && wish ? '/wishlist' : `/book/${book.id}`);
  }

  /** "12" → "13", "Bd. 4" → "Bd. 5", "18a" → "19"; anything else stays empty. */
  function bump(n: string | undefined): string | undefined {
    const m = n?.match(/^(.*?)(\d+)\D*$/);
    return m ? `${m[1]}${Number(m[2]) + 1}` : undefined;
  }

  /** What the next volume of the same set shares with this one; title, pages and contents are new. */
  function nextVolume(b: Book): Partial<Book> {
    return {
      authors: b.authors, publisher: b.publisher, publishedYear: b.publishedYear, format: b.format, language: b.language,
      edition: b.edition, series: b.series, line: b.line, locationId: b.locationId, ownership: b.ownership, status: b.status,
      tags: b.tags, collections: b.collections, condition: b.condition, borrowed: b.borrowed,
      cover: b.cover?.startsWith('photo:') ? b.cover : undefined,
      seriesNumber: b.series ? bump(b.seriesNumber) : undefined,
      volume: b.volume ? bump(b.volume) : undefined
    };
  }

  /** The user confirmed it's really another copy: always a separate entry. */
  async function confirmCopy() {
    dupOpen = false;
    if (pendingDraft) await add(pendingDraft);
    else if (pendingAfterLookup) {
      confirmedIsbn = pendingAfterLookup;
      await lookup(pendingAfterLookup);
    }
  }

  /** The scanned book was on the wishlist: it's bought now, so it moves into the library (no second entry). */
  const wished = $derived(wish ? undefined : dups.find(onWishlist));
  async function boughtWished() {
    const b = wished;
    dupOpen = false;
    if (!b) return;
    const where = $lib.settings.defaultLocationId ?? null;
    const done = await attempt(() => lib.updateBook(b.id, { ownership: 'owned', locationId: where, purchasedOn: b.purchasedOn ?? todayIso() }),
      `“${b.title}” moved from your wishlist into ${lib.label(where)}`, { undo: true });
    if (done) navigate(`/book/${b.id}`);
  }

  function cancelDup() {
    dupOpen = false;
    next = false;
    isbnInput = '';
  }

  function backToStart() {
    initial = undefined;
    notice = undefined;
  }
</script>

<div class="page stack">
  <header class="spread">
    <div class="row">
      {#if initial || chosenSet}
        <button class="btn-ghost btn-icon" aria-label="Back" onclick={() => { backToStart(); chosenSet = undefined; }}><Icon name="back" /></button>
      {/if}
      <h1>{wish ? 'Add to your wishlist' : borrow ? 'Add a borrowed book' : 'Add a book'}</h1>
    </div>
    {#if !initial && !wish && !borrow}<a class="btn btn-sm" href="#/scan"><Icon name="scan" size={18} /> Batch scan</a>{/if}
  </header>

  {#if busy}
    <div class="card busy" role="status"><span class="spinner"></span>{busy}</div>
  {:else if chosenSet}
    <SetPicker set={chosenSet} ownership={wish ? 'wishlist' : borrow ? 'borrowed' : 'owned'} ondone={setsAdded} />
  {:else if !initial}
    <div class="seg" role="tablist" aria-label="How to add">
      {#each [['scan', 'Scan'], ['isbn', 'ISBN'], ['search', 'Title / author'], ['list', 'List']] as [m, label]}
        <button role="tab" aria-selected={mode === m} class:on={mode === m} onclick={() => (mode = m as Mode)}>{label}</button>
      {/each}
    </div>

    {#if mode === 'scan'}
      <Scanner onscan={handleIsbn} onprice={(isbn, price) => scannedPrices.set(isbn, price)} paused={dupOpen} />
      <p class="muted small center">Point the camera at the barcode on the back cover.</p>
    {/if}

    {#if mode === 'scan' || mode === 'isbn'}
      <form class="card stack" onsubmit={(e) => { e.preventDefault(); handleIsbn(isbnInput); }}>
        <label class="field">{mode === 'scan' ? 'Or type the ISBN' : 'ISBN'}
          <input bind:value={isbnInput} inputmode="numeric" autocomplete="off" placeholder="978…" aria-invalid={!!isbnError} />
        </label>
        {#if isbnError}<p class="error small">{isbnError}</p>{/if}
        <button class="btn-primary" type="submit" disabled={!isbnInput.trim()}>Look up</button>
      </form>
    {:else if mode === 'search'}
      <form class="search" role="search" onsubmit={search}>
        <Icon name="search" />
        <input type="search" bind:value={searchInput} placeholder="e.g. Steppenwolf Hesse, Fontane Nymphenburger" aria-label="Title or author" />
        <button class="btn-sm btn-primary" type="submit" disabled={!searchInput.trim()}>Search</button>
      </form>
      {#if searchError}<p class="error small">{searchError}</p>{/if}
      {#if bigSets.length}
        <h3 class="sec">Editions in several volumes</h3>
        <ul class="hits">
          {#each bigSets.slice(0, 4) as st (st.key)}
            <li>
              <button class="hit set" onclick={() => (chosenSet = st)}>
                <span class="stackicon" aria-hidden="true">📚</span>
                <span class="hit-text">
                  <strong>{st.title}</strong>
                  <span class="muted small">{[st.author, st.publisher, st.firstYear].filter(Boolean).join(' · ')}</span>
                  <span class="small">{plural(st.volumes.length, 'volume')} found · tick the ones you have →</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      {#if editions?.length}
        <h3 class="sec">Editions <span class="muted small">(Deutsche Nationalbibliothek: publisher, year, also without ISBN)</span></h3>
        <ul class="hits">
          {#each editions.slice(0, 12) as e (e.result.url ?? e.result.fields.title)}
            {@const f = e.result.fields}
            {@const st = setOf(e)}
            <li class="ed">
              <button class="hit" onclick={() => pickEdition(e)}>
                <span class="hit-text">
                  <strong>{f.title}</strong>
                  <span class="muted small">{[(f.authors ?? []).join(', '), f.publisher, f.publishedYear].filter(Boolean).join(' · ')}</span>
                  {#if e.set}<span class="small">{e.set.title}{volumeLabel(e.set) ? `, ${volumeLabel(e.set)}` : ''}</span>{/if}
                </span>
              </button>
              {#if st}<button class="btn-sm" onclick={() => (chosenSet = st)}>Whole set</button>{/if}
            </li>
          {/each}
        </ul>
      {/if}
      {#if hits}
        {#if hits.length === 0 && !editions?.length}
          <p class="muted center">No matches. Try fewer words, or add it by hand.</p>
        {:else if hits.length}
          {#if editions?.length}<h3 class="sec">Works <span class="muted small">(Open Library)</span></h3>{/if}
          <ul class="hits">
            {#each hits as hit (hit.key)}
              <li>
                <button class="hit" onclick={() => pick(hit)}>
                  <Cover book={{ title: hit.title, authors: hit.authors, cover: hit.cover }} size="sm" />
                  <span class="hit-text">
                    <strong>{hit.title}</strong>
                    <span class="muted small">{hit.authors.join(', ')}{hit.year ? ` · ${hit.year}` : ''}{hit.editionCount ? ` · ${plural(hit.editionCount, 'edition')}` : ''}</span>
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {:else if mode === 'list'}
      <BookList {wish} {borrow} />
    {/if}

    <button class="ghost-link" onclick={() => openForm({})}><Icon name="edit" size={18} /> Enter everything by hand</button>
  {:else}
    {#if notice}
      <div class="card notice {notice.kind}">
        <span>{notice.text}</span>
        {#if notice.kind === 'error' && retryIsbn}<button class="btn-sm" onclick={() => lookup(retryIsbn!)}>Retry</button>{/if}
      </div>
    {/if}
    {#key formKey}
      <BookForm {initial} locations={$lib.locations} loanDays={$lib.settings.loanDays ?? DEFAULT_LOAN_DAYS} lenderNames={lenders($lib.books)}
        submitLabel={initial.ownership === 'wishlist' ? 'Add to wishlist' : initial.ownership === 'borrowed' ? 'Add as borrowed' : 'Add to library'} onsubmit={submit}
        onsubmitnext={initial.isbn13 || initial.isbn10 ? undefined : submitNext} />
    {/key}
  {/if}
</div>

<Dialog bind:open={dupOpen} title={wished ? 'On your wishlist' : wish ? 'Already yours?' : 'Another copy?'}>
  {#if wished}
    <p><strong>{wished.title}</strong> is on your wishlist. Did you buy it?</p>
    <p class="muted small">It moves into your library ({lib.label($lib.settings.defaultLocationId ?? null)}) with everything it already has.</p>
  {:else}
    <p>{wish ? 'This book is already in your books:' : `You already have ${dups.length === 1 ? 'a copy' : `${dups.length} copies`} of this book:`}</p>
    <ul class="dups">
      {#each dups as d (d.id)}
        <li><strong>{d.title}</strong> <span class="muted small">· {onWishlist(d) ? 'on your wishlist' : lib.label(d.locationId)}</span></li>
      {/each}
    </ul>
    {#if !wish}<p class="muted small">Is this really another copy, or the same book scanned twice?</p>{/if}
  {/if}
  {#snippet actions()}
    {#if wished}
      <button onclick={cancelDup}>Cancel</button>
      <button onclick={confirmCopy}>Add separately</button>
      <button class="btn-primary" onclick={boughtWished}>🛍️ Bought it</button>
    {:else}
      <button onclick={cancelDup}>{wish ? 'Cancel' : 'Same book, cancel'}</button>
      <button class="btn-primary" onclick={confirmCopy}>{wish ? 'Add to wishlist anyway' : 'Add another copy'}</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .seg { display: grid; grid-template-columns: repeat(4, auto); background: var(--surface-2); border-radius: 999px; padding: 4px; gap: 4px; }
  .seg button { border: none; background: transparent; min-height: 44px; padding: 0 8px; }
  .seg button.on { background: var(--surface); box-shadow: var(--shadow); font-weight: 600; }
  .center { text-align: center; margin: 0; }
  .error { color: var(--danger); margin: 0; }
  .search { display: flex; align-items: center; gap: 8px; padding: 0 6px 0 14px; background: var(--surface); border-radius: 999px; box-shadow: var(--shadow); color: var(--muted); }
  .search input { border: none; background: transparent; padding-left: 0; }
  .search input:focus-visible { outline: none; }
  .hits { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .hit { width: 100%; justify-content: flex-start; text-align: left; border-radius: var(--radius); padding: 8px 12px; min-height: 72px; white-space: normal; }
  .hit-text { display: grid; gap: 2px; }
  .ghost-link { background: transparent; border: none; color: var(--muted); }
  .busy { display: flex; align-items: center; gap: 12px; justify-content: center; min-height: 120px; }
  .spinner { width: 22px; height: 22px; border-radius: 50%; border: 3px solid var(--line); border-top-color: var(--brand); animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .notice { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  .notice.found { background: color-mix(in srgb, var(--ok) 12%, var(--surface)); }
  .notice.notfound { background: color-mix(in srgb, var(--warn) 12%, var(--surface)); }
  .notice.error { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); }
  .dups { margin: 0; padding-left: 20px; }
  .sec { margin: 8px 0 0; font-size: 1rem; }
  .ed { display: flex; gap: 8px; align-items: center; }
  .ed .hit { flex: 1; min-height: 56px; }
  .stackicon { font-size: 2rem; width: 48px; text-align: center; }
</style>

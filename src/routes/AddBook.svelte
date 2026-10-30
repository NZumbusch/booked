<script lang="ts">
  import { normalizeIsbn } from '../lib/domain/isbn';
  import type { Book, BookDraft } from '../lib/domain/types';
  import { lookupCandidate, lookupIsbn, searchBooks, type LookupResult } from '../lib/metadata/lookup';
  import type { Candidate } from '../lib/metadata/types';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { feedback } from '../lib/scanner/camera';
  import { attempt, library } from '../lib/stores/app';
  import BookForm from '../lib/ui/BookForm.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import Scanner from '../lib/ui/Scanner.svelte';

  type Mode = 'scan' | 'isbn' | 'search';
  let { mode: initialMode = 'isbn' }: { mode?: Mode } = $props();

  const lib = library();
  // svelte-ignore state_referenced_locally
  let mode = $state<Mode>(initialMode);
  let isbnInput = $state('');
  let isbnError = $state('');
  let busy = $state(''); // non-empty = what we're waiting for

  let searchInput = $state('');
  let hits = $state<Candidate[]>();
  let searchError = $state('');

  /** Form state: undefined = still choosing how to add. */
  let initial = $state<Partial<Book>>();
  let notice = $state<{ kind: 'found' | 'notfound' | 'error'; text: string }>();
  let formKey = $state(0);
  let retryIsbn = $state<string>();

  // Duplicate confirmation
  let dupOpen = $state(false);
  let dups = $state<Book[]>([]);
  let pendingDraft = $state<BookDraft>();
  let pendingAfterLookup = $state<string>();
  /** ISBN the user already confirmed as "another copy", so the form doesn't ask again. */
  let confirmedIsbn = $state<string>();

  const SOURCE_NAMES: Record<string, string> = { openlibrary: 'Open Library', googlebooks: 'Google Books', wikidata: 'Wikidata' };

  function openForm(prefill: Partial<Book>, result?: LookupResult) {
    initial = { locationId: $lib.settings.defaultLocationId, status: 'unread', ownership: 'owned', copies: 1, ...prefill };
    formKey++;
    if (!result) notice = undefined;
    else if (result.status === 'found') {
      notice = { kind: 'found', text: `Filled in from ${(result.draft.sources ?? []).map((s) => SOURCE_NAMES[s] ?? s).join(', ')}. Check and adjust anything.` };
    } else if (result.status === 'notfound') {
      notice = { kind: 'notfound', text: 'Nothing found online for this ISBN. Fill in what you know.' };
    } else {
      notice = { kind: 'error', text: 'Couldn’t reach the online catalogues (offline?). Fill in by hand or try again.' };
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

  async function lookup(isbn13: string) {
    busy = 'Looking up the book…';
    retryIsbn = isbn13;
    try {
      const result = await lookupIsbn(isbn13);
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
    try {
      hits = await searchBooks(searchInput.trim());
    } catch {
      hits = undefined;
      searchError = 'Couldn’t reach the online catalogues. Are you offline?';
    } finally {
      busy = '';
    }
  }

  async function pick(c: Candidate) {
    busy = 'Fetching details…';
    try {
      const result = await lookupCandidate(c);
      openForm(result.draft as Partial<Book>, result);
    } finally {
      busy = '';
    }
  }

  async function submit(draft: BookDraft) {
    const existing = lib.duplicatesOf(draft);
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
    const book = await attempt(() => lib.addBook(draft), `Added “${draft.title}”`, { undo: true });
    if (book) navigate(`/book/${book.id}`);
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

  function cancelDup() {
    dupOpen = false;
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
      {#if initial}
        <button class="btn-ghost btn-icon" aria-label="Back" onclick={backToStart}><Icon name="back" /></button>
      {/if}
      <h1>Add a book</h1>
    </div>
    {#if !initial}<a class="btn btn-sm" href="#/scan"><Icon name="scan" size={18} /> Batch scan</a>{/if}
  </header>

  {#if busy}
    <div class="card busy" role="status"><span class="spinner"></span>{busy}</div>
  {:else if !initial}
    <div class="seg" role="tablist" aria-label="How to add">
      {#each [['scan', 'Scan'], ['isbn', 'ISBN'], ['search', 'Title / author']] as [m, label]}
        <button role="tab" aria-selected={mode === m} class:on={mode === m} onclick={() => (mode = m as Mode)}>{label}</button>
      {/each}
    </div>

    {#if mode === 'scan'}
      <Scanner onscan={handleIsbn} paused={dupOpen} />
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
        <input type="search" bind:value={searchInput} placeholder="e.g. Steppenwolf Hesse" aria-label="Title or author" />
        <button class="btn-sm btn-primary" type="submit" disabled={!searchInput.trim()}>Search</button>
      </form>
      {#if searchError}<p class="error small">{searchError}</p>{/if}
      {#if hits}
        {#if hits.length === 0}
          <p class="muted center">No matches. Try fewer words, or add it by hand.</p>
        {:else}
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
      <BookForm {initial} locations={$lib.locations} submitLabel="Add to library" onsubmit={submit} />
    {/key}
  {/if}
</div>

<Dialog bind:open={dupOpen} title="Another copy?">
  <p>You already have {dups.length === 1 ? 'a copy' : `${dups.length} copies`} of this ISBN:</p>
  <ul class="dups">
    {#each dups as d (d.id)}
      <li><strong>{d.title}</strong> <span class="muted small">· {lib.label(d.locationId)}</span></li>
    {/each}
  </ul>
  <p class="muted small">Is this really another copy, or the same book scanned twice?</p>
  {#snippet actions()}
    <button onclick={cancelDup}>Same book, cancel</button>
    <button class="btn-primary" onclick={confirmCopy}>Add another copy</button>
  {/snippet}
</Dialog>

<style>
  .seg { display: grid; grid-template-columns: repeat(3, 1fr); background: var(--surface-2); border-radius: 999px; padding: 4px; gap: 4px; }
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
</style>

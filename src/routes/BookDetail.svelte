<script lang="ts">
  import { filterToQuery, type BookFilter } from '../lib/domain/filters';
  import { borrowers, copyDraft, fillMissing, isOverdue, lendingFrom, todayIso } from '../lib/domain/book';
  import type { BookDraft, MoveRecord, PlaceBasis, ReadingStatus } from '../lib/domain/types';
  import { lookupIsbn, searchBooks, lookupCandidate } from '../lib/metadata/lookup';
  import { FORMAT_LABEL, STATUS_LABEL, formatDate, formatPrice, languageName } from '../lib/format';
  import { navigate } from '../lib/router';
  import { attempt, enricher, library, toast } from '../lib/stores/app';
  import BookForm from '../lib/ui/BookForm.svelte';
  import Confirm from '../lib/ui/Confirm.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';
  import Rating from '../lib/ui/Rating.svelte';
  import SourceInfo from '../lib/ui/SourceInfo.svelte';

  let { id, edit = false }: { id: string; edit?: boolean } = $props();

  const lib = library();
  const book = $derived($lib && lib.book(id));
  const s = $derived($lib.settings);
  const fetchingIds = enricher().pending;

  let moves = $state<MoveRecord[]>([]);
  let moveOpen = $state(false);
  let moveTarget = $state<string | null>(null);
  let deleteOpen = $state(false);

  $effect(() => {
    if (book) lib.history(book.id).then((h) => (moves = h));
  });

  async function save(draft: BookDraft) {
    if (await attempt(() => lib.updateBook(id, draft), 'Saved', { undo: true })) navigate(`/book/${id}`, {}, true);
  }

  async function quick(patch: Partial<BookDraft>) {
    await attempt(() => lib.updateBook(id, patch));
  }

  function openMove() {
    moveTarget = book?.locationId ?? null;
    moveOpen = true;
  }

  async function doMove() {
    moveOpen = false;
    await attempt(() => lib.moveBooks([id], moveTarget), `Moved to ${lib.label(moveTarget)}`, { undo: true });
  }

  let fetching = $state(false);

  // Inline notes editing
  let notesEditing = $state(false);
  let notesDraft = $state('');
  async function saveNotes() {
    notesEditing = false;
    if ((notesDraft.trim() || undefined) === book?.notes) return; // unchanged: no edit, no undo entry, no sync
    await attempt(() => lib.updateBook(id, { notes: notesDraft.trim() || undefined }), 'Notes saved', { undo: true });
  }

  /** Another physical copy: separate entry, same book data, goes to the default location. */
  async function addCopy() {
    if (!book) return;
    const copy = await attempt(() => lib.addBook(copyDraft(book!)), `Added another copy of “${book.title}”`, { undo: true });
    if (copy) navigate(`/book/${copy.id}`);
  }

  // Quick lend
  let lendOpen = $state(false);
  let lendTo = $state('');
  let lendDue = $state('');
  const knownBorrowers = $derived(lendOpen ? borrowers($lib.books) : []);
  async function lend() {
    lendOpen = false;
    await attempt(() => lib.updateBook(id, { lending: lendingFrom(lendTo, lendDue) }), `Lent to ${lendTo.trim()}`, { undo: true });
  }

  /** Fill empty fields from online sources; never overwrites what's there. */
  async function fetchDetails() {
    if (!book) return;
    fetching = true;
    try {
      let result;
      if (book.isbn13 || book.isbn10) result = await lookupIsbn(book.isbn13 ?? book.isbn10!);
      else {
        const hit = (await searchBooks(`${book.title} ${book.authors[0] ?? ''}`.trim()))[0];
        result = hit ? await lookupCandidate(hit) : undefined;
      }
      if (!result || result.status === 'notfound') return toast('Nothing found online');
      if (result.status === 'error') return toast('Couldn’t reach the online catalogues');
      const patch = fillMissing(book, result.draft);
      if (!Object.keys(patch).length) return toast('Nothing new found, all details are already filled in');
      await attempt(() => lib.updateBook(id, patch), `Added ${Object.keys(patch).filter((k) => k !== 'provenance' && k !== 'sources').length} details`, { undo: true });
    } catch {
      toast('Couldn’t reach the online catalogues');
    } finally {
      fetching = false;
    }
  }

  const filterLink = (f: BookFilter) => `#/books?${new URLSearchParams(filterToQuery(f))}`;

  const BASIS: Record<PlaceBasis, string> = {
    written: 'where it was written', published: 'place of first publication', author: 'author’s home town', country: 'country of publication'
  };

  async function doDelete() {
    const title = book?.title;
    if (await attempt(() => lib.deleteBooks([id]).then(() => true), `Deleted “${title}”`, { undo: true })) navigate('/books');
  }

  const written = $derived.by(() => {
    const w = book?.writing;
    if (!w || (!w.year && !w.place)) return undefined;
    const year = w.year ? `${w.year}${w.yearEnd ? `–${w.yearEnd}` : ''}` : '';
    const place = w.place?.label ? `${w.place.label}${w.placeBasis && w.placeBasis !== 'written' ? ` (${BASIS[w.placeBasis]})` : ''}` : '';
    return [year, place].filter(Boolean).join(' · ');
  });

  // [label, value, field key for provenance]
  const facts = $derived(book ? ([
    ['Written', written, 'writing'],
    ['First published', book.firstPublishedYear, 'firstPublishedYear'],
    ['Original language', languageName(book.originalLanguage), 'originalLanguage'],
    ['Publisher', book.publisher, 'publisher'],
    ['This edition', book.publishedYear, 'publishedYear'],
    ['Edition', book.edition, 'edition'],
    ['Format', book.format && FORMAT_LABEL[book.format], 'format'],
    ['Pages', book.pageCount, 'pageCount'],
    ['Language', languageName(book.language), 'language'],
    ['Series', book.series && `${book.series}${book.seriesNumber ? ` #${book.seriesNumber}` : ''}`, 'series'],
    ['ISBN-13', book.isbn13, ''],
    ['ISBN-10', book.isbn10, ''],
    ['Contributors', book.contributors?.join(', '), 'contributors'],
    ['Genres', book.genres.join(', '), 'genres'],
    ['Subjects', book.subjects?.join(', '), 'subjects']
  ] as const).filter(([, v]) => v !== undefined && v !== '') : []);

  const links = $derived(book?.identifiers ? ([
    ['Open Library', book.identifiers.olid ? `https://openlibrary.org/books/${book.identifiers.olid}` : book.identifiers.olwork && `https://openlibrary.org/works/${book.identifiers.olwork}`],
    ['Google Books', book.identifiers.gbid && `https://books.google.com/books?id=${book.identifiers.gbid}`],
    ['Wikidata', book.identifiers.wikidata && `https://www.wikidata.org/wiki/${book.identifiers.wikidata}`]
  ] as const).filter(([, url]) => url) : []);

  const mine = $derived(book ? ([
    ['Collections', book.collections.join(', ')],
    ['Started', formatDate(book.startedOn, s.dateFormat)],
    ['Finished', formatDate(book.finishedOn, s.dateFormat)],
    ['Condition', book.condition],
    ['Copies', book.copies > 1 ? book.copies : ''],
    ['Signed', book.signed ? 'Yes' : ''],
    ['Purchased', formatDate(book.purchasedOn, s.dateFormat)],
    ['Price', formatPrice(book.price, s.currency)],
    ['Added', `${formatDate(book.createdAt, s.dateFormat)}${book.addedBy ? ` by ${book.addedBy}` : ''}`],
    ['Last modified', formatDate(book.updatedAt, s.dateFormat)]
  ] as const).filter(([, v]) => v !== undefined && v !== '') : []);
</script>

{#if !book}
  <div class="page empty">
    <span class="big">🤷</span>
    <p>This book doesn't exist (anymore).</p>
    <a class="btn" href="#/books">Back to library</a>
  </div>
{:else if edit}
  <div class="page stack">
    <header class="row">
      <a class="btn btn-ghost btn-icon" href="#/book/{id}" aria-label="Back"><Icon name="back" /></a>
      <h1>Edit book</h1>
    </header>
    <BookForm initial={book} locations={$lib.locations} onsubmit={save} oncancel={() => navigate(`/book/${id}`)} />
  </div>
{:else}
  <div class="page stack">
    <header class="row">
      <button class="btn-ghost btn-icon" aria-label="Back" onclick={() => (window.history.length > 1 ? window.history.back() : navigate('/books'))}><Icon name="back" /></button>
      <span class="grow"></span>
      <a class="btn btn-sm" href="#/book/{id}?edit=1"><Icon name="edit" size={18} /> Edit</a>
      <button class="btn-sm btn-danger" onclick={() => (deleteOpen = true)} aria-label="Delete"><Icon name="trash" size={18} /></button>
    </header>

    <section class="hero">
      <Cover {book} size="lg" />
      <div class="stack info">
        <div>
          <h1>{book.title}</h1>
          {#if book.subtitle}<p class="muted sub">{book.subtitle}</p>{/if}
          {#if book.authors.length}<p class="authors">{book.authors.join(', ')}</p>{/if}
        </div>
        <div class="row">
          {#if book.ownership === 'wishlist'}<span class="badge warn">Wishlist</span>{/if}
          {#if book.pendingLookup}
            <span class="badge">{$fetchingIds.has(book.id) ? 'Fetching details…' : 'Details will be fetched when online'}</span>
          {/if}
          {#each book.tags as tag}<a class="chip" href={filterLink({ tags: [tag] })}>#{tag}</a>{/each}
          {#each book.collections as c}<a class="chip" href={filterLink({ collections: [c] })}>▣ {c}</a>{/each}
        </div>
        <div class="loc card">
          <div class="stack tight">
            <span class="muted small">Location</span>
            <a href="#/books?loc={book.locationId ?? 'none'}" class="strong">{lib.label(book.locationId)}</a>
          </div>
          <button class="btn-primary" onclick={openMove}><Icon name="move" size={18} /> Move</button>
        </div>
        <div class="row">
          <select class="status" value={book.status} aria-label="Reading status"
            onchange={(e) => quick({ status: e.currentTarget.value as ReadingStatus })}>
            {#each Object.entries(STATUS_LABEL) as [v, l]}<option value={v}>{l}</option>{/each}
          </select>
          <Rating value={book.rating} onchange={(rating) => quick({ rating })} />
        </div>
        <div class="row">
          {#if book.ownership === 'wishlist'}
            <button class="btn-sm btn-primary" onclick={() => quick({ ownership: 'owned', purchasedOn: book.purchasedOn ?? todayIso() })}>🛍️ Bought it</button>
          {:else if !book.lending}
            <button class="btn-sm" onclick={() => { lendTo = ''; lendDue = ''; lendOpen = true; }}>🤝 Lend…</button>
          {/if}
          <button class="btn-sm" onclick={addCopy}>＋ Another copy</button>
        </div>
      </div>
    </section>

    {#if book.lending}
      <section class="card lend" class:overdue={isOverdue(book, todayIso())}>
        <div>
          <strong>Lent to {book.lending.to}</strong>
          <div class="small muted">
            since {formatDate(book.lending.lentOn, s.dateFormat)}
            {#if book.lending.dueOn}· due {formatDate(book.lending.dueOn, s.dateFormat)}{/if}
            {#if isOverdue(book, todayIso())}<span class="badge danger">overdue</span>{/if}
          </div>
        </div>
        <button class="btn-sm" onclick={() => quick({ lending: undefined })}>Mark returned</button>
      </section>
    {/if}

    <section class="card">
      <div class="spread">
        <h2>My notes</h2>
        {#if !notesEditing}<button class="btn-sm btn-ghost" onclick={() => { notesDraft = book.notes ?? ''; notesEditing = true; }}>{book.notes ? 'Edit' : '+ Add'}</button>{/if}
      </div>
      {#if notesEditing}
        <!-- svelte-ignore a11y_autofocus -->
        <textarea bind:value={notesDraft} rows="5" autofocus aria-label="My notes"></textarea>
        <div class="row end">
          <button class="btn-sm" onclick={() => (notesEditing = false)}>Cancel</button>
          <button class="btn-sm btn-primary" onclick={saveNotes}>Save</button>
        </div>
      {:else if book.notes}
        <p class="desc">{book.notes}</p>
      {:else}
        <p class="muted small">Thoughts, where you got it, who gave it to you…</p>
      {/if}
    </section>

    {#if book.description}
      <section class="card"><h2>About <SourceInfo ref={book.provenance?.description} /></h2><p class="desc">{book.description}</p></section>
    {/if}


    <section class="card">
      <div class="spread">
        <h2>Details</h2>
        <button class="btn-sm" onclick={fetchDetails} disabled={fetching}>{fetching ? 'Searching…' : 'Fetch missing details'}</button>
      </div>
      {#if facts.length}
        <dl>{#each facts as [k, v, key]}<dt>{k}</dt><dd>{v}<SourceInfo ref={key ? book.provenance?.[key] : undefined} /></dd>{/each}</dl>
      {:else}
        <p class="muted small">No details yet.</p>
      {/if}
      {#if links.length}
        <p class="row small links">{#each links as [name, url]}<a class="chip" href={url} target="_blank" rel="noopener">{name} ↗</a>{/each}</p>
      {/if}
    </section>

    <section class="card">
      <h2>My copy</h2>
      <dl>{#each mine as [k, v]}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
    </section>

    <section class="card">
      <h2>Location history</h2>
      {#if moves.length === 0}
        <p class="muted small">No moves yet.</p>
      {:else}
        <ol class="history">
          {#each moves as m (m.id)}
            <li>
              <span class="muted small">{formatDate(m.at, s.dateFormat)}</span>
              <span>{m.fromLabel} <span class="muted">→</span> <strong>{m.toLabel}</strong></span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  <Dialog bind:open={moveOpen} title="Move “{book.title}”">
    <LocationPicker bind:value={moveTarget} locations={$lib.locations} />
    {#snippet actions()}
      <button onclick={() => (moveOpen = false)}>Cancel</button>
      <button class="btn-primary" onclick={doMove}>Move here</button>
    {/snippet}
  </Dialog>

  <Dialog bind:open={lendOpen} title="Lend “{book.title}”">
    <form class="stack" onsubmit={(e) => { e.preventDefault(); if (lendTo.trim()) lend(); }}>
      <label class="field">To<input bind:value={lendTo} placeholder="Name" list="borrowers" /></label>
      <datalist id="borrowers">{#each knownBorrowers as name}<option value={name}></option>{/each}</datalist>
      <label class="field">Due back (optional)<input type="date" bind:value={lendDue} /></label>
      <button class="btn-primary" type="submit" disabled={!lendTo.trim()}>Mark as lent</button>
    </form>
  </Dialog>

  <Confirm bind:open={deleteOpen} title="Delete book?" message="“{book.title}” will be removed from your library. You can undo this right after."
    onconfirm={doDelete} />
{/if}

<style>
  .grow { flex: 1; }
  .hero { display: grid; grid-template-columns: auto 1fr; gap: 20px; align-items: start; }
  @media (max-width: 600px) { .hero { grid-template-columns: 1fr; justify-items: center; text-align: center; } .hero .row { justify-content: center; } }
  .info { width: 100%; }
  .sub { margin: 0; }
  .authors { margin: 4px 0 0; font-size: 1.05rem; }
  .loc { display: flex; justify-content: space-between; align-items: center; gap: 12px; text-align: left; }
  .tight { gap: 0; }
  .strong { font-weight: 600; text-decoration: none; }
  .status { width: auto; border-radius: 999px; }
  .lend { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .lend.overdue { border-left: 4px solid var(--danger); }
  .desc { white-space: pre-line; margin: 0; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
  dt { color: var(--muted); }
  dd { margin: 0; overflow-wrap: anywhere; }
  .links { margin: 12px 0 0; }
  .end { justify-content: flex-end; margin-top: 8px; }
  .history { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .history li { display: grid; gap: 2px; }
</style>

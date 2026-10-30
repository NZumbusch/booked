<script lang="ts">
  import { isOverdue, todayIso } from '../lib/domain/book';
  import type { BookDraft, MoveRecord, ReadingStatus } from '../lib/domain/types';
  import { FORMAT_LABEL, STATUS_LABEL, formatDate, formatPrice } from '../lib/format';
  import { navigate } from '../lib/router';
  import { attempt, library } from '../lib/stores/app';
  import BookForm from '../lib/ui/BookForm.svelte';
  import Confirm from '../lib/ui/Confirm.svelte';
  import Cover from '../lib/ui/Cover.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';
  import Rating from '../lib/ui/Rating.svelte';

  let { id, edit = false }: { id: string; edit?: boolean } = $props();

  const lib = library();
  const book = $derived($lib && lib.book(id));
  const s = $derived($lib.settings);

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

  async function doDelete() {
    const title = book?.title;
    if (await attempt(() => lib.deleteBooks([id]).then(() => true), `Deleted “${title}”`, { undo: true })) navigate('/books');
  }

  const facts = $derived(book ? ([
    ['Publisher', book.publisher],
    ['Published', book.publishedYear],
    ['First published', book.firstPublishedYear],
    ['Edition', book.edition],
    ['Format', book.format && FORMAT_LABEL[book.format]],
    ['Pages', book.pageCount],
    ['Language', book.language],
    ['Series', book.series && `${book.series}${book.seriesNumber ? ` #${book.seriesNumber}` : ''}`],
    ['ISBN-13', book.isbn13],
    ['ISBN-10', book.isbn10],
    ['Contributors', book.contributors?.join(', ')],
    ['Genres', book.genres.join(', ')],
    ['Subjects', book.subjects?.join(', ')]
  ] as const).filter(([, v]) => v !== undefined && v !== '') : []);

  const mine = $derived(book ? ([
    ['Collections', book.collections.join(', ')],
    ['Started', formatDate(book.startedOn, s.dateFormat)],
    ['Finished', formatDate(book.finishedOn, s.dateFormat)],
    ['Condition', book.condition],
    ['Copies', book.copies > 1 ? book.copies : ''],
    ['Signed', book.signed ? 'Yes' : ''],
    ['Purchased', formatDate(book.purchasedOn, s.dateFormat)],
    ['Price', formatPrice(book.price, s.currency)],
    ['Added', formatDate(book.createdAt, s.dateFormat)],
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
          {#each book.tags as tag}<a class="chip" href="#/books?q={encodeURIComponent(tag)}">#{tag}</a>{/each}
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

    {#if book.description}
      <section class="card"><h2>About</h2><p class="desc">{book.description}</p></section>
    {/if}

    {#if book.notes}
      <section class="card"><h2>My notes</h2><p class="desc">{book.notes}</p></section>
    {/if}

    {#if facts.length}
      <section class="card">
        <h2>Details</h2>
        <dl>{#each facts as [k, v]}<dt>{k}</dt><dd>{v}</dd>{/each}</dl>
      </section>
    {/if}

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
  .history { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
  .history li { display: grid; gap: 2px; }
</style>

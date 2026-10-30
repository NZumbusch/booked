<script lang="ts">
  import { normalizeIsbn } from '../lib/domain/isbn';
  import type { Book, BookDraft } from '../lib/domain/types';
  import { navigate } from '../lib/router';
  import { attempt, library, toast } from '../lib/stores/app';
  import BookForm from '../lib/ui/BookForm.svelte';
  import Dialog from '../lib/ui/Dialog.svelte';
  import Icon from '../lib/ui/Icon.svelte';

  let { scan = false }: { scan?: boolean } = $props();

  const lib = library();
  let isbnInput = $state('');
  let isbnError = $state('');
  /** The form's starting values; undefined = still on the first step. */
  let initial = $state<Partial<Book>>();
  let formKey = $state(0);

  let dupOpen = $state(false);
  let dupOf = $state<Book>();
  let pending = $state<BookDraft>();

  function startForm(prefill: Partial<Book> = {}) {
    initial = { locationId: $lib.settings.defaultLocationId, status: 'unread', ownership: 'owned', copies: 1, ...prefill };
    formKey++;
  }

  function useIsbn(e: SubmitEvent) {
    e.preventDefault();
    const isbn = normalizeIsbn(isbnInput);
    if (!isbn) {
      isbnError = 'That doesn’t look like a valid ISBN (10 or 13 digits).';
      return;
    }
    isbnError = '';
    const prefill = { isbn13: isbn.isbn13, isbn10: isbn.isbn10 };
    const dups = lib.duplicatesOf(prefill);
    if (dups.length) {
      askDuplicate(dups[0], { title: dups[0].title, ...prefill });
      return;
    }
    // Online metadata lookup comes in phase 2 — for now go straight to the form with the ISBN filled in.
    startForm(prefill);
  }

  function askDuplicate(existing: Book, draft: BookDraft) {
    dupOf = existing;
    pending = draft;
    dupOpen = true;
  }

  async function submit(draft: BookDraft) {
    const dups = lib.duplicatesOf(draft);
    if (dups.length) return askDuplicate(dups[0], draft);
    await add(draft);
  }

  async function add(draft: BookDraft) {
    const book = await attempt(() => lib.addBook(draft), `Added “${draft.title}”`, { undo: true });
    if (book) navigate(`/book/${book.id}`);
  }

  async function addCopy() {
    dupOpen = false;
    const b = dupOf!;
    await attempt(() => lib.updateBook(b.id, { copies: b.copies + 1 }), `Now ${b.copies + 1} copies of “${b.title}”`, { undo: true });
    navigate(`/book/${b.id}`);
  }

  async function addSeparate() {
    dupOpen = false;
    if (initial) await add(pending!);
    else startForm(pending);
  }

  function skip() {
    dupOpen = false;
    isbnInput = '';
    toast('Skipped');
  }
</script>

<div class="page stack">
  <header class="row">
    {#if initial}
      <button class="btn-ghost btn-icon" aria-label="Back" onclick={() => (initial = undefined)}><Icon name="back" /></button>
    {/if}
    <h1>Add a book</h1>
  </header>

  {#if !initial}
    {#if scan}
      <div class="card notice small">
        📷 Camera barcode scanning (with batch mode) is coming in the next build. Type the ISBN from the back cover for now.
      </div>
    {/if}
    <form class="card stack" onsubmit={useIsbn}>
      <label class="field">ISBN
        <!-- svelte-ignore a11y_autofocus -->
        <input bind:value={isbnInput} inputmode="numeric" autocomplete="off" placeholder="978…" autofocus
          aria-invalid={!!isbnError} />
      </label>
      {#if isbnError}<p class="error small">{isbnError}</p>{/if}
      <button class="btn-primary" type="submit">Continue</button>
    </form>

    <div class="or muted small">or</div>
    <button class="big" onclick={() => startForm()}><Icon name="edit" /> Enter everything by hand</button>
  {:else}
    {#key formKey}
      <BookForm {initial} locations={$lib.locations} submitLabel="Add to library" onsubmit={submit} />
    {/key}
  {/if}
</div>

<Dialog bind:open={dupOpen} title="Already in your library">
  {#if dupOf}
    <p>You already have <strong>{dupOf.title}</strong>{dupOf.copies > 1 ? ` (${dupOf.copies} copies)` : ''} in
      <strong>{lib.label(dupOf.locationId)}</strong>.</p>
  {/if}
  {#snippet actions()}
    <button onclick={skip}>Skip</button>
    <button onclick={addSeparate}>Separate entry</button>
    <button class="btn-primary" onclick={addCopy}>Add another copy</button>
  {/snippet}
</Dialog>

<style>
  .notice { background: color-mix(in srgb, var(--brand) 14%, var(--surface)); }
  .error { color: var(--danger); margin: 0; }
  .or { text-align: center; }
  .big { min-height: 64px; border-radius: 16px; }
</style>

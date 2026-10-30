<script lang="ts">
  import { hasPlaceholderTitle, placeholderTitle } from '../lib/domain/book';
  import { normalizeIsbn } from '../lib/domain/isbn';
  import { classifyScan } from '../lib/domain/scan';
  import type { Book, Id } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { feedback } from '../lib/scanner/camera';
  import { enricher, library, toast } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';
  import Scanner from '../lib/ui/Scanner.svelte';

  type State = 'added' | 'confirm' | 'skipped' | 'undone';
  interface Item {
    n: number;
    isbn: string;
    state: State;
    bookId?: Id;
    reason?: 'session' | 'library';
  }

  const lib = library();
  const enrich = enricher();
  const fetching = enrich.pending;
  // svelte-ignore state_referenced_locally
  let target = $state<Id | null>($lib.settings.defaultLocationId);
  let online = $state(true);
  let started = $state(false);
  let items = $state<Item[]>([]);
  let manual = $state('');
  let n = 0;

  const counts = $derived({
    added: items.filter((i) => i.state === 'added').length,
    confirm: items.filter((i) => i.state === 'confirm').length,
    waiting: items.filter((i) => i.state === 'added' && book(i.bookId)?.pendingLookup && !$fetching.has(i.bookId!)).length
  });
  const book = (id: Id | undefined) => (id ? $lib && lib.book(id) : undefined);

  function scanned(isbn: string) {
    const inSession = items.filter((i) => i.isbn === isbn && i.state === 'added').length;
    const decision = classifyScan(isbn, { inSession, inLibrary: lib.duplicatesOf({ isbn13: isbn }).length });
    if (decision.action === 'confirm') {
      feedback('ask');
      // Already waiting for an answer about this ISBN: bring that prompt to the top instead of adding another.
      const open = items.findIndex((i) => i.isbn === isbn && i.state === 'confirm');
      if (open >= 0) items.unshift(...items.splice(open, 1));
      else items.unshift({ n: ++n, isbn, state: 'confirm', reason: decision.reason });
      return;
    }
    feedback('ok');
    const item: Item = { n: ++n, isbn, state: 'added' };
    items.unshift(item);
    add(item.n);
  }

  function update(itemN: number, patch: Partial<Item>) {
    const i = items.findIndex((x) => x.n === itemN);
    if (i >= 0) items[i] = { ...items[i], ...patch };
  }

  /** Added instantly with just the ISBN; title, author, cover… arrive in the background. */
  async function add(itemN: number) {
    const item = items.find((x) => x.n === itemN)!;
    const isbn = normalizeIsbn(item.isbn)!;
    try {
      const added: Book = await lib.addBook({
        isbn13: isbn.isbn13,
        isbn10: isbn.isbn10,
        title: placeholderTitle(isbn.isbn13),
        locationId: target,
        pendingLookup: online || undefined
      });
      update(itemN, { bookId: added.id, state: 'added' });
      if (online) enrich.enqueue(added.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
      update(itemN, { state: 'skipped' });
    }
  }

  function confirm(itemN: number) {
    feedback('ok');
    update(itemN, { state: 'added' });
    add(itemN);
  }

  async function undo(item: Item) {
    if (item.bookId && book(item.bookId)) await lib.deleteBooks([item.bookId]);
    update(item.n, { state: 'undone' });
  }

  function undoLast() {
    const last = items.find((i) => i.state === 'added' || i.state === 'confirm');
    if (last) (last.state === 'confirm' ? update(last.n, { state: 'skipped' }) : undo(last));
  }

  function typed(e: SubmitEvent) {
    e.preventDefault();
    const isbn = normalizeIsbn(manual);
    if (!isbn) {
      feedback('error');
      toast('Not a valid ISBN');
      return;
    }
    manual = '';
    scanned(isbn.isbn13);
  }

  function status(item: Item, b: Book | undefined): string {
    if (item.state === 'skipped') return 'Skipped';
    if (item.state === 'undone') return 'Removed';
    if (!b) return 'Adding…';
    if (b.pendingLookup) return $fetching.has(b.id) ? 'Fetching details…' : 'Details pending (offline), retried automatically';
    if (hasPlaceholderTitle(b)) return 'Added, no details found online';
    return 'Added';
  }
</script>

<div class="page stack">
  <header class="spread">
    <div class="row">
      <a class="btn btn-ghost btn-icon" href="#/add" aria-label="Back"><Icon name="back" /></a>
      <h1>Batch scan</h1>
    </div>
    {#if started && counts.added}
      <a class="btn btn-sm btn-primary" href="#/books?loc={target ?? 'none'}&sort=added&dir=desc">Done</a>
    {/if}
  </header>

  {#if !started}
    <section class="card stack">
      <h2>Where are these books going?</h2>
      <LocationPicker bind:value={target} locations={$lib.locations} />
      <label class="check"><input type="checkbox" bind:checked={online} /> Look up details online</label>
      <p class="muted small">Every scanned book is added instantly; title, author and cover fill in a moment later. If a book is already in your library or was scanned before, you’ll be asked first.</p>
      <button class="btn-primary big" onclick={() => (started = true)}><Icon name="scan" /> Start scanning</button>
    </section>
  {:else}
    <button class="chip target" onclick={() => (started = false)}>
      <Icon name="pin" size={16} /> {lib.label(target)} <span class="muted">· change</span>
    </button>
    <Scanner onscan={scanned} compact />
    <form class="row manual" onsubmit={typed}>
      <input bind:value={manual} inputmode="numeric" placeholder="Type an ISBN" aria-label="Type an ISBN" />
      <button type="submit" disabled={!manual.trim()}>Add</button>
    </form>

    <div class="spread">
      <span class="small">
        <strong>{plural(counts.added, 'book')}</strong> added
        {#if counts.confirm}· <span class="warn">{counts.confirm} to confirm</span>{/if}
      </span>
      <div class="row">
        {#if counts.waiting}<button class="btn-sm" onclick={() => enrich.resumeAll()}>Retry lookups</button>{/if}
        <button class="btn-sm" onclick={undoLast} disabled={!items.length}><Icon name="undo" size={16} /> Undo last</button>
      </div>
    </div>

    {#if items.length === 0}
      <p class="muted center">Scanned books appear here.</p>
    {:else}
      <ul class="items">
        {#each items as item (item.n)}
          {@const b = book(item.bookId)}
          <li class="card item" class:confirm={item.state === 'confirm'} class:gone={item.state === 'undone' || item.state === 'skipped'}>
            <Cover book={{ title: b?.title ?? item.isbn, authors: b?.authors ?? [], cover: b?.cover }} size="sm" />
            <div class="text">
              {#if b}<a href="#/book/{b.id}"><strong>{b.title}</strong></a>{:else}<strong>{item.isbn}</strong>{/if}
              {#if b?.authors.length}<span class="small muted">{b.authors.join(', ')}</span>{/if}
              {#if item.state === 'confirm'}
                <span class="small warn">
                  {item.reason === 'session' ? 'Already scanned in this batch.' : `Already in your library (${lib.duplicatesOf({ isbn13: item.isbn }).map((d) => lib.label(d.locationId)).join('; ')}).`}
                  Another copy?
                </span>
              {:else}
                <span class="small muted" class:pending={!!b?.pendingLookup}>{status(item, b)}</span>
              {/if}
            </div>
            <div class="actions">
              {#if item.state === 'confirm'}
                <button class="btn-sm" onclick={() => update(item.n, { state: 'skipped' })}>Skip</button>
                <button class="btn-sm btn-primary" onclick={() => confirm(item.n)}>Add copy</button>
              {:else if item.state === 'added'}
                <button class="btn-ghost btn-icon" aria-label="Remove {b?.title ?? item.isbn}" onclick={() => undo(item)}><Icon name="undo" size={18} /></button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .big { min-height: 60px; }
  .target { border: none; min-height: 40px; justify-self: start; }
  .manual input { flex: 1; width: auto; }
  .center { text-align: center; }
  .warn { color: var(--warn); }
  .items { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .item { display: flex; gap: 12px; align-items: center; padding: 10px 12px; }
  .item.confirm { outline: 2px solid var(--warn); }
  .item.gone { opacity: 0.5; }
  .text { flex: 1; display: grid; gap: 2px; min-width: 0; }
  .text a { text-decoration: none; }
  .text strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
  .actions { display: flex; gap: 6px; }
  .pending { animation: pulse 1.2s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.4; } }
</style>

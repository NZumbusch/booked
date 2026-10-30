<script lang="ts">
  import { fillMissing } from '../lib/domain/book';
  import { normalizeIsbn } from '../lib/domain/isbn';
  import { classifyScan } from '../lib/domain/scan';
  import type { Book, Id } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { lookupIsbn } from '../lib/metadata/lookup';
  import { feedback } from '../lib/scanner/camera';
  import { library, toast } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';
  import Icon from '../lib/ui/Icon.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';
  import Scanner from '../lib/ui/Scanner.svelte';

  type State = 'looking' | 'added' | 'missing' | 'offline' | 'confirm' | 'skipped' | 'undone';
  interface Item {
    n: number;
    isbn: string;
    state: State;
    bookId?: Id;
    reason?: 'session' | 'library';
  }

  const lib = library();
  // svelte-ignore state_referenced_locally
  let target = $state<Id | null>($lib.settings.defaultLocationId);
  let online = $state(true);
  let started = $state(false);
  let items = $state<Item[]>([]);
  let manual = $state('');
  let n = 0;

  const ADDED: State[] = ['looking', 'added', 'missing', 'offline'];
  const counts = $derived({
    added: items.filter((i) => ADDED.includes(i.state)).length,
    confirm: items.filter((i) => i.state === 'confirm').length,
    offline: items.filter((i) => i.state === 'offline').length
  });
  const book = (id: Id | undefined) => (id ? $lib.books.find((b) => b.id === id) : undefined);

  // At most 3 lookups at a time; scanning never waits for the network.
  let running = 0;
  const queue: (() => Promise<void>)[] = [];
  function enqueue(job: () => Promise<void>) {
    queue.push(job);
    pump();
  }
  function pump() {
    while (running < 3 && queue.length) {
      const job = queue.shift()!;
      running++;
      job().finally(() => {
        running--;
        pump();
      });
    }
  }

  function scanned(isbn: string) {
    const inSession = items.filter((i) => i.isbn === isbn && ADDED.includes(i.state)).length;
    const decision = classifyScan(isbn, { inSession, inLibrary: lib.duplicatesOf({ isbn13: isbn }).length });
    const item: Item = { n: ++n, isbn, state: 'looking' };
    if (decision.action === 'confirm') {
      feedback('ask');
      // Already waiting for an answer about this ISBN: bring that prompt to the top instead of adding another.
      const open = items.findIndex((i) => i.isbn === isbn && i.state === 'confirm');
      if (open >= 0) items.unshift(...items.splice(open, 1));
      else items.unshift({ ...item, state: 'confirm', reason: decision.reason });
      return;
    }
    feedback('ok');
    items.unshift(item);
    process(item.n);
  }

  function update(itemN: number, patch: Partial<Item>) {
    const i = items.findIndex((x) => x.n === itemN);
    if (i >= 0) items[i] = { ...items[i], ...patch };
  }

  function process(itemN: number) {
    const item = items.find((x) => x.n === itemN)!;
    update(itemN, { state: 'looking' });
    enqueue(async () => {
      const isbn = normalizeIsbn(item.isbn)!;
      const result = online ? await lookupIsbn(item.isbn) : undefined;
      const found = result?.status === 'found';
      try {
        const added: Book = await lib.addBook({
          ...(found ? result!.draft : {}),
          isbn13: isbn.isbn13,
          isbn10: isbn.isbn10,
          title: (found && result!.draft.title) || `ISBN ${isbn.isbn13}`,
          locationId: target
        });
        update(itemN, { bookId: added.id, state: found ? 'added' : result?.status === 'notfound' ? 'missing' : 'offline' });
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e));
        update(itemN, { state: 'skipped' });
      }
    });
  }

  function confirm(itemN: number) {
    feedback('ok');
    process(itemN);
  }

  async function undo(item: Item) {
    if (item.bookId && book(item.bookId)) await lib.deleteBooks([item.bookId]);
    update(item.n, { state: 'undone' });
  }

  function undoLast() {
    const last = items.find((i) => i.state !== 'undone' && i.state !== 'skipped' && i.state !== 'looking');
    if (last) (last.state === 'confirm' ? update(last.n, { state: 'skipped' }) : undo(last));
  }

  /** Books added while offline: try the online lookup again and fill in what's missing. */
  function retryOffline() {
    for (const item of items.filter((i) => i.state === 'offline' && i.bookId)) {
      update(item.n, { state: 'looking' });
      enqueue(async () => {
        const result = await lookupIsbn(item.isbn);
        const b = book(item.bookId);
        if (result.status === 'found' && b) {
          const patch = fillMissing({ ...b, title: b.title.startsWith('ISBN ') ? '' : b.title }, result.draft);
          await lib.updateBook(b.id, patch);
        }
        update(item.n, { state: result.status === 'found' ? 'added' : result.status === 'notfound' ? 'missing' : 'offline' });
      });
    }
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

  const STATE_LABEL: Record<State, string> = {
    looking: 'Looking up…', added: 'Added', missing: 'Added, no details found', offline: 'Added, details pending (offline)',
    confirm: '', skipped: 'Skipped', undone: 'Removed'
  };
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
      <p class="muted small">Every scanned book is added right away. If a book is already in your library or was scanned before, you’ll be asked first.</p>
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
        {#if counts.offline}<button class="btn-sm" onclick={retryOffline}>Retry lookups</button>{/if}
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
                <span class="small muted" class:pending={item.state === 'looking'}>{STATE_LABEL[item.state]}</span>
              {/if}
            </div>
            <div class="actions">
              {#if item.state === 'confirm'}
                <button class="btn-sm" onclick={() => update(item.n, { state: 'skipped' })}>Skip</button>
                <button class="btn-sm btn-primary" onclick={() => confirm(item.n)}>Add copy</button>
              {:else if item.state === 'added' || item.state === 'missing' || item.state === 'offline'}
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

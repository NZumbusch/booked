<script lang="ts">
  import { applyFilter } from '../lib/domain/filters';
  import { todayIso } from '../lib/domain/book';
  import { sortBooks } from '../lib/domain/query';
  import type { Book, Id } from '../lib/domain/types';
  import { toBibtex, toCslJson, toRis } from '../lib/exchange/citations';
  import { parseCsv, toCsv } from '../lib/exchange/csv';
  import { guessMapping, IMPORT_FIELDS, rowsToImport, type ImportField } from '../lib/exchange/import';
  import { libibRows } from '../lib/exchange/libib';
  import { saveFile, stamp } from '../lib/files';
  import { plural } from '../lib/format';
  import { navigate } from '../lib/router';
  import { attempt, enricher, library, toast } from '../lib/stores/app';
  import BackupButton from '../lib/ui/BackupButton.svelte';
  import LocationPicker from '../lib/ui/LocationPicker.svelte';

  const lib = library();

  // ---------------------------------------------------------------- export
  let scope = $state<Id | null>(null);
  type Format = 'csv' | 'csl' | 'ris' | 'bib';
  let format = $state<Format>('csv');
  const FORMATS: Record<Format, { label: string; hint: string }> = {
    csv: { label: 'CSV spreadsheet (Libib-compatible)', hint: 'Opens in Excel/Numbers; Libib-style columns plus all Booked fields.' },
    csl: { label: 'Zotero: CSL-JSON', hint: 'Best for Zotero: File › Import… › choose this file.' },
    ris: { label: 'RIS', hint: 'Zotero, EndNote, Mendeley, Citavi.' },
    bib: { label: 'BibTeX', hint: 'LaTeX / BibLaTeX, JabRef, Zotero.' }
  };
  const scoped = $derived(
    sortBooks(scope ? applyFilter($lib.books, { loc: scope }, { locations: $lib.locations, today: todayIso() }) : $lib.books, 'author', 'asc')
  );

  async function exportBooks() {
    const books: Book[] = scoped;
    const name = `booked-${scope ? lib.label(scope).replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase() + '-' : ''}${stamp()}`;
    const file = {
      csv: () => new File([toCsv(libibRows(books, $lib.locations))], `${name}.csv`, { type: 'text/csv' }),
      csl: () => new File([toCslJson(books)], `${name}.json`, { type: 'application/json' }),
      ris: () => new File([toRis(books)], `${name}.ris`, { type: 'application/x-research-info-systems' }),
      bib: () => new File([toBibtex(books)], `${name}.bib`, { type: 'application/x-bibtex' })
    }[format]();
    const result = await saveFile(file);
    if (result !== 'cancelled') toast(`Exported ${plural(books.length, 'book')}`);
  }

  // ---------------------------------------------------------------- import
  let header = $state<string[]>([]);
  let rows = $state.raw<string[][]>([]);
  let mapping = $state<(ImportField | '')[]>([]);
  let fileName = $state('');
  let skipDuplicates = $state(true);
  let lookup = $state(true);
  let importing = $state(false);

  async function pickCsv(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) {
      toast('That file has no rows to import');
      return;
    }
    fileName = file.name;
    header = parsed[0];
    rows = parsed.slice(1);
    mapping = guessMapping(header);
  }

  const preview = $derived(rows.length ? rowsToImport(rows, mapping) : undefined);
  const hasTitle = $derived(mapping.includes('title') || mapping.includes('isbn13') || mapping.includes('isbn10'));

  async function runImport() {
    if (!preview) return;
    importing = true;
    try {
      const result = await attempt(() => lib.importBooks(preview.items, { skipDuplicates, lookup }));
      if (!result) return;
      for (const b of result.added) if (b.pendingLookup) enricher().enqueue(b.id);
      toast(`Imported ${plural(result.added.length, 'book')}${result.skipped ? `, skipped ${result.skipped} already in your library` : ''}`, { undo: true });
      rows = [];
      header = [];
      navigate('/books', { sort: 'added', dir: 'desc' });
    } finally {
      importing = false;
    }
  }
</script>

<div class="page stack">
  <h1>Import & export</h1>

  <section class="card stack">
    <h2>Export</h2>
    <LocationPicker bind:value={scope} locations={$lib.locations} oncreate={null} />
    <p class="muted small">{scope ? '' : 'No location chosen: '}{plural(scoped.length, 'book')} will be exported.</p>
    <div class="formats">
      {#each Object.entries(FORMATS) as [key, f]}
        <label class="fmt" class:on={format === key}>
          <input type="radio" name="format" value={key} bind:group={format} />
          <span><strong>{f.label}</strong><br /><span class="muted small">{f.hint}</span></span>
        </label>
      {/each}
    </div>
    <div class="row">
      <button class="btn-primary" onclick={exportBooks} disabled={!scoped.length}>Export {plural(scoped.length, 'book')}</button>
      {#if scope}<a class="btn" href="#/print?loc={scope}">Printable list</a>{:else}<a class="btn" href="#/print">Printable list</a>{/if}
    </div>
  </section>

  <section class="card stack">
    <h2>Import from CSV</h2>
    <p class="muted small">From Libib, Goodreads, a spreadsheet or a Booked export. Columns are matched automatically; check and adjust below.</p>
    <label class="btn">Choose CSV file…<input type="file" accept=".csv,text/csv,text/plain,.tsv" class="sr-only" onchange={pickCsv} /></label>

    {#if header.length}
      <p class="small"><strong>{fileName}</strong>: {plural(rows.length, 'row')}</p>
      <div class="map">
        {#each header as col, i}
          <div class="map-row">
            <div class="col">
              <strong>{col || `Column ${i + 1}`}</strong>
              <span class="muted small sample">{rows[0]?.[i] ?? ''}</span>
            </div>
            <select bind:value={mapping[i]} aria-label="Field for column {col}">
              <option value="">Don’t import</option>
              {#each Object.entries(IMPORT_FIELDS) as [key, label]}<option value={key}>{label}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
      <label class="check"><input type="checkbox" bind:checked={skipDuplicates} /> Skip books whose ISBN is already in the library</label>
      <label class="check"><input type="checkbox" bind:checked={lookup} /> Fill in missing details online (in the background)</label>
      {#if !hasTitle}<p class="warn small">Map at least a title or ISBN column.</p>{/if}
      {#if preview?.skipped.length}<p class="muted small">{preview.skipped.length} rows without title or ISBN will be skipped.</p>{/if}
      <button class="btn-primary" onclick={runImport} disabled={!hasTitle || importing || !preview?.items.length}>
        {importing ? 'Importing…' : `Import ${plural(preview?.items.length ?? 0, 'book')}`}
      </button>
    {/if}
  </section>

  <section class="card stack">
    <h2>Full backup</h2>
    <p class="muted small">Everything (books, places, history, settings) in one file. Restore it under Settings.</p>
    <div class="row"><BackupButton /></div>
  </section>
</div>

<style>
  .formats { display: grid; gap: 8px; }
  .fmt { display: flex; gap: 12px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; cursor: pointer; }
  .fmt.on { border-color: var(--brand); background: color-mix(in srgb, var(--brand) 8%, transparent); }
  .fmt input { width: 20px; min-height: 20px; margin-top: 2px; }
  .map { display: grid; gap: 8px; }
  .map-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 8px; }
  .col { display: grid; min-width: 0; }
  .sample { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .warn { color: var(--warn); margin: 0; }
  label.btn { justify-self: start; }
</style>

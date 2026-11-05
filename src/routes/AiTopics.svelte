<script lang="ts">
  import { untrack } from 'svelte';
  import {
    aiSplitPrompts, aiTopicPrompts, booksFor, ownVocabulary, parseAiTopics, parsePath, pathText, topicLanguage, topLevels, underNode, type AiScope, type TopicLanguage
  } from '../lib/domain/aiTopics';
  import { pathTree, flatten } from '../lib/domain/pathTree';
  import { route } from '../lib/router';
  import { displayTitle } from '../lib/domain/book';
  import type { Book, Id } from '../lib/domain/types';
  import { plural } from '../lib/format';
  import { attempt, library, toast } from '../lib/stores/app';
  import Confirm from '../lib/ui/Confirm.svelte';
  import { libraryTopics } from '../lib/wall/topicPaths';

  /**
   * Topics with AI: Booked writes a prompt, you paste it into any chat AI and paste the answer back.
   * Before anything is saved you see every book with its new topic and can change it.
   */
  const lib = library();
  const books = $derived($lib && lib.owned());
  const topics = $derived(libraryTopics(books));

  let scope = $state<AiScope>('unsorted');
  // svelte-ignore state_referenced_locally
  let lang = $state<TopicLanguage>(untrack(() => savedLang() ?? topicLanguage(ownVocabulary(books)) ?? (books.filter((b) => b.language === 'de').length >= books.length / 2 ? 'de' : 'en')));
  /** The language of your topics stays the same from run to run (a mix of both would split the tree). */
  function savedLang(): TopicLanguage | undefined {
    try {
      const v = localStorage.getItem('booked.aiLang');
      return v === 'de' || v === 'en' ? v : undefined;
    } catch {
      return undefined;
    }
  }
  $effect(() => {
    try {
      localStorage.setItem('booked.aiLang', lang);
    } catch {
      // fine
    }
  });
  let part = $state(0);
  let answer = $state('');
  let copied = $state(false);

  /** Split mode (from the topic editor): one big topic, its books get sub-topics below it. */
  const split = $derived($route.query.split ? parsePath($route.query.split) : undefined);
  const splitNode = $derived(split ? flatten(pathTree(books)).find(({ node }) => node.path.join('\u0000') === split.join('\u0000'))?.node : undefined);
  const inSplit = (b: Book) => !!split && split.every((x, i) => b.aiTopics?.[i] === x);
  // Only your own topics are offered to the AI: catalogue headings offered there end up copied into your topics.
  const vocabulary = $derived(ownVocabulary(books));
  const chosen = $derived(split ? books.filter(inSplit) : booksFor(scope, books, topics.hasTopic));
  const prompts = $derived(split
    ? aiSplitPrompts(split, chosen, lang, (splitNode?.children ?? []).map((c) => c.name))
    : aiTopicPrompts(chosen, lang, vocabulary));
  const current = $derived(prompts[Math.min(part, prompts.length - 1)]);
  const counts = $derived({
    all: books.length,
    unsorted: booksFor('unsorted', books, topics.hasTopic).length,
    none: booksFor('none', books, topics.hasTopic).length
  });

  $effect(() => {
    void scope;
    void lang;
    part = 0;
    answer = '';
  });

  async function copy() {
    if (!current) return;
    try {
      await navigator.clipboard.writeText(current.text);
      copied = true;
      setTimeout(() => (copied = false), 2500);
    } catch {
      toast('Couldn’t copy: select the text below and copy it yourself');
    }
  }

  // ---- the answer, with every book's new topic editable before saving
  const parsed = $derived(current && answer.trim() ? parseAiTopics(answer, current.ids) : undefined);
  let edits = $state<Record<Id, string>>({});
  $effect(() => {
    const p = parsed;
    edits = p ? Object.fromEntries([...p.paths].map(([id, path]) => [id, pathText(split ? underNode(split, path) : path)])) : {};
  });
  const rows = $derived(parsed ? [...parsed.paths.keys()].map((id) => lib.book(id)).filter((b): b is Book => !!b) : []);
  const missing = $derived(current && parsed ? current.ids.filter((id) => !parsed.paths.has(id)).length : 0);
  const preview = $derived(topLevels(new Map(Object.entries(edits).map(([id, t]) => [id, parsePath(t)]).filter(([, p]) => p.length) as [Id, string[]][])));

  async function apply() {
    const ids = Object.keys(edits).filter((id) => parsePath(edits[id]).length);
    if (!ids.length) return;
    const done = await attempt(
      () => lib.bulkUpdate(ids, (b) => ({ aiTopics: parsePath(edits[b.id]) }), `Topics for ${plural(ids.length, 'book')}`),
      `Topics saved for ${plural(ids.length, 'book')}`, { undo: true }
    );
    if (done === undefined) return;
    answer = '';
    if (scope === 'all' && part < prompts.length - 1) part++;
    // in the other scopes, the books just sorted drop out of the list: part 1 now holds the next ones
  }

  let clearOpen = $state(false);
  const own = $derived(books.filter((b) => b.aiTopics?.length).length);
  async function clearAll() {
    const ids = books.filter((b) => b.aiTopics?.length).map((b) => b.id);
    await attempt(() => lib.bulkUpdate(ids, () => ({ aiTopics: undefined }), 'Removed own topics'), `Removed topics from ${plural(ids.length, 'book')}`, { undo: true });
  }
</script>

<div class="page stack">
  <header class="spread">
    <h1>✨ Topics with AI</h1>
    <a class="btn btn-sm" href="#/paths">🗂️ Edit topics</a>
  </header>
  <p class="muted">Booked writes a request listing your books. Paste it into any chat AI (ChatGPT, Claude, Gemini…), then paste the answer back here. Every book gets a topic path like <em>Belletristik › Kriminalroman › Skandinavischer Krimi</em>, which arranges and names the cover wall. You can check and change each one before it’s saved, and change any book later on its page. Nothing is sent anywhere by Booked.</p>

  <section class="card stack">
    {#if split}
      <h2>1. Split “{split.join(' › ')}”</h2>
      <p class="small">{plural(chosen.length, 'book')} in this topic get sub-topics below it; the rest of your topics stay as they are. <a href="#/topics">Other books instead</a></p>
    {:else}
      <h2>1. Which books?</h2>
      <label class="radio"><input type="radio" bind:group={scope} value="unsorted" /> Books without topics of my own <span class="muted">({counts.unsorted})</span></label>
      <label class="radio"><input type="radio" bind:group={scope} value="none" /> Only books with no topic at all <span class="muted">({counts.none})</span></label>
      <label class="radio"><input type="radio" bind:group={scope} value="all" /> All books, revising my topics too <span class="muted">({counts.all})</span></label>
    {/if}
    <label class="field">Topic names in
      <select bind:value={lang}><option value="de">German</option><option value="en">English</option></select>
    </label>
    {#if vocabulary.length && !split}<p class="muted small">The request lists your {vocabulary.length} existing topics, so books are sorted into those where they fit; the AI adds new ones only where needed, keeps topics to a browsable size, and is asked to search the web when it isn’t sure about a book.</p>{/if}
  </section>

  {#if !chosen.length}
    <p class="muted">No books to ask about in this choice. 🎉</p>
  {:else if current}
    <section class="card stack">
      <h2>2. Copy the request{prompts.length > 1 ? ` (part ${current.part} of ${prompts.length})` : ''}</h2>
      <p class="muted small">{plural(current.ids.length, 'book')}{prompts.length > 1 ? ' in this part; big libraries go in parts so each fits in one message' : ''}. A chat AI with web search gives the best results.</p>
      <div class="row">
        <button class="btn-primary" onclick={copy}>{copied ? '✓ Copied' : '📋 Copy request'}</button>
        {#if prompts.length > 1}
          <button class="btn-sm" disabled={part === 0} onclick={() => { part--; answer = ''; }}>‹ Part {current.part - 1}</button>
          <button class="btn-sm" disabled={part >= prompts.length - 1} onclick={() => { part++; answer = ''; }}>Part {current.part + 1} ›</button>
        {/if}
      </div>
      <details><summary class="small">Show the request</summary><textarea readonly rows="8" value={current.text}></textarea></details>
    </section>

    <section class="card stack">
      <h2>3. Paste the answer</h2>
      <textarea rows="6" bind:value={answer} placeholder={'1: Belletristik > Kriminalroman\n2: Philosophie > Politische Philosophie\n…'}></textarea>
      {#if parsed}
        <p class="small">
          <strong>{plural(rows.length, 'book')}</strong> understood{missing ? `, ${missing} without an answer (ask again for those later)` : ''}{parsed.skipped.length ? `, ${parsed.skipped.length} lines not readable` : ''}.
        </p>
        {#if preview.length}<p class="muted small">Broad topics: {preview.slice(0, 15).map((t) => `${t.name} (${t.count})`).join(' · ')}</p>{/if}
        {#if parsed.skipped.length}<details><summary class="small">Lines not readable</summary><pre class="small">{parsed.skipped.join('\n')}</pre></details>{/if}
        {#if rows.length}
          <details open={rows.length <= 40}>
            <summary class="small">Check and change the topics ({rows.length})</summary>
            <datalist id="topic-paths">{#each topics.vocabulary as v}<option value={v}></option>{/each}</datalist>
            <ul class="rows">
              {#each rows as b (b.id)}
                <li>
                  <span class="t"><strong>{displayTitle(b)}</strong><span class="muted small">{b.authors.slice(0, 2).join(', ')}</span></span>
                  <input bind:value={edits[b.id]} list="topic-paths" aria-label="Topic for {b.title}" />
                </li>
              {/each}
            </ul>
          </details>
          <button class="btn-primary" onclick={apply}>Save topics for {plural(Object.values(edits).filter((t) => parsePath(t).length).length, 'book')}</button>
        {/if}
      {/if}
    </section>
  {/if}

  {#if own}
    <p class="muted small">{plural(own, 'book')} have topics of your own. <button class="btn-sm" onclick={() => (clearOpen = true)}>Remove them all</button></p>
  {/if}
</div>

<Confirm bind:open={clearOpen} title="Remove your own topics?" message="The wall goes back to the catalogue topics for {plural(own, 'book')}. You can undo this right after." onconfirm={clearAll} />

<style>
  h2 { font-size: 1.05rem; margin: 0; }
  p { margin: 0; }
  .radio { display: flex; gap: 10px; align-items: center; justify-content: flex-start; text-align: left; }
  .radio input { width: auto; min-height: 0; flex: none; margin: 0; }
  textarea { width: 100%; font: inherit; font-size: 0.85rem; }
  .rows { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 8px; }
  .rows li { display: grid; gap: 4px; }
  .t { display: grid; min-width: 0; }
  .t strong { overflow-wrap: anywhere; }
  pre { white-space: pre-wrap; margin: 0; }
</style>

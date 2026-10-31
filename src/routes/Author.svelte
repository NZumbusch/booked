<script lang="ts">
  import { fold } from '../lib/domain/query';
  import { formatDate, plural } from '../lib/format';
  import type { AuthorKnowledge, WikiSummary } from '../lib/metadata/knowledge';
  import { addToWishlist, knowledge, library } from '../lib/stores/app';
  import Cover from '../lib/ui/Cover.svelte';

  let { name }: { name: string } = $props();
  const lib = library();
  const kn = knowledge();

  const mine = $derived($lib.books.filter((b) => b.authors.some((a) => fold(a) === fold(name))));
  const ownedAuthors = $derived(new Set($lib.books.flatMap((b) => b.authors.map(fold))));
  let author = $state<AuthorKnowledge>();
  let bio = $state<WikiSummary>();
  let loading = $state(true);
  let failed = $state(false);

  $effect(() => {
    const n = name;
    loading = true;
    failed = false;
    author = undefined;
    bio = undefined;
    kn.author(n)
      .then(async (a) => {
        author = a;
        if (a) bio = await kn.bio(a);
      })
      .catch(() => (failed = true))
      .finally(() => (loading = false));
  });

  const life = $derived(
    author ? [author.born && `* ${formatDate(author.born, $lib.settings.dateFormat)}${author.birthPlace ? ` in ${author.birthPlace}` : ''}`,
      author.died && `† ${formatDate(author.died, $lib.settings.dateFormat)}${author.deathPlace ? ` in ${author.deathPlace}` : ''}`].filter(Boolean) : []
  );
  const ownsWork = (label: string) => $lib.books.find((b) => fold(b.title) === fold(label));
  const LANG: Record<string, string> = { de: 'Deutsch', en: 'English' };
</script>

<div class="page stack">
  <header class="hero">
    {#if bio?.thumbnail}<img src={bio.thumbnail} alt="" class="portrait" />{/if}
    <div>
      <span class="muted small">Author</span>
      <h1>{author?.label ?? name}</h1>
      {#if bio?.description}<p class="muted">{bio.description}</p>{/if}
      {#each life as l}<div class="small">{l}</div>{/each}
    </div>
  </header>

  {#if bio}
    <section class="card stack">
      <p class="bio">{bio.extract}</p>
      <a class="small" href={bio.url} target="_blank" rel="noopener">Wikipedia ({LANG[bio.lang] ?? bio.lang}) ↗</a>
    </section>
  {:else if loading}
    <p class="muted small">Looking up {name}…</p>
  {:else if failed}
    <p class="muted small">Couldn’t reach Wikidata/Wikipedia (offline?).</p>
  {:else if !author}
    <p class="muted small">No entry found for “{name}” on Wikidata.</p>
  {/if}

  <section class="stack">
    <h2>On your shelves <span class="muted small">{mine.length}</span></h2>
    <div class="shelf">
      {#each mine as b (b.id)}<a href="#/book/{b.id}" title={b.title} class="tile"><Cover book={b} /><span class="small">{b.title}</span></a>{/each}
    </div>
  </section>

  {#if author}
    {#if author.movements.length}
      <section class="stack">
        <h2>Movements</h2>
        <div class="row">{#each author.movements as m (m.id)}<span class="chip">{m.label}</span>{/each}</div>
      </section>
    {/if}
    {#if author.influencedBy.length}
      <section class="stack">
        <h2>Influenced by</h2>
        <div class="row">
          {#each author.influencedBy as i (i.id)}
            <a class="chip" href={i.person === false ? `#/topic/${encodeURIComponent(i.label)}` : `#/author/${encodeURIComponent(i.label)}`}>{i.label}{#if ownedAuthors.has(fold(i.label))} ✓{/if}</a>
          {/each}
        </div>
      </section>
    {/if}
    {#if author.influenced.length}
      <section class="stack">
        <h2>Influenced</h2>
        <div class="row">
          {#each author.influenced.slice(0, 24) as i (i.id)}
            <a class="chip" href="#/author/{encodeURIComponent(i.label)}">{i.label}{#if ownedAuthors.has(fold(i.label))} ✓{/if}</a>
          {/each}
        </div>
      </section>
    {/if}
    {#if author.notableWorks.length}
      <section class="stack">
        <h2>Notable works</h2>
        <ul class="works">
          {#each author.notableWorks as w (w.id)}
            {@const have = ownsWork(w.label)}
            <li>
              <span>{w.label}</span>
              {#if have}<a class="btn btn-sm" href="#/book/{have.id}">✓ Yours</a>
              {:else}<button class="btn-sm" onclick={() => addToWishlist({ title: w.label, authors: [author!.label] })}>+ Wishlist</button>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
    <p class="muted small">{plural(mine.length, 'book')} by {author.label} in your library · data from Wikidata</p>
  {/if}
</div>

<style>
  .hero { display: flex; gap: 16px; align-items: center; }
  .portrait { width: 96px; height: 120px; object-fit: cover; border-radius: 10px; box-shadow: var(--shadow); }
  .hero p { margin: 2px 0 4px; }
  .bio { margin: 0; line-height: 1.55; }
  h2 { display: flex; gap: 8px; align-items: baseline; margin: 8px 0 0; }
  .shelf { display: grid; grid-auto-flow: column; grid-auto-columns: 96px; gap: 12px; overflow-x: auto; padding-bottom: 8px; }
  .tile { display: grid; gap: 4px; text-decoration: none; }
  .tile span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .works { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .works li { display: flex; justify-content: space-between; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
</style>

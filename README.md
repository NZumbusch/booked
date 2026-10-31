# Booked

A personal book catalogue in the spirit of Libib. It's a static, offline-first PWA built with Svelte 5 and Vite, and it's hosted on GitHub Pages.
All data stays on your device (IndexedDB). The app needs no backend and no API keys.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit + component tests (Vitest)
npm run check    # type-check Svelte + TS
npm run build    # production build in dist/
npm run preview  # serve the production build locally (the service worker is active here)
```

## Deploy to GitHub Pages (one-time setup)

1. Push this repository to GitHub.
2. On GitHub, open **Settings → Pages**. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Merge or push to `main`. The workflow `.github/workflows/deploy.yml` type-checks, tests, builds and deploys the app.
4. The app goes live at `https://<user>.github.io/<repo>/`. The URL also appears in the workflow run's *deploy* step.
5. On your phone, open that URL:
   - **Android (Chrome):** tap ⋮ → *Install app*.
   - **iOS (Safari):** tap Share → *Add to Home Screen*.

The build uses a relative base path (`./`) and hash routing (`#/books`). Because of that, it works under any sub-path and needs no 404 redirect hacks.
Pull requests run the same checks but skip the deploy.

## Google Books API key (optional)

Without a key, Google Books lookups share an anonymous quota that is often used up. Nothing breaks when that happens, because Open Library and Wikidata still answer.
A free key gives you **1,000 lookups per day**, and each book uses one. No billing account is needed.

1. Open <https://console.cloud.google.com/>, then create a project (any name).
2. Go to **APIs & Services → Library**, search for **Books API**, and choose **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**.
4. Recommended: open the key and set **Application restrictions → Websites** to `https://<user>.github.io/*`. Then set **API restrictions → Books API**.
5. Paste the key into the app under **Settings → Online lookups**.

The key is stored only on your device, and it's included in backups so a restored device keeps it.

## PWA or Capacitor?

**Recommendation: PWA now. Capacitor stays possible later with no rewrite.**

| | PWA (chosen) | Capacitor |
|---|---|---|
| Hosting / install | GitHub Pages; install from the browser | App Store / Play Store, or sideload. iOS needs a Mac, Xcode and a $99/yr developer account |
| Updates | Automatic on next open | Rebuild and re-publish the binary |
| Barcode scanning | Camera via `getUserMedia`. Native `BarcodeDetector` on Android Chrome, WASM ZXing fallback on iOS. Good for EAN-13 | ML Kit native scanner: a bit faster in poor light |
| Offline | Service worker precaches the app. Covers are cached on first view | Same |
| Storage durability | IndexedDB plus `navigator.storage.persist()`. Installed PWAs on iOS are exempt from Safari's 7-day eviction. **Regular JSON backups are still recommended** | SQLite/filesystem, very durable |
| Complexity | One `npm run build` | Native projects, toolchains and signing |

Every requirement here works well as a PWA: GitHub Pages, offline, no keys, camera scanning.
Capacitor would mainly add a slightly better scanner and stronger storage guarantees. The code keeps platform concerns behind small interfaces (`Repository`, and in phase 2 a `Scanner`). Wrapping the same `dist/` in Capacitor later is therefore an additive change.

## Project structure

```
src/
  main.ts, App.svelte        bootstrap + hash router outlet
  app.css                    design tokens (light/dark), base components
  lib/
    domain/                  pure, framework-free logic (100% unit-tested)
      types.ts               the data schema (see below)
      isbn.ts                ISBN-10/13 validation, conversion, duplicate keys
      book.ts                create/patch/normalise books, duplicates, lending helpers
      locations.ts           Place › Room › Shelf tree: paths, labels, counts, reorder
      query.ts               search (accent-insensitive) and sorting
    storage/
      repository.ts          storage interface (+ atomic ChangeSet)
      dexie-repository.ts    IndexedDB implementation
    services/
      library.ts             app service: in-memory model + persistence + undo + move history
    stores/app.ts            Library singleton, toasts, error handling
    ui/                      reusable components (Cover, LocationPicker, BookForm, Dialog…)
    router.ts, format.ts, images.ts
  routes/                    one component per screen
tests/setup.ts               fake IndexedDB + testing-library cleanup
.github/workflows/deploy.yml CI + GitHub Pages deploy
```

### Architecture in one paragraph

On start, `Library` loads all books and locations into memory. That's fine for 5,000+ books: the JSON is a few MB, and filtering in memory takes milliseconds.
Each mutation builds a `ChangeSet` and an `UndoEntry` (the before-state of every record it touches). It writes both atomically through the `Repository`, then updates memory and notifies subscribers. `Library` implements the Svelte store contract, so components simply use `$lib`.
Because every action stores its before-state, **any** action can be undone: a bulk move, a room move, a delete.
A future Google Drive sync module only needs `Repository.exportSnapshot/importSnapshot`, or it can wrap `commit()`. The UI and domain don't change.

### Where the metadata comes from

| Source | Used for |
|---|---|
| Open Library (edition + work + author records) | Title, authors, publisher, edition year, pages, language, series, edition cover, description, subjects, author Wikidata ids |
| Google Books (keyless) | Gaps in the above, genres (categories), and a cover fallback. If it's over quota, it's skipped quietly |
| Wikidata (SPARQL) | First publication year, writing year ("inception"), original language, genres, and the **writing place** |

The writing place uses the best available evidence, in this order:
1. The work's recorded *location of creation*
2. The city of first publication
3. **The author's home town (birthplace)**
4. The country of publication

The book page says which of these was used, and the "?" links to the Wikidata record.
A field you edit by hand loses its source marker.

## Data schema (v1)

All records are plain JSON. A backup is `{ app, schemaVersion, books, locations, moves, settings }`.

**Location**: `{ id, kind: 'place'|'room'|'shelf', name, parentId, order, geo?, createdAt, updatedAt }`.
A place has no parent, a room's parent is a place, and a shelf's parent is a room. Shelves are optional and stay out of the way: the shelf picker only appears once a room has shelves.

**Book**
- *Bibliographic:* `title, subtitle, authors[], contributors[], publisher, publishedYear, firstPublishedYear, edition, language, originalLanguage, pageCount, format, isbn10, isbn13, identifiers{olid,gbid,oclc,lccn,wikidata…}, description, cover, genres[], subjects[], series, seriesNumber, writing{year,yearEnd,place{lat,lon,label},placeBasis}, sources[], provenance{field → {source,url,note}}`
- *Mine:* `ownership: owned|wishlist, locationId, tags[], collections[], status: unread|reading|read|abandoned, rating 1–5, startedOn, finishedOn, notes, condition, purchasedOn, price, signed, copies, lending{to,lentOn,dueOn}`
- *Meta:* `createdAt, updatedAt`

**MoveRecord** (location history): `{ id, bookId, fromId, toId, fromLabel, toLabel, at, batchId }`.
Labels are snapshots, so renaming a room later doesn't rewrite history. Moving a whole room logs a move for every book in it.

**UndoEntry**: before-images of the books and locations touched by an action, plus the ids it created. The last 20 entries are kept.

**Settings**: `defaultLocationId, theme, dateFormat, currency, view`.

`writing.place` and `Location.geo` power the planned map ("where were my books written / where are they now").

## Roadmap

- [x] **Phase 1: Foundation**
  - Schema, IndexedDB storage behind an interface, and the Library service with undo and move history
  - Locations: create, rename, reorder, move a whole room or shelf, and delete (asks where the books go)
  - Manual add with ISBN validation and duplicate detection (add another copy / separate entry / skip)
  - Library grid/list with sortable columns, search and a location filter
  - Book detail with quick status, rating and move, the full edit form, and lending return
  - Settings, plus a JSON backup and restore
  - PWA (offline, installable) and the GitHub Pages CI
- [x] **Phase 2: Adding books fast**
  - Camera ISBN scanner: native `BarcodeDetector` on Android, a bundled ZXing-WASM decoder elsewhere (precached, so it works offline)
  - Batch scan: preset location, beep/vibrate, a running list with per-item undo and "Undo last", and "Retry lookups" for books scanned offline
  - Repeated ISBNs (already owned, or already scanned in this batch) are never added silently: you confirm "another copy?" and it becomes a separate entry
  - Metadata lookup merged from Open Library, then Google Books (keyless), then Wikidata. Each field records its source, shown behind a "?" on the book page
  - Search by title/author
  - "Fetch missing details" on the book page fills only empty fields
- [x] **Backup (pulled forward)**
  - "Back up now" opens the phone's share sheet, so you can save straight to Google Drive or Files. On desktop it downloads a file
  - Each backup file has a date and time in its name, so new backups never overwrite old ones
  - The home screen reminds you if you've never backed up, after 20 changed books, or after 7 days with any change. "Later" snoozes it for a day
  - Restore checks the file first (wrong app, newer version, damaged records) and keeps a safety copy of the current library, so you can undo it
- [x] **Phase 3: Organising**
  - Combinable filters, shown as removable chips:
    - Place/room, author, genre, tag, collection, status, rating, format, language and year range
    - Lent out or overdue, owned or wishlist, no location, missing cover or missing details
  - Filters live in the URL, so back/forward works. They can be saved under a name
  - Group by location, author, genre or status. The list renders incrementally, so 5,000 books render in about 100 ms
  - Multi-select by checkbox or long-press, with "Select all in filter"
  - Bulk actions as one undoable step each: move, tags, collection, status, lend/return, owned/wishlist, delete
  - Tags & collections page (genres too): rename, merge by renaming onto an existing name, remove
- [x] **Speed first**
  - Adding a book waits for at most one quick lookup (under 3 s). Everything else is filled in in the background
  - Background fill-ins never overwrite your edits and don't interfere with Undo
  - Location pickers can create a new place or room inline
- [ ] **Phase 4: Insight & exchange**
  - Lending tracker
  - Stats dashboard and the map
  - Libib-compatible CSV export, and CSV import with column mapping
  - Printable location lists
  - Zotero export as CSL-JSON / RIS / BibTeX. Zotero imports these directly, so no API key is needed.
- [ ] **Phase 5: Google Drive sync**
  - Uses Drive's hidden per-app folder (`appDataFolder`). It's free, but needs a one-time OAuth client ID from a Google Cloud project
  - Plugs in behind `Repository.exportSnapshot/importSnapshot`

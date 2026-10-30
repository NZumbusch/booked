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

## Data schema (v1)

All records are plain JSON. A backup is `{ app, schemaVersion, books, locations, moves, settings }`.

**Location**: `{ id, kind: 'place'|'room'|'shelf', name, parentId, order, geo?, createdAt, updatedAt }`.
A place has no parent, a room's parent is a place, and a shelf's parent is a room. Shelves are optional.

**Book**
- *Bibliographic:* `title, subtitle, authors[], contributors[], publisher, publishedYear, firstPublishedYear, edition, language, originalLanguage, pageCount, format, isbn10, isbn13, identifiers{olid,gbid,oclc,lccn,wikidata…}, description, cover, genres[], subjects[], series, seriesNumber, writing{year,yearEnd,place{lat,lon,label}}, sources[]`
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
- [ ] **Phase 2: Adding books fast**
  - Camera ISBN scanner (`BarcodeDetector` with a ZXing-WASM fallback)
  - Batch scan mode: preset location, beep/vibrate, and a running list with undo
  - Metadata lookup merged from Open Library, Google Books (keyless) and Wikidata: original publication year, subjects, and where available the place of writing or publication
  - Search by title/author
- [ ] **Phase 3: Organising**
  - Combinable filters as chips, plus saved filters
  - Group-by and a virtualised list
  - Multi-select (long-press or checkbox), "select all in filter", and bulk actions (move, tags, collection, status, lend/return, delete)
  - Page for managing tags and collections (rename, merge, delete)
- [ ] **Phase 4: Insight & exchange**
  - Lending tracker
  - Stats dashboard and the map
  - Libib-compatible CSV export, and CSV import with column mapping
  - Printable location lists
  - Zotero export as CSL-JSON / RIS / BibTeX. Zotero imports these directly, so no API key is needed.

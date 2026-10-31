# Booked

A personal book catalogue in the spirit of Libib. It's a static, offline-first PWA built with Svelte 5 and Vite, and it's hosted on GitHub Pages.
All data stays on your device (IndexedDB). The app needs no backend and no API keys.

## What it does

- **Add books fast**
  - Camera barcode scanning, plus batch scanning straight into a chosen room
  - ISBN entry, title/author search, or a full manual form
  - Details come from Open Library, Google Books and Wikidata, filled in the background so adding never waits
  - Repeated ISBNs ask "another copy?" before adding
- **Know where everything is**
  - Place › room (› optional shelf), with counts at every level
  - Move single books, a selection, or a whole room. Every move goes into the book's history
- **Find and organise**
  - Search plus combinable filters as chips, which you can save
  - Grid or list, sorting and grouping
  - Multi-select with bulk actions
  - Tags/collections/genres management
  - Undo for every action
- **Discover**
  - "More like this" from your own shelves, plus topic pages (your books on a timeline, related topics, well-known books to wishlist)
  - Author pages with a Wikipedia bio in the author's language, influences and notable works
  - Connections: series gaps, shared movements, settings, awards and sources
  - A map of where books were written, where the stories are set, and where your books are
- **Cover wall**
  - All your covers as one field you can scroll forever in every direction (∞, the default); colours wrap seamlessly. Pinch, scroll or drag; tap to zoom; tap again for details
  - Switch ∞ off for one organic, roughly round field with a natural, uneven edge
  - Seamless: every cover gets the same 2:3 tile with no gaps; covers are cropped to fill (never stretched), taking less from the top where the title usually is
  - **Arrangements:**
    - Colour, as a colour wheel
    - Topic › subtopic, as seamless clusters with floating labels
    - Title, author › title, century › decade, place › room
  - **Topic dropdown:** narrows the field to one topic, clustered by its subtopics
  - **Topic tags** float over the clusters (broad topics zoomed out, subtopics closer in); the tag button hides them
  - Full screen: the arrangement/topic bar and the control pill float over the covers; status (filter, downloads) only appears when relevant
  - Zooming out stops while covers are still recognisable (about 15 across a phone); the ◎ button jumps back to the start
  - Tap a cover to zoom in and see which book it is; tap it again (or the card at the bottom) to open the book
  - Follows your library filter; "Show on wall" from any book; export as a poster image
- **Reading and analysis**
  - Up next queue, reading progress and a yearly goal
  - Stats: per month, pace, abandon rate, breadth (languages, centuries), what each room is about
  - List prices (DNB fixed German price, price barcode, Google) and collection value
  - Lending tracker with overdue highlighting
- **Keep it safe and portable**
  - Backups to Google Drive/Files with reminders, and safe restore
  - Optional Google Drive sync between devices
  - Libib-compatible CSV export, CSV import from Libib or Goodreads
  - Zotero export (CSL-JSON/RIS/BibTeX) and printable room lists
- **Works offline and installs like an app.** Data stays on your devices, and nothing needs an API key

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

## Google Drive sync setup

Sync keeps the library identical on all your devices. It's stored as a single file in Booked's **private app folder** on your Google Drive. That folder doesn't appear in "My Drive", and Booked is only allowed to see that folder.
Google requires an OAuth *client ID* to identify the app. It's free, and because the app runs entirely in the browser, there's no secret.

1. Open <https://console.cloud.google.com/>, then pick or create a project. The one for the Books API key works.
2. Go to **APIs & Services → Library**, search for **Google Drive API**, and choose **Enable**.
3. Set up the **OAuth consent screen** (also called *Google Auth Platform*):
   - User type **External**, app name "Booked", and your email.
   - Under **Audience / Test users**, add your own Google account(s). You can leave the app in *Testing*.
   - The only scope used is `…/auth/drive.appdata`.
4. Go to **Credentials → Create credentials → OAuth client ID**, with application type **Web application**.
   - Under **Authorized JavaScript origins**, add `https://<user>.github.io`. Add `http://localhost:5173` too if you develop locally.
   - No redirect URI is needed.
5. **Build it into the app** (once, so no device needs to paste anything):
   - On GitHub, open the repository → **Settings → Secrets and variables → Actions → Variables** tab → **New repository variable**.
   - Add `GOOGLE_CLIENT_ID` = your client ID. Optionally also `GOOGLE_BOOKS_KEY` (your Books API key) and, after the Worker is deployed, `SYNC_HELPER_URL` (its address).
   - Re-run the deploy: **Actions → Test & deploy to GitHub Pages → Run workflow**.
   - Every device then just shows **Connect Google Drive** in Settings.
   - (Without variables, you can paste the client ID into **Settings → Sync with Google Drive** on each device instead.)
6. **Privacy policy:** on the consent screen (*Branding*), use `https://<user>.github.io/<repo>/` as the home page and `https://<user>.github.io/<repo>/privacy.html` as the privacy policy. The app only uses the non-sensitive `drive.appdata` scope, so publishing it needs no review.

How it behaves:
- **Automatic syncing:** when the app opens, about 15 s after changes, when you come back online, and every 5 minutes.
- **Merging:** changes are merged per book, place and move, and the newer edit wins. Deletions are tracked, so a deleted book doesn't come back from another device. Undo and Restore propagate too.
- **Sign-in expiry:** without a helper, Google sign-ins last about an hour. Your next tap afterwards renews it automatically; Google's window flashes briefly, with no consent screen. If that's blocked, Home shows a one-tap "Reconnect". With the optional token helper (below), you stay signed in.
- **Settings stay per device:** theme, view, default location and keys aren't synced.
- **Backups:** a recent sync counts as a backup for the backup reminder. Exporting a file now and then is still a good idea.

## Stay signed in (optional token helper)

A website can only get one-hour Google tokens on its own. Staying signed in needs a *refresh token*, and Google only hands those out to a server that knows the client secret.
`worker/` contains a tiny **Cloudflare Worker** (free plan) that does exactly that:

- It exchanges your one-time sign-in for a refresh token, then turns that into new hourly tokens in the background.
- It stores nothing, only talks to Google's token endpoint, and only accepts requests from your app's address.
- The refresh token stays on your device. "Disconnect" revokes it.

**One-time setup** (about 10 minutes, needs Node.js on a computer):

1. **Get the client secret.** In the Google Cloud console, open **Credentials**, then your *Web application* OAuth client. Copy its **client secret**; create one there if none is shown.
2. **Publish the app.** In **Google Auth Platform → Audience**, choose **Publish app** ("In production").
   - In *Testing* mode, Google expires refresh tokens after 7 days.
   - Google may then show a "Google hasn't verified this app" screen once. Choose *Advanced → Go to Booked*. For an app only you use, verification isn't needed.
3. **Configure the Worker.** Edit `worker/wrangler.toml`: set `GOOGLE_CLIENT_ID` to your client ID, and `ALLOWED_ORIGIN` to `https://<user>.github.io`. To allow local development too, comma-separate a second address: `https://<user>.github.io, http://localhost:5173`.
4. **Deploy it.** Create a free account at <https://dash.cloudflare.com/sign-up>, then run:
   ```bash
   cd worker
   npx wrangler login                              # opens the browser once
   npx wrangler secret put GOOGLE_CLIENT_SECRET    # paste the secret from step 1
   npx wrangler deploy                             # prints https://booked-auth.<you>.workers.dev
   ```
5. **Connect the app.** Add the Worker address as the repository variable `SYNC_HELPER_URL` (see step 5 of the Drive setup) and re-run the deploy; then tap **Reconnect** once on each device. (Or paste it under **Settings → Sync with Google Drive → Stay signed in** on each device.)

The free plan allows 100,000 requests a day. Booked uses a handful.

## Shared places (family)

Share a place or room, e.g. *Flat A › Living room*, so family members can see, **add, edit and move** the books there from their own phones.

- **Everyone keeps their own library.** Only the shared room and its shelves are exchanged.
- **Taking a book out:** a book someone moves from the shared room into their own room stays listed in the shared room for everyone else, marked **"with Anna"**.
  - It shows as a badge in the library and on the book page, and in its own section on the Lending page. There's also a filter for it.
  - When it's moved back, or anyone taps **"It's back"**, the mark disappears everywhere.
  - Deleting a shared book removes it for everyone.
- **Who added what:** each person sets their name once, and books show "Added … by Anna".
- **Privacy:** data is encrypted on the phone (AES-GCM) before upload. The key exists only in the share link, after the `#`, so the server and Cloudflare only ever see unreadable data.
- **Automatic syncing:** when the app opens, a few seconds after changes, and every 2 minutes.
- **Family members need nothing set up:** they open the link, enter their name and tap **Join**. Anyone with the link can edit, so share it only with people who should.

**Setup (owner only).** This uses the same Cloudflare Worker as "Stay signed in", plus Cloudflare's free D1 database:

```bash
cd worker
npx wrangler d1 create booked-spaces          # prints a database_id
# paste it into wrangler.toml: uncomment the [[d1_databases]] block and set database_id
npx wrangler d1 execute booked-spaces --remote --file=schema.sql
npx wrangler deploy
```

If you only want sharing and not Drive sync, leave the Google values in `wrangler.toml` as they are. `ALLOWED_ORIGIN` must still be your app's address.
Then, in the app:
1. Enter the Worker address under **Settings → Shared places**, or under Sync › Stay signed in; both use the same field.
2. Go to **Places → Living room → Edit → Share with family… → Create share link**.
3. Tap **Send link…** and send it by WhatsApp, Signal or email.

To stop sharing, go to **Settings → Shared places → Stop**. That deletes the shared copy, and the link stops working. Everyone keeps their last copy.

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
      dexie-repository.ts    IndexedDB implementation (schema v2: + sync tombstones)
    metadata/                Open Library, Google Books, Wikidata, geocoding; quick + full lookup
    exchange/                CSV parse/write, Libib export, CSV import mapping, CSL-JSON/RIS/BibTeX
    sync/                    Drive sync: target interface, Drive client, Google sign-in, service, controller
    scanner/                 camera + barcode detection (native or WASM)
    services/
      library.ts             app service: in-memory model + persistence + undo + move history
      enrich.ts              background completion of book details
    stores/app.ts            Library singleton, toasts, error handling
    ui/                      reusable components (Cover, LocationPicker, BookForm, Dialog…)
    router.ts, format.ts, images.ts
  routes/                    one component per screen
tests/setup.ts               fake IndexedDB + testing-library cleanup
.github/workflows/deploy.yml CI + GitHub Pages deploy
worker/                      optional Cloudflare Worker: keeps Google Drive sync signed in; stores shared places (D1)
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
| Deutsche Nationalbibliothek (SRU, MARC 21) | German book details and the **fixed German/Austrian list price** |
| Wikidata (SPARQL) | First publication year, writing year ("inception"), original language, genres, the **writing place**. For Discover: series and volume numbers, "based on", main subjects, where the story is set, awards, movements, and authors' life, influences and languages |
| Wikipedia (REST) | Author bios. German or English, whichever is the author's own language; otherwise German, then English |
| Open Library subjects | Related topics and the best-known books on a topic |

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
- [x] **Phase 4: Insight & exchange**
  - **Lending tracker** grouped by borrower, with overdue books highlighted and one-tap "Returned"
  - **Stats:**
    - Totals, plus books read per year (with a table view)
    - Counts per status, place and room, top authors, genres, and first-publication decade
    - Every bar links to the matching filtered list
  - **Map:**
    - "Where they were written" shows the writing place, with the evidence used noted in each popup
    - "Where they are" shows your places. Set a place's map position via OpenStreetMap search under Places › Edit
    - Tiles you've viewed are cached for offline use
  - **Import & export page:**
    - Libib-compatible CSV export (Libib's columns, then all Booked fields)
    - Zotero export as CSL-JSON, RIS or BibTeX. Zotero imports these directly with File › Import, so no API key is needed
    - CSV import with automatic column mapping for Libib, Goodreads and Booked files, which you can adjust before importing
    - Optionally skips duplicates. Missing places/rooms are created, details are filled in in the background, and the whole import is one undo step
  - **Printable list** per place or room, grouped by room/shelf and sorted by author. Print it, or save it as a PDF
- [x] **Shared places**
  - A family can add and edit books in a shared room, with live sync, end-to-end encryption and "Added by"
- [x] **Phase 5: Google Drive sync**
  - Optional Cloudflare token helper (`worker/`) to stay signed in. Without it, the sign-in renews automatically on your first tap after it expires
  - Works through Drive's hidden per-app folder (`appDataFolder`), and needs no backend
  - Merges per record with deletion markers (tombstones). Optimistic concurrency: if another device writes during a sync, it merges again
  - See "Google Drive sync setup" above

## Testing

- `npm test` runs about 200 unit and component tests. They cover the domain logic, storage, metadata adapters (with real recorded API responses in `src/lib/metadata/fixtures`), import/export, sync merge and the Drive client.
- During development, each phase was also exercised end to end in a headless browser:
  - Live lookups, and a fake camera feed showing printed barcodes
  - A generated 5,000-book library
  - Offline reload
  - Backup/restore, and sync against a simulated Drive

### Prices

- **Germany and Austria:** fixed book prices come from the Deutsche Nationalbibliothek, e.g. `EUR 24.00 (DE), EUR 24.70 (AT)`.
- **English-language books:** many have a small 5-digit price barcode next to the ISBN. The scanner reads it after the ISBN without slowing scanning, e.g. `51699` = $16.99, `0xxxx` = £, `6xxxx` = CA$.
- **Google Books:** its print prices are used as a fallback. Its e-book prices are ignored, because they'd be misleading.
- **Collection value:** uses what you paid where you recorded it, otherwise the list price, summed per currency.
- **No used-market value:** there's no free source for second-hand prices.

### Choosing a different cover

Tap the cover on a book's page to see the covers of its other editions (Open Library and Google Books): your own edition first, then the same language.
- The covers lie in loose piles. Tap one to pull it out and see it full size, swipe sideways to flip through, swipe down to put it back, and tap **Use this cover** to take it.
- **Use my own photo** takes a picture (or picks one from your photos) and uses that instead.
- Changing a cover can be undone right away.

### Covers on this device

- **What's saved:** every cover is downloaded once and stored on the device in its own database, separate from your backups and sync. The colours of each cover are analysed (main colour, palette, "is this a real cover?") for the cover wall.
- **When it downloads** (Settings → Covers on this device):
  - **Only on Wi-Fi** (the default), on any connection, or off.
  - Android Chrome reports whether it's on Wi-Fi. iPhone browsers don't, so Booked asks once ("Download covers now?") instead of guessing.
  - Data saver is respected for automatic downloads.
  - **Downloading on mobile data:** tapping *Download* when not on Wi-Fi asks first and shows the estimated size; confirm and it downloads anyway.
- **Resolution:** small (360 px), medium (540 px, the default), large (900 px) or extra large (1350 px).
  - The storage estimate is based on your library. After the first downloads, it uses your real average.
  - Covers are never upscaled beyond what the catalogue has.
  - Switching up re-downloads in the background; switching down shrinks locally.
- **Google Books covers:** they don't allow reading their pixels directly. With the Cloudflare helper configured, they go through its `/img` pass-through.

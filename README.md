# LocalLog

Simple time tracking for your projects, in your browser. **Your data stays on your computer.**

LocalLog is a web app (a Progressive Web App) that you can open in Chrome or Edge and install like a regular program. The app files are delivered from a website, but everything you enter is saved only on your own device. LocalLog has no account, no server database and no tracking.

The interface is available in **English** and **German** (switch with EN | DE in the header).

---

## What you can do

* Track time with a timer, or add entries by hand.
* Organise work by **customer → project**, and add an optional **ticket** (Jira or any other system) to each entry. If a project has a ticket link, ticket numbers become clickable.
* **Pause and resume**: each pause closes the current entry and resuming starts a new one for the same project, note and ticket. Resuming within a minute simply continues the same entry.
* **Forgot to start?** Move the start back with the **−5 min** and **−15 min** buttons, or click the start time next to the stopwatch and type a new one.
* **Edit entries directly in the table**: click a cell, change it, press Enter (Esc cancels).
* **Export** the table: copy it and paste into Excel, or download a CSV file. Choose today, this week, this month or everything.
* **Day tab** for transferring hours into another system: hours per project for one day, rounded to 15 minutes, with a copy button and a "transferred" tick per project.
* **Week tab**: a timesheet grid with projects as rows and Monday to Sunday as columns.
* **Adjacent entries**: when you change a time that touches the next or previous entry, LocalLog asks whether to move that one too.
* Optional **rates** (per customer, per project) and values in EUR.
* Optional **reminder** every 30 or 60 minutes, and an optional always-on-top mini window (Chrome and Edge).
* Works on a **phone** too (the entries are shown as cards).

Numbers, dates and times follow your browser's regional settings.

---

## How it works

* **Keyboard shortcuts:** Alt+S start or pause, Alt+C copy the table, Alt+P mini window.
* **Changing the project while a timer runs:** within the first 2 minutes the running entry is corrected. A message "Project corrected" with an **Undo** button appears for 8 seconds. After that, the entry ends and a new one starts for the new project.
* **−5 / −15 min and the start time:** these move the start of the running entry. A typed time that has not happened yet today means yesterday. If the new start overlaps another entry, you get a warning and nothing else is changed.
* **Pause and resume:** a pause closes the entry. Resuming within 1 minute continues it; later, a new entry starts.
* **Prompts:** after a reload, LocalLog only asks about a running timer when the app was closed for more than 5 minutes. If the computer was asleep for more than 10 minutes, it asks whether to keep that time, remove it as a break or stop at the start of the gap. A timer that runs longer than 10 hours or across midnight asks whether you are still working.
* **Snap to quarter hours (optional, Settings):** the timer rounds start and stop to the nearest quarter hour. Manual edits are never rounded.
* **Several tabs:** all open LocalLog tabs show the same data and the same timer; a change in one tab appears in the others within a second.
* **Updates:** when a new version is available, a banner offers a Reload button. LocalLog never reloads by itself.

---

## Day view and transferring hours

The **Day** tab lists every project you worked on that day as "Customer › Project", with the hours rounded to 15 minutes in large type and the exact time next to it (for example "2,25 h · exact 2:17").

* **Copy** puts the rounded hours (in your browser's number format, e.g. `2,25`) on the clipboard.
* **Transferred** stores a mark for that day and project. If an entry changes later so that the rounded value differs, the mark shows "changed since transfer (was 2,25)". Marked days are not locked.
* A project whose timer is still running counts up to now; its tick box is disabled until the timer stops.
* **Export day** copies or downloads the per-project rows (`locallog-YYYY-MM-DD-day.csv`).
* **Add entry** opens the usual dialog with the selected day.
* Below the list you see the entries of that day, oldest first.

## Week timesheet

The **Week** tab shows a grid: one row per project, one column per day (Monday to Sunday), with row, day and week totals. Each cell is the rounded day value, so the week always matches what you transferred day by day. Cells carry the transfer mark; clicking a cell or a day heading opens that day. **Export week** copies or downloads the grid as it looks.

### Rounding and midnight

* The evaluations round **each day and project** to 15 minutes (nearest). The entry list and the entry export stay exact.
* For the evaluations, an entry across midnight is split at midnight (23:00–01:00 counts 1 h on each day). The stored entry is not changed and the entry list shows it once.

## Adjacent entries

Two entries are adjacent when one ends within a minute of the other's start. When you edit that shared time, LocalLog asks: **Move both**, **Only this entry** or **Cancel** (Enter = Move both, Esc = Cancel). "Move both" saves both entries at once. In the Day view the shared time appears as one row between the entries; a gap shows **Extend previous** and **Extend next** buttons, and an overlap shows buttons that shorten instead.

## Where your data lives, and its limits
';
'LocalLog keeps `customers.csv`, `projects.csv`, `entries.csv` and `meta.csv` there up to date.' = 'LocalLog keeps `customers.csv`, `projects.csv`, `entries.csv`, `transfers.csv` and `meta.csv` there up to date. Backups from version 0.2.0 (without `transfers.csv`) can still be loaded.';
'js/core/              Pure logic without DOM access (time, rounding, format, csv, export, backup, validate)' = @'
js/core/              Pure logic without DOM access (time, rounding, format, csv, export, backup, validate)
js/core/report.js     Day and week evaluations (rounding per day and project, midnight split)
js/core/adjacent.js   Adjacent entries and linked boundaries

* Your entries are stored **only in this browser on this computer**. Other browsers and other computers do not see them.
* If you **clear your browser data**, your entries are deleted.
* In a **private window**, entries are lost when the window closes. LocalLog shows a warning in that case.
* The browser may clean up stored data when the disk is very full, unless it grants LocalLog protection. The "Your data" card shows whether the data is protected.

### How to back up

* **Backup folder** (Chrome and Edge): under *Settings*, choose a folder. LocalLog keeps `customers.csv`, `projects.csv`, `entries.csv` and `meta.csv` there up to date. If the browser asks for permission again after a restart, use the *Reconnect folder* button.
* **Download**: *Settings → Download backup files* saves the same files at any time.
* The "Your data" card shows when the last backup was made and turns amber after 7 days.
* When you choose a folder that already contains LocalLog files, you decide whether to load the folder's data into the browser or to replace the folder's files with the browser's data.

---

## For developers

Plain HTML, CSS and ES modules. **No dependencies and no build step.**

### Structure

```
index.html            Page, with the Content Security Policy
sw.js                 Service worker (offline cache)
manifest.webmanifest  Install information
css/app.css           Styles (no inline styles anywhere)
css/pip.css           Styles for the mini window
icons/                App icons
tools/                Developer tools (check.mjs, serve.mjs)
LICENSE               MIT License
CHANGELOG.md          Version history
js/version.js         APP_VERSION and SCHEMA_VERSION
js/app.js             Start-up, timer controls, header, tabs, shortcuts
js/i18n.js            English and German texts
js/state.js           In-memory copy of the data for the screens
js/storage.js         IndexedDB access (database "locallog")
js/backup.js          Backup folder, downloads, storage protection
js/timer.js           Timer (pause = segment)
js/ambient.js         Mini window, tab icon, title, reminder
js/core/              Pure logic without DOM access (time, rounding, format, csv, export, backup, validate)
js/ui/                Screen code (entries.js, entry-editor.js, boundary-dialog.js, day.js, weekly.js, ...)
```

The modules in `js/core/` never touch the DOM so that unit tests can be added later.

### Security policy

`index.html` sets `connect-src 'none'`, so the app cannot send data over the network, and it forbids inline scripts and styles. Therefore: **never add `style="..."` attributes or inline `<script>`**. Put styles in `css/`. Set dynamic colours from JavaScript with `element.style.setProperty(...)`, which is allowed.

### Run locally

Service workers and ES modules need a web server (opening `index.html` as a file does not work). With Node installed (no packages needed):

```bash
node tools/serve.mjs
```

then open <http://localhost:8090/>. The server sends `Cache-Control: no-cache`; pass another port as an argument (`node tools/serve.mjs 8123`).

**Offline cache while developing:** the service worker keeps the app files, so a normal reload can show old code. Either bump the version (see below) or, in the browser's developer tools, open *Application → Service Workers* and tick *Update on reload*.

### Check before a release

```bash
node tools/check.mjs
```

It fails when `APP_VERSION` and the `VERSION` in `sw.js` differ, when a file in `js/` or `css/` is missing from `ASSETS_TO_CACHE`, or when an entry in that list does not exist.

### Bump the version

The version is kept in two places that must always be changed together:

1. `APP_VERSION` in `js/version.js`
2. `VERSION` at the top of `sw.js`

A new version changes `sw.js`, so the browser installs the new service worker, which loads fresh files into a new cache (`locallog-<version>`) and removes the old one. Open pages show a Reload banner when the new version takes over. If you add or remove a file, update `ASSETS_TO_CACHE` in `sw.js` as well; `node tools/check.mjs` tells you if you forgot. If the data layout changes, increase `SCHEMA_VERSION`.

### Deploy to GitHub Pages

1. Push the repository to GitHub.
2. In the repository settings, open **Pages**, choose the `main` branch as the source and save.
3. Open `https://<your-username>.github.io/<repo-name>/` and install the app from the browser's address bar.

---

MIT License. A personal side project, provided as is, without warranty.

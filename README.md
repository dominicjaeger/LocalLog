# LocalLog

Simple time tracking for your projects, in your browser. **Your data stays on your computer.**

LocalLog is a web app (a Progressive Web App) that you can open in Chrome or Edge and install like a regular program. The app files are delivered from a website, but everything you enter is saved only on your own device. LocalLog has no account, no server database and no tracking.

The interface is available in **English** and **German** (switch with EN | DE in the header).

---

## What you can do

* Track time with a timer, or add entries by hand.
* Organise work by **customer → project**, and add an optional **ticket** (Jira or any other system) to each entry. If a project has a ticket link, ticket numbers become clickable.
* **Pause and resume**: each pause closes the current entry and resuming starts a new one for the same project, note and ticket.
* **Edit entries directly in the table**: click a cell, change it, press Enter (Esc cancels).
* **Export** the table: copy it and paste into Excel, or download a CSV file. Choose today, this week, this month or everything.
* **Weekly overview** with hours per customer and project (Monday to Sunday).
* Optional **rates** (per customer, per project) and values in EUR.
* Optional **reminder** every 30 or 60 minutes, and an optional always-on-top mini window (Chrome and Edge).

Numbers, dates and times follow your browser's regional settings.

---

## Where your data lives, and its limits

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
js/version.js         APP_VERSION and SCHEMA_VERSION
js/app.js             Start-up, timer controls, header, tabs, shortcuts
js/i18n.js            English and German texts
js/state.js           In-memory copy of the data for the screens
js/storage.js         IndexedDB access (database "locallog")
js/backup.js          Backup folder, downloads, storage protection
js/timer.js           Timer (pause = segment)
js/ambient.js         Mini window, tab icon, title, reminder
js/core/              Pure logic without DOM access (time, format, csv, export, backup, validate)
js/ui/                Screen code
```

The modules in `js/core/` never touch the DOM so that unit tests can be added later.

### Security policy

`index.html` sets `connect-src 'none'`, so the app cannot send data over the network, and it forbids inline scripts and styles. Therefore: **never add `style="..."` attributes or inline `<script>`**. Put styles in `css/`. Set dynamic colours from JavaScript with `element.style.setProperty(...)`, which is allowed.

### Run locally

Service workers and ES modules need a web server (opening `index.html` as a file does not work). Use any static server, for example:

```bash
npx serve .
```

or

```bash
python -m http.server 8080
```

then open the printed address (for example `http://localhost:8080`).

### Bump the version

The version is kept in two places that must always be changed together:

1. `APP_VERSION` in `js/version.js`
2. `VERSION` at the top of `sw.js`

A new version changes `sw.js`, so the browser installs the new service worker, which loads fresh files into a new cache (`locallog-<version>`) and removes the old one. Open pages reload once when the new version takes over. If you add or remove a file, update `ASSETS_TO_CACHE` in `sw.js` as well. If the data layout changes, increase `SCHEMA_VERSION`.

### Deploy to GitHub Pages

1. Push the repository to GitHub.
2. In the repository settings, open **Pages**, choose the `main` branch as the source and save.
3. Open `https://<your-username>.github.io/<repo-name>/` and install the app from the browser's address bar.

---

MIT License. A personal side project, provided as is, without warranty.

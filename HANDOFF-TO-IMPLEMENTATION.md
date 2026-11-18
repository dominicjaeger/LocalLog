# LocalLog – Implementation Handoff

Status: agreed plan, not yet implemented (2026-11-18).
This document supersedes the "Status & Roadmap" section of `HANDOFF.md`. The roadmap there marks features as done and verified, but several of them are broken (see "Known bugs" below).

---

## 1. Product summary

LocalLog is a **Progressive Web App (PWA) for project time tracking**, aimed at **non-technical users**.

- It is **hosted on the web** (GitHub Pages), but **all user data stays on the user's device**. The server only delivers the app files.
- Users track time against **Customers → Projects**, edit entries directly in the table, add an optional ticket reference (Jira or any other system), and export the table for Excel.
- The interface is available in **English and German**.

---

## 2. Decisions (binding)

| # | Decision |
|---|---|
| D1 | **PWA only.** No PowerShell application. Delete `LocalLog.ps1` and `Start-LocalLogPwa.ps1`. Desktop-only features (microphone call-end watcher, tray icon, corner orb) are dropped. Lock-screen detection via `IdleDetector` is an optional later extra. |
| D2 | **Hosted on the web** (GitHub Pages). This is an accepted change. |
| D3 | **All data is stored locally**: IndexedDB, plus an optional folder backup via the File System Access API. Zero telemetry, zero external APIs. |
| D4 | **Network sending blocked by Content Security Policy** with `connect-src 'none'` (see §5). |
| D5 | **Semantic versioning, starting at `0.1.0`.** Single source of truth: `js/version.js`. |
| D6 | **Number, date and time formats follow the browser locale** (`Intl.*` with `undefined` locale). Nothing on screen mentions a locale. |
| D7 | **Interface language toggle EN \| DE** in the header. The default comes from `navigator.language` (`de*` → German, otherwise English); the choice is persisted. |
| D8 | **No visible technical jargon.** Terms like IndexedDB, File System Access API, Service Worker, Document PiP, TSV, WCAG and de-AT are not shown. Technical details live in a collapsed "Technical details" section under About. |
| D9 | **No WCAG claims in the interface.** Keep sensible keyboard behaviour, but don't advertise it. |
| D10 | **Remove the AI-looking iconography**: all emoji in the interface and the glowing gradient app icon. |
| D11 | **Two-tier hierarchy: Customer → Project.** |
| D12 | **Optional ticket reference per entry**, with an optional link pattern per project. |
| D13 | **"Export"** replaces "Copy for Excel". |
| D14 | **Inline editing** of date, start, end, customer/project, ticket and note directly in the entries table. |
| D15 | **No data migration needed.** Start with a clean database and remove the legacy seed/upgrade code. |
| D16 | **Storage limits are visible to the user** (see §6). |
| D17 | **Pause = segment.** Pausing closes the current entry and resuming starts a new entry with the same project, note and ticket. Every entry is therefore exactly `start → end`, and duration = end − start. |
| D18 | **Zero dependencies, zero build** for the shipped app (plain HTML/CSS/ES modules). |
| D19 | **Automated tests are deferred**, but keep the logic in pure modules (no DOM access) so unit and end-to-end tests can be added later. |

### Defaults for minor open points (change if the owner objects)
- **Colour per customer, rate per project.** A project with an empty rate falls back to the customer's default rate.
- Weeks run **Monday–Sunday**.
- The default UI theme stays light; the dark toggle is kept.

---

## 3. Known bugs in the current code (fix in Phase 1)

1. **Critical – timer saves destroy entries.**
   - The pause, stop and 60-second checkpoint saves call `saveEntry` with a partial object, and `store.put` replaces the whole record (`js/timer.js:90`, `js/timer.js:122`, `js/timer.js:171`). `startTime` and `note` are lost.
   - `getEntries` → `formatDateAT(Invalid Date)` then throws a `RangeError`, so the entries table and today's total stop rendering. Crash recovery (`recoverUnclosedEntries`) can't work either.
   - *Fix:* resolved by D17 plus a read-modify-write `updateEntry(id, patch)`.
2. **Buttons that do nothing:**
   - `btnAddEntryManual`, the `formEntry` submit, `btnDlgEntryClose`, `btnDlgEntryCancel`, the change listeners for the live duration preview, and `btnResetProjects` have no handlers in `js/app.js`.
   - The Edit dialog opens, but Save just closes it (`method="dialog"`).
3. **Folder "2-way sync" only writes.** `bindLocalDirectory` overwrites existing CSVs in the chosen folder (`js/storage.js:280`). `parseCsv` is never used.
4. **Folder access is lost silently after a reload.** `verifyPermission` calls `requestPermission` without a user click on startup (`js/storage.js:118`); this fails and sync stops without any message.
5. **Formula protection only covers the note** in the export, not the project name (`js/csv.js:154`).
6. **Code updates never reach users.** The service worker serves cached files first under a fixed cache name `locallog-v1.0.0` (`sw.js:2`).
7. **Check-in "Switch / Stop" only scrolls the page.** It should focus the project picker or stop the timer.
8. **Today's total is formatted by hand** (`toFixed().replace`) instead of with the locale formatter (`js/app.js:421`).

---

## 4. Target data model (IndexedDB, new DB name `locallog`, version 1)

```
customers: { id, name, colorHex, defaultRate|null, isActive, createdAt }
projects:  { id, customerId, name, hourlyRate|null, ticketUrlTemplate|null, isActive, createdAt }
entries:   { id, projectId, startTime (ISO), endTime (ISO|''), note, ticket, createdAt, updatedAt }
settings:  { key, value }   // language, theme, dirHandle, lastBackupAt, welcomeSeen, persistGranted, exportRange
```

- **Entries:** duration is derived as `endTime − startTime`; no stored `durationSeconds`. An entry with an empty `endTime` is the running timer.
- **Running timer survives a reload:** on startup, an entry with an empty `endTime` becomes the running timer again. Show a prompt: "Timer for X has been running since HH:mm – keep running / stop at last activity / stop now".
- **Deactivating a customer** hides all of its projects from the picker.
- A customer or project can't be deleted while entries reference it; it can only be deactivated.
- **Seed on first run:** one customer, "Internal", with one project, "General". No demo data.
- **Folder backup files:** `customers.csv`, `projects.csv`, `entries.csv`.
  - Locale-neutral format: UTF-8, `,` separator, ISO timestamps, `.` decimals.
  - Plus `meta.csv` with `AppVersion` and `SchemaVersion`.

---

## 5. Content Security Policy

Add to `index.html` `<head>`:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">
```

Requirements this creates:
- **No inline `style="..."` attributes and no inline `<script>`.** Move every inline style in `index.html` and in JS-generated markup into `css/app.css` classes.
  - Dynamic colours (project/customer dots) must be set via `element.style.setProperty(...)` from JS. That is allowed under `style-src 'self'`; only attribute/inline `<style>` is blocked.
- **The Picture-in-Picture window** currently injects a `<style>` block (`js/ambient.js:63`). Load `css/pip.css` into it via a `<link>` element instead, or copy rules through `adoptedStyleSheets`.
- **The dynamic favicon** uses a `data:` URL, which `img-src data:` allows. Downloads use `blob:` URLs.
- **The service worker** is unaffected: it runs under its own (empty) policy and can still cache app files.
- **Ticket links** are normal `<a target="_blank" rel="noopener noreferrer">` navigations started by the user, which `connect-src` doesn't block. This is intended.

---

## 6. Visible storage limits (user-facing)

All texts in EN and DE, written in plain language.

1. **Welcome panel** (first run; can be reopened from Help/About). Explains:
   - Your data stays only in this browser on this computer.
   - Other browsers and computers won't see it.
   - Clearing your browser data deletes it.
   - Set up a backup folder or export regularly.
   Buttons: "Choose backup folder", "Got it".
2. **"Your data" card on the main screen** (replaces the "Local Storage Status" card):
   - Where data is saved: "This browser" / "This browser + folder *Name*".
   - Protection status: the result of `navigator.storage.persist()` ("Protected from automatic cleanup" / "May be cleaned up by the browser").
   - "Last backup: never / today / 5 days ago". Turns amber after 7 days and shows a "Back up now" button.
   - `lastBackupAt` is updated on a successful folder write or a CSV download.
3. **Private-window warning banner.** Use a heuristic: a small storage quota from `navigator.storage.estimate()`, or `persist()` being refused. Text: "Private window: your entries will be lost when this window closes."
4. **Folder-access-lost banner.** Shown when a folder handle exists but permission is `prompt`. Its "Reconnect folder" button calls `requestPermission` from the click.
5. **Request permanent storage** with `navigator.storage.persist()` on first data entry.

---

## 7. Phases and tasks

### Phase 1 – Foundation
1. Delete `LocalLog.ps1` and `Start-LocalLogPwa.ps1`. In the README, document a local test command for developers only (e.g. `npx serve` or `python -m http.server`).
2. Add `js/version.js` with `export const APP_VERSION = '0.1.0'`.
   - Show it in the header badge and the footer.
   - Make `sw.js` use `CACHE_NAME = 'locallog-' + VERSION`. Keep the version string in `sw.js` and in `version.js` and note that both must be bumped together, or use a classic `version.js` loaded with `importScripts`.
   - Remove "v2.0 PWA".
3. Add the CSP (§5) and move all inline styles into `css/app.css`; give the PiP window its own stylesheet.
4. Separate logic from screen code. Pure modules, with no DOM access:
   - `js/core/time.js`: durations, overlap checks, week ranges, segment handling.
   - `js/core/format.js`: `Intl` formatting with the browser locale.
   - `js/core/csv.js`: parse, serialize, formula protection.
   - `js/core/export.js`: table rows, date-range filters, clipboard text, CSV download content.
   - `js/core/validate.js`.
   Screen code stays in `js/app.js` and the `js/ui/*` modules.
5. Implement D17 (pause = segment) and `updateEntry(id, patch)`. Remove `durationSeconds`. This fixes bug 1.
6. Connect all the buttons that do nothing (bug 2) and fix bugs 5–8.
7. Remove the legacy seed and upgrade code (`Project Alpha` handling) and start a clean DB (D15).

### Phase 2 – Data
8. Customers and projects (§4):
   - CRUD screens: Customers tab with nested projects, or one "Customers & Projects" tab with grouping.
   - Picker with `<optgroup>` per customer.
9. Ticket field:
   - Input in the timer bar, column in the table, field in the add dialog.
   - Per-project `ticketUrlTemplate` with `{ticket}` placeholder; render as a link when set.
   - Validate that the template starts with `https://`.
10. Safe folder backup (fixes bugs 3–4):
    - When a folder is linked and already contains LocalLog CSVs, ask: "Load data from this folder" (replaces the browser data, after confirmation) or "Replace folder files with data from this browser".
    - Write files atomically where possible (write to `*.tmp`, then rename via `move()` where supported; otherwise overwrite).
    - Handle reconnect through the banner (§6.4).
11. Permanent storage request and the `lastBackupAt` tracking (§6).

### Phase 3 – Interface
12. **Internationalisation:**
    - `js/i18n.js` with `en` and `de` dictionaries.
    - `data-i18n` attributes for static markup; `t(key, params)` for dynamic text.
    - EN | DE toggle in the header, persisted.
    - Covers everything: notifications, confirm dialogs, error messages, export headers, welcome panel, banners.
    - Set the `lang` attribute on `<html>`.
13. **Icons (D10):**
    - Remove all emoji from the markup and JS strings.
    - Use plain text buttons, plus a minimal hand-written inline SVG outline icon set (edit, delete, export, settings, theme, mini-window), used sparingly.
    - Replace `icons/icon.svg` with a flat, simple mark: no gradients, glow or orb.
    - Regenerate `icon-192.png` and `icon-512.png` (maskable safe zone) from it.
14. **Plain wording (D8):**
    - Rename the tabs: "Entries", "Customers & Projects", "Settings", "About".
    - Remove "Enterprise", "Zero Network Traffic", "IndexedDB", "WCAG", "Austrian Locale", "Light Theme Default" and "Test 30-Min Notification Card Now" from the interface.
    - Add the collapsed "Technical details" section under About.
15. **"Your data" card, welcome panel and warning banners** (§6).
16. **Inline table editing (D14):**
    - Click or Enter on a cell turns it into an input: date, time, a grouped customer/project select, text for ticket and note.
    - Enter or blur saves; Esc cancels.
    - Validation: end after start; an overlap with another entry shows a warning but still allows saving.
    - Duration and hours update immediately; the running entry is not editable except for note and ticket.
    - The dialog remains only for "Add entry".
17. **Export (D13):**
    - An "Export" button with a menu: "Copy table" (tab-separated, for pasting into Excel) and "Download as CSV" (UTF-8 with BOM; `;` separator when the locale's decimal separator is `,`).
    - Range selector: Today / This week / This month / All. The choice is persisted.
    - Columns: Date, Start, End, Customer, Project, Ticket, Duration, Hours, [Rate, Value], Note.
    - Formula protection on all text cells.
18. **Weekly overview:**
    - Week picker (previous / this / next).
    - Hours per customer → project with simple CSS bars, and a total.
    - Optional EUR values (same toggle as the export).
    - "Export week" reuses the export module.
19. **Check-in reminder:**
    - Keep the 30-minute reminder, configurable as off / 30 / 60 minutes.
    - Its "Switch / Stop" button focuses the project picker; a separate "Stop" button stops the timer.

### Phase 4 – Finish
20. Rewrite `README.md`:
    - User-facing: what it is, where data lives, its limits, how to back up.
    - Developer section: structure, local test server, how to bump the version.
21. Rewrite the `communication` drafts for the web-hosted PWA. Remove the mic/lock/tray claims and mention web hosting plus local-only data.
22. Update `HANDOFF.md` so it points to this document and reflects the real status.
23. Deploy to GitHub Pages and check the install, offline and CSP behaviour manually in Chrome and Edge.

### Deferred
- Automated tests: unit tests with `node --test`; end-to-end tests with Playwright, including a "no network requests" and a CSP check; a GitHub Actions workflow that gates deployment. The pure modules from task 4 are the preparation for this.
- Optional lock-screen detection via `IdleDetector`.

---

## 8. Done criteria (manual check per phase)
- No console errors. No network requests after the initial load (DevTools → Network). The CSP is active (a test `fetch()` in the console is blocked).
- Timer start → pause → resume → stop creates two correct entries, and the table renders.
- Every visible text switches between EN and DE; no emoji remain; no technical terms appear outside "Technical details".
- Formats follow the browser locale (check with the browser set to `en-US` and to `de-AT`).
- Version `0.1.0` is visible, and a version bump makes the app load the new files.

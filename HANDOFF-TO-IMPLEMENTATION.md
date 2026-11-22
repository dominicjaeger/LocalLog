# LocalLog – Implementation Handoff (Round 2 → version 0.2.0)

Status: implemented in version 0.2.0 (2026-11-22); see [CHANGELOG.md](CHANGELOG.md) and the status in [HANDOFF.md](HANDOFF.md).
Open topics that still need a decision are tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). **Don't implement anything listed there as open**; build only what this document describes.

---

## 0. Context

**Round 1 (version 0.1.0) is implemented.** It covers:
- the PWA foundation and the Content Security Policy (`connect-src 'none'`);
- pure logic modules in `js/core/`;
- customers → projects, tickets;
- English/German interface;
- inline table editing, export, weekly overview;
- the "Your data" card, backup folder and reminders.

The binding architecture rules are in [HANDOFF.md](HANDOFF.md) (PWA only, all data local, no inline styles or scripts, formats follow the browser locale, every text in English and German, logic in pure modules, no emoji or jargon in the interface).

**Round 2 basis:** a code review and test session on 2026-11-22:
- 24 logic checks with Node;
- in-browser tests: timer, reload, two tabs, 4,700 entries, phone width, dark mode, security policy and offline mode.

Section 2 lists the bugs it found.

---

## 1. Decisions for round 2 (binding)

| # | Decision |
|---|---|
| R1 | The next version is **0.2.0**. Bump `js/version.js` and `sw.js` together. |
| R2 | **Remove `server.ps1`.** There is no PowerShell in the repository. |
| R3 | **The layout must work on phones** (375 px wide) without horizontal page scrolling. |
| R4 | **A running entry's start time can be moved back** with quick buttons **−5 min** and **−15 min**, by clicking the start time next to the stopwatch, and in the table's start cell. |
| R5 | **Overlap with the previous entry only gives a warning.** Nothing is changed automatically. |
| R6 | **Changing the project within the first 2 minutes of a running entry corrects that entry** (it changes its project) instead of starting a new one. After 2 minutes it switches as today. The rule is to be reviewed later (see OPEN-QUESTIONS). |
| R7 | **The rounding grid is always 15 minutes.** |
| R8 | **The rounding direction is "nearest" for now**, but the code must support "up" and "down" through a setting, so it can become user-selectable later without a rewrite. |
| R9 | **There is no minimum duration.** |
| R10 | **Snapping start and stop times to the 15-minute grid is an opt-in setting**, off by default. |
| R11 | **All open tabs stay in sync.** |
| R12 | **Resuming within 1 minute of a pause continues the previous entry** instead of creating a new one. |
| R13 | **The "timer was running" prompt after a reload only appears when the last sign of activity is more than 5 minutes old.** Otherwise the timer simply continues. |
| R14 | **No browser permission prompts for away detection** (no `IdleDetector` for now). Away time is detected from gaps in the app's own heartbeat. |
| R15 | **Long-running warning:** when a timer runs longer than 10 hours or across midnight. |

**Still open (don't build):**
- what exactly gets rounded and shown (per entry or per day and project);
- the export columns for rounded hours.

See OPEN-QUESTIONS.

---

## 2. Bugs found on 2026-11-22 (to fix in this round)

| # | Severity | Bug | Where |
|---|---|---|---|
| B1 | High | **Two open tabs overwrite each other.** I stopped the timer in tab 1; tab 2 still showed it running. Pausing in tab 2 changed the stopped entry's end time and created a new running entry. | `js/timer.js` (cached `this.running`); no cross-tab notification |
| B2 | High | **Editing the running entry in the table isn't seen by the timer.** The timer bar keeps the old note and ticket, and after pause → resume the next segment gets the old values back. | `js/timer.js` keeps its own copy; `js/ui/entries.js` writes to the database directly |
| B3 | Medium | **"Load from folder" doesn't validate enough.** Duplicate IDs pass (rows silently disappear), invalid colours and `end ≤ start` pass. With more than one running entry, `timer.load()` **deletes** the older ones. | `js/core/backup.js`, `js/timer.js:44` |
| B4 | Medium | **The recovery prompt appears on every reload.** | `js/app.js` `reloadTimer()` |
| B5 | Medium | **Quick pause → resume creates entries of a few seconds.** | `js/timer.js` |
| B6 | Medium | **A new app version reloads the page immediately**, even during editing, so unsaved input is lost. | `js/app.js:389` |
| B7 | Medium | **A backup file opened and saved in Excel** (`;` separator) can't be loaded, and the error is unclear. | `js/core/backup.js` |
| B8 | Low | **Export hours are rounded per row to 0.01 h**, so the row sum in Excel can differ from LocalLog's total. *The fix depends on the open rounding/export questions; only document it for now.* | `js/core/export.js` |
| B9 | Low | **The stopwatch resets to the current segment after a reload**, and differs from the table by 1 s (rounded down vs. rounded to nearest). | `js/timer.js`, `js/core/time.js` |
| B10 | Low | **A rate typed as `1.234` is read as 1.234 €.** | `js/core/format.js` `parseAmount` |
| B11 | Low | **Horizontal page scrolling at 375 px** (the entries table, the tab bar, and a `.visually-hidden` span in a table header). | `css/app.css` |
| P1 | Info | **With 4,700 entries and range "All",** every change takes about 0.5 s and draws 4,700 rows. | `js/ui/entries.js` |

---

## 3. Work packages

Work in this order. Each package ends with its manual checks; automated tests are still deferred.

### WP1 – Data safety and timer consistency (B1, B2, B4, B5, B9, R11–R13)

1. **The database is the single source for the timer** (B2, B9):
   - `TimerEngine` no longer keeps its own editable copy of the running entry.
   - After every data change (local or from another tab), it re-reads the running entry from `state` / the database.
   - The timer bar fields (project, ticket, note) follow the entry unless the user is typing in them right now.
   - The stopwatch shows the current entry's duration from `startTime`, with the same rounding as the table (use `entryDurationSeconds`).
   - Drop the in-memory `accumulated` counter, or recompute it from the entries of the current work session, so a reload shows the same value.
2. **Tab sync** (B1, R11):
   - Add a `BroadcastChannel('locallog')`. Every write in `storage.js` posts `{ type: 'changed' }`, and every tab reacts with `refreshData()` and a timer reload.
   - Settings that affect the screen (language, theme, rates toggle, export range, reminder) also broadcast.
   - **Guard rails in the timer:** `pause()`, `stop()` and `updateActive()` re-read the entry inside the write transaction. If it is already closed or deleted, they do nothing and reload instead of writing.
   - Add `updateEntryIfOpen(id, patch)` to `storage.js` for this.
   - `start()` first closes any other open entry found in the database, not only the cached one.
3. **Resume within 1 minute** (B5, R12):
   - If `resume()` is called less than 60 s after the pause closed the entry, reopen that entry (`endTime = ''`) instead of adding a new one.
   - Keep the pause timestamp in memory and in a setting so it survives a reload.
4. **Recovery prompt threshold** (B4, R13):
   - Show the banner only when `now − lastSeenAt > 5 min`.
   - Otherwise continue silently.
   - Write `lastSeenAt` every 30 s as today.
5. **Never delete open entries automatically** (B3, second part):
   - If `load()` finds more than one open entry, close the older ones with `endTime` = the start of the next entry, or their own start + 1 min if that is earlier.
   - Show a warning toast.

**Checks:**
- Two tabs: stop in tab A → tab B shows stopped within 1 s, and pausing in B changes nothing.
- An inline note edit on the running entry shows up in the timer bar and survives pause/resume.
- Pause → resume after 10 s gives one entry; after 70 s it gives two.
- A reload within 5 min shows no banner; with `lastSeenAt` set 10 min back, the banner appears.

### WP2 – Editing a running entry (R4, R5, R6)

1. **Quick buttons and start time next to the stopwatch:**
   - While a timer runs, show `−5 min` and `−15 min` buttons and the start time ("since 14:05").
   - Clicking the start time opens a time input.
   - Each change updates the running entry's `startTime` through the guarded update from WP1.
2. **Table:** the running row's **start** cell becomes editable. Date, end and project stay locked; project changes go through the picker (step 4).
3. **Validation:**
   - The start can't be later than now.
   - A typed time later than now means **yesterday**, which allows corrections across midnight.
   - The start must not fall before the end of a running entry in another tab; WP1 makes this impossible.
4. **Project correction within 2 minutes** (R6):
   - If the picker changes while the running entry is younger than 2 minutes, call `updateActive({ projectId })` instead of `start()`.
   - Show a short toast: "Project corrected".
   - After 2 minutes, keep today's behaviour (a new entry after the 800 ms delay).
   - Keep the 2-minute threshold as a named constant.
5. **Overlap** (R5): if the new start overlaps another entry, save anyway and show the existing overlap warning toast. Don't change other entries.
6. **Texts:** new texts in EN and DE ("since {time}", "−5 min", "−15 min", "Project corrected", error messages).

**Checks:**
- Start a timer, press −15 → the stopwatch jumps by 15 min and the table start matches.
- Type a start time 1 hour ago → it's saved; type 23:50 shortly after midnight → it's saved as the previous day.
- Change the project after 30 s → still one entry with the new project; after 3 min → two entries.
- Overlap with the previous entry → a warning only.

### WP3 – Rounding foundation and snapping (R7, R8, R10)

1. **New pure module `js/core/rounding.js`:**
   - `GRID_MINUTES = 15`.
   - `roundTime(date, mode)` and `roundSeconds(seconds, mode)` with `mode` ∈ `'nearest' | 'up' | 'down'`.
   - The mode comes from setting `roundingMode` (default `'nearest'`, no interface yet).
2. **Snapping setting** (opt-in, off by default): in Settings, a "Snap timer to quarter hours" checkbox with a short explanation in EN and DE. When on:
   - **start:** the new entry's `startTime` is rounded with the mode;
   - **stop / pause:** `endTime` is rounded with the mode;
   - **switching project:** the old entry ends and the new one starts at the **same** rounded boundary (no gap, no overlap);
   - **safety:** if rounding would make `end ≤ start`, set the end to `start + 15 min` (rounding "nearest" on a 3-minute entry would otherwise collapse it) and show a toast;
   - manual edits (table, dialog, −5/−15 buttons) are **never** snapped;
   - the stopwatch during a snapped start shows the time from the snapped start (it may begin at a few minutes).
3. **Don't build yet:** rounded hours in the table, weekly overview or export (open questions). Don't change B8 yet.

**Checks:**
- With snapping off, nothing changes.
- With snapping on, start at 10:07 → start 10:00; stop at 10:52 → end 10:45; switch at 11:08 → old end and new start both 11:15.
- A 3-minute entry → at least 15 min, with a toast.

### WP4 – Away time and long-running warning (R14, R15)

1. **Away detection without permissions:**
   - The heartbeat (every 1 s) remembers the last tick.
   - If a tick arrives more than 10 minutes after the previous one (sleep, hibernation, frozen tab) while a timer runs, show a banner: "You were away {from}–{to}. Keep this time / Remove as a break / Stop at {from}".
   - "Remove as a break" closes the entry at `from` and starts a new one at `to` with the same project, note and ticket.
   - The 10-minute threshold is a named constant.
2. **Long-running warning:**
   - When a running entry passes 10 hours, or its start date is before today, show a banner: "The timer has been running since {date time}. Still working?"
   - Buttons: "Keep running" (don't ask again for this entry), "Stop at …" (a time input), "Stop now".
   - Remember "don't ask again" per entry ID in a setting.
3. **Texts** in EN and DE.

**Checks:**
- Simulate a gap: set the last tick 20 min back in the console → the away banner appears.
- Create a running entry that started yesterday → the long-running banner appears.

### WP5 – Phone layout (R3, B11)

1. No horizontal page scrolling at 375 px:
   - the tab bar scrolls inside its own container;
   - `.visually-hidden` gets `position: absolute` inside a `position: relative` cell, or uses `clip-path` without width;
   - check every card.
2. **Entries table under 640 px:** show each entry as a stacked card: date + times on the first line, customer › project on the second, ticket, note, duration and hours.
   - Inline editing keeps working; tapping a value edits it.
   - The running entry shows the −5/−15 buttons.
3. The timer card, the "Your data" card and the dialogs fit at 375 px; touch targets are at least 40 px high.
4. The weekly overview's bars and names wrap cleanly.

**Checks:** in a 375 × 812 viewport, `document.documentElement.scrollWidth === clientWidth` in all four tabs and with every dialog open; one full workflow is possible by tapping only.

### WP6 – Backup and import robustness (B3 first part, B7)

1. **`fromBackupFiles` validation:**
   - Reject duplicate IDs per file.
   - Colour must match `#RRGGBB` (otherwise use a default colour and count a warning).
   - Entries with `end ≤ start` are rejected with a clear message naming the row.
   - Ticket templates that fail `validateTicketTemplate` are imported as empty, with a warning.
   - At most one open entry; close extra ones as in WP1 step 5.
2. **Excel-saved files** (default, see OPEN-QUESTIONS Q-B2):
   - Detect the separator from the header line (`,` or `;`) and accept both, as well as an optional BOM.
   - If the timestamps were changed by Excel and can no longer be read as ISO dates, show the message "The backup files were changed by a spreadsheet program and can't be read. Please use an unchanged copy."
3. **Before "Load from folder"** replaces the browser data, **automatically download a safety copy** of the current data (the existing `downloadBackup()`), unless the browser has no entries.

**Checks:** reuse the cases from the exploratory test (duplicate IDs, bad colour, end before start, `;` file with BOM); each gives a clear result.

### WP7 – Smaller fixes (B6, B10, P1, manifest, version check)

1. **Update banner instead of automatic reload** (B6; default, see Q-B3): when a new service worker takes control, show the banner "A new version of LocalLog is available" with a "Reload" button. Never reload automatically.
2. **Rate input** (B10): below the rate field, show the parsed value live ("= 1,234.00 €/h" or "= 1.23 €/h"), so mistakes are visible.
3. **Paging** (P1): show at most 200 rows, plus a "Show more" button that adds 200 more. Totals still use all entries. Re-render only the rows when data changes.
4. **Manifest:** add a 512 px icon with `"purpose": "any"` next to the maskable one.
5. **Version check:** add `tools/check.mjs` (Node, no dependencies). It fails when `APP_VERSION` ≠ `VERSION` in `sw.js`, when a file in `js/` or `css/` is missing from `ASSETS_TO_CACHE`, or when an entry in `ASSETS_TO_CACHE` doesn't exist. Document it in the README.
6. **Local test server:** add `tools/serve.mjs` (Node, no dependencies, sends `Cache-Control: no-cache`) to replace `server.ps1` (default, see Q-H1).

### WP8 – Documentation

1. **Delete `server.ps1`** (R2).
2. **`HANDOFF.md`:**
   - Set the status to 0.2.0.
   - Correct "service worker could not be verified": it registers and controls the page in the in-app browser (verified 2026-11-22).
   - List what is still unverified: folder picker, mini window, notifications, install prompt, GitHub Pages.
3. **`README.md`:**
   - "Run locally" → `node tools/serve.mjs`; remove the `python` and `npx serve` instructions.
   - Add a note on the offline cache during development (bump the version, or DevTools → Application → "Update on reload").
   - Mention `tools/check.mjs`.
   - Add a "How it works" section: keyboard shortcuts (Alt+S, Alt+C, Alt+P); changing the project while running (correction within 2 min, otherwise a new entry); −5/−15 buttons; resume within 1 min; recovery, away and long-running prompts; snapping setting; tab sync.
   - Update the structure list (`tools/`, `LICENSE`, `js/core/rounding.js`).
4. **About → Technical details** (EN and DE): mention tab sync and that snapping is optional.
5. **`.gitignore`:** remove the PowerShell-era entries (`Backup_*/`, `*.db`, `*.wal`, `*.shm`, `*.bak`). Keep `*.csv` and `*.tmp`.
6. **`communication`:** add the start-time correction and phone support briefly; no other changes.
7. **`CHANGELOG.md`** (new): entries for 0.1.0 (summary of round 1) and 0.2.0.

### WP9 – Release 0.2.0

1. Bump `APP_VERSION` and `VERSION` to `0.2.0`; run `node tools/check.mjs`.
2. Do a manual run in the in-app browser:
   - all checks of WP1–WP7;
   - EN/DE complete (all new texts in both);
   - dark mode;
   - 375 px;
   - no console errors;
   - `fetch()` blocked by the security policy.
3. Fill in `CHANGELOG.md`.

---

## 4. Not in this round

- Everything in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), in particular: what rounding applies to, rounded export columns, the B8 fix, and further features (undo, recent tasks, gap filling, …).
- Automated tests (still deferred). The exploratory checks from 2026-11-22 are listed in OPEN-QUESTIONS (Q-T1).
- `IdleDetector` (R14).
- A minimum duration (R9).

# Changelog

## 0.3.0 – 2026-11-24

### Day and Week evaluations (for transferring hours)
- New **Day** tab: hours per project for one day, labelled "Customer › Project", rounded to 15 minutes with the exact time next to it. Each project has a copy button and a "transferred" tick. The mark stores the rounded hours and shows "changed since transfer (was …)" when the value changes later. Running timers count up to now; their tick box waits until the timer stops. Day export (copy or CSV, `locallog-YYYY-MM-DD-day.csv`). "Add entry" opens with the selected day.
- New **Week** tab: a timesheet grid (projects x Monday to Sunday) with row, day and week totals, transfer marks in the cells, and a click on a cell or day heading opens that day. Export of the grid. With rates on, a value column per row and a value total (no value per day cell).
- The old "Weekly overview" in the Entries tab (customer → project bars) is removed.
- Both evaluations round each day and project to the 15-minute grid (setting `roundingMode`, default nearest). The entry list and the entry export stay exact.
- Entries across midnight are split at local midnight in the evaluations only (daylight-saving days are handled). The stored entry and the entry list are unchanged.

### Adjacent entries
- Two entries are adjacent when one ends within 60 seconds of the other's start. Editing that boundary asks "Move both / Only this entry / Cancel". "Move both" saves both entries in one transaction (`updateEntries`); if that would leave the neighbour without time, only "Only this entry" and "Cancel" are offered. A running entry can be the next entry.
- The Day view shows entries oldest first, one row for a shared boundary, a gap row with "Extend previous" / "Extend next", and an overlap row with "Shorten previous" / "Shorten next".

### Project correction hint
- After the 2-minute project correction, a message "Project corrected: Customer › Project" with an **Undo** button stays for 8 seconds. Toasts can now carry an action button.

### Data and backup
- Data layout version 2: new IndexedDB store `transfers`. The upgrade now runs by `oldVersion`, so an existing version-1 database is upgraded without errors and keeps its data.
- Backup: new file `transfers.csv` (Key, Date, ProjectId, Hours, Seconds, TransferredAt). Version-1 backups (no `transfers.csv`) still load; marks for unknown projects are skipped with a note; duplicate keys are rejected. Deleting a project or customer also deletes its transfer marks.

### Internal
- New modules `js/core/report.js`, `js/core/adjacent.js`, `js/ui/day.js`, `js/ui/entry-editor.js` (inline editing shared by the Entries table and the Day view) and `js/ui/boundary-dialog.js`. `summarizeByCustomer` was removed.

## 0.2.0 – 2026-11-22

### Timer and data safety
- The database is now the single source for the running timer. The timer bar follows edits made in the table (note, ticket, start) and keeps them across pause and resume.
- Open tabs stay in sync. Pausing, stopping or changing the running entry only writes while it is still open, so a second tab can no longer overwrite the first.
- The stopwatch shows the running entry's duration from its start time and matches the table after a reload.
- Resuming within 1 minute of a pause continues the previous entry instead of creating a new one.
- After a reload the "timer was running" prompt only appears when the last sign of activity is more than 5 minutes old; otherwise the timer simply continues.
- More than one open entry is never deleted any more: the older ones are closed and a warning is shown.
- A paused timer survives a reload.

### Editing a running entry
- New buttons −5 min and −15 min, and a clickable start time ("since 14:05") next to the stopwatch. The start cell of the running row in the table is editable too. A typed time later than now means yesterday.
- Overlap with the previous entry only gives a warning.
- Changing the project within the first 2 minutes corrects the running entry instead of starting a new one.

### Quarter hours
- New setting "Snap timer to quarter hours" (off by default). Start and stop are rounded to the nearest quarter hour; switching projects uses the same boundary; an entry that would collapse is extended to 15 minutes. Manual edits are never rounded.
- New pure module `js/core/rounding.js` with the 15-minute grid and the directions nearest, up and down (only "nearest" is used for now).

### Away time and long-running timers
- A gap of more than 10 minutes in the app's own heartbeat (sleep, hibernation, frozen tab) shows a banner: keep the time, remove it as a break, or stop at the start of the gap. No browser permission is needed.
- A timer that runs longer than 10 hours or across midnight asks "Still working?".

### Phone layout
- No horizontal page scrolling at 375 px. The entries table becomes a list of cards; the tab bar scrolls inside its own container; touch targets are at least 40 px high.

### Backup and import
- Loading from the folder rejects duplicate IDs, entries whose end is not after the start (naming the row), and timestamps that a spreadsheet program changed. Invalid colours and ticket links are repaired with a note.
- Backup files saved in Excel (`;` separator, byte order mark, decimal comma) can be loaded.
- Before the browser data is replaced, a safety copy of the current data is downloaded.

### Smaller fixes
- A new app version shows a "Reload" banner instead of reloading the page.
- The rate fields show how the typed value is read ("= 1,234.00 €/h").
- Long entry lists show 200 rows at a time with a "Show more" button; totals still use all entries.
- The manifest has a 512 px icon with purpose "any" next to the maskable one.
- New `tools/check.mjs` (version and cache list check) and `tools/serve.mjs` (local test server). `server.ps1` was removed.

### Known and unchanged
- Export hours are still rounded per row to 0.01 h, so the row sum in Excel can differ slightly from LocalLog's total (B8). The fix depends on the open rounding and export questions.

## 0.1.0

First version: PWA foundation with a strict security policy (no network access), pure logic modules, customers and projects, tickets with links, English and German interface, inline editing in the table, export for Excel (copy and CSV), weekly overview, optional rates, reminders, a mini window, and a backup folder with download.

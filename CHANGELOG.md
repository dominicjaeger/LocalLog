# Changelog

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

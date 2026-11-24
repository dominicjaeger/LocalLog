# LocalLog – Implementation Handoff (Round 3 → version 0.3.0)

Status: implemented in version 0.3.0 (2026-11-24).
Open topics are tracked in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). **Don't implement anything listed there as open**; build only what this document describes. Items marked "default assumed" there are part of this plan unless the owner objects.

Earlier rounds are done:
- 0.1.0: foundation, customers/projects, EN/DE, export, backup.
- 0.2.0: data safety, tab sync, running-entry editing, snapping, phone layout.

Details are in [CHANGELOG.md](CHANGELOG.md). The architecture rules are in [HANDOFF.md](HANDOFF.md).

---

## 1. Goals of round 3

The owner asked for four things:

| # | Request | Result |
|---|---|---|
| 1 | Add entries without starting the timer | **Already possible** via "Add entry" (dialog). The owner confirmed the dialog is fine. Only change: it opens with the date of the selected day when used from the new Day view (WP3). |
| 2 | Edit times of adjacent entries more easily | **Linked boundaries** (WP2): when two entries touch and one boundary is edited, LocalLog asks each time whether to move the neighbour too. The Day view shows these boundaries and gaps explicitly. |
| 3 | A day evaluation for transferring each day into another system | **New "Day" tab** (WP3): hours per project for one day, rounded to 15 minutes, with a copy button and a "transferred" tick per project. |
| 4 | Group by project in the day and week evaluation | Both evaluations list **projects** (labelled "Customer › Project"), with no customer level. The week becomes a **timesheet grid** (WP4): projects × Monday–Sunday. |

---

## 2. Decisions

### New in round 3 (binding)

| # | Decision |
|---|---|
| D3-1 | The next version is **0.3.0**. The data layout version (`SCHEMA_VERSION`) becomes **2** (new store for transfer marks). |
| D3-2 | **Day and week evaluations group by project.** Each row is one project, labelled "Customer › Project", sorted by customer name, then project name. There are no customer subtotals. |
| D3-3 | **The week evaluation is a timesheet grid:** rows = projects, columns = Monday–Sunday, plus row and column totals. |
| D3-4 | **Evaluation rounding:** for each day and project, the exact total is rounded to the 15-minute grid using the existing setting `roundingMode` (default "nearest"). This decides Q-R1 = b) **for the evaluations**. Week cells use the same rounded day values; row and week totals are sums of rounded cells, so the week always matches what was transferred day by day. |
| D3-5 | **The evaluations show the rounded decimal hours prominently and the exact time next to them** (e.g. "2,25 h · exact 2:17"). Formats follow the browser locale. |
| D3-6 | **A day and project can be marked "transferred".** The mark stores the rounded hours at that moment. If the value changes later, the mark shows "changed since transfer (was 2,25)". |
| D3-7 | **The "Add entry" dialog stays as it is** (request 1). |
| D3-8 | **Linked boundaries, asking each time:** two entries are adjacent when one ends within 60 seconds of the other's start. When the user edits that boundary on one entry, LocalLog **asks each time** whether to move the neighbour too: "Move both", "Only this entry" or "Cancel". "Move both" saves both entries in one atomic save. (Decided 2026-11-24, Q-D1.) |
| D3-9 | **Entries across midnight are split at local midnight for the Day and Week evaluations.** An entry 23:00–01:00 counts 1 h on each day. The stored entry is **not** changed; only the evaluations split it. The Entries tab list and the entry-level export keep showing it once, on its start day. (Q-D7.) |
| D3-10 | **No combined notes/tickets** in the day transfer; it covers hours only. (Q-D3.) |
| D3-11 | **Transferred days are not locked**; entries stay editable. A later change only shows the "changed since transfer" note (D3-6). (Q-D6.) |
| D3-12 | **The week grid shows no value per day cell**; with rates on, only a value column per row and a value total. (Q-D8.) |
| D3-13 | **Project correction hint:** the 2-minute project correction (round 2) stays at 2 minutes and now shows a visible hint "Project corrected" with an **Undo** button. (Q-T-1.) |

### From earlier rounds (still binding, summary)

| # | Decision |
|---|---|
| R3 | Works on phones (375 px) without horizontal page scrolling. |
| R5 | Overlaps only give a warning; other entries are never changed automatically. Linked boundaries (D3-8) move the adjacent entry only after the user chose "Move both". |
| R7, R8 | The grid is fixed at 15 minutes; the direction is "nearest" for now. The code supports "up" and "down" through `roundingMode`. |
| R9 | No minimum duration. |
| R11 | All open tabs stay in sync. Every new store and write must go through `storage.js` so it is broadcast. |
| — | Every visible text exists in English and German; no inline styles or scripts; logic in pure `js/core/*` modules. |

---

## 3. Work packages

Work in this order. Each package ends with manual checks; automated tests are still deferred (Q-T1).

### WP1 – Data layout version 2 (transfer marks)

1. **Make the upgrade safe.** `storage.js` `onupgradeneeded` currently creates all stores unconditionally, which **fails on an existing version-1 database**. Restructure it by `event.oldVersion`:
   - `oldVersion < 1`: the current stores (customers, projects, entries, settings);
   - `oldVersion < 2`: the new `transfers` store.
2. **New store `transfers`:**
   - `keyPath: 'key'`, where `key = 'YYYY-MM-DD|projectId'` (local date);
   - fields `{ key, date, projectId, hours, seconds, transferredAt }`;
   - `hours` = the rounded decimal hours at the moment of marking; `seconds` = the exact seconds.
3. **Storage functions:** `getTransfers()`, `setTransfer(record)`, `deleteTransfer(key)`. All notify and broadcast like other writes.
   - `deleteProject` keeps refusing while entries exist; it should also delete the project's transfer marks when it succeeds.
   - Snapshot and `replaceAll` include transfers.
4. **Backup:**
   - new file `transfers.csv` with columns `Key, Date, ProjectId, Hours, Seconds, TransferredAt` (dot decimals, ISO time);
   - `meta.csv` SchemaVersion 2;
   - loading a **version-1 backup** (no `transfers.csv`) is accepted with no transfer marks;
   - validation: unknown `ProjectId` → the row is skipped with a note; duplicate keys → rejected;
   - the "folder has a backup" check is unchanged.
5. Set `SCHEMA_VERSION = 2` in `js/version.js`. The About → Technical details text mentions `transfers.csv` (EN and DE).

**Checks:**
- Open the app with an existing 0.2.0 database → it upgrades without errors and the data is unchanged.
- Backup round trip with transfers.
- A 0.2.0 backup folder loads.

### WP2 – Linked boundaries for adjacent entries

1. **New pure logic** (`js/core/adjacent.js`):
   - `ADJACENT_TOLERANCE_MS = 60000`;
   - `findPrevious(entries, entry)` / `findNext(entries, entry)`: the closest entry ending/starting within the tolerance of this entry's start/end;
   - `planBoundaryEdit(entries, entryId, side, newIso, now)` → `{ patches: [{ id, patch }], adjusted: [ids], error }`:
     - `side = 'start'`: also move the previous entry's `endTime`;
     - `side = 'end'`: also move the next entry's `startTime`;
     - when the neighbour sits within the tolerance, both get exactly the same timestamp (this closes tiny gaps);
     - **error** if any affected entry would end up with `end ≤ start` (error code `boundaryCollapse`);
     - a running entry may be the "next" entry (its start moves); its end is never set;
     - **no chain reaction:** only the direct neighbour moves.
2. **Atomic save:** `updateEntries(patches)` in `storage.js` writes all patches in one transaction. A patch on an open entry uses the same guard as `updateEntryIfOpen` (if the entry was closed elsewhere, the whole save is aborted with the existing "changed elsewhere" message).
3. **Asking each time (D3-8):** when an inline edit of `start` or `end` (Entries tab or Day view) touches a boundary that has an adjacent neighbour, open a small dialog **before saving**:
   - text: "The next entry (Customer › Project, 10:00–11:00) starts where this one ends. Move its start to 10:20 too?" (or the equivalent for the previous entry's end);
   - buttons: **"Move both"** (atomic save of both patches), **"Only this entry"** (saves only the edited entry; the normal overlap warning applies if they now overlap), **"Cancel"** (nothing is saved and the cell returns to its old value);
   - Enter = "Move both", Esc = "Cancel";
   - if "Move both" would collapse the neighbour (`boundaryCollapse`), the dialog shows the error and offers only "Only this entry" and "Cancel";
   - without an adjacent neighbour, no dialog appears (today's behaviour).
   - A dialog must be added to `index.html` and use the existing modal styles. It is not a native `confirm()`, because its buttons must be translated.
4. **Day view** (part of WP3, listed here for the logic):
   - entries of the day in **chronological order** (oldest first);
   - **between two touching entries**, a single boundary time row ("11:15"). Editing this row means editing the shared boundary, so it **also asks** with the same dialog, with "Move both" preselected. "Only this entry" moves only the earlier entry's end there;
   - **between entries with a gap**, a gap row ("10:15–10:45 · 30 min not tracked") with two buttons: **"Extend previous"** (the previous end becomes the gap end) and **"Extend next"** (the next start becomes the gap start);
   - a **small overlap** (the next starts before the previous ends) shows a warning row ("Overlap 11:10–11:15") with the same two buttons, which then shorten instead of extend.
5. **Texts** in EN and DE.

**Checks:**
- A 09:00–10:00 + B 10:00–11:00: set A's end to 10:20 → the dialog appears; "Move both" → B starts 10:20.
- Same with "Only this entry" → only A changes, and an overlap warning appears.
- Same with "Cancel" → nothing changes.
- Set B's start to 09:40, "Move both" → A ends 09:40.
- Set A's end to 11:30 → the dialog says B would have no time left and offers only "Only this entry" / "Cancel".
- An entry without a touching neighbour → no dialog.
- A gap of 30 min: "Extend previous" closes it.
- A running entry as B: its start moves, and the stopwatch follows.
- Two tabs: the change appears in the other tab.

### WP3 – Day view and day transfer

1. **New tab "Day"** (after "Entries"): `Entries | Day | Week | Customers & Projects | Settings | About`. On phones the tab bar keeps scrolling inside its container.
2. **Navigation:** "Previous day", "Today", "Next day", and a date input. The label shows the long date with weekday (browser locale). The selected day is kept while the app is open (not stored).
3. **Section "Per project"** (the transfer list): one row per project with time on that day (`projectDayTotals`, see step 6). Columns:
   - colour dot + "Customer › Project";
   - **hours rounded** (decimal, large);
   - "exact h:mm" (small);
   - a **copy button**: copies the rounded hours as text in the browser locale (e.g. `2,25`), with a toast "Copied 2,25";
   - a **"Transferred" checkbox**:
     - ticking stores the transfer mark (WP1);
     - unticking asks nothing and removes it;
     - if the mark's stored hours ≠ current rounded hours, show an amber note "changed since transfer (was 2,25)" and keep the box ticked until the user re-ticks or unticks.
   - Footer: day total (sum of rounded rows) and exact total.
   - **Running entries:** they count up to now (the value updates every minute); the project's row is marked "running" and its transfer checkbox is disabled until the timer stops.
   - With rates switched on: a value column (rounded hours × effective rate).
4. **Section "Entries"** for that day:
   - chronological list with the boundary, gap and overlap rows from WP2;
   - **entries across midnight** (D3-9) appear on both days. On the start day they show "23:00 – 24:00 · continues next day"; on the next day "00:00 – 01:00 · from previous day". Editing them changes the real entry (its real start/end), not the part;
   - each entry shows its times, project, ticket and note, and supports the same inline editing as the table (shared editor code from `js/ui/entries.js`, extracted into a reusable helper);
   - an **"Add entry" button** that opens the existing dialog with the **selected date** prefilled (start/end defaults as today's dialog). This is the only dialog change.
5. **Export for the day:** the existing export menu with a new range kind `day` (with the selected date):
   - "Copy table" and "Download as CSV" of the **per-project rows**: columns Project, Hours (rounded), Exact (h:mm), and Value if rates are on;
   - file name `locallog-YYYY-MM-DD-day.csv`;
   - the entry-level export in the Entries tab stays unchanged (B8 / Q-R3 still open there).
6. **Pure logic** (`js/core/report.js`):
   - `localDateKey(date)` → `'YYYY-MM-DD'`;
   - `splitAtMidnight(entry, now)` → the parts of an entry per local day `[{ dateKey, startMs, endMs }]` (D3-9). It must use local midnights (`addDays(startOfDay(…))`), so the daylight-saving change gives 23 or 25 hour days correctly. A running entry is split up to `now`;
   - `projectDayTotals({ entries, projects, customers, date, mode, now })` → `[{ project, customer, label, seconds, roundedSeconds, hours, running }]`, sorted as D3-2. It sums only the parts of each entry that fall on `date`, then rounds the total per project;
   - `transferState(record, currentHours)` → `'none' | 'done' | 'changed'`.
7. **Phone:** the per-project rows become two-line cards (label on top; hours, copy and tick below). The entries list uses the existing card layout.

**Checks:**
- A day with 3 projects: rounded values are correct (e.g. 2:17 → 2,25; 0:52 → 0,75; 0:05 → 0,00); copy puts `2,25` (German browser) or `2.25` (English) on the clipboard.
- An entry 23:00–01:00 → 1,00 h on each day; both days list it with the "continues" / "from previous day" note; the Entries tab still shows it once.
- An entry across the daylight-saving night is split correctly.
- Ticking "transferred", then editing an entry so the value changes → the amber note appears.
- Previous/next/date input work across month ends and the daylight-saving change.
- "Add entry" from the Day view prefills the date.
- Phone width: no horizontal page scrolling.

### WP4 – Week timesheet grid (replaces the weekly overview)

1. **New tab "Week"**; remove the "Weekly overview" card from the Entries tab, including its old customer → project summary code (`summarizeByCustomer` can stay in `export.js` only if still used elsewhere; otherwise remove it).
2. **Navigation:** previous / this week / next, plus a label "16 Nov 2026 – 22 Nov 2026" (as today).
3. **The grid:**
   - rows = projects with any time in the week (D3-2 order);
   - columns = Mon … Sun (weekday + date);
   - cells = rounded day hours from `projectDayTotals` (empty when 0);
   - a **row total** column, a **day total** row, and the grand total;
   - below the grid: "exact 37:42" for the week;
   - the **cell marker** reflects the transfer state of that day/project: a check mark for transferred, amber for changed since transfer;
   - **clicking a cell or a day header** opens the Day tab on that date;
   - with rates on: a value column per row and a value total, but **no value per day cell** (D3-12);
   - entries across midnight are split (D3-9), also across the Sunday → Monday week boundary.
4. **Export of the week:** the export menu exports **the grid**: header Project, Mon dd.mm., …, Sun dd.mm., Total. Cells use the rounded decimal hours in the browser locale; empty cells are empty. Copy and CSV work as for the day.
5. **Pure logic** in `js/core/report.js`: `weekGrid({ entries, projects, customers, weekStart, mode, now })` → `{ days: [Date×7], rows: [{ project, customer, label, cells: [{ seconds, roundedSeconds }]×7, totalRounded }], dayTotals, totalRounded, totalExact }`.
6. **Phone:** the grid scrolls horizontally **inside its own container**, with the project column sticky on the left. The page itself never scrolls sideways.

**Checks:**
- A week with entries on 4 days for 3 projects: cells match the Day view for each day; the row totals add up; the grand total equals the sum of the day totals.
- Clicking a cell opens the Day view on that date.
- Transfer marks show in the cells.
- The export pastes into Excel as a grid.
- 375 px: only the grid container scrolls.

### WP5 – Project correction hint with Undo (D3-13)

1. **Toast with an action:** extend `toast()` in `js/ui/dom.js` with an optional action `{ label, onClick }`.
   - The button is part of the toast and reachable by keyboard.
   - A toast with an action stays visible for 8 seconds.
2. **After the 2-minute project correction:** show "Project corrected: Customer › Project" with **Undo**.
   - Undo writes the previous `projectId` back through `updateEntryIfOpen`.
   - If the entry was stopped meanwhile, write with `updateEntry`, because the correction concerns the same entry.
   - The picker follows.
   - The 2-minute threshold stays unchanged.
3. **Texts** in EN and DE.

**Checks:**
- Start a timer, change the project after 30 s → the hint with Undo appears.
- Undo → the original project is back, in the table, the timer bar and a second tab.
- After 3 min → no hint; a new entry as before.

### WP6 – Documentation and release 0.3.0

1. **`README.md`:**
   - new sections "Day view and transferring hours", "Week timesheet" and "Adjacent entries" (linked boundaries, extend buttons);
   - the rounding note: evaluations round each day and project to 15 minutes; the entry export stays exact;
   - the midnight note: evaluations split entries at midnight; the entry list does not;
   - the project correction hint with Undo;
   - update the structure list (`js/core/report.js`, `js/core/adjacent.js`, the new UI files) and the backup file list (`transfers.csv`);
   - "What you can do": replace "Weekly overview" with the Day view and the Week timesheet; mention the dialog that asks before moving an adjacent entry;
   - "How to back up": list `transfers.csv` with the other files.
2. **`HANDOFF.md`:** status 0.3.0, what was verified, and what is still unverified.
3. **`HANDOFF-TO-IMPLEMENTATION.md`:** change the status line to "implemented in version 0.3.0" with the date.
4. **`OPEN-QUESTIONS.md`:** update "Last updated"; move anything decided during implementation into the decided state; keep the entry-export questions (Q-R1 rest, Q-R2 rest, Q-R3, Q-R4) and the rest of Q-T-1 open.
5. **`CHANGELOG.md`:** add a 0.3.0 entry.
6. **In-app texts (EN and DE):**
   - About → intro: mention the Day and Week evaluations;
   - About → Technical details: the `transfers` store and `transfers.csv`, the data layout version 2, rounding per day and project in the evaluations, and splitting at midnight;
   - the hint line under the entries table: mention the dialog for adjacent entries;
   - run the key comparison between English and German again (both must have the same keys).
7. **`communication`:** add one line about the day/week evaluation for transferring hours.
8. **Release:**
   - bump `APP_VERSION` and `sw.js` `VERSION` to `0.3.0`;
   - add the new files to `ASSETS_TO_CACHE`;
   - run `node tools/check.mjs`;
   - manual run in the in-app browser: all checks above, EN/DE complete, dark mode, 375 px, no console errors, upgrade from a 0.2.0 database.

---

## 4. Not in this round

- Anything open in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), in particular rounding and columns in the **entry-level** export (Q-R3, Q-R4 / B8).
- Combined notes/tickets in the day transfer (decided: no, D3-10).
- Locking transferred days (decided: no, D3-11).
- Values per day cell in the week grid (decided: no, D3-12).
- Changes to the "Add entry" dialog beyond prefilling the date (D3-7).
- Automated tests (still deferred).

# LocalLog – Open topics and questions

Last updated: 2026-11-24 (after implementing round 3, version 0.3.0). Decided during implementation: Q-D2, Q-D4 and Q-D5 were built as "default assumed" (0,00 shown with the exact time; the copy button copies the rounded hours only; gap and overlap rows offer Extend/Shorten previous and next). Say if you want any of them changed. Answer here (or in chat). Once a question is decided, move it into [HANDOFF-TO-IMPLEMENTATION.md](HANDOFF-TO-IMPLEMENTATION.md) as a decision.

Status labels:
- **Open:** needs a decision; don't build.
- **Default assumed:** the plan uses the proposed default. Say if you disagree.
- **Review later:** decided for now, but to be reconsidered.

---

## Rounding and export

### Q-R1 – What does rounding apply to? (Decided for the evaluations; open for the entry list)
**Decided 2026-11-24 (round 3, D3-4):** the Day and Week evaluations round **each day's total per project** to 15 minutes.
Still open: should the entry list (table hours column, "Today" card) and the entry-level export round anything, or stay exact?

### Q-R2 – Where are rounded values shown? (Decided for the evaluations; open elsewhere)
**Decided (D3-5):** the Day and Week evaluations show the rounded decimal hours with the exact time next to them.
Still open: the Entries tab and the "Today" card (currently exact).

### Q-R3 – Export columns (Open)
- **a)** "Hours" (exact) plus "Billable hours" (rounded);
- **b)** only rounded hours;
- **c)** only exact hours, as today.

*Recommendation: a).*

### Q-R4 – Fix for the row-rounding drift (B8) (Open, depends on Q-R1/Q-R3)
Today each row is rounded to 0.01 h, so the row sum in Excel can differ from LocalLog's total. Options:
- export minutes or more decimals;
- distribute the rounding so the rows add up exactly;
- accept and document it.

### Q-R5 – Rounding direction in the interface (Review later)
It is "nearest" for now. The code supports "up" and "down" (R8). Should users be able to choose it in Settings later?

---

## Day and week evaluation (round 3)

### Q-D1 – Linked boundaries always on? (Decided 2026-11-24: ask each time)
Editing a boundary shared with a touching entry asks "Move both / Only this entry / Cancel" (D3-8).

### Q-D2 – Small amounts rounded to 0 (Default assumed: show 0,00 with the exact time)
With "nearest", a project with less than 7.5 minutes on a day rounds to 0,00 h, so it disappears from the transfer. Options:
- **a)** accept (shown as 0,00 with "exact 0:05");
- **b)** round up to 0,25 when there is any time at all;
- **c)** use direction "up" for the evaluations.

Related: Q-F2 (minimum duration), Q-R5 (direction in Settings).

### Q-D3 – Combined notes and tickets in the day transfer (Decided 2026-11-24: no)
The day transfer covers hours only (D3-10).

### Q-D4 – What exactly does the copy button copy? (Default assumed: rounded hours only, browser number format)
Alternatives: hours with "h"; hours and project name; a whole row (tab-separated) for pasting into a spreadsheet.

### Q-D5 – Gap and overlap buttons in the Day view (Default assumed: "Extend previous" / "Extend next")
Should the gap row also offer "Add entry here" (the dialog with the gap's times prefilled)? This is related to Q-F1 #3 (gap filling).

### Q-D6 – Lock transferred days? (Decided 2026-11-24: no lock)
Entries stay editable; a later change only shows "changed since transfer" (D3-11).

### Q-D7 – Entries across midnight (Decided 2026-11-24: split)
The Day and Week evaluations split entries at local midnight; the stored entry and the entry list stay unchanged (D3-9).

### Q-D8 – Week grid with rates (Decided 2026-11-24: no value per day cell)
Only a value column per row and a value total (D3-12).

---

## Timer behaviour

### Q-T-1 – 2-minute project correction (Partly decided 2026-11-24)
- 2 minutes is right (unchanged).
- Yes, show a visible hint "Project corrected" with Undo (D3-13, round 3).
- **Still open:** should the correction also apply right after resuming (within 2 minutes of resuming), or only after starting?

### Q-T-2 – "Start from end of last entry" suggestion (Default assumed: not built)
When starting a timer shortly after the last entry ended (e.g. less than 30 min), offer "Start from 14:05". It isn't in the round 2 plan. Should it be built?

### Q-T-3 – "Stop at …" when stopping normally (Default assumed: only in the long-running banner)
Round 2 adds a "Stop at …" time input to the long-running banner only. Should the normal Stop button also offer it (e.g. a small menu next to Stop)?

### Q-T-4 – Away detection with screen-lock permission (Review later)
Round 2 detects away time only from heartbeat gaps (no permission prompt). Later option: the browser's idle detection, which recognises a locked screen and idle time, but asks the user for permission once.

---

## Backup and updates

### Q-B1 – Backup history in the folder (Open)
Today the folder copy is overwritten on every change, so a mistake reaches the backup within a second. Proposal: daily copies in a subfolder `history/YYYY-MM-DD/`, keeping the last 14 days. Build it? How many days?

### Q-B2 – Backup files saved by Excel (Default assumed: accept `;` files)
The round 2 plan accepts `,` and `;` separators and a BOM, and shows a clear message if Excel has changed the timestamps. Alternative: only show an error.

### Q-B3 – App updates (Default assumed: banner with "Reload" button)
Alternative: reload automatically when nothing is being edited.

---

## Housekeeping

### Q-H1 – Local test server (Default assumed: `tools/serve.mjs`)
`server.ps1` is removed. Replacement: a small Node script with no dependencies. Alternative: only document `npx serve`, which downloads a package.

### Q-H2 – Changelog (Default assumed: new `CHANGELOG.md`)
Round 2 adds a `CHANGELOG.md`. Alternatively, track versions only in `HANDOFF.md`.

### Q-H3 – Old plan documents (Open)
`HANDOFF-TO-IMPLEMENTATION.md` is now the round 3 plan. The detailed round 2 plan was replaced; its results are in `CHANGELOG.md`. Should future completed plans be kept in `docs/archive/` instead of being overwritten?

---

## Feature scope (beyond round 2)

### Q-F1 – Which improvements next? (Open)
Candidates, roughly by value:
1. **Undo instead of delete confirmation** (a message with an "Undo" button).
2. **Recent tasks:** the last customer/project/ticket/note combinations with a restart button.
3. **Gap filling:** "Untracked today: 10:15–10:45" with one-click fill.
4. **Ticket suggestions** from the history of each project.
5. **Split / duplicate** an entry.
6. **Lock a submitted week** against accidental changes.
7. **Optional weekly target hours** with overtime display.

### Q-F2 – Minimum duration (Review later)
Decided "off" for now (R9). Possible later option: entries shorter than X minutes count as X.

---

## Tests

### Q-T1 – When do automated tests start? (Open)
Tests are still deferred. A first set of exploratory checks exists from 2026-11-22: CSV round trips, formula protection, amount parsing, daylight-saving week ranges, overlap, ticket links, export, backup round trip and the import validation gaps. Its temporary copy is in a scratch folder that will be cleaned up, so if it should be kept, it needs moving into `tests/` soon. Questions:
- Move it into `tests/` now (no dependencies, `node --test`)?
- Add Playwright end-to-end tests in the same round as the tab sync work (WP1), since that is hard to test by hand?

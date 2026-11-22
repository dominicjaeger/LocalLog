# LocalLog – Open topics and questions

Last updated: 2026-11-22. Answer here (or in chat). Once a question is decided, move it into [HANDOFF-TO-IMPLEMENTATION.md](HANDOFF-TO-IMPLEMENTATION.md) as a decision.

Status labels:
- **Open:** needs a decision; don't build.
- **Default assumed:** the plan uses the proposed default. Say if you disagree.
- **Review later:** decided for now, but to be reconsidered.

---

## Rounding and export

### Q-R1 – What does rounding apply to? (Open)
The grid (15 min) and direction (nearest) are decided. Still unclear is what gets rounded for display and export:
- **a)** each entry separately;
- **b)** each day's total per project (avoids 4 × 5-minute calls becoming 4 × 15 minutes);
- **c)** only the weekly total;
- **d)** no rounding outside the opt-in snapping.

*Recommendation: b).*

### Q-R2 – Where are rounded values shown? (Open)
Options: table hours column, "Today" total, weekly overview, export. Should the exact value stay visible next to the rounded one (e.g. "exact 37:42 → billable 38:00")?

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

## Timer behaviour

### Q-T-1 – 2-minute project correction (Review later)
Changing the project within the first 2 minutes corrects the running entry (R6). To review after some real use:
- Is 2 minutes right?
- Should there be a visible hint ("Project corrected – undo")?
- Should it also apply right after resuming?

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
`HANDOFF-TO-IMPLEMENTATION.md` is now the round 2 plan; round 1 is summarised in its section 0. Should completed plans be moved to `docs/archive/`?

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

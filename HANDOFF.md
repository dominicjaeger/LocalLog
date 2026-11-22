# LocalLog – Workspace Brief

**The current plan and decisions are in [HANDOFF-TO-IMPLEMENTATION.md](HANDOFF-TO-IMPLEMENTATION.md).** This file only keeps the short rules and the real status. The old roadmap that used to be here marked features as done that were actually broken; it has been removed.

## Architectural rules (do not violate)
1. **PWA only.** No PowerShell in the repository. Plain HTML/CSS/ES modules, zero dependencies, zero build.
2. **All data stays on the device** (IndexedDB plus an optional backup folder). Zero telemetry, zero external APIs. The Content Security Policy in `index.html` (`connect-src 'none'`) enforces this.
3. **No inline styles, no inline scripts** (the CSP forbids them). Dynamic colours via `element.style.setProperty`.
4. **Formats follow the browser locale** (`Intl` with an undefined locale). The interface language (EN | DE) is a separate setting in `js/i18n.js`. Every visible text must exist in both languages.
5. **Logic in pure modules** (`js/core/*`, no DOM access) so tests can be added later; screen code lives in `js/app.js` and `js/ui/*`.
6. **No visible technical jargon and no emoji** in the interface; technical details live in the collapsed section under About.
7. **Version:** `js/version.js` and `sw.js` are bumped together; `node tools/check.mjs` verifies it (see README).

## Status (0.2.0)
Round 2 of the implementation handoff is implemented (see [CHANGELOG.md](CHANGELOG.md)): the database is the single source for the timer, open tabs stay in sync, the running entry's start can be corrected, the optional quarter-hour snapping, away and long-running prompts, a phone layout, stricter backup loading, paging for long lists, `tools/check.mjs` and `tools/serve.mjs`. Round 1 (0.1.0) covers the foundation, customers/projects, tickets, EN/DE, inline editing, export, weekly overview and backups.

Verified in the in-app browser on 2026-11-22: timer start/pause/resume (within and after one minute), −15 min button, start time typed in the stopwatch card and in the table (including "later than now means yesterday"), project correction within 2 minutes and a new entry after, two tabs (stop in one tab shows in the other within a second; a stale pause writes nothing; an inline note edit reaches the timer bar and survives pause/resume), recovery prompt only after more than 5 minutes, away banner (simulated gap), long-running banner, snapping with the 15-minute safety rule, 458 entries with paging, `fetch()` blocked by the policy, EN/DE switch, and no horizontal page scrolling at 375 px in all four tabs and in every dialog. The service worker registers and controls the page in the in-app browser. The pure modules were checked with Node (rounding, time helpers, backup validation including Excel-style files).

Not yet verified (needs a real Chrome/Edge session):
- Choosing a backup folder, reconnect after restart, atomic writes, "load from folder" with its safety download (needs the native folder picker).
- Mini window (Document Picture-in-Picture), notifications, install prompt.
- The update banner after a real new service worker version.
- Deployment to GitHub Pages.

## Deferred
- Automated tests (`node --test`, Playwright with a "no network requests" and CSP check, a GitHub Actions gate).
- Optional lock-screen detection via `IdleDetector`.
- Everything listed in [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md), in particular what rounding applies to and the rounded export columns.

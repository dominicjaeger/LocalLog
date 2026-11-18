# LocalLog – Workspace Brief

**The current plan and decisions are in [HANDOFF-TO-IMPLEMENTATION.md](HANDOFF-TO-IMPLEMENTATION.md).** This file only keeps the short rules and the real status. The old roadmap that used to be here marked features as done that were actually broken; it has been removed.

## Architectural rules (do not violate)
1. **PWA only.** No PowerShell application. Plain HTML/CSS/ES modules, zero dependencies, zero build.
2. **All data stays on the device** (IndexedDB plus an optional backup folder). Zero telemetry, zero external APIs. The Content Security Policy in `index.html` (`connect-src 'none'`) enforces this.
3. **No inline styles, no inline scripts** (the CSP forbids them). Dynamic colours via `element.style.setProperty`.
4. **Formats follow the browser locale** (`Intl` with an undefined locale). The interface language (EN | DE) is a separate setting in `js/i18n.js`. Every visible text must exist in both languages.
5. **Logic in pure modules** (`js/core/*`, no DOM access) so tests can be added later; screen code lives in `js/app.js` and `js/ui/*`.
6. **No visible technical jargon and no emoji** in the interface; technical details live in the collapsed section under About.
7. **Version:** `js/version.js` and `sw.js` are bumped together (see README).

## Status (0.1.0)
Phases 1–4 of the implementation handoff are implemented: the foundation (pure core modules, pause = segment, fixed buttons and bugs 1–8), customers/projects, tickets, safe folder backup, visible storage limits, EN/DE interface, no emoji, inline table editing, export, weekly overview, reminder settings, README and communication drafts.

Verified in the in-app browser: timer start → pause → resume → stop creates two correct entries; running timer survives a reload with the recovery prompt; inline editing and validation; add-entry dialog; customers/projects CRUD and ticket links; export text with formula protection; backup file round trip (pure modules); CSP blocks `fetch()`; EN/DE switch; dark theme.

Not yet verified (needs a real Chrome/Edge session, task 23):
- Service worker install, offline use and the update flow (the in-app browser refused to register the service worker).
- Choosing a backup folder, reconnect after restart, atomic writes, "load from folder" (needs the native folder picker).
- Mini window (Document Picture-in-Picture), notifications, install prompt.
- Deployment to GitHub Pages.

## Deferred
- Automated tests (`node --test`, Playwright with a "no network requests" and CSP check, a GitHub Actions gate).
- Optional lock-screen detection via `IdleDetector`.

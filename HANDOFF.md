# Antigravity Workspace Brief: LocalLog

## Architectural Rules (Do Not Violate)
1. **Zero External Dependencies / Zero-Build Web Standards:** Keep the PWA implementation completely self-contained in standard HTML5, CSS3, and ES6+ JavaScript (`index.html`, `js/`, `css/`, `icons/`) with zero node_modules or build pipelines.
2. **Local-First & Offline-Only:** All time-tracking data must reside in browser-local storage (IndexedDB) and optional local folder CSVs (`projects.csv`, `entries.csv`) via the File System Access API. Zero telemetry, zero external APIs, zero cloud transmission.
3. **Austrian Locale (`de-AT`):** Preserve `DD.MM.YYYY`, 24-hour time (`HH:mm`), comma decimals (`1,50 h`), and formula-injection guards (`'`, `=`, `+`, `-`, `@`) when copying to Excel.
4. **Dual Ambient Awareness:** Maintain toggles for both Document Picture-in-Picture (always-on-top floating mini-orb) and dynamic favicon/badging/notifications.

## Status & Roadmap
- [x] **PWA Core Architecture:** Implemented `manifest.webmanifest`, `sw.js` (offline caching), and `index.html`.
- [x] **Local Storage Engine:** Implemented IndexedDB layer and 2-way disk synchronization via File System Access API (`js/storage.js`).
- [x] **CSV & Excel Engine:** Implemented RFC 4180 parsing, serialization, and TSV clipboard generation with formula-injection guard (`js/csv.js`).
- [x] **Ambient Awareness Controller:** Implemented Document Picture-in-Picture floating mini-widget and dynamic canvas favicon / badging (`js/ambient.js`).
- [x] **Local Server Runner:** Implemented zero-dependency `Start-LocalLogPwa.ps1` for immediate local browser testing and installation.
- [x] **Automated Integrity Verification:** Verified 100% manifest, icon, script balance, and CSS structure.

### Next Tasks for Antigravity Agents
1. **Inline Entry Edit Dialog:** Add double-click / inline edit modal in the entries table to adjust notes, duration, or project after logging.
2. **Weekly Aggregated Report:** Add a weekly hours summary chart/card grouped by project.

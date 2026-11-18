# LocalLog

A lightweight, zero-install, local-first companion for effortless project time tracking—built for personal productivity and designed to meet strict corporate privacy and security expectations.

Now available as a modern **Progressive Web App (PWA)** with pure web standards (zero build step) alongside the classic single-file PowerShell desktop script.

---

## Built for Enterprise Environments: Privacy, Security & Transparency

Corporate environments rightly scrutinize tools that touch daily work routines. LocalLog is engineered from the ground up so individuals can stay organized without introducing compliance or security risks:

* **Zero Network Traffic:** LocalLog runs 100% client-side in the browser. It never connects to external servers, cloud databases, or third-party APIs. No telemetry, analytics, or usage statistics are ever transmitted.
* **100% Offline Capability:** Powered by a local Service Worker, LocalLog works completely offline once cached, even with no network connection.
* **Dual Persistence (IndexedDB + Direct CSV Disk Sync):** Your data is stored locally in browser IndexedDB. With the modern **File System Access API** (Chrome/Edge), LocalLog can sync directly in two directions with real `projects.csv` and `entries.csv` files in a local folder of your choice on your computer.
* **Fully Auditable Source Code:** Zero npm dependencies, zero node_modules, and zero compilation. All HTML, CSS, and ES6 JavaScript can be inspected directly line-by-line by internal IT and security teams.
* **Austrian Locale (`de-AT`):** Native support for comma decimals (`1,50 h`), 24-hour time (`HH:mm`), European dates (`DD.MM.YYYY`), and formula-injection guards (`'`, `=`, `+`, `-`, `@`) when copying tables to Excel.

---

## Key Features

* **Ambient Awareness Modes (Test & Toggle):**
  * **Option A: Document Picture-in-Picture (PiP):** Pops an always-on-top floating mini-widget above Excel, Teams, and desktop apps showing your live breathing orb and stopwatch.
  * **Option B: Dynamic Favicon & Notifications:** Renders active project color dot directly inside your browser tab icon and taskbar badge, plus native 30-min reminder cards.
* **Flat, Distraction-Free Project List:** Create color-coded projects in seconds and deactivate finished ones to keep your active dropdown clean.
* **One-Click Excel Copy:** View your logged entries in a clean table and copy them to your clipboard in a single click for instant pasting into Microsoft Excel.
* **Automatic Crash & Drift Checkpoints:** In-memory checkpoints save duration state every 60 seconds to protect against accidental browser closing.

---

## Getting Started: PWA (Recommended)

### Option 1: Test Locally with Zero Dependencies
Run the included test server helper in PowerShell:
```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-LocalLogPwa.ps1
```
This starts a lightweight server on `http://localhost:8080` and opens LocalLog in your browser.
In Microsoft Edge or Google Chrome, click the **"Install App"** icon in the address bar to install LocalLog as a native standalone desktop app on your PC!

### Option 2: Deploy to GitHub Pages (Free, Instant HTTPS)
1. Push this repository to GitHub.
2. In your repository settings $\rightarrow$ **Pages** $\rightarrow$ select the `main` branch as the source and click **Save**.
3. Visit `https://<your-username>.github.io/<repo-name>/`.
4. Click **Install LocalLog** from your browser address bar. The Service Worker will cache the application for full offline use.

---

## Classic Desktop Version (PowerShell)

The original single-file PowerShell 5.1 + WPF desktop application remains available in `LocalLog.ps1`:
```powershell
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\LocalLog.ps1
```

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step. Open `index.html` directly in a browser, or serve the directory with any static file server:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

All three files (`index.html`, `style.css`, `app.js`) are loaded directly; changes take effect on browser refresh.

## Architecture

Single-page dashboard for tracking freelance web dev projects. Three files, no framework, no bundler.

**Data layer — Firebase Firestore**
- Config and credentials are hardcoded in `app.js` (lines 6–13).
- All state lives in a single Firestore document: `webdev/dashboard`.
- `initFirestore()` sets up an `onSnapshot` listener; every change to global state calls `persist()` which writes the whole document back.
- `_saving` flag prevents the snapshot listener from overwriting in-flight saves.
- On first load (document doesn't exist), the app seeds Firestore from the `INI` constant (hardcoded sample projects).

**Global state** (`app.js`)
- `P` — array of all project objects
- `MONTHS` — ordered array of month strings like `"Авг 25"`, shared across all projects; adding/removing a month mutates every project's `months` array
- `aid` / `eid` / `did` — IDs for the currently active/editing/deleting project
- `fClient` / `fType` / `fStatus` — active filter values

**Project data model**
Each project has: `id`, `site`, `client`, `type`, `income` (USDT), `dop` (extra costs $), `refPct` (referral % to partner), `warn`, `status`, `deliveryMonth`, `prepaymentMonth`, `paymentMonth`, `paymentStatus`, `profitShared`, `months[]` (`{month, hours}`).

**Financial formula**
`expense = hours × rate(€/h) × eurRate($/€)` — rate and eurRate are user-editable inputs in the sidebar, persisted to Firestore.  
`profit = income − expense − dop − (income × refPct / 100)`

**Income field**
Accepts plain numbers or arithmetic expressions (`5000+1000`). `evalIncome()` uses `Function()` with a strict character allowlist (`[\d\s+\-*/(). ]+`) to safely evaluate expressions.

**Two views**
- **Projects** (`view-projects`): filterable card summary + table + expandable detail panel per project.
- **Monthly** (`view-monthly`): Chart.js bar+line chart of income/expense/profit per month, plus a breakdown table. Income is attributed to `paymentMonth` (falls back to `deliveryMonth` if unset). Projects missing both fields are surfaced as a warning with quick-edit buttons.

**CSS conventions**
- CSS custom properties defined in `:root` in `style.css`.
- Status badge classes use Cyrillic slugs: `.s-сдан`, `.s-вработе`, `.s-холд`, `.s-напроверке`, `.s-обсуждение` — match the Cyrillic value strings exactly.
- Responsive breakpoints: 900px (4→2 cards), 768px (sidebar becomes drawer), 480px (table columns hidden).

**Month management**
`MONTHS` is the canonical ordered list. `addMonth()` / `addPrevMonth()` append/prepend and call `normMonths()` on all projects to keep the arrays in sync. Modal month inputs are keyed by index (`mh0`, `mh1`, …) but saved by month name to survive index shifts from prepending.

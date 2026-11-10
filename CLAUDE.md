# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step. Serve the directory with any static file server (Firestore needs http, not file://):

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Deployed via GitHub Pages from `main` (https://oldione.github.io/Hexa-dashboard/). `index.html` loads `core.js` then `app.js`.

## Architecture

Single-page dashboard for freelance web-dev projects. No framework, no bundler.

- `core.js` — **data model v2 and the whole calculation layer** (`globalThis.HexaCore`). Shared by the browser and the MCP server, so formulas exist in one place only. Change calculations here, never duplicate them in `app.js` or `mcp/`.
- `app.js` — UI: rendering, forms, Firestore sync. Calls `HexaCore` for every number it shows.
- `mcp/` — MCP server exposing the same data to Claude (see below).

**Storage — Firestore**, one document `webdev/dashboard` (security rules only allow that doc, so "collections" are arrays inside it; ~45 KB, limit 1 MB). The browser writes the whole doc on every change (`persist()`), `onSnapshot` keeps it live; `_saving` skips the echo of our own write. The UI refuses to write unless `schemaVersion === 2` (an old-format doc shows a blocker banner).

**Schema v2** (`schemaVersion: 2`):
- `settings`: `rate` (€/h dev default, 20), `costRate` (€/h cost default, 15), `eurRate` (global $/€ fallback), `expDelay`
- `months[]`: `{month: "Окт 26", eurRate?}` — ordered; per-month rate, falls back to `settings.eurRate`
- `clients[]`, `types[]`: `{id, name}` directories; names normalized on write via `C.ensureRef` (case/space/trailing-s insensitive)
- `projects[]`: `id, site, clientId, typeId, status, origin ('own'|'inherited'|'' = unknown), deliveryMonth, dop, refPct, warn, profitShared, note`
- `hours[]`: `id, projectId, month, hours (real), rate (€/h), kind ('dev'|'cost'), phase ('build'|'support'), phaseManual, note, migrated?`
- `invoices[]`: `id, projectId, amount, currency ('USD'|'EUR'), issuedAt (YYYY-MM-DD), description, status ('draft'|'sent'|'paid'|'cancelled')`
- `payments[]`: `id, projectId, invoiceId ('' = unlinked), amount (USDT), receivedAt, month, note`

**Formulas** (`core.js`):
- entry expense = `hours × rate × monthRate(month)`; project expense = sum of entries
- `phase` auto: inherited → `support`; else month ≤ `deliveryMonth` (or no deliveryMonth) → `build`, later → `support`. `refreshPhases` re-applies after deliveryMonth/origin change; `phaseManual` entries are left alone.
- invoiced = active (sent/paid) invoices in USD (EUR × month rate of issue month); received = sum of payments
- debt = Σ over `sent` invoices of (amount − payments linked to it); `paymentStatus` is computed: not_invoiced / awaiting / partial / paid
- **profit = received − expense − dop − received × refPct%** (cash basis — matches pre-migration numbers); `expectedProfit` adds outstanding debt
- monthly: received by payment month, invoiced by issue month, expense by work month shifted by `expDelay`
- `C.syncInvoiceStatus` flips sent→paid when payments cover an invoice (and back if a payment is removed)
- `C.clientSummary` groups `inherited` projects separately; `C.receivables`, `C.dataIssues` power the reports

**UI views** (tabs): Projects (filters, cards, table with sticky header and inline notes; the detail panel `#det` lives in `#det-home` and is moved into a `tr.det-row` under the selected row on each `renderTable()` — it must be moved out before `tbody.innerHTML` is rebuilt; it holds editors for hour entries, invoices, payments), Monthly (chart + table with editable per-month rate, add month buttons), Clients (period filter), Receivables, Issues.

**CSS conventions**: custom properties in `:root`; status badge classes use Cyrillic slugs (`.s-сдан` …); breakpoints 900px, 768px (sidebar → drawer, sticky header off, tables scroll horizontally), 480px (some columns hidden — selectors target `#proj-table` children by index; update them if columns change).

## MCP server (`mcp/`)

Exposes the dashboard to Claude. `mcp/src/tools.js` defines the tools on top of `HexaCore` (imported from `../../core.js`); `mcp/src/store.js` talks to Firestore via REST (whole-doc PATCH with `currentDocument.updateTime` precondition + retry). Writes go through `makeIO().mutate(fn, allowShrink)` — a guard refuses writes that drop collections or delete records unless the tool declares it, and refuses any write to a pre-v2 document.

Entry points: `mcp/server.js` (stdio, Claude Code/Desktop via root `.mcp.json`) and `mcp/worker.js` (Cloudflare Worker `hexa-dashboard-mcp`, secret in URL path `/mcp/<MCP_SECRET>`, used as a claude.ai custom connector; deploy with `cd mcp && npx wrangler deploy`).

`mcp/scripts/migrate.mjs` migrated v1 → v2 with per-project/per-month reconciliation; kept for reference.

**Never test writes against the production document** — use the in-memory store / mocked `fetch` and a local copy of the data.

---
name: crest-apps
description: Context, conventions, and current status for Crest Pharmacies' single-file web apps in this repo (locum claim, cash log, stock transfer). Read before changing or adding any Crest app page, wiring a backend, or discussing the pharmacy ops tooling roadmap.
---

# Crest Pharmacies web apps — project context

Last updated: 13 Jul 2026.

Crest Pharmacies is a small UK community pharmacy chain: multiple branches in
the same town(s), all **one company / one legal entity**. This repo holds a
family of lightweight, single-file mobile web apps for its internal ops,
backed by a Google Apps Script + Google Sheets backend (owned outside this
repo). The owner (bmoukik) works with a boss who reviews/approves ideas, and
head office / accounts is a separate department.

## The three apps

| File | Purpose | Status |
|---|---|---|
| `index.html` | **Locum payment claim** — locum submits hours/rate/bank details → chosen validator approves via token link → accounts pays by transfer | Live (deployed via "deploy web/index.html" commits) |
| `cash-log.html` | **Till outflow log** — manager records any cash leaving the till (locum cash, team lunch, petty supplies, travel, refunds…) | Frontend complete, demo mode; backend not wired |
| `stock-transfer.html` | **Inter-branch emergency stock transfer note** — sender logs what moved, receiving branch taps Received | Frontend complete, demo mode; backend not wired |

Screenshots of all flows live in `crest/screenshots/` (generated with
Playwright + the pre-installed Chromium; viewport 460×900, deviceScaleFactor 2,
fullPage). Demo tokens print to the browser console where applicable.

## Shared conventions (follow these for any new page)

- **One self-contained HTML file per app.** No frameworks, no build step.
  Plus Jakarta Sans, navy Crest branding, same CSS variable block — copy the
  header/style from an existing page.
- `var API_URL = '__API_URL__'` placeholder swapped at deploy. When it starts
  with `__`, the page runs in **demo mode** (banner shown, localStorage-backed
  fake backend) so every flow is clickable with no server.
- Backend contract documented in a comment block at the top of each file's
  `<script>`. All apps share one Apps Script web app; each has its own Sheet
  tab and `action` names.
- Two-sided integrity pattern: one side records, the other side confirms
  (validator approve / head-office acknowledge / receiver Received). Nothing
  counts until both sides agree.
- Mobile-first, big tap targets, `esc()` every interpolated value, friendly
  error box at top of form, "no connection — NOT saved" failure copy.

## Copy rules (hard-won feedback — do not regress)

- **No accounting language in staff-facing copy.** No "P&L", "netting",
  "settled at cost", "made whole", "in the books". Valuation and month-end
  are head office's department and stay server-side. Say what to do, not why
  it matters financially.
- Plain words over jargon: "Keeping it / Borrowing" (not Transfer/Loan),
  "the price on the invoice — not the shelf price" (not "at cost").
- **No link-based flows for branch staff** where avoidable: the receiving
  side should find work waiting on the page they already use. Each device
  remembers its branch via localStorage (`crest_branch`), one-time pick,
  changeable. Token links are OK for head-office/validator roles.

## Key decisions already made (don't relitigate)

- **Cash log:** threshold sign-off — under £20 auto-recorded, £20+ requires
  head-office acknowledgement (token link). Locum-paid-in-cash lives in the
  cash log as a category (with role/GPhC/right-to-work compliance fields),
  not in the claim app.
- **Stock transfer:** phone/WhatsApp coordination stays exactly as it is —
  the app only records what moved (~20s form) + one-tap receive. No request/
  broadcast/approval workflow, no WhatsApp bot (official API costs per
  message; unofficial bots risk bans), no dashboards for branch staff.
  Keep-vs-borrow toggle; borrows auto-convert to kept after 30 days.
  Transfers valued at **cost price**; monthly per-branch-pair netting is a
  backend job that emails accounts one journal line.
- Head-office bulk-to-branch distribution: explicitly parked for later.
- The boss pitch angle: PMR vendors charge ~£500/branch/month for transfer
  modules; this is £0/month on existing infra.

## Compliance notes (UK pharmacy — reflect these, never remove)

- Same legal entity ⇒ branch-to-branch moves are not wholesale dealing (no
  WDA(H) needed). Keep transfers at cost / not-for-profit.
- **Controlled drugs (Sch 2/3):** FP10CDF requisition + CD register entries
  at BOTH branches within 24h. The apps flag and remind; they must never
  claim to replace the statutory process.
- Fridge lines (2–8°C): proper cold-chain transit container, not a domestic
  cool box.
- Records retained 2 years. GPhC audit trail: who, what, when, both ends
  confirmed.

## Open work (next steps)

1. Owner to review cash-log and stock-transfer prototypes.
2. Wire Apps Script backends: "Cash Log" tab (`cashmeta`, `cashlog`,
   `cashentry`, `ack`, `query`) and "Transfers" tab (`transfermeta`,
   `transferlog`, `pending`, `transferentry`, `receive`, `dispute`) +
   month-end netting trigger. Then set API_URL and deploy.
3. Later phase: head-office bulk distribution; possible boss-pitch doc for
   the stock exchange (research findings saved in session scratchpad
   `research.json`, key facts summarised above).

## Related trackers

- Notion "Crest" hub → "Crest — To-dos" database (kept current; entries
  exist for the backend wiring and for Carl's P&L inter-branch section).
- A separate `crest:log` skill (decisions log) exists in another
  environment/repo — not present here; don't confuse it with this file.

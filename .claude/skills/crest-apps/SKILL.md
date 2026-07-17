---
name: crest-apps
description: Context, conventions, and current status for Crest Pharmacies' single-file web apps in this repo (locum claim, cash log, stock transfer). Read before changing or adding any Crest app page, wiring a backend, or discussing the pharmacy ops tooling roadmap.
---

# Crest Pharmacies web apps — project context

Last updated: 16 Jul 2026. **See "SESSION HANDOFF — 16 Jul 2026" at the
bottom for the current live plan, decisions, and the exact next actions.**

Crest Pharmacies is a small UK community pharmacy chain: multiple branches in
the same town(s), all **one company / one legal entity**. This repo holds a
family of lightweight, single-file mobile web apps for its internal ops,
backed by a Google Apps Script + Google Sheets backend (owned outside this
repo). The owner (bmoukik) works with a boss who reviews/approves ideas, and
head office / accounts is a separate department.

## The three apps

| File | Purpose | Status |
|---|---|---|
| `index.html` | **Locum payment claim** — locum submits hours/rate/bank details → chosen validator approves via token link → accounts pays by transfer, or sends it back | **Phase-1 frontend DONE 17 Jul 2026** (accounts step, 2 flags, self-approval block, demo mode added); awaiting backend deploy |
| `cash-log.html` | **Till outflow log** — manager records any cash leaving the till (locum cash, team lunch, petty supplies, travel, refunds…) | **Phase-1 frontend DONE 17 Jul 2026** (shared config + device-remembers-branch); awaiting backend deploy |
| `admin.html` | **Admin / control panel** — PIN-gated settings for the whole tool family (pharmacies, validators, emails, per-tool knobs) | **BUILT 17 Jul 2026**, demo mode, verified end-to-end; awaiting backend deploy |
| `stock-transfer.html` | **Inter-branch emergency stock transfer note** — sender logs what moved, receiving branch taps Received | Frontend complete, demo mode; **ON HOLD** (not in this go-live) |

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

## Related trackers

- Notion "Crest" hub → "Crest — To-dos" database (kept current). Relevant
  entries: "Locum app: run backend setup + deploy" (the concrete deploy step,
  has the backend Code.gs), "Prep boss call Tuesday" (locum = steer #1; call
  was 14 Jul), "Locum accounting — await boss context" (Low, Boss-owned),
  "Wire Apps Script backends for cash-log + stock-transfer", and "Carl's P&L
  template" (inter-branch section updated with transfer-log status).
- A separate `crest:log` skill (decisions log) exists in another
  environment/repo — not present here; don't confuse it with this file.
- Stock-exchange research (verified July 2026) saved in the cloud session
  scratchpad as `research.json`; key facts are summarised in the compliance
  section above.

---

# SESSION HANDOFF — 16 Jul 2026 (start here)

This is the live plan carried over from a long cloud-chat design session.
Work continues on branch `claude/locum-payments-context-brflyu`. Nothing
below is built yet unless the file status table says so.

## Go-live scope (decided)

**Ship together: Locum app + Cash log + Admin page.** Plan thin, develop
subsequently. **Stock transfer is ON HOLD.** The **bulk-order / demand-
forecasting toolkit** (flagged in Notion as possibly superseding the stock-
transfer app; needs Proscript data + a pilot site) must be **discussed with
the boss first** — do not build.

## Approval-model decision (important — do not revert)

The owner explicitly **rejected "silence is consent"** for the locum flow.
Money moving requires a **positive, logged action** — "one-tap
accountability." So:
- **Validator keeps an explicit Approve tap**, and the approval **records who
  + when** (non-repudiation), not a shared-inbox nod.
- A slow/absent validator is handled by **reminders + escalation**, NOT by
  auto-approving. (Their real-world process today is email approval-by-
  exception; we are deliberately strengthening it, because it moves money.)
- **Accounts is the explicit payer** and a second exception-handler.

## Phase-1 build (thin) — what to actually build

**1. Locum app (`index.html`) changes:**
   - Keep explicit validator approval; capture approver identity (who + when).
   - New **accounts step**: **Paid ✓** (emails the locum — kills "where's my
     money?" chasers) OR **raise-back with reason** (bounces to validator or
     locum). This is the known gap: accounts currently has no lever, only the
     validator does.
   - Two new **flags** (extend the existing server-side flags mechanism the
     validator already sees): **duplicate/overlapping days** and **bank-
     details-changed-since-last-claim**. (Rate-out-of-band was considered and
     **dropped** by the owner.)
   - **Self-approval block**: locum can't be their own validator (validator
     email ≠ locum email).
   - Reads validators / pharmacies / emails from the shared config.
   - Reminder cadence DEFAULT (unconfirmed): nudge validator at 2 working
     days, escalate to head office at 4.

**2. Cash log (`cash-log.html`):** point it at the shared config (pharmacies,
   categories, £20 threshold, ack email). Identity via device-remembers-branch
   + submitter name; acknowledge locked to head office. Otherwise built.

**3. Admin page (`admin.html`) — thin:** PIN-gated. Manage pharmacies; manage
   validators (pharmacy / name / email / active); edit global emails
   (accounts, locum-handling, cash-log ack); two labelled per-tool sections
   (Locum reminder/escalate days; Cash threshold). Guardrails: email
   validation, **cannot leave a pharmacy with zero active validators**,
   confirm-before-save, and a **change-log row (who/when/what)**. Writes to the
   config store. Demo mode like the others.

## Shared config + control-plane architecture (decided)

- **One shared Config store = single source of truth**, in its **own tabs,
  separate from claim/cash transactional data** (ideally a separate
  spreadsheet). Organized **Global** (pharmacies, validators+emails, accounts
  email, locum-handling email, admin PIN) **+ per-tool sections** (namespaced;
  e.g. Locum timings, Cash threshold).
- **Control plane / data plane split:** a **dedicated admin/ops Google
  account** owns the admin page + config. Other tools can live on **whatever
  email suits their use case** (the numbers dashboard is on `accounts@`; a
  pharmacy-specific tool could sit on that pharmacy's email) and still **read
  config centrally** — centralisation is *logical, not physical*.
- **Two cross-account connection patterns:** (a) a **config API endpoint** —
  admin Apps Script web app serves config over HTTPS, any tool fetches by URL,
  account boundaries irrelevant (keep the PIN and anything sensitive OUT of the
  public blob); or (b) a **shared config Sheet** read-only to each tool's
  account via `openById` (more private, needs a one-time share). Recommend the
  endpoint with the shared-Sheet as fallback.
- **Only the admin panel writes** config; every tool is **read-only** and
  **fails safe** (caches last-good config, falls back to sensible defaults) so
  the single source of truth is never a single point of failure.

## Build vs backend boundary

In-repo (Claude builds): `admin.html`, the `index.html` changes, cash-log
config alignment, all with demo modes — PLUS a precise **Config-sheet layout +
Apps Script action spec** (including the reminder/escalation cron) handed
drop-in-ready. The Apps Script backend (reads/writes the config sheet, sends
emails, runs reminders) is the **deploy step**, done outside this repo (see the
Notion "run backend setup + deploy" todo, which holds the backend Code.gs).

## Open inputs — ALL ANSWERED 17 Jul 2026 (do not re-ask)

1. **Admin PIN** — placeholder `0000`, seeded as a salted hash, changed on
   first login through the panel. The page nags until it changes. The PIN is
   never in the HTML and never in the public config blob; only the backend
   compares it, and it must rate-limit (5 fails/hour → 30 min lock).
   **UPGRADED 17 Jul 2026 (Moukik: admin needs the dashboard's 2-layer model):**
   the live console is a SEPARATE Apps Script deployment (Execute as: user
   accessing, access: Anyone with Google account) serving `AdminConsole.html`
   (pasted in the editor as file "Admin") — Google sign-in + `admin.allowedEmails`
   allowlist (Global tab) + the PIN, three layers. Admin actions were REMOVED
   from the public "Anyone" API (`doPost` no longer routes them); change-log
   `by` = the Google-verified email. Allowlisted admins need Editor on the
   Crest Config spreadsheet (script runs as the user). At go-live on the
   company account, switch to DOMAIN access like the dashboard. The repo's
   `admin.html` is the demo/design preview only.
2. **Accounts** — **one shared inbox** (a single global email in admin, not a
   list of named people). To keep the non-repudiation rule, the accounts step
   requires a **typed name** on Paid / send-back, remembered per device in
   `crest_accounts_name`. Upgrade path if the typed name proves too weak: a
   named-people list like the validators.
3. **Reminder cadence** — **confirmed as the default**: remind the validator at
   2 working days, escalate to locum-handling at 4. Both live in config.
4. **Emails — TESTING RULE:** no `@crestpharmacy.com` addresses anywhere yet.
   Personal/placeholder addresses only, set through admin. Swapping to real
   company addresses is the LAST go-live step, after end-to-end testing. The
   admin page carries this as a visible warning.

## Phase-1 build state (17 Jul 2026)

Frontend is **done and verified in demo mode** on branch
`claude/locum-payments-context-brflyu`; the backend is the remaining work.

- `admin.html` built: PIN gate, pharmacies, validators, emails, locum timings,
  cash threshold, PIN change. Guardrails verified live: wrong PIN rejected,
  zero-active-validator blocked, invalid email caught, confirm-before-save,
  plain-English change log written with who/when/what.
  **Redesigned desktop-first 17 Jul 2026** (Moukik: "admin is used on a PC,
  not a phone") — dark navy rail + wide work surface + real tables, unlike the
  phone apps. Signature element: live "Review changes (n)" counter in the
  header that ticks as you edit. Lock-screen PIN gate. Mobile degrades to
  pill nav + scrollable tables. All logic/guardrails unchanged and re-verified.
- **Test emails are Gmail plus-aliases of bmoukik@gmail.com** (17 Jul 2026):
  validators `moukik.cyber+val.<name>@`, accounts `moukik.cyber+accounts@`, escalations
  `moukik.cyber+locumdesk@`, cash acks `moukik.cyber+cashack@`, test locums
  `moukik.cyber+locum.<name>@`. One inbox sees every stream. Gmail labels created
  under "Crest apps/" (Validators, Accounts, Locums, Cash log, Locum desk);
  the to:-address FILTERS must be added manually in Gmail settings (no API for
  filters). Deploy the Apps Script on the admin/ops account, NOT bmoukik@ —
  Gmail does not reliably filter self-sent mail. Caveats in BACKEND_SPEC.md.
- `index.html`: accounts step (**Paid ✓** emails the locum / **send it back**
  to validator or locum with a reason), both flags (duplicate days, bank
  changed) shown to validator AND accounts, self-approval block, demo mode
  ported from the cash log. Verified: validator view never receives the `bank`
  object.
- `cash-log.html`: threshold/pharmacies from shared config, device remembers
  branch + name (`crest_branch`, `crest_name`).
- **`BACKEND_SPEC.md`** written — config sheet layout, every action, token
  rules, the reminder/escalation cron, and a go-live checklist. The flag rules
  and self-approval block are mirrored in the page JS; change both or they drift.
- Demo mode shares one `crest_config` in localStorage across all three pages, so
  editing a validator or the threshold in admin shows up in the other apps —
  the real architecture in miniature (admin writes, every tool reads).

**Decisions taken while building** (didn't need a steer, flag if wrong):
- No rename button for pharmacies — past claims point at the name string, so
  renaming would orphan history. Add-new + switch-old-off instead.
- Cash categories stay in config but out of the admin UI (thin, per the plan).
- Validator identity comes from their token (emailed only to them), so they
  never type a name; accounts type one because they share an inbox.

## Parked / later (do not build now)

Stock transfer (on hold); bulk-order/demand-forecasting toolkit (boss first);
line-level claim adjustment; audit/reporting dashboard; and the boss-decision
compliance items — **IR35 / employment status** (payroll vs self-employed for
cash/locum payments), whether the claim replaces an invoice for the tax trail,
and **GPhC register / right-to-work verification** (currently format-checked /
self-certified only). The IR35/invoice question was flagged for the boss-call
steer list.

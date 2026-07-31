---
name: crest-apps
description: Context, conventions, and current status for Crest Pharmacies' single-file web apps in this repo (locum claim, cash log, stock transfer). Read before changing or adding any Crest app page, wiring a backend, or discussing the pharmacy ops tooling roadmap.
---

# Crest Pharmacies web apps — project context

Last updated: 30 Jul 2026. **Phase 1 is LIVE — read "🟢 LIVE STATE" below
first.** The "SESSION HANDOFF — 16 Jul 2026" section at the bottom is the
design history + decisions record (still binding on the don't-relitigate
points), but its build steps are DONE.

**Lyeba demoed and signed off both apps on 30 Jul 2026 — read
"LYEBA DEMO — 30 Jul 2026" before changing either app.** Three changes
shipped straight out of it and are on `main` but NOT yet in the deployed
Apps Script (see "⚠️ UNDEPLOYED" below).

**Remaining before real go-live** (testing period until then, personal
emails only): Gmail labels+filters on moukik.cyber (manual); swap validator
placeholders for real people via the console — **Lyeba owes the branch
manager email list, chase from 31 Jul / start of w/c 3 Aug**; confirm
Ridgacre on/off; watch the first reminder/escalation fire (weekday 9am
trigger); THEN swap the three global emails + validator emails to real
company addresses, move hosting to the final domain, and reprint the QR
posters (URL is in the ink).
Parked (unchanged): stock transfer; bulk-order toolkit (boss first);
IR35/invoice-trail + GPhC/RTW verification (boss steers).

## ⚠️ UNDEPLOYED — on `main`, not in the Apps Script editor

`Code.gs` in this repo is ahead of the deployed web app. Until it is pasted
in and the deployment version is bumped, three things are inert:

1. **Receipt viewing** (`cashGet_` sends bytes inline) — without it the ack
   page still shows a broken image.
2. **Per-day rates** — the form collects them and the server bills every
   hour at the agreed rate. **This one is a money bug while it is half
   deployed**, since the page shows a total the backend will not honour.
3. **`addHeadOfficeValidator()`** — does not exist until pasted, then must
   be run once from the editor.

Crest Pharmacies is a small UK community pharmacy chain: multiple branches in
the same town(s), all **one company / one legal entity**. This repo holds a
family of lightweight, single-file mobile web apps for its internal ops,
backed by a Google Apps Script + Google Sheets backend (owned outside this
repo). The owner (bmoukik) works with a boss who reviews/approves ideas, and
head office / accounts is a separate department.

## 🟢 LIVE STATE (17–18 Jul 2026) — read this before touching anything

**Phase 1 is DEPLOYED and tested end-to-end with real emails.** Everything
below in this box is production fact, not plan.

- **Hosting:** GitHub Pages off `main` — https://bmoukik.github.io/locum-claim/
  (`index.html`, `cash-log.html`, `posters.html`; `admin.html` there is a DEMO
  design preview only). Work branch `claude/locum-payments-context-brflyu` is
  kept merged into main.
- **Backend:** ONE Apps Script web app (`Code.gs` in this repo = the deployed
  code; re-paste + bump deployment version to change). Public deployment
  (Execute as Me / access Anyone):
  `https://script.google.com/macros/s/AKfycbzo_SG8akvk_7P82WXMGmAuHfeTcU_xZj1nahQSJ8x9h24445oO1NyWIJhwPDvB2kc0/exec`
  — baked into the three pages (demo mode auto-off). Two spreadsheets on the
  deploying account: **Crest Config** (Global/Pharmacies/Validators/Tools/
  ChangeLog) + **Crest Apps Data** (Claims/Cash Log/Tokens). Weekday-9am
  reminder trigger installed by `setup()`.
- **Admin console:** SEPARATE deployment of the same script (Execute as: user
  accessing / access: Anyone with Google account) serving the `Admin` HTML
  file (`AdminConsole.html` in repo). Three layers: Google sign-in → allowlist
  (`admin.allowedEmails` on Global tab = bmoukik@gmail.com, moukik.cyber@
  gmail.com; both share the Config sheet as Editors) → PIN (changed off 0000,
  rate-limited 5/hr → 30-min lock). Admin actions are NOT in the public
  doPost — verified refused. Change-log `by` = Google-verified email.
  Sessions: 2h sliding; unsaved edits survive a re-auth; removing a pharmacy
  cascades its validators (all three were the "my changes vanished" fixes,
  18 Jul).
- **Config content:** the REAL 24-branch estate seeded via `seedEstate()`
  (23 OCS-map branches + Crook; Adastral excluded — merged into Canford;
  Ridgacre included, switch off in console if it shouldn't take claims).
  One random test validator per branch on `moukik.cyber+val.<first>@gmail.com`.
- **Test emails (Gmail plus-aliasing, ALL streams → moukik.cyber@gmail.com):**
  validators `+val.<name>`, accounts `+accounts`, escalations `+locumdesk`,
  cash acks `+cashack`, test locums `+locum.<name>`. Verified live: claim
  CLM-0B718 submitted through the hosted page → validator + locum emails
  arrived. Labels exist under "Crest apps/" on bmoukik's Gmail (WRONG account
  now — recreate labels + 5 to:-filters on moukik.cyber, still manual).
- **Repo consolidation (20 Jul 2026):** `bmoukik/crest-locum-payments` (the
  private June–July prototype, `LOC-2026-NNNN` refs, own backend/web/) is
  SUPERSEDED — this repo is the single locum repo. Ported before archiving:
  `appsscript.json` (manifest), a rewritten `tests/test_logic.js` (59 Node
  checks against the LIVE Code.gs — mocked GAS services, full claim lifecycle,
  bank-visibility + self-approval invariants; run before any Code.gs commit),
  and the README architecture rationale. The prototype's own tests/UI targeted
  its dead backend and were deliberately not carried over; the old repo stays
  archived (not deleted) as history.
- **QR posters:** https://bmoukik.github.io/locum-claim/posters.html — 25 A4
  pages (one per branch + generic). Each QR = `index.html?ph=<branch>` which
  pre-selects the pharmacy + loads its validators (still changeable). QRs are
  error-correction Q; regenerate by re-running the segno snippet in git log /
  session notes if the estate or domain changes. **Domain change ⇒ reprint.**

## LYEBA DEMO — 30 Jul 2026 (decisions; do not relitigate)

Moukik demoed both apps to Lyeba. **Both approved and wanted.** Her verdicts,
in her framing rather than ours:

- **Locum app: unambiguous yes for drivers, dispensers, phlebotomists.**
  They have no RP log, so nothing about them is contentious. A driver's claim
  gets validated by the manager who booked the cover (she named Albert at
  Humber, Ali at Clay) and then reaches her already checked.
- **Locum app for pharmacists: yes, with the RP log as the open question.**
  See "RP log" below.
- **Cash log: yes — and the reason is narrower than the pitch.** Not the
  monthly tally. **The receipt upload.** Her live gap is that ATL payout
  reports exist but receipts do not: headings are junk ("a fan for £40" that
  was actually a locum payout), and paper receipts die in a drawer. Receipt
  capture at the moment of payout is the whole value.
- **Scope: Crest's own shops only.** Partner pharmacies are out — the
  partners organise shifts, check invoices and forward them, so approval
  already happens before head office sees it. Extending to them is a separate
  process and a later conversation.
- **No deadline.** Verbatim: "If it's not something that's been in place, I'd
  rather have it in place than have it perfect." Do not rush either app.

### Corrections to earlier assumptions (these were wrong before 30 Jul)

- **Tally the cash log against the ATL payout report, NOT Sage petty cash.**
  Sage petty cash includes head-office spend (e.g. new shelves paid centrally)
  that never touched a branch till. They are different numbers.
- **The GPhC number is not a validation input.** Lyeba has never once checked
  a claim against it — it is held so that a patient complaint can be traced to
  who was RP that day. Do not build GPhC register verification; it solves a
  problem nobody has.

### Shipped out of this meeting (all on `main`, see ⚠️ UNDEPLOYED)

- **Receipts now viewable by the acknowledger.** They were uploading to Drive
  fine but the ack page rendered a Drive *page* URL in an `<img>`, so it was
  always a broken image, and the file is private to the deploying account so
  clicking through gave "request access". The bytes now travel inline against
  the token the acknowledger already holds. Photos are downscaled to 1600px
  JPEG client-side first (~4MB → ~200KB).
- **Per-day rates.** Cover is not priced the same every day — bank holidays,
  weekends and last-minute shifts cost more. The agreed rate stays the
  default; a checkbox turns the day list into hours + £/hr, each pre-filled
  from the agreed rate. Only days that differ are called out on the review
  page, so the validator's eye goes to the exception.
- **Head office validates at every branch** (`addHeadOfficeValidator()`).
  Regular pharmacists (Tahir, Mariam, Janade, Hamza) have no manager who
  booked their shift, so Lyeba approves them off the RP log.
  **Deliberately a VALIDATOR at each branch, not a "Crest Pharmacies"
  pharmacy** — which is how it came up in the meeting. A head-office
  *pharmacy* would record head office as the place worked and throw away the
  branch that carries the cost, defeating the P&L feed that is the whole
  point. Do not "simplify" it back.

### RP log — stays manual, and here is why (researched 30 Jul 2026)

The RP log is a **legal record** under the Responsible Pharmacist Regulations
2008 (name, GPhC number, time became RP, time ceased). Lyeba checks it daily;
an inspector opening it is checking the pharmacy's compliance, not our payment
trail. **The apps must never look like they replace it.**

Their system is **Pharmsmart** — one word, no 'a', pharmsmart.co.uk.
(**PharmaSmart** *with* an 'a' is an unrelated US blood-pressure-kiosk
company. Do not confuse them, and do not research that spelling.) Findings,
evidenced not assumed:

- **No API.** Raw HTML of all 18 site pages: zero hits for export, csv,
  excel, webhook, developer. `api.` and `developer.` subdomains return 200 but
  it is **wildcard DNS** — an invented subdomain serves the same homepage.
- **No export of any kind.** No CSV, Excel, scheduled report or download for
  the RP log or anything else.
- **What does exist:** the Head Office module surfaces "Missed RP Log
  entries" across branches. That is exception monitoring, not the log rows.
- **The only route is the vendor**: 0333 772 0679 / support@pharmsmart.co.uk.
  Ask specifically for a bulk or scheduled RP-log extract at group level;
  "do you have an API" gets answered with "we integrate with PMRs", which is
  a different thing. Crest being ~24 branches and Pharmsmart already having
  multi-branch customers is the leverage.
- **Second door, unchecked:** if the branches run Cegedim **Pharmacy
  Manager**, it has a built-in Responsible Pharmacist Report today (date
  range, pharmacist filter, includes deleted/amended records). Per-branch, no
  evidenced CSV. Nobody has confirmed which PMR Crest runs.

**Blocker for any automation: the claim records hours, the RP log records
times.** "8 hours on the 15th" cannot be matched against "signed in 09:00,
out 18:00" — which is exactly the check Lyeba does by eye. Start/end times on
the claim are the prerequisite for any future matching.

Head-office-credential scraping was considered and is **not** the plan.
Pharmsmart's terms have no anti-automation clause and clause 5.3 arguably
permits internal use, but 6.1.4 forbids copying their "operating logic or
database structure" — which is precisely what a scraper encodes. Reg 5(3)
makes the owner an inspector of the record but "**at the premises**": an
inspection right is not a right to a remote feed. And a scripted login breaks
silently, which is the worst failure mode on a money path.

### 🔴 The biggest gap: the apps do not feed the P&L at all

Verified 30 Jul by grepping the whole `crest_P&L` pipeline for claim refs,
cash log and the Crest Apps Data sheet: **zero hits.** Claims and cash entries
land in their own spreadsheet and stop there. Both apps deliver the workflow
and none of the reporting — while Lyeba named the reporting as the main
benefit twice.

**The trap when building it:** `build_full_csv.py` already routes Sage locum
items to a canonical "Locum Expenses" row, and Sage petty cash already carries
branch spend. Feeding app data in on top would **double-count** every payment
that also reaches Sage. The interlink has to be *reconciliation* — app record
matched against the Sage line, differences flagged — not addition. Settle that
shape with Moukik before writing any code.

### Open, not decided (do not build on a guess)

- **Cash log categories vs ATL payout headings.** Ours are our own list.
  Lyeba's complaint is junk ATL headings, so matching the two lists is what
  makes them reconcile line for line. Needs her to send ATL's list.
- **The float question.** £5 out of the till, £2 spent — is £3 going back?
  She raised it and then said she did not know if it was worth doing. Cheapest
  shape is amount-taken vs amount-spent. Do not build until she decides, or it
  is a field nobody fills.
- **Which PMR the branches run** (gates the Pharmacy Manager route above).

## The app files

| File | Purpose | Status |
|---|---|---|
| `index.html` | **Locum payment claim** — locum submits hours/rate/bank details → chosen validator approves via token link → accounts taps Paid (emails locum) or sends it back with a reason | **LIVE** (accounts step, duplicate-days + bank-changed flags, self-approval block, `?ph=` QR prefill; demo mode when `__API_URL__`) |
| `cash-log.html` | **Till outflow log** — manager records any cash leaving the till | **LIVE** (shared config threshold/pharmacies, device remembers branch+name) |
| `admin.html` | Demo/design preview of the admin console | Demo only — the live console is the private admin deployment |
| `AdminConsole.html` | The REAL admin console (pasted in Apps Script as HTML file `Admin`) | **LIVE** behind Google sign-in + allowlist + PIN |
| `Code.gs` | The whole backend (spec: `BACKEND_SPEC.md`) | **DEPLOYED** — repo copy is source of truth, editor is paste target |
| `appsscript.json` | Apps Script manifest (V8, Europe/London, public web-app defaults) | Paste alongside Code.gs; admin deployment overrides access per-deployment |
| `tests/test_logic.js` | 59 Node checks on the live Code.gs (mocked GAS) | Run `node tests/test_logic.js` before any Code.gs commit |
| `posters.html` | Printable QR posters, one per branch | **LIVE** |
| `stock-transfer.html` | Inter-branch stock transfer note | Frontend complete, demo; **ON HOLD** |

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

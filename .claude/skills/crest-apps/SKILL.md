---
name: crest-apps
description: Context, conventions, and current status for Crest Pharmacies' single-file web apps in this repo (locum claim, cash log, stock transfer). Read before changing or adding any Crest app page, wiring a backend, or discussing the pharmacy ops tooling roadmap.
---

# Crest Pharmacies web apps — project context

Last updated: 18 Jul 2026. **Phase 1 is LIVE — read "🟢 LIVE STATE" below
first.** The "SESSION HANDOFF — 16 Jul 2026" section at the bottom is the
design history + decisions record (still binding on the don't-relitigate
points), but its build steps are DONE.

**Remaining before real go-live** (testing period until then, personal
emails only): Gmail labels+filters on moukik.cyber (manual); swap validator
placeholders for real people via the console; confirm Ridgacre on/off;
watch the first reminder/escalation fire (weekday 9am trigger); THEN swap
the three global emails + validator emails to real company addresses, move
hosting to the final domain, and reprint the QR posters (URL is in the ink).
Parked (unchanged): stock transfer; bulk-order toolkit (boss first);
IR35/invoice-trail + GPhC/RTW verification (boss steers).

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
- **Cash redesign deploy order (NOT YET DONE — blocks merging to main):** the
  20 Jul cash work adds backend actions the deployed script doesn't have.
  Order: (1) paste new `Code.gs` into the editor, (2) run `migrateCash_()`
  once (appends new columns, creates Cash Requests tab, seeds
  `cash.categories`), (3) Deploy → Manage deployments → New version — for
  BOTH deployments (public + admin), (4) only THEN merge the branch to main
  so Pages picks up the new pages. Merging pages first breaks the live cash
  form. Tests: `node tests/test_logic.js` (116 checks) covers the whole model.
- **QR posters:** https://bmoukik.github.io/locum-claim/posters.html — 25 A4
  pages (one per branch + generic). Each QR = `index.html?ph=<branch>` which
  pre-selects the pharmacy + loads its validators (still changeable). QRs are
  error-correction Q; regenerate by re-running the segno snippet in git log /
  session notes if the estate or domain changes. **Domain change ⇒ reprint.**

## The app files

| File | Purpose | Status |
|---|---|---|
| `index.html` | **Locum payment claim** — locum submits hours/rate/bank details → chosen validator approves via token link → accounts taps Paid (emails locum) or sends it back with a reason | **LIVE** (accounts step, duplicate-days + bank-changed flags, self-approval block, `?ph=` QR prefill; demo mode when `__API_URL__`). **BUILT, NOT DEPLOYED (20 Jul):** "paid in cash" settle option + live cash flags |
| `cash-log.html` | **Branch spend & approvals log** — records (money already spent) + requests (ask first), review floored by category policy, reimbursement, locum-cash links to claims | **REDESIGNED 20 Jul — BUILT, NOT DEPLOYED.** The live page still runs the old flat-£20 model until the new Code.gs is pasted (see deploy order below) |
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

- **Cash log (SUPERSEDED 20 Jul 2026 — new model below):** ~~threshold
  sign-off — under £20 auto-recorded, £20+ requires head-office
  acknowledgement~~. Replaced per the owner's 13 Jul Notion steer + 20 Jul
  design session by the **record/request model**: three independent dimensions
  per entry — (1) record (money already spent — the common case, cash is
  sorted at the counter) vs request (ask first, cost may be unknown → approve
  with optional cap, lapses in 30 days); (2) review level floored by a
  per-category **policy matrix** (self / review / approve + per-category cap)
  with a global review ceiling as backstop — submitter can escalate, never
  downgrade; (3) settlement source till / own pocket (→ OWED → Repaid, HO
  typed-name tap, payer emailed) / invoice-to-HO. Emergency path: spending
  without asking is never blocked, always flagged + reviewed (or people route
  around the app). Flags: over-cap, repeat-spend-on-one-approval, duplicate
  entry.
- **Locum cash links to the claim system (20 Jul 2026):** cash is a
  **settlement method for a claim, never a parallel payment route** — else the
  validator trail and duplicate-day checks are bypassed at the till. Claim
  first (intended): approved claim + linked cash entry → HO ack (typed name
  required — it moves money) marks the claim PAID `paidMethod=cash`, locum
  emailed, accounts warned off the bank transfer. Cash first (reality): entry
  carries the locum's email; any later claim from that email grows a **live
  flag** (computed at view time, both validator + accounts views), and
  accounts settles it with the "paid in cash at the branch" tick — which
  **back-fills `claimRef` onto the cash entry** when exactly one matches, so
  the link reads both ways from sheet data alone. Locum entries are always
  reviewed. **The worked days/hours live ONLY on the claim** (monthsJson
  per-month split — the P&L allocation data); the cash row never duplicates
  them. **P&L rule:** Claims tab = the locum cost record (month split,
  `paidMethod` bank/cash, `cashEntryRef`); locum-category Cash Log rows are
  till movements — a future pipeline must never ingest both as locum expense
  or cash-paid locums double-count (full filter rules in spec §6a).
- **Branch-raised claims (21 Jul 2026, owner steer — spec §6b):** when the
  locum can't or won't submit ("if they could have, it wouldn't come through
  this route"), the BRANCH fills the worked days at the counter and a claim
  is raised on the locum's behalf — no chasing the locum afterwards (the cron
  chase now covers pre-migration rows only). Two routes from the cash-log
  locum path: **cash was paid now** (entry + auto-raised claim
  `origin='branch-cash'`, rate derived amount÷hours; HO ack + validator
  approval in either order — whichever comes second auto-settles the claim as
  PAID/cash) and **head office should pay them** (`action:'branchclaim'`,
  `origin='branch-hopays'`, locum's bank details required, no cash moves;
  validator approves → accounts pay by bank as normal). Fraud tripwire: the
  locum is emailed whenever a claim is raised in their name (when an address
  exists); `submittedBy` recorded; self-approval + duplicate-days checks run
  (duplicates by email, or by NAME when no email); bankless claims cannot be
  bank-paid.
- **Gap-hunt hardening (21 Jul 2026, 5-lens adversarial review):** fixed —
  `parseLocumDays_` rejects impossible/typo dates (real-calendar + not future /
  not >6mo old) and duplicate day-rows (no more silent hour-drop; page mirrors
  both); manager-who-raised ≠ approver on the on-behalf path; branch-raised
  claims always ping `locumHandling` (tripwire independent of the locum's
  email); settle-as-cash back-fill now requires matching amount + non-blank
  email both sides; a claimRef only settles from a **locum-category entry at the
  same pharmacy and amount** (blocks cross-branch / wrong-category claim
  hijack); rejecting a branch-cash claim alerts HO the till cash is unbacked and
  resurfaces the orphaned entry on any resubmission; tokenless `cashReqStatus_`
  no longer returns decider name or verbatim reason; money stored at 2dp. Tests
  162→178. Known-but-unfixed (deliberate, tracked, revisit before wider
  rollout): no validator-reassignment path; partial/split payments; single
  30-day token expiry on APPROVED/PENDING/OWED; public-endpoint email-relay/DoS
  + 5-char ref guessability (architectural — token-as-credential); plus-alias
  self-approval tripwire (documented).
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
line-level claim adjustment; audit/reporting dashboard; **cash phase-2 items
(20 Jul): till-float ledger/balance tracking (creeps into cash management —
boss first; `paidFrom` is captured now so the data exists), receipt photo
storage beyond the existing Drive link, month-end category digest to accounts
(data is shaped for it)**; and the boss-decision
compliance items — **IR35 / employment status** (payroll vs self-employed for
cash/locum payments), whether the claim replaces an invoice for the tax trail,
and **GPhC register / right-to-work verification** (currently format-checked /
self-certified only). The IR35/invoice question was flagged for the boss-call
steer list.

# Crest apps — config layout + Apps Script spec

Phase 1: **locum claim + cash log + admin**, one shared config, one Apps Script.
This is the deploy-step half, done outside this repo. The three HTML pages are
built and demo-mode clickable; wire this up and swap `__API_URL__` in each.

Everything below is what the frontends already assume. Where a rule is
duplicated in the page JS (the flags, the self-approval block), it is marked
**mirrored** — change both or they drift.

---

## 1. Two spreadsheets, on purpose

| Spreadsheet | Owner | Holds |
|---|---|---|
| **Crest Config** | admin/ops Google account | Global, Pharmacies, Validators, Tools, ChangeLog |
| **Crest Apps Data** | same account (phase 1) | Claims, Cash Log |

Config is separate from transactional data so a config mistake can never
scribble on a claim, and so the config can later be shared read-only to a tool
living on a different account without exposing claims.

**Control plane / data plane.** The admin account owns the config and the admin
page. Other tools may live on whatever account suits them (the numbers
dashboard is on `accounts@`, a branch tool could sit on that branch's account)
and still read config centrally. Centralisation is logical, not physical.

**Phase 1 reads config directly.** All three apps are one Apps Script owned by
the same account as the config, so they read it with `SpreadsheetApp.openById()`.
No endpoint needed yet. Section 8 specs the endpoint for the first cross-account
tool.

**Only the admin panel writes.** Every tool is read-only against config and
**fails safe**: cache the last-good config in `PropertiesService`, and if the
config sheet is unreachable serve the cache; if there is no cache, serve the
hardcoded defaults. The single source of truth must never be a single point of
failure.

---

## 2. Config spreadsheet layout

### Tab `Global` (key/value, two columns)

| key | value | notes |
|---|---|---|
| `adminPinHash` | `<sha256 hex>` | **never** plaintext, **never** served |
| `adminPinSalt` | `<random 16+ chars>` | |
| `email.accounts` | `moukik.cyber+accounts@gmail.com` | placeholder until go-live |
| `email.locumHandling` | `moukik.cyber+locumdesk@gmail.com` | escalation + reply-to |
| `email.cashAck` | `moukik.cyber+cashack@gmail.com` | |

> **Testing period: no `@crestpharmacy.com` addresses anywhere.** Switching to
> real company addresses is a go-live step, not a build step.
>
> **Test addresses use Gmail plus-aliasing** so every role's mail lands in one
> inbox (`moukik.cyber@gmail.com`) but stays distinguishable and filterable:
> validators `moukik.cyber+val.<name>@gmail.com`, accounts `moukik.cyber+accounts@`,
> escalations `moukik.cyber+locumdesk@`, cash acks `moukik.cyber+cashack@`, and test
> locums typed at submit time as `moukik.cyber+locum.<name>@gmail.com`. Gmail
> filters on the `to:` address label each stream (labels already exist under
> "Crest apps/").
>
> Two caveats while testing this way:
> 1. **Deploy the Apps Script on a different account than `moukik.cyber@gmail.com`**
>    (the dedicated admin/ops account is already the plan). Gmail does not
>    reliably run filters on mail an account sends to itself, so self-sent
>    test mail may skip the inbox and the labels.
> 2. **The self-approval block compares exact addresses** (lowercased), so
>    `+val.sam` and `+locum.jane` count as different people — which is exactly
>    what makes single-inbox testing possible. Flip side: in production a
>    determined person could dodge the tripwire with a plus-alias of their own
>    address. It is a tripwire, not a security boundary; if that ever matters,
>    canonicalise gmail addresses (strip `+tag` and dots) in the self-approval
>    check only — and only at go-live, since canonicalising during testing
>    would make every test claim self-approved.

### Tab `Pharmacies`

| name | active |
|---|---|
| `Crest — High Street` | `TRUE` |

`name` is the identity used by every claim and cash entry. **Never rename a
pharmacy** — past records point at the old string. Add a new one and switch the
old to `active=FALSE`. (The admin page deliberately has no rename button.)

### Tab `Validators`

| pharmacy | name | email | active |
|---|---|---|---|
| `Crest — High Street` | `Sam Okafor` | `moukik.cyber+val.sam@gmail.com` | `TRUE` |

### Tab `Tools` (namespaced key/value)

| key | value |
|---|---|
| `locum.reminderDays` | `2` |
| `locum.escalateDays` | `4` |
| `cash.threshold` | `20` — the **global review ceiling**: any spend at/over this gets head-office review regardless of category policy |
| `cash.categories` | JSON array of `{name, policy, cap}`, optional; pages have defaults. `policy`: `self` (self-acknowledge allowed) \| `review` (head office always sees it) \| `approve` (requires pre-approval before spend). `cap`: number or `null` — for `self`, spends above it force review; for `approve`, the default approved ceiling |

### Tab `ChangeLog` (append-only)

| at (ISO) | by | change |
|---|---|---|
| `2026-07-17T09:12:03Z` | `Moukik` | `Cash threshold £20 → £25` |

One row per change line the admin page sends. Never update or delete rows.

---

## 3. Transport gotchas (Apps Script specific)

- Reply with `ContentService.createTextOutput(JSON.stringify(x))
  .setMimeType(ContentService.MimeType.JSON)`. The pages do `.text()` then
  `JSON.parse`, so a plain text body is fine.
- The pages POST with **no `Content-Type` header**, which makes it a CORS
  *simple request* with `text/plain`. **Do not "fix" this by sending
  `application/json`** — that triggers a preflight `OPTIONS`, which Apps Script
  web apps cannot answer, and every POST silently fails.
- `doPost(e)`: `JSON.parse(e.postData.contents)`. `doGet(e)`: `e.parameter`.
- Deploy: **Execute as** the admin account, **Who has access** Anyone. The
  token in the URL is the access control, not Google auth.
- Wrap every write in `LockService.getScriptLock()` — two validators tapping at
  once must not interleave.

---

## 4. Admin actions

**Admin rides its own deployment — the dashboard's 2-layer pattern + the PIN.**
The admin console has centralised control of every tool, so it does NOT sit on
the public "Anyone" web app. Two deployments of the same script:

| Deployment | Execute as | Who has access | Serves |
|---|---|---|---|
| Public API | Me | Anyone | locum + cash pages (JSON), `?action=config` |
| **Admin console** | **User accessing** | **Anyone with Google account** | the HtmlService console (`Admin` file) |

Layers on the admin deployment:
1. **Google sign-in** — forced by the access setting before the page loads.
2. **Email allowlist** — Global tab key `admin.allowedEmails` (comma-separated),
   checked in `adminPage_` on load AND in `adminApi` on every call. "Execute as
   user accessing" is what makes `Session.getActiveUser().getEmail()` reliable
   on consumer Gmail accounts (the dashboard uses DOMAIN access for the same
   guarantee — switch to that model at go-live on the company account).
3. **PIN + rate limit** — unchanged, below.

Consequences:
- `adminAuth`/`adminSave`/`adminPin` are **not routed in `doPost`** — the
  public URL cannot reach them at all, PIN or no PIN.
- The change log's `by` is the **Google-verified email**, set server-side —
  the client cannot spoof it.
- Because the script runs AS the admin user, each allowlisted email needs
  **Editor access to the Crest Config spreadsheet** (share it once). The Data
  spreadsheet is not touched by admin actions — no share needed.
- The repo's `admin.html` is a demo-mode design preview only.

### `POST {action:'adminAuth', pin, by}`
→ `{ok:true, session, config, defaultPin:bool}`
→ `{ok:false, code:'badpin'}` | `{ok:false, code:'locked', message}`

- Hash the supplied PIN with `adminPinSalt` (`Utilities.computeDigest` SHA-256)
  and compare to `adminPinHash`.
- **Rate limit — required, not optional.** A 4–8 digit PIN on an open endpoint
  is brute-forceable in minutes without it. Keep a counter in
  `PropertiesService` per rolling hour: **5 failures → locked for 30 minutes**,
  return `code:'locked'`. Log every failure (time + `by`) to `ChangeLog`.
- `session`: 32+ random chars in `PropertiesService`, **30 minute expiry**,
  bound to `by`. The page keeps it in memory only.
- `config`: the admin shape — pharmacies, validators (with emails), emails,
  locum, cash. **Never include the PIN or its hash.**
- `defaultPin`: true while the PIN is still the placeholder, so the page can nag.

**Placeholder PIN for first login: `0000`.** Seed `adminPinHash` from it, then
change it on first login through the panel. It is a placeholder, not a secret —
do not ship it to anyone as though it were one.

### `POST {action:'adminSave', session, by, config, changes:[]}`
→ `{ok:true, updatedAt}` | `{ok:false, code:'session'|'validation', errors:[]}`

**Re-validate everything server-side.** The page validates for UX; that is not
a control. Reject the save unless all hold:

1. Every pharmacy has a non-empty, unique name.
2. Every validator has a name, a syntactically valid email, and a pharmacy that
   exists in the pharmacy list.
3. **Every `active` pharmacy has ≥1 `active` validator.** Otherwise claims there
   could never be approved by anyone.
4. All three global emails are valid.
5. `locum.reminderDays ≥ 1`, `locum.escalateDays > locum.reminderDays`,
   `cash.threshold ≥ 0`.

On success: rewrite the config tabs, append one `ChangeLog` row per entry in
`changes`, bust the cached config, return `updatedAt`.

### `POST {action:'adminPin', session, by, newPin}`
→ `{ok:true}`

4–8 digits. New random salt, store the hash, append a `ChangeLog` row
(`PIN changed` — **never log the PIN itself**).

---

## 5. Locum claim actions

### `GET ?action=meta`
→ `{ok:true, pharmacies:[names], validators:{pharmacy:[names]}, months:[{label,maxDay}]}`

Active pharmacies and active validators only. **Names only — never emails.**
This is a public page; validator emails must not leave the server.
`months`: current month + previous 2, `label` like `July 2026`, `maxDay` = days
in that month.

### `POST {action:'submit', payload}`
→ `{ok:true, ref, total, hours, validator}` | `{ok:false, errors:[]}`

`payload`: `name, email, phone, role, roleOther, gphc, pharmacy, validatorName,
rate, months:[{label, entries:[{day,hours}]}], bankName, sort, acct, acct2,
notes`.

Re-validate the lot server-side (the page's checks are UX only): required
fields, GPhC 7 digits when role is Pharmacist, right-to-work ticked, sort code 6
digits, account 8 digits, `acct === acct2`, `0 < hours ≤ 24` per day, rate > 0.

**Self-approval block (mirrored in `index.html`).** Look up the selected
validator in config; if `validator.email.toLowerCase().trim() ===
payload.email.toLowerCase().trim()`, reject:

> The validator you picked uses the same email address as you. Someone else has
> to approve your claim — pick a different validator, or ask head office.

Re-check this at approve time too — config can change between submit and
approval.

**Flags (mirrored in `index.html`).** Neither blocks the claim; both ask a
human to look. Both are shown to the validator *and* to accounts.

- *Duplicate days*: any prior claim with the same locum email
  (case-insensitive) and status **not** `REJECTED`, sharing any
  `(month label, day)` pair. One flag per prior ref:
  `Same days as claim CLM-XXXXX, already sent in: 5 July, 6 July. Check this is not a repeat.`
- *Bank details changed*: the most recent prior non-rejected claim by the same
  email whose `sort|acct` differs from this one:
  `The bank details are different from this locum's last claim (CLM-XXXXX). Ring them on a number you already have to check, before any money is sent — do not just reply to the email.`

`ref`: `CLM-` + 5 uppercase alphanumerics, unique.

Then: append the Claims row (`status=SUBMITTED`), mint a **validator token**,
email the validator the link, email the locum a confirmation.

### `GET ?action=claim&token=..`
→ `{ok:true, view:'validator'|'accounts', ...claim}`
→ `{ok:false, code:'processed'|'expired'|'invalid', ref, status, decidedAt}`

The token decides the view. **A validator token must never return the `bank`
object** — accounts get bank details only after approval, and the page tells the
validator exactly that. Strip it server-side; do not rely on the page.

- validator view valid while status is `SUBMITTED` or `RAISED`
- accounts view valid only while status is `APPROVED`
- anything else → `code:'processed'` (this is what makes a double-tap safe)

Claim shape the pages read: `ref, locum:{name,email,phone}, role, roleOther,
gphc, pharmacy, company, rate, months:[{label,days:[],hours:{day:h}}],
split:{rows:[{label,daysCount,hours,amount}], totalHours, totalAmount},
flags:[], notes, approval:{by,at}, bank:{name,sort,acct}` (accounts only).

### `POST {action:'approve', token}` → `{ok:true, ref, status:'APPROVED', locum}`

The token **is** the identity — it was emailed only to that validator. Record
`approval = {by: validator.name, email: validator.email, at: now}`. That is the
non-repudiation: who approved, and when.

Then mint an **accounts token**, email `email.accounts` the full claim
**including bank details and any flags**, email the locum "approved", email the
validator a receipt.

### `POST {action:'reject', token, reason}` → `{ok:true, ref, status:'REJECTED', locum}`

Reason required. Email the locum the reason so they can resubmit.

### `POST {action:'paid', token, by, method?}` → `{ok:true, ref, status:'PAID', locum}`

`by` is required — the typed name of whoever in accounts sent the money.
`method` is `'bank'` (default) or `'cash'` — accounts tick "paid in cash at the
branch" when a cash-log entry covered it (see §6a; the claim views surface a
live flag when one exists). Record `payment = {by, at, method}`. Email the
locum: money sent (bank wording) or paid in cash (cash wording). This is the
thing that kills "where's my money?" chasers.

**Live cash flag (claim views, computed at view time — not stored):** if the
Cash Log holds a locum-category entry with this locum's email (or linked
`claimRef` = this ref), both validator and accounts views get a flag naming the
entry, amount and pharmacy. Stored flags can't cover this — the cash entry may
be logged after the claim was submitted.

### `POST {action:'raise', token, by, to:'validator'|'locum', reason}`
→ `{ok:true, ref, status:'RAISED', locum}`

Accounts pushing back. `by` and `reason` required. Record
`raise = {by, to, reason, at}`, set status `RAISED`.
- `to='validator'`: mint a fresh validator token, email the validator the reason.
- `to='locum'`: email the locum the reason; they fix and resubmit.

Nothing is paid. A `RAISED` claim is valid for the validator view again, which
is what lets it come back round.

---

## 6. Cash log actions — records, requests, reimbursement

The flat threshold rule is superseded (owner steer, 13 Jul 2026 + design
session 20 Jul 2026). Three independent dimensions per entry:

1. **What it is** — a *record* of money already spent (the common case: cash is
   sorted at the counter before any sign-off could complete), or a *request*
   for permission before anything is spent.
2. **Review level** — none (self-acknowledged), head-office acknowledgment
   after the fact, or head-office approval before the spend. Chosen per entry
   by the submitter but **floored by the category policy** — the submitter can
   always escalate, never downgrade below policy.
3. **Settlement** — where the money came from: `till`, `pocket` (someone paid
   personally → reimbursement owed), or `invoice` (supplier invoices head
   office; logged for completeness, no cash moved).

### Review flooring (mirrored in `cash-log.html`)

A record becomes `PENDING` (head-office review) if ANY of:
- category policy is `review`
- category policy is `approve` and there is **no valid linked approved request**
- amount ≥ `cash.threshold` (global ceiling)
- category `cap` is set and amount > cap
- `paidFrom = 'pocket'` (someone is owed money — head office must know)
- `emergency` flag set ("couldn't ask first" — always reviewed, never blocked:
  reality wins, or people route around the app)
- submitter voluntarily asked for review (`wantReview`)
- it is a **locum-category** entry (money to people is always seen)

Otherwise it is `RECORDED` (self-acknowledged, final, still in the ledger).

### Requests (pre-approval)

- `POST {action:'cashrequest', payload}` → `{ok, ref, status:'REQUESTED'}`
  — `ref`: `CR-` + 5 chars. Payload: `manager, managerEmail (optional),
  pharmacy, category, amountKnown, estAmount (if known), reason, notes`.
  Unknown amount is legitimate ("boiler engineer, cost TBC — OK to initiate?").
  Emails `email.cashAck` a token link.
- `GET ?action=cashentry&token=..` on a request token → the HO decide view.
- `POST {action:'cashapprove', token, by, cap}` → `{ok, ref, status:'APPROVED'}`
  — `by` (typed name) required; `cap` optional ("fine up to £X, ring me
  beyond"). Emails the manager if `managerEmail` was given.
- `POST {action:'cashreject', token, by, reason}` → `{ok, ref, status:'REJECTED'}`
- Requests **lapse 30 days** after approval if never spent against
  (status `LAPSED`, judged lazily on read). A stale permission must not be
  reusable months later.
- `GET ?action=cashreqstatus&refs=CR-A,CR-B` → `{ok, requests:[{ref, status,
  cap, decidedBy, decidedAt, decideReason}]}` — **safe fields only**. The
  branch page polls this for the refs the device remembers (localStorage), so
  branch staff find outcomes on the page they already use — no link-based flow
  for branch staff (copy rule).

### Records

- `GET ?action=cashmeta` → `{ok, pharmacies:[active names],
  categories:[{name, policy, cap}], reviewCeiling,
  validators:{pharmacy:[names]}}` — validator names (never emails) feed the
  on-behalf approver picker (§6b).
- `POST {action:'cashlog', payload}` → `{ok, ref, status:'RECORDED'|'PENDING',
  flags:[]}` — `ref`: `CX-` + 5 chars. Payload adds to the phase-1 shape:
  `paidFrom:'till'|'pocket'|'invoice'`, `payerEmail` (pocket only, optional —
  who to email when repaid), `emergency`, `wantReview`, `requestRef` (link to
  an approved `CR-`), and for locum entries `claimRef` (link to a `CLM-`) or
  `locumEmail` when there is no claim yet.
- `POST {action:'ack', token, by?}` / `{action:'query', token, reason}` —
  `by` (typed name, stored in `ackBy`) is REQUIRED for any locum-category
  entry (it pays a person) and for any ack that settles a linked claim; query
  emails the manager if an address is on file. A typed `claimRef` that does
  not resolve is a **hard error at log time**, never stored — a typo would
  orphan the payment (no email to chase, no claim to settle).
- `POST {action:'cashrepay', token, by}` → `{ok, ref, repaidAt}` — head office
  marks a `pocket` entry repaid. `by` (typed name) required; emails
  `payerEmail` if given. The ack token stays usable for this after
  acknowledgment (the entry is not "processed" until any owed money is repaid).

### Flags on records (server-computed, stored in `flagsJson`, shown to HO)

- **Over cap**: linked request has a cap and `amount > cap` beyond £0.01 —
  "£X against an approval capped at £Y".
- **Repeat spend on one approval**: a second record links the same `CR-` ref.
- **Duplicate entry**: same pharmacy + category + amount + date already on the
  log (non-queried) — "Looks like a repeat of CX-…".
- **Emergency**: "Spent without asking first — review."
- **Locum, no claim linked**: "No claim linked — ask the locum to submit a
  claim so validation and duplicate-day checks run." (see §6a)
- **Locum claim mismatch**: linked claim not APPROVED, already PAID, amount ≠
  claim total, or name mismatch.

### 6a. Locum cash ↔ claim linkage (both directions)

**Cash is a settlement method for a claim, not a parallel payment route.**
Otherwise the validator's non-repudiation trail and the duplicate-days
protection are bypassed at the till.

- **Claim first (the intended path):** locum submits a claim as normal,
  validator approves as normal. The branch pays cash and logs a locum-category
  entry with `claimRef`. Server checks the claim is APPROVED (flags anything
  else). When head office **acknowledges** the cash entry (typed name), the
  claim is marked `PAID` with `paidMethod='cash'`,
  `cashEntryRef` = the CX ref (structured, machine-readable), `paidBy` =
  "<HO name> — cash at <pharmacy> (entry CX-X)", and the locum gets the paid
  email (cash wording). Accounts gets an FYI so they never double-pay by
  bank. **Amount mismatch = no auto-settle:** if the entry amount differs
  from the claim total, the ack records the entry only; the claim stays
  APPROVED with accounts, who see the mismatch flag and decide. Late
  paperwork: an entry naming a claim already PAID-as-cash back-fills the
  claim's empty `cashEntryRef`.
- **Cash first (reality at the counter):** branch pays cash before any claim
  exists, logs the entry with `locumEmail` instead of `claimRef`. The entry is
  flagged (no claim linked). When a claim later arrives from that email, the
  claim views grow a **live flag** (computed at view time, not stored):
  "A cash payment CX-X (£amt, date) to this locum at <pharmacy> is on the cash
  log — check this claim is not for work already paid in cash." Validator and
  accounts both see it; accounts settles the claim with `method:'cash'`
  (below) instead of sending a bank transfer. **At that settle, the cash
  entry's `claimRef` is back-filled** when exactly one unlinked locum entry
  matches the email — the link then reads both ways from sheet data alone
  (ambiguous matches stay flag-only for a human to resolve).
- **Chasing the missing claim (the cron, §9) — LEGACY ROWS ONLY:** since §6b,
  a new locum entry always carries a claim (linked or raised on the spot), so
  the unlinked email-only state can no longer be created. Rows from before the
  migration can still be in it, and for those the weekday trigger chases on
  the validator cadence: at `locum.reminderDays` the locum is emailed to
  submit a claim (`claimChasedAt`), at `locum.escalateDays` it escalates to
  `email.locumHandling` (`claimEscalatedAt`), max one of each, stopping the
  moment any non-REJECTED claim from that email exists.

### 6b. Branch-raised claims — the locum can't or won't submit

If the locum could have submitted a claim, the payment wouldn't be coming
through this route — so the branch fills in the worked days at the counter
and **a claim is raised on the locum's behalf**. The Claims tab stays the
single record of days × hours × rate (the P&L month split); a validator still
approves; nothing is duplicated onto the cash row.

- `POST {action:'cashlog', ...}` with a locum category and **no `claimRef`**
  now REQUIRES `locumDays:[{date:'YYYY-MM-DD', hours}]` + `validatorName`
  (`locumEmail`/`locumPhone` optional). The server raises a claim
  (`origin='branch-cash'`, `submittedBy` = manager + pharmacy, rate derived as
  amount ÷ total hours, `cashEntryRef` = the entry, entry `claimRef` = the
  claim) before writing the entry — any claim-side validation failure stops
  the whole log. Self-approval block and duplicate-days flags still run
  (duplicates match by email when present, by name otherwise).
- `POST {action:'branchclaim', payload}` — the **head-office-pays** route: no
  cash moves at the branch. Same identity/days payload plus `rate` and the
  locum's bank details (required — accounts must be able to pay). Creates the
  claim (`origin='branch-hopays'`), validator approves, accounts pay by bank
  exactly like a self-submitted claim.
- **Fraud tripwire:** whenever a claim is raised in someone's name, the locum
  is emailed about it (when an address is on file). No email → a stored flag
  warns receipts can't reach them; blank addresses are never sent to.
- **Settlement order is symmetric for branch-cash:** HO ack first + validator
  approval second → **approval auto-settles** the claim as PAID/cash using the
  ack's typed name (the approval was the last human in the chain). Approval
  first → the ack settles as before. While unsettled, the accounts email for a
  bankless claim says "to be settled in cash — do not pay by bank", and
  `settle_` refuses `method` bank on a claim with no account number.
- **P&L rule (for the future pipeline — do not double-count):** the **Claims
  tab is the locum cost record** — it has the per-month split
  (`monthsJson`/`totalHours`/`totalAmount`), and a cash-settled claim keeps
  all of it (`paidMethod='cash'`, `cashEntryRef` = the till entry). A
  locum-category Cash Log row is a **till movement**, not a second locum
  expense. Pipeline rules, in order of reliability:
  1. Filter locum Cash Log rows out of expense ingest **by `category`**
     (`/^Locum/`) — the admin panels refuse to save a matrix without a
     Locum-prefixed category precisely so this filter stays sound.
     `claimRef` alone under-filters (ambiguous back-fills can leave it empty).
  2. Exclude `status='QUERIED'` rows everywhere — a corrected re-log means two
     rows for one outflow.
  3. The one exception: an unlinked locum cash row whose locum **never**
     submitted a claim is the ONLY record of that cost (single date, no month
     split — the cron chases exactly this state via
     `claimChasedAt`/`claimEscalatedAt`). Ingest it as locum cost only when
     `claimRef` is empty AND no non-REJECTED claim exists for its
     `locumEmail` — the cron's own condition.
  4. `paidFrom='pocket'` rows are not till outflows; the reimbursement is
     recorded on the same row (`repaidBy`/`repaidAt`), no second ledger row.
  5. Rows predating `migrateCash_` have the appended columns blank —
     pre-migration PAID claims have no `paidMethod` (all were bank) and
     pre-migration cash rows can't be claim-joined.

Receipt photos arrive as a base64 data URI. Push them to Drive and store the
file URL in the sheet; a few hundred base64 images in cells will make the sheet
unusable.

---

## 7. Tokens

- 32+ random chars, `Utilities.getUuid()` twice or a CSPRNG. Never sequential.
- Store `token → {ref, view}`; **expire after 30 days**, then `code:'expired'`.
- Treat as a bearer credential: whoever holds the link can act. That is
  acceptable because it is emailed to exactly one named mailbox — so never put a
  token anywhere public, and never reuse one across recipients.
- Status checks (not token deletion) make repeat taps safe: a second tap gets
  `code:'processed'`, which the pages already render as "nothing sent twice".

---

## 8. Config endpoint (for the first cross-account tool)

Not needed in phase 1. When a tool on another Google account needs config:

`GET ?action=config` → **public-safe subset only**:

```json
{"ok":true,
 "pharmacies":["Crest — High Street"],
 "validators":{"Crest — High Street":["Sam Okafor"]},
 "locum":{"reminderDays":2,"escalateDays":4},
 "cash":{"threshold":20,
         "categories":[{"name":"Petty supplies","policy":"self","cap":30}]}}
```

**Never in this blob: the PIN or its hash, validator emails, the global
emails.** Anything on an open URL is public. A tool that genuinely needs
addresses gets the shared-Sheet route instead (share Crest Config read-only to
that tool's account, `openById`), or a secret-gated variant of this endpoint.

Consumers cache the last-good response and fall back to their own defaults.

---

## 9. Reminders and escalation (the cron)

Time-driven trigger, **weekdays ~09:00**. Nothing here ever approves anything.
A slow validator gets chased, then escalated to a human. That is the whole
point: money moving requires a positive, logged action by a person.

```
for each claim where status in (SUBMITTED, RAISED):
    d = workingDaysSince(lastActionAt)     # submittedAt, or raise.at
    if d >= locum.escalateDays and not escalatedAt:
        email email.locumHandling  -> "CLM-X has sat N working days with <validator>"
        set escalatedAt = now
    else if d >= locum.reminderDays and not remindedAt:
        email validator (fresh token link) -> "CLM-X is waiting for you"
        set remindedAt = now
```

Defaults: remind at **2** working days, escalate at **4**. Both live in config,
both editable in admin. Confirmed 17 Jul 2026.

`workingDaysSince`: Mon–Fri only.
**Ceiling:** it does not know England/Wales bank holidays, so over a bank
holiday weekend a reminder can fire a day early. Harmless for a nudge. If that
ever matters, add a `Holidays` tab to config and subtract it — do not reach for
a date library.

Send at most one reminder and one escalation per claim. Nobody reads the third
email, and the noise trains people to ignore the first.

---

## 10. Data tabs

**Claims**: `ref, submittedAt, status, locumName, locumEmail, locumPhone, role,
roleOther, gphc, rtw, pharmacy, validatorName, validatorEmail, rate, monthsJson,
totalHours, totalAmount, bankName, sortCode, accountNumber, notes, flagsJson,
approvedBy, approvedAt, rejectReason, paidBy, paidAt, raisedBy, raisedTo,
raisedReason, raisedAt, remindedAt, escalatedAt`

**Cash Log**: `ref, at, status, pharmacy, manager, category, amount, date,
reason, fromTill, receiptUrl, notes, person, role, gphc, rtw, ackAt, queryReason`
— **plus, appended at the end (never reorder existing columns; old rows must
stay readable):** `paidFrom, payerEmail, emergency, requestRef, claimRef,
locumEmail, flagsJson, repaidBy, repaidAt, claimChasedAt, claimEscalatedAt,
ackBy`

**Cash Requests** (new tab): `ref, at, status, pharmacy, manager, managerEmail,
category, estAmount, reason, notes, decidedBy, decidedAt, decideReason, cap,
linkedCashRef`

Claims — appended at the end: `paidMethod` (`bank` | `cash`), `cashEntryRef`
(the CX ref that settled it, when known), `submittedBy` (who raised it, for
branch-raised claims), `origin` (`locum` | `branch-cash` | `branch-hopays`).

Status values — Claims: `SUBMITTED → APPROVED → PAID`, plus `REJECTED` (by
validator) and `RAISED` (by accounts, returns to `SUBMITTED`-like handling).
Cash Log: `RECORDED | PENDING → ACKNOWLEDGED | QUERIED` (+ `repaidAt` set once
a pocket entry is repaid). Cash Requests: `REQUESTED → APPROVED | REJECTED |
LAPSED`.

**Migration on an already-deployed sheet:** run `migrateCash_()` once from the
editor — it appends the new header cells to Cash Log and Claims and creates the
Cash Requests tab. Deploy order matters: **paste + version the new Code.gs
BEFORE merging the new pages to main**, or the live pages will call actions the
deployed backend doesn't have.

Bank details sit in the Claims sheet because accounts need them. Keep the
spreadsheet's sharing tight: this tab is the most sensitive thing in the whole
system.

---

## 11. Go-live checklist

1. Create both spreadsheets on the admin/ops account. Fill Config from the
   admin page (placeholder PIN `0000`, **personal test emails**).
2. Deploy the Apps Script web app; copy the `/exec` URL.
3. Swap `__API_URL__` in `index.html`, `cash-log.html`, `admin.html`. The demo
   banner disappears by itself — that is the go-live tell.
4. Change the admin PIN through the panel. Confirm the placeholder warning goes.
5. Test with personal emails, end to end, on a phone:
   claim → validator approves → accounts pays → locum gets the email.
   Then: submit a duplicate day and a changed bank number, confirm both flags.
   Then: try to be your own validator, confirm the block.
6. Only then swap the three config emails to real company addresses.
7. Install the weekday trigger. Watch the first escalation fire before trusting it.

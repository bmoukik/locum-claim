# Crest Pharmacies apps

The single repo for Crest Pharmacies' internal ops web apps: locum payment
claims, till cash log, printable QR posters, the admin console, and the Google
Apps Script backend that serves them all. Also the GitHub Pages deploy target —
what's on `main` is what's live at **https://bmoukik.github.io/locum-claim/**.

Project context, conventions and current status live in
`.claude/skills/crest-apps/SKILL.md` — read it before changing anything.
Backend contract: `BACKEND_SPEC.md`.

## The apps

| File | What it is |
|---|---|
| `index.html` | Locum payment claim — locum submits, validator approves via token link, accounts marks Paid or raises it back |
| `cash-log.html` | Till outflow log — under £20 auto-recorded, £20+ needs head-office acknowledgement |
| `posters.html` | Printable A4 QR posters, one per branch (`?ph=` prefills the pharmacy) |
| `admin.html` | Demo/design preview of the admin console |
| `AdminConsole.html` | The real admin console — served by a separate, Google-authenticated Apps Script deployment |
| `Code.gs` + `appsscript.json` | The whole backend + its manifest. Repo copy is the source of truth; the Apps Script editor is the paste target |
| `stock-transfer.html` | Inter-branch stock transfer note (frontend done, ON HOLD) |

## Architecture

```
locum / validator / accounts phone
        │  (plain HTTPS fetch — carries NO Google cookies)
        ▼
GitHub Pages static site (this repo, main)     <- all UI, mobile-first
        │
        ▼
Google Apps Script JSON API (Code.gs)          <- validation, emails, tokens
        │
        ▼
Google Sheets: Crest Config · Crest Apps Data
```

Nobody ever *browses* a Google URL for the public flows, so Google's
multi-account "unable to open the file" glitch cannot happen — the browser
fetches the API cross-origin without Google session cookies, which forces truly
anonymous access every time. The admin console is the deliberate exception: a
second deployment of the same script behind Google sign-in + an email allowlist
+ a rate-limited PIN.

Every page has a demo mode: while `API_URL` is the `__API_URL__` placeholder it
runs against a localStorage fake backend, so every flow is clickable with no
server.

This repo is **public** (GitHub Pages). No secrets belong here — tokens, the
PIN hash and all config live in the Google Sheets / script properties.

## Tests

```
node tests/test_logic.js
```

59 checks that load the real `Code.gs` with in-memory Google Apps Script mocks
and exercise the claim lifecycle end-to-end: submit → approve/reject → paid /
raise-back, the duplicate-days and bank-changed flags, the self-approval block,
token expiry, admin PIN rate-limiting — and the invariant that the validator
never sees bank details. Run it before committing any `Code.gs` change.

## Deploying

- **UI:** merge to `main` — GitHub Pages redeploys in about a minute.
- **Backend:** paste `Code.gs` into the Apps Script editor → Deploy → Manage
  deployments → New version. Never create a second public deployment — the
  /exec URL is baked into the pages. Full setup steps are in the header comment
  of `Code.gs`; the go-live checklist is in `BACKEND_SPEC.md`.
- Validators, pharmacies, emails, rates and timings are **admin-console edits,
  never deploys**.

## History

This repo absorbed `crest-locum-payments` (the private June–July 2026 prototype,
`LOC-2026-NNNN` claim refs) on 20 Jul 2026. The prototype repo is archived,
kept only as history; its manifest, test-harness approach and this README's
architecture rationale were ported here. Everything current lives in this repo.

// Node checks for Code.gs (the deployed Apps Script backend) — no GAS account
// needed. GAS services are mocked in-memory: spreadsheets are arrays, emails
// are captured, Utilities.getUuid is deterministic. Exercises the real claim
// lifecycle: submit → validate/reject → approve → paid / raise-back, plus the
// flags, the self-approval block and the bank-visibility rule.
// Run: node tests/test_logic.js
'use strict';
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

// --- in-memory GAS mocks ----------------------------------------------------
function fakeSheet(rows) {
  return {
    _rows: rows,
    getDataRange() { return { getValues: () => this._rows }; },
    appendRow(arr) { this._rows.push(arr.slice()); },
    clearContents() { this._rows.length = 0; },
    getRange(row, col) {
      const rows_ = this._rows;
      return {
        setValue(v) { while (rows_.length < row) rows_.push([]); rows_[row - 1][col - 1] = v; },
        setValues(vals) {
          vals.forEach((vr, i) => {
            while (rows_.length < row + i) rows_.push([]);
            vr.forEach((v, j) => { rows_[row + i - 1][col + j - 1] = v; });
          });
        },
      };
    },
  };
}

function build() {
  const props = {};
  let uuidN = 0;
  const sent = [];

  const cfgSheets = {
    Global: fakeSheet([
      ['key', 'value'],
      ['email.accounts', 'accounts@test.co'],
      ['email.locumHandling', 'desk@test.co'],
      ['email.cashAck', 'cash@test.co'],
      ['adminPinSalt', 'SALT'],
      ['adminPinHash', crypto.createHash('sha256').update('SALT|1234').digest('hex')],
      ['admin.allowedEmails', 'admin@test'],
    ]),
    Pharmacies: fakeSheet([
      ['Pharmacy', 'Active'],
      ['High Street', true],
      ['Riverside', true],
      ['Closed Branch', false],
    ]),
    Validators: fakeSheet([
      ['Pharmacy', 'Name', 'Email', 'Active'],
      ['High Street', 'Sam Okafor', 'sam@test.co', true],
      ['High Street', 'Inactive Val', 'iv@test.co', false],
      ['Riverside', 'Priya Shah', 'priya@test.co', true],
    ]),
    Tools: fakeSheet([
      ['key', 'value'],
      ['locum.reminderDays', 2],
      ['locum.escalateDays', 4],
      // ceiling deliberately above the category caps so cap and ceiling
      // trigger separately in tests
      ['cash.threshold', 100],
      ['cash.categories', JSON.stringify([
        { name: 'Locum / casual staff (cash)', policy: 'review', cap: null },
        { name: 'Petty supplies', policy: 'self', cap: 30 },
        { name: 'Repairs / maintenance', policy: 'approve', cap: null },
        { name: 'Customer cash refund', policy: 'review', cap: null },
      ])],
    ]),
    ChangeLog: fakeSheet([['at', 'by', 'change']]),
  };

  const sandbox = {
    console, Date, JSON, Math, Number, String, Object, RegExp, Array,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: (k) => { delete props[k]; },
      }),
    },
    SpreadsheetApp: { openById: (id) => ({ getSheetByName: (n) => (id === 'cfg' ? cfgSheets : sandbox._dataSheets)[n] }) },
    Utilities: {
      // uniqueness must live in the FIRST 5 chars: submit_ derives the claim
      // ref from uuid.slice(0, 5)
      getUuid: () => String(++uuidN).padStart(5, '0') + 'aaaabbbbccccddddeeeeffffaaa',
      computeDigest: (algo, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
      DigestAlgorithm: { SHA_256: 'sha256' },
      formatDate: (d) => ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'][d.getMonth()] + ' ' + d.getFullYear(),
    },
    Session: { getScriptTimeZone: () => 'Europe/London', getActiveUser: () => ({ getEmail: () => '' }) },
    MailApp: { sendEmail: (o) => sent.push(o) },
    ContentService: { createTextOutput: (s) => ({ setMimeType: () => s }), MimeType: { JSON: 'json' } },
    LockService: {}, ScriptApp: {}, HtmlService: {}, Logger: { log: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(__dirname + '/../Code.gs', 'utf8'), sandbox);

  // setup() is interactive; seed script properties + data sheets directly.
  props.CONFIG_SS_ID = 'cfg';
  props.DATA_SS_ID = 'data';
  sandbox._dataSheets = {
    Claims: fakeSheet([sandbox.CLAIM_COLS.slice()]),
    'Cash Log': fakeSheet([sandbox.CASH_COLS.slice()]),
    'Cash Requests': fakeSheet([sandbox.REQ_COLS.slice()]),
    Tokens: fakeSheet([['token', 'kind', 'ref', 'view', 'createdAt']]),
  };
  return { s: sandbox, sent, props, dataSheets: () => sandbox._dataSheets, cfgSheets };
}

function basePl(over) {
  return Object.assign({
    name: 'Jane Locum', email: 'jane@test.co', phone: '07000000000',
    role: 'Pharmacist', gphc: '1234567', rate: 22,
    sort: '071234', acct: '01235678', acct2: '01235678', bankName: 'J Locum',
    pharmacy: 'High Street', validatorName: 'Sam Okafor',
    months: [{ label: 'July 2026', entries: [{ day: 15, hours: 8 }, { day: 16, hours: 4.5 }] }],
  }, over || {});
}

function tokenFor(env, ref, view) {
  const rows = env.dataSheets().Tokens._rows.slice(1);
  const m = rows.filter((r) => r[2] === ref && r[3] === view);
  return m.length ? m[m.length - 1][0] : null;
}

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
}

// --- pure helpers -----------------------------------------------------------
{
  const { s } = build();
  ok(s.money_(1234.5) === '1,234.50', 'money_ thousands + 2dp');
  ok(s.money_(0) === '0.00', 'money_ zero');
  ok(s.money_(1000000) === '1,000,000.00', 'money_ million');

  // +1h keeps the day count deterministic: the loop compares against a fresh
  // new Date() each pass, so an exact n×24h offset can slip in an extra day.
  const DAY = 24 * 3600 * 1000, HOUR = 3600 * 1000;
  ok(s.workingDaysSince_(new Date(Date.now() + HOUR)) === 0, 'workingDaysSince_ nothing elapsed = 0');
  ok(s.workingDaysSince_(new Date(Date.now() - 7 * DAY + HOUR)) === 5, 'workingDaysSince_ ~7 days = 5 weekdays');
  ok(s.workingDaysSince_(new Date(Date.now() - 14 * DAY + HOUR)) === 10, 'workingDaysSince_ ~14 days = 10 weekdays');

  ok(s.hashPin_('1234', 'SALT') === crypto.createHash('sha256').update('SALT|1234').digest('hex'),
    'hashPin_ = sha256(salt|pin) hex');
}

// --- config exposure --------------------------------------------------------
{
  const { s } = build();
  const pub = s.publicConfig_();
  ok(pub.pharmacies.join(',') === 'High Street,Riverside', 'publicConfig_ active pharmacies only');
  ok(pub.validators['High Street'].join(',') === 'Sam Okafor', 'publicConfig_ active validator names only');
  const blob = JSON.stringify(pub);
  ok(blob.indexOf('@') === -1, 'publicConfig_ contains no email addresses');
  ok(blob.toLowerCase().indexOf('pin') === -1, 'publicConfig_ contains no pin material');

  const meta = s.metaAction_();
  ok(meta.months.length === 3 && /^[A-Z][a-z]+ \d{4}$/.test(meta.months[0].label), 'metaAction_ 3 rolling month labels');
  ok(JSON.stringify(meta.validators).indexOf('@') === -1, 'metaAction_ validator names, never emails');
}

// --- submit_ validation -----------------------------------------------------
{
  const { s } = build();
  const r = s.submit_({});
  ok(r.ok === false && r.errors.indexOf('Full name') >= 0, 'submit_ empty payload rejected');
  ok(s.submit_(basePl({ acct: '1235678', acct2: '1235678' })).errors.some((e) => /Account number/.test(e)), 'submit_ 7-digit account rejected');
  ok(s.submit_(basePl({ acct2: '99999999' })).errors.some((e) => /must match/.test(e)), 'submit_ account re-key mismatch rejected');
  ok(s.submit_(basePl({ sort: '07-12-34' })).errors.some((e) => /Sort code/.test(e)), 'submit_ un-normalised sort code rejected (page sends digits only)');
  ok(s.submit_(basePl({ gphc: '123' })).errors.some((e) => /GPhC/.test(e)), 'submit_ pharmacist needs 7-digit GPhC');
  ok(s.submit_(basePl({ months: [] })).errors.some((e) => /at least one day/.test(e)), 'submit_ no days rejected');
  ok(s.submit_(basePl({ validatorName: 'Inactive Val' })).errors.some((e) => /not available/.test(e)), 'submit_ inactive validator rejected');
  ok(s.submit_(basePl({ email: 'SAM@test.co' })).errors.some((e) => /same email/.test(e)), 'submit_ self-approval blocked (case-insensitive)');
}

// --- clean submit + emails --------------------------------------------------
{
  const env = build(); const { s, sent } = env;
  const r = s.submit_(basePl());
  ok(r.ok === true && /^CLM-[0-9A-Z]{5}$/.test(r.ref), 'submit_ ok with CLM-XXXXX ref');
  ok(r.total === '275.00' && r.hours === 12.5, 'submit_ totals 12.5h × £22 = £275.00');
  ok(env.dataSheets().Claims._rows.length === 2, 'submit_ appended one Claims row');
  ok(sent.length === 2, 'submit_ sent validator + locum emails');
  const vMail = sent.filter((m) => m.to === 'sam@test.co')[0];
  ok(vMail && vMail.body.indexOf('token=') >= 0, 'validator email carries review token link');
  ok(vMail.body.indexOf('01235678') === -1 && vMail.body.indexOf('071234') === -1, 'validator email NEVER contains bank details');

  const vTok = tokenFor(env, r.ref, 'validator');
  const view = s.claimGet_(vTok);
  ok(view.ok === true && view.view === 'validator', 'claimGet_ resolves validator token');
  ok(!('bank' in view), 'validator view has no bank object');
}

// --- flags ------------------------------------------------------------------
{
  const env = build(); const { s } = env;
  const r1 = s.submit_(basePl());
  const r2 = s.submit_(basePl({ months: [{ label: 'July 2026', entries: [{ day: 16, hours: 8 }] }] }));
  const row2 = s.findByRef_('Claims', s.CLAIM_COLS, r2.ref);
  const flags2 = JSON.parse(row2.flagsJson);
  ok(flags2.some((f) => f.indexOf('Same days as claim ' + r1.ref) === 0), 'duplicate-days flag names the earlier claim');

  const r3 = s.submit_(basePl({ sort: '999999', months: [{ label: 'June 2026', entries: [{ day: 1, hours: 8 }] }] }));
  const flags3 = JSON.parse(s.findByRef_('Claims', s.CLAIM_COLS, r3.ref).flagsJson);
  ok(flags3.some((f) => /bank details are different/.test(f)), 'bank-details-changed flag raised');

  const r4 = s.submit_(basePl({ email: 'other@test.co', name: 'Other Locum' }));
  ok(JSON.parse(s.findByRef_('Claims', s.CLAIM_COLS, r4.ref).flagsJson).length === 0, 'different locum, same days: no flag');
}

// --- decide_ (validator) ----------------------------------------------------
{
  const env = build(); const { s, sent } = env;
  const r = s.submit_(basePl());
  const vTok = tokenFor(env, r.ref, 'validator');

  ok(s.decide_({ token: 'nonsense', action: 'reject' }).code === 'invalid', 'decide_ unknown token invalid');
  ok(s.decide_({ token: vTok, action: 'reject' }).ok === false, 'decide_ reject requires a reason');

  sent.length = 0;
  const rej = s.decide_({ token: vTok, action: 'reject', reason: 'Wrong hours' });
  ok(rej.ok === true && rej.status === 'REJECTED', 'decide_ reject lands');
  ok(sent.some((m) => m.to === 'jane@test.co' && /not approved/.test(m.subject)), 'reject emails the locum with the reason');
  ok(s.decide_({ token: vTok, action: 'approve' }).code === 'processed', 'decided claim cannot be flipped afterwards');
}
{
  const env = build(); const { s, sent } = env;
  const r = s.submit_(basePl());
  const vTok = tokenFor(env, r.ref, 'validator');
  sent.length = 0;
  const ap = s.decide_({ token: vTok, action: 'approve' });
  ok(ap.ok === true && ap.status === 'APPROVED', 'decide_ approve lands');
  const aMail = sent.filter((m) => m.to === 'accounts@test.co')[0];
  ok(aMail && aMail.body.indexOf('071234') >= 0 && aMail.body.indexOf('01235678') >= 0, 'accounts email carries the bank details');
  ok(aMail.body.indexOf('token=') >= 0, 'accounts email carries the settle token');
  ok(sent.length === 3, 'approve emails accounts + locum + validator receipt');

  const aTok = tokenFor(env, r.ref, 'accounts');
  const view = s.claimGet_(aTok);
  ok(view.bank && view.bank.acct === '01235678', 'accounts view includes bank object');

  // config drift: validator email later becomes the locum's → approval refused
  const r2 = s.submit_(basePl({ months: [{ label: 'June 2026', entries: [{ day: 2, hours: 4 }] }] }));
  const row2 = s.findByRef_('Claims', s.CLAIM_COLS, r2.ref);
  s.writeCell_('Claims', row2._row, s.CLAIM_COLS, 'validatorEmail', 'jane@test.co');
  const selfAp = s.decide_({ token: tokenFor(env, r2.ref, 'validator'), action: 'approve' });
  ok(selfAp.ok === false && /own claimant/.test(selfAp.message), 'self-approval re-checked at approve time');
}

// --- settle_ (accounts) -----------------------------------------------------
{
  const env = build(); const { s, sent } = env;
  const r = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, r.ref, 'validator'), action: 'approve' });
  const aTok = tokenFor(env, r.ref, 'accounts');

  ok(s.settle_({ token: aTok, action: 'paid' }).ok === false, 'settle_ requires a typed name');
  sent.length = 0;
  const paid = s.settle_({ token: aTok, action: 'paid', by: 'Pat Accounts' });
  ok(paid.ok === true && paid.status === 'PAID', 'settle_ paid lands');
  ok(sent.some((m) => m.to === 'jane@test.co' && m.body.indexOf('ending 5678') >= 0), 'paid email shows only last 4 digits');
  ok(s.settle_({ token: aTok, action: 'paid', by: 'Pat' }).code === 'processed', 'paid claim cannot be settled twice');
}
{
  const env = build(); const { s, sent } = env;
  const r = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, r.ref, 'validator'), action: 'approve' });
  const aTok = tokenFor(env, r.ref, 'accounts');
  ok(s.settle_({ token: aTok, action: 'raise', by: 'Pat', to: 'validator' }).ok === false, 'raise-back requires a reason');
  sent.length = 0;
  const raised = s.settle_({ token: aTok, action: 'raise', by: 'Pat', to: 'validator', reason: 'Bank details look wrong' });
  ok(raised.ok === true && raised.status === 'RAISED', 'settle_ raise-back lands');
  ok(sent.some((m) => m.to === 'sam@test.co' && m.body.indexOf('token=') >= 0), 'raise-back re-tokens the validator');
  const vTok2 = tokenFor(env, r.ref, 'validator');
  ok(s.decide_({ token: vTok2, action: 'reject', reason: 'Agreed' }).ok === true, 'RAISED claim can be re-decided by validator');
}

// --- token expiry -----------------------------------------------------------
{
  const env = build(); const { s } = env;
  const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  env.dataSheets().Tokens.appendRow(['staletoken', 'claim', 'CLM-XXXXX', 'validator', old]);
  ok(s.lookupToken_('staletoken').expired === true, 'tokens expire after 30 days');
  ok(s.decide_({ token: 'staletoken', action: 'approve' }).code === 'invalid', 'expired token cannot decide');
}

// --- admin auth -------------------------------------------------------------
{
  const { s } = build();
  ok(s.adminAuth_({ pin: '0000', by: 'x' }).ok === false, 'adminAuth_ wrong pin refused');
  for (let i = 0; i < 4; i++) s.adminAuth_({ pin: '0000', by: 'x' });
  ok(s.adminAuth_({ pin: '1234', by: 'x' }).code === 'locked', 'adminAuth_ locks after 5 fails, even for the right pin');
}
{
  const { s } = build();
  const auth = s.adminAuth_({ pin: '1234', by: 'Moukik' });
  ok(auth.ok === true && !!auth.session, 'adminAuth_ right pin opens a session');
  ok(JSON.stringify(auth.config).toLowerCase().indexOf('pinhash') === -1, 'session config never contains the pin hash');
  ok(auth.defaultPin === false, 'defaultPin false once pin changed off 0000');
  ok(s.checkSession_(auth.session) && s.checkSession_(auth.session).by === 'Moukik', 'checkSession_ resolves + slides');
}

// ===========================================================================
// CASH LOG — records, requests, reimbursement, locum linkage (spec §6/§6a)
// ===========================================================================
function baseCash(over) {
  return Object.assign({
    manager: 'Test Manager', pharmacy: 'High Street', category: 'Petty supplies',
    amount: 5, date: '2026-07-20', reason: 'Bin bags', paidFrom: 'till',
  }, over || {});
}
function cashRow(env, ref) { return env.s.findByRef_('Cash Log', env.s.CASH_COLS, ref); }
// pre-§6b rows (email-only, no raised claim) can no longer be created through
// the API — insert them directly to prove the protections still cover them
let legacyN = 0;
function legacyLocumRow(env, over) {
  const s = env.s;
  const row = {};
  s.CASH_COLS.forEach((k) => { row[k] = ''; });
  Object.assign(row, {
    ref: 'CX-LEG' + (++legacyN), at: new Date().toISOString(), status: 'PENDING',
    pharmacy: 'High Street', manager: 'Test Manager', category: 'Locum / casual staff (cash)',
    amount: 100, date: '2026-07-10', reason: 'legacy row', fromTill: true, paidFrom: 'till',
    person: 'Jane Locum', role: 'Dispenser', rtw: true, locumEmail: 'jane@test.co',
    flagsJson: JSON.stringify(['No claim linked — ask the locum to submit a claim so validation and duplicate-day checks run.']),
  }, over || {});
  env.dataSheets()['Cash Log'].appendRow(s.CASH_COLS.map((k) => row[k]));
  return row;
}
function behalfCash(over) {
  return baseCash(Object.assign({
    category: 'Locum / casual staff (cash)', amount: 120, reason: 'Sat cover',
    person: 'Jane Locum', role: 'Dispenser', rtw: true,
    locumEmail: 'jane@test.co', locumPhone: '07123456789', validatorName: 'Sam Okafor',
    locumDays: [{ date: '2026-07-18', hours: 8 }, { date: '2026-06-30', hours: 4 }],
  }, over || {}));
}
function cashToken(env, ref) {
  const rows = env.dataSheets().Tokens._rows.slice(1);
  const m = rows.filter((r) => r[2] === ref);
  return m.length ? m[m.length - 1][0] : null;
}

// --- meta + config fallback -------------------------------------------------
{
  const { s } = build();
  const meta = s.cashMeta_();
  ok(meta.reviewCeiling === 100 && meta.categories.length === 4, 'cashMeta_ serves categories + ceiling');
  ok(s.cashCats_('not json')[0].name === 'Locum / casual staff (cash)', 'cashCats_ falls back to defaults on bad JSON');
}

// --- review flooring --------------------------------------------------------
{
  const env = build(); const { s, sent } = env;
  const r1 = s.cashLog_(baseCash());
  ok(r1.ok && r1.status === 'RECORDED' && sent.length === 0, 'routine £5 self-recorded, no email');
  const r2 = s.cashLog_(baseCash({ amount: 35, reason: 'Ink' }));
  ok(r2.status === 'PENDING', 'over category cap (£35 > £30) goes to review');
  const r3 = s.cashLog_(baseCash({ amount: 150, reason: 'Bulk', date: '2026-07-19' }));
  ok(r3.status === 'PENDING', 'over global ceiling (£150 ≥ £100) goes to review');
  ok(sent.filter((m) => m.to === 'cash@test.co').length === 2, 'each reviewed entry emails head office');
  const r4 = s.cashLog_(baseCash({ category: 'Customer cash refund', amount: 3, reason: 'Refund', date: '2026-07-18' }));
  ok(r4.status === 'PENDING', 'review-policy category always reviewed');
  const r5 = s.cashLog_(baseCash({ category: 'Repairs / maintenance', amount: 8, reason: 'Hinge', date: '2026-07-17' }));
  ok(r5.status === 'PENDING' && r5.flags.some((f) => /needs approval before spending/.test(f)),
    'approve-policy without a linked approval is flagged');
  const r6 = s.cashLog_(baseCash({ amount: 4, wantReview: true, reason: 'Odd one', date: '2026-07-16' }));
  ok(r6.status === 'PENDING', 'voluntary escalation always possible');
  const r7 = s.cashLog_(baseCash({ amount: 4, emergency: true, reason: 'Late night', date: '2026-07-15' }));
  ok(r7.status === 'PENDING' && r7.flags.some((f) => /emergency/.test(f)), 'emergency spend flagged + reviewed');
  const r8 = s.cashLog_(baseCash({ amount: 5, reason: 'Bin bags' }));
  ok(r8.status === 'PENDING' && r8.flags.some((f) => /Looks like a repeat of CX-/.test(f)),
    'duplicate entry (same pharmacy/category/amount/date) flagged');
  ok(s.cashLog_(baseCash({ paidFrom: 'wallet' })).ok === false, 'unknown settlement source rejected');
}

// --- requests: lifecycle, cap, lapse ---------------------------------------
{
  const env = build(); const { s, sent } = env;
  ok(s.cashRequest_({}).ok === false, 'empty request rejected');
  const rq = s.cashRequest_({ manager: 'Test Manager', managerEmail: 'mgr@test.co', pharmacy: 'High Street',
    category: 'Repairs / maintenance', amountKnown: false, reason: 'Fridge seal, engineer TBC' });
  ok(rq.ok && /^CR-/.test(rq.ref) && rq.status === 'REQUESTED', 'unknown-cost request accepted');
  ok(sent.some((m) => m.to === 'cash@test.co' && /not known yet/.test(m.subject)), 'HO email says cost not known yet');

  const tok = cashToken(env, rq.ref);
  ok(s.cashGet_(tok).view === 'decide', 'request token opens the decide view');
  ok(s.cashReqDecide_({ token: tok, action: 'cashapprove', cap: 200 }).ok === false, 'approve without a name refused');
  sent.length = 0;
  const ap = s.cashReqDecide_({ token: tok, action: 'cashapprove', by: 'HO Person', cap: 200 });
  ok(ap.ok && ap.status === 'APPROVED' && ap.cap === 200, 'approved with a £200 cap');
  ok(sent.some((m) => m.to === 'mgr@test.co' && /up to £200/.test(m.body)), 'manager emailed the cap');
  ok(s.cashReqDecide_({ token: tok, action: 'cashreject', by: 'X', reason: 'no' }).code === 'processed',
    'decided request cannot be re-decided');

  // spend against it, over the cap, and again
  const sp = s.cashLog_(baseCash({ category: 'Repairs / maintenance', amount: 250, reason: 'Engineer', requestRef: rq.ref }));
  ok(sp.status === 'PENDING' && sp.flags.some((f) => /capped at £200/.test(f)), 'over-cap spend flagged (£250 vs £200)');
  ok(s.findByRef_('Cash Requests', s.REQ_COLS, rq.ref).linkedCashRef === sp.ref, 'approval linked to the spend');
  const sp2 = s.cashLog_(baseCash({ category: 'Repairs / maintenance', amount: 20, reason: 'More parts', date: '2026-07-19', requestRef: rq.ref }));
  ok(sp2.flags.some((f) => /already spent against/.test(f)), 'second spend on one approval flagged');

  // within-cap spend on a fresh approval self-records (approval already gave HO eyes)
  const rq2 = s.cashRequest_({ manager: 'Test Manager', pharmacy: 'High Street', category: 'Repairs / maintenance',
    amountKnown: true, estAmount: 40, reason: 'Shelf bracket' });
  s.cashReqDecide_({ token: cashToken(env, rq2.ref), action: 'cashapprove', by: 'HO Person', cap: 50 });
  const sp3 = s.cashLog_(baseCash({ category: 'Repairs / maintenance', amount: 40, reason: 'Bracket', date: '2026-07-18', requestRef: rq2.ref }));
  ok(sp3.status === 'RECORDED' && sp3.flags.length === 0, 'within-cap approved spend self-records');

  // lapse: unused approval older than 30 days dies on read
  const rq3 = s.cashRequest_({ manager: 'Test Manager', pharmacy: 'High Street', category: 'Repairs / maintenance',
    amountKnown: true, estAmount: 10, reason: 'Old one' });
  s.cashReqDecide_({ token: cashToken(env, rq3.ref), action: 'cashapprove', by: 'HO Person' });
  const q3 = s.findByRef_('Cash Requests', s.REQ_COLS, rq3.ref);
  s.writeCell_('Cash Requests', q3._row, s.REQ_COLS, 'decidedAt', new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString());
  const st = s.cashReqStatus_(rq.ref + ',' + rq3.ref + ',CR-NOPE');
  ok(st.requests.length === 2, 'cashreqstatus returns only known refs');
  ok(st.requests.filter((r) => r.ref === rq3.ref)[0].status === 'LAPSED', 'unused 31-day-old approval lapses');
  ok(!JSON.stringify(st).includes('@'), 'cashreqstatus leaks no email addresses');
}

// --- reimbursement (pocket → owed → repaid) ---------------------------------
{
  const env = build(); const { s, sent } = env;
  const r = s.cashLog_(baseCash({ paidFrom: 'pocket', payerEmail: 'payer@test.co', amount: 60, reason: 'Emergency taxi' }));
  ok(r.status === 'PENDING' && r.flags.some((f) => /own pocket/.test(f)), 'pocket spend always reviewed + flagged');
  const tok = cashToken(env, r.ref);
  ok(s.cashRepay_({ token: tok, by: 'HO' }).ok === false, 'cannot repay before acknowledging');
  ok(s.cashDecide_({ token: tok, action: 'ack' }).ok === true, 'plain ack needs no name (no claim linked)');
  ok(s.cashGet_(tok).view === 'repay', 'acknowledged pocket entry stays open for repayment');
  ok(s.cashRepay_({ token: tok }).ok === false, 'repay without a name refused');
  sent.length = 0;
  const rp = s.cashRepay_({ token: tok, by: 'HO Person' });
  ok(rp.ok && rp.repaidAt, 'repay lands');
  ok(sent.some((m) => m.to === 'payer@test.co' && /repaid/.test(m.subject)), 'payer emailed on repayment');
  ok(s.cashGet_(tok).code === 'processed', 'repaid entry is closed');
  ok(s.cashRepay_({ token: tok, by: 'HO' }).code === 'processed', 'cannot repay twice');
}

// --- locum cash ↔ claim linkage (spec §6a) ----------------------------------
{
  // claim first: approved claim, cash settles it at ack
  const env = build(); const { s, sent } = env;
  const claim = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  const r = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 275,
    person: 'Jane Locum', role: 'Dispenser', rtw: true, claimRef: claim.ref.toLowerCase(), reason: 'Paid in cash' }));
  ok(r.status === 'PENDING' && r.flags.length === 0, 'clean claim-linked cash entry reviewed with no flags');
  const view = s.cashGet_(cashToken(env, r.ref));
  ok(view.entry.claim && view.entry.claim.ref === claim.ref && !('bank' in view.entry.claim),
    'HO view carries claim summary, never bank details');
  ok(s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack' }).ok === false, 'settling ack requires a typed name');
  sent.length = 0;
  const ack = s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' });
  ok(ack.ok && ack.settledClaim === claim.ref, 'ack settles the linked claim');
  const cl = s.findByRef_('Claims', s.CLAIM_COLS, claim.ref);
  ok(cl.status === 'PAID' && cl.paidMethod === 'cash' && /HO Person/.test(cl.paidBy), 'claim PAID by cash with who/where recorded');
  ok(cl.cashEntryRef === r.ref, 'claim carries the settling entry ref (structured, both directions)');
  ok(cashRow(env, r.ref).ackBy === 'HO Person', 'ackBy stored on the entry');
  ok(sent.some((m) => m.to === 'jane@test.co' && /paid in cash/.test(m.subject)), 'locum told: paid in cash');
  ok(sent.some((m) => m.to === 'accounts@test.co' && /do not pay by bank/.test(m.subject)), 'accounts warned off the bank transfer');
}
{
  // mismatches flagged
  const env = build(); const { s } = env;
  const claim = s.submit_(basePl());
  const notApproved = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 275,
    person: 'Jane Locum', role: 'Dispenser', rtw: true, claimRef: claim.ref, reason: 'cash' }));
  ok(notApproved.flags.some((f) => /not yet approved/.test(f)), 'unapproved claim link flagged');
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  const wrongAmt = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 200,
    person: 'Someone Else', role: 'Dispenser', rtw: true, claimRef: claim.ref, reason: 'cash', date: '2026-07-19' }));
  ok(wrongAmt.flags.some((f) => /does not match claim/.test(f)), 'amount mismatch flagged');
  ok(wrongAmt.flags.some((f) => /does not match the claim’s locum/.test(f)), 'name mismatch flagged');
  const dangling = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 10, person: 'X', role: 'Driver',
    rtw: true, claimRef: 'CLM-ZZZZZ', reason: 'cash', date: '2026-07-18' }));
  ok(dangling.ok === false && dangling.errors.some((e2) => /not found/.test(e2)),
    'unknown claim ref is a hard error — a typo must not orphan the payment');
  const noDays = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 10, person: 'X', role: 'Driver',
    rtw: true, reason: 'cash', date: '2026-07-17' }));
  ok(noDays.ok === false && noDays.errors.some((e2) => /days they worked/.test(e2)),
    'locum entry without a claim needs the worked days — the branch fills them in');
}
{
  // LEGACY cash-first row (pre-§6b, email only, no raised claim): a later
  // claim still gets the live flag and accounts can still settle it as cash
  const env = build(); const { s, sent } = env;
  const r = legacyLocumRow(env, { amount: 120, reason: 'Sat cover cash' });
  const claim = s.submit_(basePl());
  const vView = s.claimGet_(tokenFor(env, claim.ref, 'validator'));
  ok(vView.flags.some((f) => f.indexOf('Cash payment ' + r.ref) === 0), 'later claim shows live cash flag to validator');
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  const aMail = sent.filter((m) => m.to === 'accounts@test.co').pop();
  ok(aMail.body.indexOf('Cash payment ' + r.ref) >= 0, 'accounts email carries the live cash flag');
  // accounts settles in cash instead of paying by bank
  sent.length = 0;
  const paid = s.settle_({ token: tokenFor(env, claim.ref, 'accounts'), action: 'paid', by: 'Pat', method: 'cash' });
  ok(paid.ok && paid.status === 'PAID', 'accounts can settle a claim as paid-in-cash');
  ok(s.findByRef_('Claims', s.CLAIM_COLS, claim.ref).paidMethod === 'cash', 'paidMethod recorded as cash');
  ok(sent.some((m) => m.to === 'jane@test.co' && /paid in cash/.test(m.body)), 'locum email uses cash wording, no bank last-4');
}

// --- back-link at settle: the till record gets the claim ref ----------------
{
  const env = build(); const { s } = env;
  const cash = legacyLocumRow(env, { amount: 275, reason: 'cash first' });
  const claim = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  s.settle_({ token: tokenFor(env, claim.ref, 'accounts'), action: 'paid', by: 'Pat', method: 'cash' });
  ok(cashRow(env, cash.ref).claimRef === claim.ref, 'settle-as-cash back-fills claimRef on the single matching entry');
  const cl2 = s.findByRef_('Claims', s.CLAIM_COLS, claim.ref);
  ok(cl2.cashEntryRef === cash.ref && /entry CX-/.test(cl2.paidBy), 'settle-as-cash stamps cashEntryRef + names the entry in paidBy');
}
{
  const env = build(); const { s } = env;
  const c1 = legacyLocumRow(env, { amount: 100, reason: 'week 1' });
  const c2 = legacyLocumRow(env, { amount: 175, reason: 'week 2', date: '2026-07-19' });
  const claim = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  s.settle_({ token: tokenFor(env, claim.ref, 'accounts'), action: 'paid', by: 'Pat', method: 'cash' });
  ok(!cashRow(env, c1.ref).claimRef && !cashRow(env, c2.ref).claimRef,
    'ambiguous back-link (two candidates) stays flag-only');
  // late paperwork: branch now logs the entry naming the already-settled claim
  const late = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 275,
    person: 'Jane Locum', role: 'Dispenser', rtw: true, claimRef: claim.ref, reason: 'late paperwork', date: '2026-07-18' }));
  ok(late.flags.some((f) => /already marked PAID/.test(f)), 'late entry still flags possible double payment');
  ok(s.findByRef_('Claims', s.CLAIM_COLS, claim.ref).cashEntryRef === late.ref,
    'late paperwork back-fills the claim’s empty cashEntryRef');
}

// --- plain locum ack needs a name; mismatch never auto-settles --------------
{
  const env = build(); const { s } = env;
  const r = s.cashLog_(behalfCash());
  ok(s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack' }).ok === false,
    'ack of a locum entry requires a typed name — it pays a person');
  const done = s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' });
  ok(done.ok && done.settledClaim === '' && cashRow(env, r.ref).ackBy === 'HO Person',
    'named ack recorded; raised claim still awaiting its validator, nothing settled yet');
}
{
  const env = build(); const { s } = env;
  const claim = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, claim.ref, 'validator'), action: 'approve' });
  const r = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 200, // claim total is 275
    person: 'Jane Locum', role: 'Dispenser', rtw: true, claimRef: claim.ref, reason: 'partial cash' }));
  ok(s.cashGet_(cashToken(env, r.ref)).entry.claim.amountMatches === false, 'HO view exposes the amount mismatch');
  const ack = s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' });
  ok(ack.ok && ack.settledClaim === '', 'mismatched amount: entry acknowledged, claim NOT auto-settled');
  ok(s.findByRef_('Claims', s.CLAIM_COLS, claim.ref).status === 'APPROVED', 'claim stays with accounts to decide');
}

// --- linked-elsewhere entries stop flagging later claims --------------------
{
  const env = build(); const { s } = env;
  const claimA = s.submit_(basePl());
  s.decide_({ token: tokenFor(env, claimA.ref, 'validator'), action: 'approve' });
  const r = s.cashLog_(baseCash({ category: 'Locum / casual staff (cash)', amount: 275,
    person: 'Jane Locum', role: 'Dispenser', rtw: true, claimRef: claimA.ref, reason: 'cash' }));
  s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' }); // settles claim A
  const claimB = s.submit_(basePl({ months: [{ label: 'June 2026', entries: [{ day: 3, hours: 4 }] }] }));
  const vView = s.claimGet_(tokenFor(env, claimB.ref, 'validator'));
  ok(!vView.flags.some((f) => f.indexOf('Cash payment ' + r.ref) === 0),
    'entry settled against claim A no longer flags claim B (noise fix)');
}

// --- cron: chase the missing claim behind a cash-first payment --------------
{
  const env = build(); const { s, sent } = env;
  // pin "now" to a Wednesday mid-morning so the weekday guard and the
  // working-day maths cannot go flaky depending on which day tests run
  const RealDate = Date;
  const WED = new RealDate('2026-07-22T10:00:00Z').getTime();
  s.Date = class extends RealDate {
    constructor(...a) { a.length ? super(...a) : super(WED); }
    static now() { return WED; }
  };
  // legacy email-only rows are the only state the chase still applies to —
  // the on-behalf path raises a claim at log time, so new entries never lack one
  // nudge-age: Monday 09:00 → 2 working days by Wednesday (= reminderDays);
  // escalate-age: previous Wednesday → 5 working days (≥ escalateDays 4)
  const nudge = legacyLocumRow(env, { amount: 120, reason: 'Sat cover', at: '2026-07-20T09:00:00Z' });
  const esc = legacyLocumRow(env, { amount: 90, reason: 'Deliveries', person: 'Amir Khan', role: 'Driver',
    locumEmail: 'amir@test.co', date: '2026-07-14', at: '2026-07-15T09:00:00Z' });
  sent.length = 0;
  s.remindAndEscalate();
  ok(sent.some((m) => m.to === 'jane@test.co' && /submit a claim/.test(m.subject)), 'locum nudged to submit a claim');
  ok(sent.some((m) => m.to === 'desk@test.co' && /No claim yet/.test(m.subject)), 'older unlinked entry escalates to the desk');
  ok(!!cashRow(env, nudge.ref).claimChasedAt && !!cashRow(env, esc.ref).claimEscalatedAt, 'chase stamps written');
  const n = sent.length;
  s.remindAndEscalate();
  ok(sent.length === n, 'second run sends nothing — max one nudge + one escalation');

  // once the locum has submitted, chasing them stops
  legacyLocumRow(env, { amount: 60, reason: 'More cover', date: '2026-07-13', at: '2026-07-15T09:00:00Z' });
  s.writeCell_('Cash Log', cashRow(env, nudge.ref)._row, s.CASH_COLS, 'claimRef', 'CLM-LINKED'); // silence the first
  s.submit_(basePl());
  const n2 = sent.length;
  s.remindAndEscalate();
  ok(!sent.slice(n2).some((m) => m.to === 'jane@test.co'), 'no chasing once a live claim exists for that locum');
}

// --- §6b on-behalf: the cash entry raises the claim itself ------------------
{
  const env = build(); const { s, sent } = env;
  const r = s.cashLog_(behalfCash());
  ok(r.ok && r.status === 'PENDING', 'on-behalf cash entry accepted + reviewed');
  const entryRow = cashRow(env, r.ref);
  const clm = s.findByRef_('Claims', s.CLAIM_COLS, entryRow.claimRef);
  ok(!!clm && clm.status === 'SUBMITTED' && clm.origin === 'branch-cash', 'claim raised on the locum’s behalf');
  ok(/Test Manager \(High Street\)/.test(clm.submittedBy), 'submittedBy recorded');
  const months = JSON.parse(clm.monthsJson);
  ok(months.length === 2 && Number(clm.totalHours) === 12 && Number(clm.totalAmount) === 120,
    'worked days captured with the month split (July 8h + June 4h) — the P&L data');
  ok(Number(clm.rate) === 10, 'rate derived from amount ÷ hours (£120 / 12h)');
  ok(clm.cashEntryRef === r.ref && entryRow.claimRef === clm.ref, 'two-way link written at creation');
  ok(r.flags.some((f) => /raised from this entry/.test(f)), 'entry flags say a claim was raised');
  ok(sent.some((m) => m.to === 'sam@test.co' && /on behalf of Jane Locum/.test(m.body)), 'validator told who raised it');
  ok(sent.some((m) => m.to === 'jane@test.co' && /submitted for you/.test(m.subject)), 'locum notified — fraud tripwire');

  // HO reviews the entry first, validator approves after → auto-settle
  const ack = s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' });
  ok(ack.ok && ack.settledClaim === '', 'ack before approval records, does not settle');
  sent.length = 0;
  const ap = s.decide_({ token: tokenFor(env, clm.ref, 'validator'), action: 'approve' });
  ok(ap.ok && ap.status === 'PAID', 'validator approval auto-settles the branch-cash claim');
  const done = s.findByRef_('Claims', s.CLAIM_COLS, clm.ref);
  ok(done.paidMethod === 'cash' && /HO Person/.test(done.paidBy) && done.cashEntryRef === r.ref,
    'settled with the reviewer’s name + entry ref');
  ok(sent.some((m) => m.to === 'accounts@test.co' && /nothing to pay/.test(m.subject)), 'accounts get an FYI, not a pay request');
  ok(sent.some((m) => m.to === 'jane@test.co' && /approved and settled/.test(m.subject)), 'locum told: approved, already paid');
}
{
  // approval first, HO review after → the existing ack path settles
  const env = build(); const { s, sent } = env;
  const r = s.cashLog_(behalfCash());
  const clmRef = cashRow(env, r.ref).claimRef;
  sent.length = 0;
  const ap = s.decide_({ token: tokenFor(env, clmRef, 'validator'), action: 'approve' });
  ok(ap.status === 'APPROVED', 'approval before HO review leaves the claim APPROVED');
  const aMail = sent.filter((m) => m.to === 'accounts@test.co')[0];
  ok(aMail && /to be settled in cash/.test(aMail.subject) && /Do not pay by bank/i.test(aMail.body),
    'accounts email: cash-settlement note, no bank instruction');
  ok(s.settle_({ token: tokenFor(env, clmRef, 'accounts'), action: 'paid', by: 'Pat' }).ok === false,
    'bankless claim cannot be paid by bank');
  const ack = s.cashDecide_({ token: cashToken(env, r.ref), action: 'ack', by: 'HO Person' });
  ok(ack.ok && ack.settledClaim === clmRef, 'HO review then settles the approved claim');
}
{
  // no email on file: claim still raised, nothing sent to a blank address
  const env = build(); const { s, sent } = env;
  const r = s.cashLog_(behalfCash({ locumEmail: '' }));
  ok(r.ok && r.flags.some((f) => /No email on file/.test(f)), 'no-email locum accepted + flagged');
  ok(!sent.some((m) => !m.to), 'nothing ever sent to a blank address');
  const r2 = s.cashLog_(behalfCash({ locumEmail: '', reason: 'again', date: '2026-07-19', amount: 60,
    locumDays: [{ date: '2026-07-18', hours: 6 }] }));
  ok(r2.ok && r2.flags.some((f) => /Same days as claim/.test(f)), 'duplicate day caught by NAME when no email');
  ok(s.cashLog_(behalfCash({ validatorName: 'Inactive Val', date: '2026-07-16' })).ok === false,
    'inactive approver rejected on the on-behalf path');
  ok(s.cashLog_(behalfCash({ locumEmail: 'sam@test.co', date: '2026-07-15' })).ok === false,
    'approver’s email = locum’s email blocked on-behalf too');
}

// --- §6b HO-pays: branch-raised claim, accounts pay by bank -----------------
{
  const env = build(); const { s, sent } = env;
  ok(s.branchClaim_(behalfCash({ rate: 15 })).ok === false, 'HO-pays needs the locum’s bank details');
  const q = s.branchClaim_(behalfCash({ rate: 15, sort: '071234', acct: '01235678', acct2: '01235678', bankName: 'J Locum' }));
  ok(q.ok && q.totalAmount === 180, 'HO-pays claim: 12h × £15 = £180');
  const clm = s.findByRef_('Claims', s.CLAIM_COLS, q.ref);
  ok(clm.origin === 'branch-hopays' && String(clm.accountNumber) === '01235678', 'bank details stored for accounts');
  sent.length = 0;
  s.decide_({ token: tokenFor(env, q.ref, 'validator'), action: 'approve' });
  const aMail = sent.filter((m) => m.to === 'accounts@test.co')[0];
  ok(aMail && /ready to pay/.test(aMail.subject) && aMail.body.indexOf('01235678') >= 0, 'accounts asked to pay by bank');
  const paid = s.settle_({ token: tokenFor(env, q.ref, 'accounts'), action: 'paid', by: 'Pat' });
  ok(paid.ok && s.findByRef_('Claims', s.CLAIM_COLS, q.ref).paidMethod === 'bank', 'paid by bank as normal');
}

// --- admin save with the category matrix ------------------------------------
{
  const { s } = build();
  const auth = s.adminAuth_({ pin: '1234', by: 'Moukik' });
  const cfg = auth.config;
  cfg.cash.categories = [{ name: 'Petty supplies', policy: 'sometimes', cap: 30 }];
  ok(s.adminSave_({ session: auth.session, by: 'Moukik', config: cfg, changes: [] }).ok === false,
    'adminSave_ rejects an unknown policy');
  cfg.cash.categories = [{ name: 'Petty supplies', policy: 'approve', cap: 30 }, { name: 'Other', policy: 'review', cap: null }];
  ok(s.adminSave_({ session: auth.session, by: 'Moukik', config: cfg, changes: [] }).ok === false,
    'adminSave_ refuses a matrix without a Locum category — the linkage keys off it');
  cfg.cash.categories = [{ name: 'Locum / casual staff (cash)', policy: 'review', cap: null },
    { name: 'Petty supplies', policy: 'approve', cap: 30 }, { name: 'Other', policy: 'review', cap: null }];
  const saved = s.adminSave_({ session: auth.session, by: 'Moukik', config: cfg, changes: ['Cash categories reworked'] });
  ok(saved.ok === true, 'adminSave_ accepts a valid category matrix');
  const cats = s.readConfig_().cash.categories;
  ok(cats.length === 3 && cats[1].policy === 'approve' && cats[2].cap === null, 'saved matrix round-trips through config');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

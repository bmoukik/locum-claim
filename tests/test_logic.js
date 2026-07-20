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
    getRange(row, col) {
      const rows_ = this._rows;
      return { setValue(v) { rows_[row - 1][col - 1] = v; } };
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
      ['cash.threshold', 20],
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

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

/**
 * Crest Pharmacies apps — Apps Script backend (phase 1)
 * Serves: index.html (locum claims), cash-log.html, admin.html
 * Spec: BACKEND_SPEC.md in the repo — this file implements it. The flag rules
 * and the self-approval block are MIRRORED in index.html's demo backend;
 * change both or they drift.
 *
 * DEPLOY (one time, ~5 minutes):
 *   1. script.new → paste this whole file. Deploy on the admin/ops account
 *      (or bmoukik@gmail.com) — NOT on moukik.cyber@gmail.com, so Gmail
 *      filters run on the incoming test mail.
 *   2. Run setup() once from the editor (authorize when asked). It creates
 *      the two spreadsheets, seeds the config (PIN 0000, moukik.cyber+ test
 *      emails) and installs the weekday reminder trigger.
 *   3. Deploy → New deployment → Web app → Execute as: Me,
 *      Who has access: Anyone. Copy the /exec URL.
 *   4. Swap __API_URL__ in index.html / cash-log.html / admin.html with that
 *      URL. The demo banners disappear by themselves.
 *   5. Change the PIN through the admin page.
 */

var COMPANY = 'Crest Pharmacies';
var PROPS = PropertiesService.getScriptProperties();

// ---------------------------------------------------------------------------
// SETUP — run once from the editor
// ---------------------------------------------------------------------------
function setup() {
  if (PROPS.getProperty('CONFIG_SS_ID')) throw new Error('Already set up. Delete script properties to redo.');

  var cfg = SpreadsheetApp.create('Crest Config');
  var g = cfg.getActiveSheet(); g.setName('Global');
  var salt = Utilities.getUuid();
  g.getRange(1, 1, 6, 2).setValues([
    ['adminPinHash', hashPin_('0000', salt)],
    ['adminPinSalt', salt],
    ['email.accounts', 'moukik.cyber+accounts@gmail.com'],
    ['email.locumHandling', 'moukik.cyber+locumdesk@gmail.com'],
    ['email.cashAck', 'moukik.cyber+cashack@gmail.com'],
    ['admin.allowedEmails', 'bmoukik@gmail.com, moukik.cyber@gmail.com']
  ]);
  var ph = cfg.insertSheet('Pharmacies');
  ph.getRange(1, 1, 5, 2).setValues([
    ['name', 'active'],
    ['Crest — High Street', true],
    ['Crest — Riverside', true],
    ['Crest — Market Square', true],
    ['Crest — Station Road', true]
  ]);
  var v = cfg.insertSheet('Validators');
  v.getRange(1, 1, 5, 4).setValues([
    ['pharmacy', 'name', 'email', 'active'],
    ['Crest — High Street', 'Sam Okafor', 'moukik.cyber+val.sam@gmail.com', true],
    ['Crest — Riverside', 'Priya Shah', 'moukik.cyber+val.priya@gmail.com', true],
    ['Crest — Market Square', 'Tom Ellis', 'moukik.cyber+val.tom@gmail.com', true],
    ['Crest — Station Road', 'Aisha Khan', 'moukik.cyber+val.aisha@gmail.com', true]
  ]);
  var t = cfg.insertSheet('Tools');
  t.getRange(1, 1, 5, 2).setValues([
    ['key', 'value'],
    ['locum.reminderDays', 2],
    ['locum.escalateDays', 4],
    ['cash.threshold', 20],
    ['cash.categories', JSON.stringify(DEFAULT_CASH_CATS)]
  ]);
  cfg.insertSheet('ChangeLog').getRange(1, 1, 1, 3).setValues([['at', 'by', 'change']]);

  var data = SpreadsheetApp.create('Crest Apps Data');
  var c = data.getActiveSheet(); c.setName('Claims');
  c.getRange(1, 1, 1, CLAIM_COLS.length).setValues([CLAIM_COLS]);
  data.insertSheet('Cash Log').getRange(1, 1, 1, CASH_COLS.length).setValues([CASH_COLS]);
  data.insertSheet('Cash Requests').getRange(1, 1, 1, REQ_COLS.length).setValues([REQ_COLS]);
  data.insertSheet('Tokens').getRange(1, 1, 1, 5).setValues([['token', 'kind', 'ref', 'view', 'createdAt']]);

  PROPS.setProperty('CONFIG_SS_ID', cfg.getId());
  PROPS.setProperty('DATA_SS_ID', data.getId());

  ScriptApp.newTrigger('remindAndEscalate').timeBased().everyDays(1).atHour(9).create();

  Logger.log('Config sheet: ' + cfg.getUrl());
  Logger.log('Data sheet:   ' + data.getUrl());
}

// One-off for an ALREADY-DEPLOYED estate: appends the new columns to Cash Log
// and Claims (old rows stay readable — columns are append-only), creates the
// Cash Requests tab, seeds cash.categories. Run from the editor, once.
function migrateCash_() {
  var data = SpreadsheetApp.openById(PROPS.getProperty('DATA_SS_ID'));
  var cash = data.getSheetByName('Cash Log');
  var have = cash.getRange(1, 1, 1, cash.getLastColumn()).getValues()[0].filter(String).length;
  if (have < CASH_COLS.length)
    cash.getRange(1, have + 1, 1, CASH_COLS.length - have).setValues([CASH_COLS.slice(have)]);
  var claims = data.getSheetByName('Claims');
  var haveC = claims.getRange(1, 1, 1, claims.getLastColumn()).getValues()[0].filter(String).length;
  if (haveC < CLAIM_COLS.length)
    claims.getRange(1, haveC + 1, 1, CLAIM_COLS.length - haveC).setValues([CLAIM_COLS.slice(haveC)]);
  if (!data.getSheetByName('Cash Requests'))
    data.insertSheet('Cash Requests').getRange(1, 1, 1, REQ_COLS.length).setValues([REQ_COLS]);
  var tools = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID')).getSheetByName('Tools');
  var keys = tools.getDataRange().getValues().map(function (r) { return r[0]; });
  if (keys.indexOf('cash.categories') < 0)
    tools.appendRow(['cash.categories', JSON.stringify(DEFAULT_CASH_CATS)]);
  PROPS.deleteProperty('CONFIG_CACHE');
  Logger.log('Cash migration done.');
}

var CLAIM_COLS = ['ref', 'submittedAt', 'status', 'locumName', 'locumEmail', 'locumPhone', 'role', 'roleOther', 'gphc', 'rtw',
  'pharmacy', 'validatorName', 'validatorEmail', 'rate', 'monthsJson', 'totalHours', 'totalAmount',
  'bankName', 'sortCode', 'accountNumber', 'notes', 'flagsJson',
  'approvedBy', 'approvedAt', 'rejectReason', 'paidBy', 'paidAt',
  'raisedBy', 'raisedTo', 'raisedReason', 'raisedAt', 'remindedAt', 'escalatedAt',
  // appended for the cash-settlement linkage — never reorder the columns above,
  // deployed sheets are migrated by appending (migrateCash_)
  'paidMethod', 'cashEntryRef',
  // who raised it: locum themselves, or the branch on their behalf (spec §6b)
  'submittedBy', 'origin'];
var MONTHS_ = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
var CASH_COLS = ['ref', 'at', 'status', 'pharmacy', 'manager', 'category', 'amount', 'date', 'reason', 'fromTill',
  'receiptUrl', 'notes', 'person', 'role', 'gphc', 'rtw', 'ackAt', 'queryReason',
  // appended for the record/request model — same append-only rule as above
  'paidFrom', 'payerEmail', 'emergency', 'requestRef', 'claimRef', 'locumEmail', 'flagsJson', 'repaidBy', 'repaidAt',
  'claimChasedAt', 'claimEscalatedAt', 'ackBy'];
var REQ_COLS = ['ref', 'at', 'status', 'pharmacy', 'manager', 'managerEmail', 'category', 'estAmount',
  'reason', 'notes', 'decidedBy', 'decidedAt', 'decideReason', 'cap', 'linkedCashRef'];

// Category policy: 'self' = self-acknowledge allowed (up to cap, if set),
// 'review' = head office always sees it, 'approve' = needs pre-approval.
// Config key cash.categories (JSON) overrides; this is the fail-safe default.
var DEFAULT_CASH_CATS = [
  { name: 'Locum / casual staff (cash)', policy: 'review', cap: null },
  { name: 'Staff welfare / team lunch', policy: 'self', cap: 30 },
  { name: 'Petty supplies', policy: 'self', cap: 30 },
  { name: 'Emergency stock', policy: 'self', cap: 50 },
  { name: 'Travel / parking / courier', policy: 'self', cap: 30 },
  { name: 'Customer cash refund', policy: 'review', cap: null },
  { name: 'Repairs / maintenance', policy: 'approve', cap: null },
  { name: 'Postage', policy: 'self', cap: 20 },
  { name: 'Other', policy: 'review', cap: null }
];
function isLocumCat_(c) { return /^Locum/.test(String(c || '')); }

// ---------------------------------------------------------------------------
// HTTP entry points
// ---------------------------------------------------------------------------
function doGet(e) {
  try {
    var a = (e.parameter || {}).action;
    if (a === 'meta') return out_(metaAction_());
    if (a === 'claim') return out_(claimGet_(e.parameter.token));
    if (a === 'cashmeta') return out_(cashMeta_());
    if (a === 'cashentry') return out_(cashGet_(e.parameter.token));
    if (a === 'cashreqstatus') return out_(cashReqStatus_(e.parameter.refs));
    if (a === 'config') return out_(publicConfig_());
    // No action = the admin console. Served ONLY usefully from the ADMIN
    // deployment (Execute as: user accessing + Anyone with Google account):
    // there Google has already forced sign-in and we can read the identity.
    // On the anonymous public deployment the email comes back blank, so
    // this same code path safely renders "not authorised".
    return adminPage_();
  } catch (err) { return out_({ ok: false, message: String(err) }); }
}

// ---------------------------------------------------------------------------
// ADMIN CONSOLE (2-layer + PIN, mirrors the Crest Dashboard auth pattern)
//   Layer 1: Google sign-in — enforced by the admin deployment's access
//            setting ("Anyone with Google account", execute as USER ACCESSING
//            so Session.getActiveUser() is reliable on consumer accounts).
//   Layer 2: email allowlist — Global tab key admin.allowedEmails, checked on
//            page load AND on every google.script.run call.
//   Layer 3: the PIN + rate limit (unchanged).
// The public "Anyone" deployment CANNOT reach admin actions at all — they are
// not routed in doPost and adminApi throws for non-allowlisted identities.
// ---------------------------------------------------------------------------
function adminEmail_() {
  return String(Session.getActiveUser().getEmail() || '').toLowerCase().trim();
}
function isAdmin_(email) {
  if (!email) return false;
  var c = readConfig_();
  return (c._adminEmails || []).indexOf(email) >= 0;
}
function adminPage_() {
  var email = adminEmail_();
  if (!isAdmin_(email)) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;max-width:480px;margin:80px auto;padding:24px;border:1px solid #FCA5A5;border-radius:12px;background:#FEF2F2;color:#991B1B">' +
      '<h2 style="margin:0 0 8px">Not authorised</h2>' +
      '<p>This console is restricted. ' + (email
        ? 'You are signed in as <b>' + email.replace(/</g, '&lt;') + '</b>, which is not on the admin list.'
        : 'Open the ADMIN deployment URL (it requires Google sign-in) — this URL serves the public API only.') +
      '</p></div>').setTitle('Crest Admin — not authorised');
  }
  var t = HtmlService.createTemplateFromFile('Admin');
  t.adminEmail = email;
  return t.evaluate().setTitle('Crest Pharmacies — Admin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// Single bridge for google.script.run from the admin console. Identity is
// re-verified on EVERY call; `by` is ALWAYS the Google-verified email — the
// client cannot spoof the change log.
function adminApi(json) {
  var email = adminEmail_();
  if (!isAdmin_(email)) throw new Error('Not authorised.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var p = JSON.parse(json);
    p.by = email;
    if (p.action === 'adminAuth') return JSON.stringify(adminAuth_(p));
    if (p.action === 'adminSave') return JSON.stringify(adminSave_(p));
    if (p.action === 'adminPin') return JSON.stringify(adminPin_(p));
    throw new Error('Unknown action');
  } finally { lock.releaseLock(); }
}
// One-time migration for an already-setup() script: seed the allowlist.
function setupAdminAccess() {
  var ss = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID'));
  var g = ss.getSheetByName('Global');
  var has = g.getDataRange().getValues().some(function (r) { return r[0] === 'admin.allowedEmails'; });
  if (!has) g.appendRow(['admin.allowedEmails', 'bmoukik@gmail.com, moukik.cyber@gmail.com']);
  PROPS.deleteProperty('CONFIG_CACHE');
  Logger.log('Admin allowlist ready. Edit it on the Global tab.');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var p = JSON.parse(e.postData.contents);
    var a = p.action;
    if (a === 'submit') return out_(submit_(p.payload));
    if (a === 'approve' || a === 'reject') return out_(decide_(p));
    if (a === 'paid' || a === 'raise') return out_(settle_(p));
    if (a === 'cashlog') return out_(cashLog_(p.payload));
    if (a === 'branchclaim') return out_(branchClaim_(p.payload));
    if (a === 'ack' || a === 'query') return out_(cashDecide_(p));
    if (a === 'cashrequest') return out_(cashRequest_(p.payload));
    if (a === 'cashapprove' || a === 'cashreject') return out_(cashReqDecide_(p));
    if (a === 'cashrepay') return out_(cashRepay_(p));
    // admin actions are NOT routed here — they exist only behind adminApi()
    // on the Google-authenticated admin deployment.
    return out_({ ok: false, message: 'Unknown action' });
  } catch (err) {
    return out_({ ok: false, message: String(err) });
  } finally { lock.releaseLock(); }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------------
// CONFIG (read + fail-safe cache)
// ---------------------------------------------------------------------------
function readConfig_() {
  try {
    var ss = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID'));
    var g = {};
    ss.getSheetByName('Global').getDataRange().getValues().forEach(function (r) { if (r[0]) g[r[0]] = r[1]; });
    var ph = ss.getSheetByName('Pharmacies').getDataRange().getValues().slice(1)
      .filter(function (r) { return r[0]; })
      .map(function (r) { return { name: String(r[0]), active: r[1] === true || String(r[1]).toUpperCase() === 'TRUE' }; });
    var vals = ss.getSheetByName('Validators').getDataRange().getValues().slice(1)
      .filter(function (r) { return r[0] || r[1]; })
      .map(function (r) { return { pharmacy: String(r[0]), name: String(r[1]), email: String(r[2]), active: r[3] === true || String(r[3]).toUpperCase() === 'TRUE' }; });
    var tools = {};
    ss.getSheetByName('Tools').getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) tools[r[0]] = r[1]; });
    var cfg = {
      pharmacies: ph, validators: vals,
      emails: { accounts: String(g['email.accounts'] || ''), locumHandling: String(g['email.locumHandling'] || ''), cashAck: String(g['email.cashAck'] || '') },
      locum: { reminderDays: Number(tools['locum.reminderDays']) || 2, escalateDays: Number(tools['locum.escalateDays']) || 4 },
      cash: {
        threshold: tools['cash.threshold'] == null ? 20 : Number(tools['cash.threshold']),
        categories: cashCats_(tools['cash.categories'])
      },
      _pin: { hash: String(g['adminPinHash'] || ''), salt: String(g['adminPinSalt'] || '') },
      _adminEmails: String(g['admin.allowedEmails'] || '').toLowerCase().split(',').map(function (s) { return s.trim(); }).filter(String)
    };
    PROPS.setProperty('CONFIG_CACHE', JSON.stringify(cfg)); // last-good copy
    return cfg;
  } catch (err) {
    var cached = PROPS.getProperty('CONFIG_CACHE');
    if (cached) return JSON.parse(cached); // fail safe: serve last-good
    throw err;
  }
}

function publicConfig_() {
  var c = readConfig_();
  var vmap = {};
  c.validators.filter(function (v) { return v.active; }).forEach(function (v) { (vmap[v.pharmacy] = vmap[v.pharmacy] || []).push(v.name); });
  // public-safe subset ONLY: no pin, no emails of any kind
  return {
    ok: true,
    pharmacies: c.pharmacies.filter(function (p) { return p.active; }).map(function (p) { return p.name; }),
    validators: vmap, locum: c.locum,
    cash: { threshold: c.cash.threshold, categories: c.cash.categories }
  };
}

// ---------------------------------------------------------------------------
// SHEET helpers
// ---------------------------------------------------------------------------
function sheet_(name) { return SpreadsheetApp.openById(PROPS.getProperty('DATA_SS_ID')).getSheetByName(name); }
function rows_(name, cols) {
  return sheet_(name).getDataRange().getValues().slice(1).map(function (r, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) { o[c] = r[j]; });
    return o;
  });
}
function writeCell_(name, row, cols, key, val) { sheet_(name).getRange(row, cols.indexOf(key) + 1).setValue(val); }
function findByRef_(name, cols, ref) {
  var m = rows_(name, cols).filter(function (r) { return r.ref === ref; });
  return m.length ? m[0] : null;
}

// tokens
function mintToken_(kind, ref, view) {
  var tok = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  sheet_('Tokens').appendRow([tok, kind, ref, view, new Date().toISOString()]);
  return tok;
}
function lookupToken_(tok) {
  var m = rows_('Tokens', ['token', 'kind', 'ref', 'view', 'createdAt']).filter(function (r) { return r.token === tok; });
  if (!m.length) return null;
  var t = m[0];
  if ((new Date() - new Date(t.createdAt)) > 30 * 24 * 3600 * 1000) return { expired: true };
  return t;
}

// ---------------------------------------------------------------------------
// LOCUM CLAIMS
// ---------------------------------------------------------------------------
function metaAction_() {
  var c = readConfig_();
  var vmap = {};
  c.validators.filter(function (v) { return v.active; }).forEach(function (v) {
    (vmap[v.pharmacy] = vmap[v.pharmacy] || []).push(v.name); // names only — never emails
  });
  var months = [], now = new Date();
  for (var i = 0; i < 3; i++) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      label: Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMMM yyyy'),
      maxDay: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    });
  }
  return { ok: true, pharmacies: c.pharmacies.filter(function (p) { return p.active; }).map(function (p) { return p.name; }), validators: vmap, months: months };
}

function submit_(pl) {
  var c = readConfig_();
  var errs = [];
  if (!pl.name) errs.push('Full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pl.email || '')) errs.push('A valid email address');
  if (!pl.phone) errs.push('Phone number');
  if (!pl.role) errs.push('Role');
  if (pl.role === 'Pharmacist' && !/^\d{7}$/.test(pl.gphc || '')) errs.push('GPhC number (7 digits)');
  if (!(pl.rate > 0)) errs.push('Rate');
  if (!/^\d{6}$/.test(pl.sort || '')) errs.push('Sort code (6 digits)');
  if (!/^\d{8}$/.test(pl.acct || '')) errs.push('Account number (8 digits)');
  if (pl.acct !== pl.acct2) errs.push('Account numbers must match');
  if (!pl.bankName) errs.push('Account holder name');
  if (errs.length) return { ok: false, errors: errs };

  var v = c.validators.filter(function (x) { return x.pharmacy === pl.pharmacy && x.name === pl.validatorName && x.active; })[0];
  if (!v) return { ok: false, errors: ['That validator is not available for ' + pl.pharmacy + ' — reload and pick again.'] };

  // self-approval block (mirrored in index.html)
  if (v.email.toLowerCase().trim() === String(pl.email).toLowerCase().trim()) {
    return { ok: false, errors: ['The validator you picked uses the same email address as you. Someone else has to approve your claim — pick a different validator, or ask head office.'] };
  }

  // month split
  var months = [], totalHours = 0, totalAmount = 0, dayKeys = [];
  (pl.months || []).forEach(function (m) {
    var hours = {}, days = [];
    (m.entries || []).forEach(function (en) {
      var hh = Number(en.hours);
      if (!(hh > 0 && hh <= 24)) return;
      days.push(Number(en.day)); hours[String(en.day)] = hh;
      totalHours += hh; totalAmount += hh * pl.rate;
      dayKeys.push(m.label + '|' + en.day);
    });
    if (days.length) { days.sort(function (a, b) { return a - b; }); months.push({ label: m.label, days: days, hours: hours }); }
  });
  if (!dayKeys.length) return { ok: false, errors: ['Tick at least one day'] };
  totalHours = Math.round(totalHours * 100) / 100;
  totalAmount = Math.round(totalAmount * 100) / 100; // store money at 2dp, not accumulated float noise

  // flags (mirrored in index.html): duplicate days + bank-details-changed
  var flags = [];
  var mine = rows_('Claims', CLAIM_COLS).filter(function (r) {
    return String(r.locumEmail).toLowerCase() === pl.email.toLowerCase() && r.status !== 'REJECTED';
  });
  var dup = {};
  mine.forEach(function (r) {
    var theirs = [];
    try { JSON.parse(r.monthsJson || '[]').forEach(function (m) { m.days.forEach(function (d) { theirs.push(m.label + '|' + d); }); }); } catch (e) { }
    var overlap = theirs.filter(function (k) { return dayKeys.indexOf(k) >= 0; });
    if (overlap.length) dup[r.ref] = overlap;
  });
  Object.keys(dup).forEach(function (ref) {
    var pretty = dup[ref].map(function (k) { var s = k.split('|'); return s[1] + ' ' + s[0].split(' ')[0]; }).join(', ');
    flags.push('Same days as claim ' + ref + ', already sent in: ' + pretty + '. Check this is not a repeat.');
  });
  var last = mine.length ? mine[mine.length - 1] : null;
  if (last && String(last.sortCode) && (String(last.sortCode) !== pl.sort || String(last.accountNumber) !== pl.acct)) {
    flags.push('The bank details are different from this locum’s last claim (' + last.ref + '). Ring them on a number you already have to check, before any money is sent — do not just reply to the email.');
  }

  var ref = 'CLM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
  var now = new Date().toISOString();
  var row = {};
  CLAIM_COLS.forEach(function (k) { row[k] = ''; });
  row.ref = ref; row.submittedAt = now; row.status = 'SUBMITTED';
  row.locumName = pl.name; row.locumEmail = pl.email; row.locumPhone = pl.phone;
  row.role = pl.role; row.roleOther = pl.roleOther || ''; row.gphc = pl.gphc || ''; row.rtw = true;
  row.pharmacy = pl.pharmacy; row.validatorName = v.name; row.validatorEmail = v.email;
  row.rate = pl.rate; row.monthsJson = JSON.stringify(months);
  row.totalHours = totalHours; row.totalAmount = totalAmount;
  row.bankName = pl.bankName; row.sortCode = pl.sort; row.accountNumber = pl.acct;
  row.notes = pl.notes || ''; row.flagsJson = JSON.stringify(flags);
  row.origin = 'locum';
  sheet_('Claims').appendRow(CLAIM_COLS.map(function (k) { return row[k]; }));

  var vtok = mintToken_('claim', ref, 'validator');
  var link = webUrl_() + '?token=' + vtok;
  sendMail_(v.email, 'Locum claim ' + ref + ' — waiting for your approval',
    pl.name + ' has submitted claim ' + ref + ' for ' + pl.pharmacy + '.\n' +
    totalHours + ' hours at £' + money_(pl.rate) + '/hr = £' + money_(totalAmount) + '.\n' +
    (flags.length ? '\nCheck these before you go on:\n- ' + flags.join('\n- ') + '\n' : '') +
    '\nReview and approve or reject:\n' + link + '\n\n' +
    'Nothing is paid until you approve. Bank details are not shown to you — accounts receive them after your approval.');
  sendMail_(pl.email, 'Your claim ' + ref + ' has been submitted',
    'Thanks ' + pl.name + ' — your claim ' + ref + ' for £' + money_(totalAmount) + ' (' + totalHours + ' hours) is in.\n' +
    v.name + ' has been asked to validate it. You will get an email when it is approved, and another when the money is sent.');

  return { ok: true, ref: ref, total: money_(totalAmount), hours: totalHours, validator: v.name };
}

// ---------------------------------------------------------------------------
// BRANCH-RAISED LOCUM CLAIMS (spec §6b)
// A manager/validator raises the claim when the locum can't or won't submit —
// the branch fills the worked days at the counter instead of chasing the
// locum afterwards. The claim stays the single record of days × hours × rate
// (the P&L month split); validation still runs through a validator.
// Two routes: 'branch-cash' (till cash already paid — created from a cash-log
// entry) and 'branch-hopays' (head office pays the locum by bank).
// ---------------------------------------------------------------------------
function parseLocumDays_(list) {
  var byMonth = {}, order = [], totalHours = 0, dayKeys = [], bad = [], dupes = [];
  var now = Date.now();
  var maxT = now + 2 * 864e5;          // up to +2 days (timezone slack), never further ahead
  var minT = now - 185 * 864e5;        // ~6 months back — generous for late paperwork
  (list || []).forEach(function (d) {
    var raw = String(d.date || '');
    var m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var hh = Number(d.hours);
    if (!m || !(hh > 0 && hh <= 24)) { if (raw || d.hours != null) bad.push(raw || '(blank date)'); return; }
    var y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    // real calendar day? (round-trips through Date — rejects 2026-02-31, day 00/99, month 13)
    var dt = new Date(y, mo - 1, day);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== day) { bad.push(raw); return; }
    var t = Date.UTC(y, mo - 1, day);
    if (t > maxT || t < minT) { bad.push(raw); return; } // future / far-past typo (e.g. 2062)
    var label = MONTHS_[mo - 1] + ' ' + y;
    if (!byMonth[label]) { byMonth[label] = { label: label, days: [], hours: {} }; order.push(label); }
    if (byMonth[label].hours[String(day)] != null) { dupes.push(raw); return; } // same day twice — do NOT silently drop
    byMonth[label].days.push(day); byMonth[label].hours[String(day)] = hh;
    totalHours += hh; dayKeys.push(label + '|' + day);
  });
  var months = order.map(function (l) {
    byMonth[l].days.sort(function (a, b) { return a - b; });
    return byMonth[l];
  });
  return { months: months, totalHours: Math.round(totalHours * 100) / 100, dayKeys: dayKeys, bad: bad, dupes: dupes };
}
// One place to turn parsed-day problems into user errors — shared by the two
// callers so the page and server never disagree about which days count.
function locumDayErrors_(parsed) {
  var e = [];
  if (parsed.dupes.length) e.push('These days are entered more than once: ' + parsed.dupes.join(', ') + '. Put each day on a single row.');
  if (parsed.bad.length) e.push('These dates look wrong — check the day, the year, and that it is recent: ' + parsed.bad.join(', ') + '.');
  return e;
}

// opts: {origin, rate, totalAmount, bank:{name,sort,acct}|null, cashRef}
function branchClaimCore_(pl, c, opts) {
  var errs = [];
  if (!pl.manager) errs.push('Your name');
  if (!pl.pharmacy) errs.push('Pharmacy');
  if (!pl.person) errs.push('The locum’s name');
  if (!pl.role) errs.push('Role');
  if (pl.role === 'Pharmacist' && !/^\d{7}$/.test(pl.gphc || '')) errs.push('GPhC number (7 digits)');
  if (!pl.rtw) errs.push('Right-to-work confirmation');
  if (pl.locumEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pl.locumEmail)) errs.push('A valid email for the locum (or leave it blank)');
  var v = null;
  if (!pl.validatorName) errs.push('Who should approve this');
  else {
    v = c.validators.filter(function (x) { return x.pharmacy === pl.pharmacy && x.name === pl.validatorName && x.active; })[0];
    if (!v) errs.push('That approver is not available for ' + pl.pharmacy + ' — reload and pick again.');
  }
  if (v && pl.locumEmail && v.email.toLowerCase().trim() === String(pl.locumEmail).toLowerCase().trim())
    errs.push('The approver’s email is the locum’s own — someone else has to approve.');
  // submitter ≠ approver: the person raising the claim cannot also be the one
  // who validates it (identity is typed names here, same basis as the rest of
  // the system). Closes the raise-and-self-approve hole on the branch path.
  if (v && String(pl.manager || '').toLowerCase().trim() === String(v.name).toLowerCase().trim())
    errs.push('You cannot approve a claim you raised — pick a different approver.');
  var parsed = parseLocumDays_(pl.locumDays);
  errs = errs.concat(locumDayErrors_(parsed));
  if (!parsed.dayKeys.length && !parsed.bad.length && !parsed.dupes.length) errs.push('At least one worked day with hours');
  if (errs.length) return { ok: false, errors: errs };

  // duplicate-days tripwire: by email when we have one, else by name — the
  // branch path often has no email, and an advisory flag beats a blind spot
  var flags = [];
  var email = String(pl.locumEmail || '').toLowerCase();
  var mine = rows_('Claims', CLAIM_COLS).filter(function (r) {
    if (r.status === 'REJECTED') return false;
    if (email) return String(r.locumEmail).toLowerCase() === email;
    return String(r.locumName).toLowerCase().trim() === String(pl.person).toLowerCase().trim();
  });
  var dup = {};
  mine.forEach(function (r) {
    var theirs = [];
    try { JSON.parse(r.monthsJson || '[]').forEach(function (m) { m.days.forEach(function (d) { theirs.push(m.label + '|' + d); }); }); } catch (e) { }
    var overlap = theirs.filter(function (k) { return parsed.dayKeys.indexOf(k) >= 0; });
    if (overlap.length) dup[r.ref] = overlap;
  });
  Object.keys(dup).forEach(function (ref) {
    var pretty = dup[ref].map(function (k) { var s = k.split('|'); return s[1] + ' ' + s[0].split(' ')[0]; }).join(', ');
    flags.push('Same days as claim ' + ref + ', already sent in: ' + pretty + '. Check this is not a repeat.');
  });
  flags.push('Submitted by ' + pl.manager + ' (' + pl.pharmacy + ') on the locum’s behalf' +
    (opts.origin === 'branch-cash' ? ' — already paid in cash, entry ' + opts.cashRef + '.' : ' — for head office to pay.'));
  if (!email) flags.push('No email on file for this locum — they will not receive receipts. Double-check the name and days with them.');

  var ref = 'CLM-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
  var now = new Date().toISOString();
  var row = {};
  CLAIM_COLS.forEach(function (k) { row[k] = ''; });
  row.ref = ref; row.submittedAt = now; row.status = 'SUBMITTED';
  row.locumName = pl.person; row.locumEmail = email; row.locumPhone = pl.locumPhone || '';
  row.role = pl.role; row.roleOther = pl.roleOther || ''; row.gphc = pl.gphc || ''; row.rtw = true;
  row.pharmacy = pl.pharmacy; row.validatorName = v.name; row.validatorEmail = v.email;
  row.rate = opts.rate; row.monthsJson = JSON.stringify(parsed.months);
  row.totalHours = parsed.totalHours; row.totalAmount = opts.totalAmount;
  if (opts.bank) { row.bankName = opts.bank.name; row.sortCode = opts.bank.sort; row.accountNumber = opts.bank.acct; }
  row.notes = pl.notes || ''; row.flagsJson = JSON.stringify(flags);
  row.submittedBy = pl.manager + ' (' + pl.pharmacy + ')'; row.origin = opts.origin;
  if (opts.origin === 'branch-cash' && opts.cashRef) row.cashEntryRef = opts.cashRef;
  sheet_('Claims').appendRow(CLAIM_COLS.map(function (k) { return row[k]; }));

  var vtok = mintToken_('claim', ref, 'validator');
  sendMail_(v.email, 'Locum claim ' + ref + ' — waiting for your approval',
    pl.manager + ' at ' + pl.pharmacy + ' submitted claim ' + ref + ' on behalf of ' + pl.person + '.\n' +
    parsed.totalHours + ' hours = £' + money_(opts.totalAmount) + '.\n' +
    (flags.length ? '\nCheck these before you go on:\n- ' + flags.join('\n- ') + '\n' : '') +
    '\nReview and approve or reject:\n' + webUrl_() + '?token=' + vtok +
    (opts.origin === 'branch-cash'
      ? '\n\nThe cash has already been paid at the branch; your approval confirms the work behind it.'
      : '\n\nNothing is paid until you approve; accounts pay after your approval.'));
  // fraud tripwire: the locum hears about any claim raised in their name
  sendMail_(email, 'A claim was submitted for you at ' + COMPANY,
    pl.manager + ' at ' + pl.pharmacy + ' submitted payment claim ' + ref + ' on your behalf: ' +
    parsed.totalHours + ' hours, £' + money_(opts.totalAmount) + '.\n' +
    (opts.origin === 'branch-cash' ? 'It records the cash you were already paid.' : 'You will get an email when it is approved and when the money is sent.') +
    '\nIf this is wrong, contact head office.');
  // independent oversight: a claim raised in someone else's name always pings
  // head office too, so the tripwire does not depend on the locum having (or
  // reading) an email — the case an insider would exploit
  sendMail_(c.emails.locumHandling, 'Claim ' + ref + ' raised on a locum’s behalf at ' + pl.pharmacy,
    pl.manager + ' raised claim ' + ref + ' for ' + pl.person + ' — ' + parsed.totalHours + 'h, £' + money_(opts.totalAmount) + ', ' +
    (opts.origin === 'branch-cash' ? 'cash already paid at the branch' : 'head office to pay by bank') + '. Approver: ' + v.name + '.' +
    (email ? '' : '\nNo locum email on file — verify this payment is genuine.'));
  return { ok: true, ref: ref, totalHours: parsed.totalHours, totalAmount: opts.totalAmount, validator: v.name, flags: flags };
}

// POST {action:'branchclaim', payload} — head office pays the locum by bank
function branchClaim_(pl) {
  var c = readConfig_();
  var errs = [];
  if (!(pl.rate > 0)) errs.push('Rate (£/hour)');
  if (!/^\d{6}$/.test(pl.sort || '')) errs.push('Sort code (6 digits)');
  if (!/^\d{8}$/.test(pl.acct || '')) errs.push('Account number (8 digits)');
  if (pl.acct !== pl.acct2) errs.push('Account numbers must match');
  if (!pl.bankName) errs.push('Account holder name');
  if (errs.length) return { ok: false, errors: errs };
  var parsed = parseLocumDays_(pl.locumDays);
  var total = Math.round(pl.rate * parsed.totalHours * 100) / 100;
  return branchClaimCore_(pl, c, {
    origin: 'branch-hopays', rate: pl.rate, totalAmount: total,
    bank: { name: pl.bankName, sort: pl.sort, acct: pl.acct }
  });
}

// Live cash flags (spec §6a): computed at view time, never stored — the cash
// entry may be logged after the claim was submitted, so stored flags can't
// cover it. Shown to validator AND accounts.
function cashFlagsForClaim_(r) {
  var flags = [];
  rows_('Cash Log', CASH_COLS).forEach(function (x) {
    if (!isLocumCat_(x.category) || x.status === 'QUERIED') return;
    if (x.claimRef && String(x.claimRef).toUpperCase() !== String(r.ref).toUpperCase()) {
      // an entry hard-linked to a DIFFERENT claim is normally accounted for and
      // flagging it on every later claim by the same locum is noise — BUT if
      // that other claim was REJECTED the cash is unbacked again, so let it
      // resurface here so a corrected resubmission still sees it
      var other = findByRef_('Claims', CLAIM_COLS, x.claimRef);
      if (other && other.status !== 'REJECTED') return;
    }
    var linked = String(x.claimRef || '').toUpperCase() === String(r.ref).toUpperCase();
    var sameLocum = x.locumEmail && String(x.locumEmail).toLowerCase() === String(r.locumEmail).toLowerCase();
    if (linked || sameLocum)
      flags.push('Cash payment ' + x.ref + ' (£' + money_(x.amount) + ', ' + x.date + ') to this locum at ' + x.pharmacy +
        ' is on the cash log — check this claim is not for work already paid in cash.');
  });
  return flags;
}

function claimView_(r, view) {
  var months = JSON.parse(r.monthsJson || '[]');
  var rows = months.map(function (m) {
    var hh = 0; m.days.forEach(function (d) { hh += m.hours[String(d)]; });
    return { label: m.label, daysCount: m.days.length, hours: hh, amount: hh * Number(r.rate) };
  });
  var o = {
    ok: true, view: view, ref: r.ref, status: r.status,
    locum: { name: r.locumName, email: r.locumEmail, phone: r.locumPhone },
    role: r.role, roleOther: r.roleOther, gphc: r.gphc,
    pharmacy: r.pharmacy, company: COMPANY, validatorName: r.validatorName,
    rate: Number(r.rate), months: months,
    split: { rows: rows, totalHours: Number(r.totalHours), totalAmount: Number(r.totalAmount) },
    flags: JSON.parse(r.flagsJson || '[]').concat(cashFlagsForClaim_(r)), notes: r.notes,
    submittedBy: r.submittedBy || '', origin: r.origin || 'locum'
  };
  if (r.approvedBy) o.approval = { by: r.approvedBy, at: r.approvedAt };
  if (view === 'accounts') o.bank = { name: r.bankName, sort: String(r.sortCode), acct: String(r.accountNumber) }; // validator NEVER gets bank
  return o;
}

function claimGet_(tok) {
  var t = lookupToken_(tok);
  if (!t) return { ok: false, code: 'invalid' };
  if (t.expired) return { ok: false, code: 'expired' };
  var r = findByRef_('Claims', CLAIM_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (t.view === 'validator' && r.status !== 'SUBMITTED' && r.status !== 'RAISED')
    return { ok: false, code: 'processed', ref: r.ref, status: r.status, decidedAt: r.approvedAt || r.paidAt };
  if (t.view === 'accounts' && r.status !== 'APPROVED')
    return { ok: false, code: 'processed', ref: r.ref, status: r.status, decidedAt: r.paidAt || r.raisedAt };
  return claimView_(r, t.view);
}

function decide_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired || t.view !== 'validator') return { ok: false, code: 'invalid' };
  var r = findByRef_('Claims', CLAIM_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.status !== 'SUBMITTED' && r.status !== 'RAISED') return { ok: false, code: 'processed', ref: r.ref, status: r.status };
  var c = readConfig_();
  var now = new Date().toISOString();

  if (p.action === 'reject') {
    if (!p.reason) return { ok: false, message: 'A reason is required.' };
    writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'REJECTED');
    writeCell_('Claims', r._row, CLAIM_COLS, 'rejectReason', p.reason);
    sendMail_(r.locumEmail, 'Your claim ' + r.ref + ' was not approved',
      r.validatorName + ' rejected claim ' + r.ref + ' with this reason:\n\n' + p.reason + '\n\nFix it and submit a fresh claim.');
    sendMail_(r.validatorEmail, 'Receipt: you rejected claim ' + r.ref, 'For your records. Reason given:\n' + p.reason);
    // if cash was already paid against this claim, rejecting it leaves the money
    // UNBACKED — the till is short and no state tracks that. Tell head office so
    // it is recovered or re-raised, and unlink the entry so a corrected claim's
    // live cash flag resurfaces it (cashFlagsForClaim_ ignores rejected links).
    var paidEntry = r.cashEntryRef ? findByRef_('Cash Log', CASH_COLS, r.cashEntryRef) : null;
    if (!paidEntry) paidEntry = rows_('Cash Log', CASH_COLS).filter(function (x) {
      return isLocumCat_(x.category) && x.status !== 'QUERIED' && String(x.claimRef).toUpperCase() === String(r.ref).toUpperCase();
    })[0] || null;
    if (paidEntry) {
      sendMail_(c.emails.locumHandling, 'Cash already paid for REJECTED claim ' + r.ref,
        'Claim ' + r.ref + ' (' + r.locumName + ', £' + money_(r.totalAmount) + ') was just rejected by ' + r.validatorName + ', but £' + money_(paidEntry.amount) +
        ' cash was already paid at ' + paidEntry.pharmacy + ' (entry ' + paidEntry.ref + ').\nRecover the cash or re-raise a corrected claim — do not let this lapse.');
    }
    return { ok: true, ref: r.ref, status: 'REJECTED', locum: r.locumName };
  }

  // re-check self-approval at approve time — config can change between submit and approval
  if (String(r.validatorEmail).toLowerCase() === String(r.locumEmail).toLowerCase())
    return { ok: false, message: 'This claim cannot be approved by its own claimant.' };

  writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'APPROVED');
  writeCell_('Claims', r._row, CLAIM_COLS, 'approvedBy', r.validatorName);
  writeCell_('Claims', r._row, CLAIM_COLS, 'approvedAt', now);

  // branch-cash claims: the till already paid and head office already put a
  // name on the reviewed entry — this approval was the last human in the
  // chain, so the claim settles as cash right here (spec §6b)
  var settledEntry = rows_('Cash Log', CASH_COLS).filter(function (x) {
    return isLocumCat_(x.category) && x.status === 'ACKNOWLEDGED' && x.ackBy &&
      String(x.claimRef).toUpperCase() === String(r.ref).toUpperCase() &&
      String(x.pharmacy) === String(r.pharmacy) &&
      Math.abs(Number(x.amount) - Number(r.totalAmount)) <= 0.005;
  })[0];
  if (settledEntry) {
    writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'PAID');
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidBy', settledEntry.ackBy + ' — cash at ' + settledEntry.pharmacy + ' (entry ' + settledEntry.ref + ')');
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidAt', now);
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidMethod', 'cash');
    writeCell_('Claims', r._row, CLAIM_COLS, 'cashEntryRef', settledEntry.ref);
    sendMail_(r.locumEmail, 'Your claim ' + r.ref + ' is approved and settled',
      r.validatorName + ' approved claim ' + r.ref + ' (£' + money_(r.totalAmount) + ').\nYou were already paid in cash at ' + settledEntry.pharmacy + ' — no bank transfer will follow; this closes the claim.');
    sendMail_(c.emails.accounts, 'Claim ' + r.ref + ' approved — already settled in CASH, nothing to pay',
      'Claim ' + r.ref + ' (' + r.locumName + ', £' + money_(r.totalAmount) + ') was paid in cash at ' + settledEntry.pharmacy +
      ' (entry ' + settledEntry.ref + ', reviewed by ' + settledEntry.ackBy + ') and is now approved by ' + r.validatorName + '.\nIt is marked PAID — do not send a bank transfer.');
    sendMail_(r.validatorEmail, 'Receipt: you approved claim ' + r.ref,
      'For your records: you approved ' + r.ref + ' (£' + money_(r.totalAmount) + ', ' + r.locumName + ') on ' + now + '. It was settled in cash at the branch (entry ' + settledEntry.ref + ').');
    return { ok: true, ref: r.ref, status: 'PAID', locum: r.locumName };
  }

  var atok = mintToken_('claim', r.ref, 'accounts');
  var flags = JSON.parse(r.flagsJson || '[]').concat(cashFlagsForClaim_(r));
  sendMail_(c.emails.accounts, 'Locum claim ' + r.ref + ' approved — ' + (r.accountNumber ? 'ready to pay £' + money_(r.totalAmount) : 'to be settled in cash'),
    'Claim ' + r.ref + ' was approved by ' + r.validatorName + '.\n\n' +
    (r.accountNumber
      ? 'Pay £' + money_(r.totalAmount) + ' to ' + r.bankName + ', sort ' + r.sortCode + ', account ' + r.accountNumber + ', reference ' + r.ref + '.\n'
      : 'No bank details on this claim — it is to be settled in cash at the branch (a cash-log entry should cover it; check the flags). Do not pay by bank.\n') +
    (flags.length ? '\nCheck these before paying:\n- ' + flags.join('\n- ') + '\n' : '') +
    '\nMark it paid or send it back:\n' + webUrl_() + '?token=' + atok);
  sendMail_(r.locumEmail, 'Your claim ' + r.ref + ' is approved',
    'Good news — ' + r.validatorName + ' approved claim ' + r.ref + ' (£' + money_(r.totalAmount) + ').\nAccounts have it now; you will get one more email when the money is sent.');
  sendMail_(r.validatorEmail, 'Receipt: you approved claim ' + r.ref,
    'For your records: you approved ' + r.ref + ' (£' + money_(r.totalAmount) + ', ' + r.locumName + ') on ' + now + '.');
  return { ok: true, ref: r.ref, status: 'APPROVED', locum: r.locumName };
}

function settle_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired || t.view !== 'accounts') return { ok: false, code: 'invalid' };
  var r = findByRef_('Claims', CLAIM_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.status !== 'APPROVED') return { ok: false, code: 'processed', ref: r.ref, status: r.status };
  if (!p.by) return { ok: false, message: 'Your name is required.' };
  var now = new Date().toISOString();

  if (p.action === 'paid') {
    var cash = p.method === 'cash'; // "paid in cash at the branch" — a cash-log entry covered it (spec §6a)
    if (!cash && !r.accountNumber)
      return { ok: false, message: 'This claim has no bank details — it can only be settled as paid in cash, or sent back.' };
    var paidByTxt = p.by;
    if (cash) {
      // hard-link the till record: exactly one unlinked locum cash entry for
      // this locum whose amount matches → stamp it with the claim ref AND name
      // it in paidBy, so the trail reads both ways from sheet data alone.
      // Require a non-blank email on BOTH sides and a matching amount, or a
      // blank/wrong-amount row could be silently mislinked. Ambiguous stays
      // flag-only.
      var cand = r.locumEmail ? rows_('Cash Log', CASH_COLS).filter(function (x) {
        return isLocumCat_(x.category) && !x.claimRef && x.status !== 'QUERIED' && x.locumEmail &&
          String(x.locumEmail).toLowerCase() === String(r.locumEmail).toLowerCase() &&
          Math.abs(Number(x.amount) - Number(r.totalAmount)) <= 0.005;
      }) : [];
      if (cand.length === 1) {
        writeCell_('Cash Log', cand[0]._row, CASH_COLS, 'claimRef', r.ref);
        writeCell_('Claims', r._row, CLAIM_COLS, 'cashEntryRef', cand[0].ref);
        paidByTxt = p.by + ' — cash at ' + cand[0].pharmacy + ' (entry ' + cand[0].ref + ')';
      }
    }
    writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'PAID');
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidBy', paidByTxt);
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidAt', now);
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidMethod', cash ? 'cash' : 'bank');
    if (cash) sendMail_(r.locumEmail, 'Your claim ' + r.ref + ' is settled — paid in cash',
      'Claim ' + r.ref + ' (£' + money_(r.totalAmount) + ') is marked settled: you were paid in cash at the pharmacy.\nNo bank transfer will follow — this closes the claim.');
    else sendMail_(r.locumEmail, 'Your payment for claim ' + r.ref + ' is on its way',
      '£' + money_(r.totalAmount) + ' for claim ' + r.ref + ' has been sent to your account ending ' + String(r.accountNumber).slice(-4) + '.\nBank transfers usually arrive the same day.');
    return { ok: true, ref: r.ref, status: 'PAID', locum: r.locumName };
  }

  if (!p.reason) return { ok: false, message: 'A reason is required.' };
  writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'RAISED');
  writeCell_('Claims', r._row, CLAIM_COLS, 'raisedBy', p.by);
  writeCell_('Claims', r._row, CLAIM_COLS, 'raisedTo', p.to);
  writeCell_('Claims', r._row, CLAIM_COLS, 'raisedReason', p.reason);
  writeCell_('Claims', r._row, CLAIM_COLS, 'raisedAt', now);
  if (p.to === 'validator') {
    var vtok = mintToken_('claim', r.ref, 'validator');
    sendMail_(r.validatorEmail, 'Claim ' + r.ref + ' sent back to you by accounts',
      p.by + ' in accounts sent claim ' + r.ref + ' back with this reason:\n\n' + p.reason + '\n\nReview it again:\n' + webUrl_() + '?token=' + vtok);
  } else {
    sendMail_(r.locumEmail, 'Your claim ' + r.ref + ' needs a fix',
      'Accounts could not pay claim ' + r.ref + ' yet:\n\n' + p.reason + '\n\nFix it and submit a fresh claim.');
  }
  return { ok: true, ref: r.ref, status: 'RAISED', locum: r.locumName };
}

// ---------------------------------------------------------------------------
// CASH LOG — records, requests, reimbursement (spec §6)
// Three independent dimensions: record vs request · review level (floored by
// category policy, submitter can escalate but never downgrade) · settlement
// (till / pocket / invoice). The review-flooring rules are MIRRORED in
// cash-log.html's demo backend; change both or they drift.
// ---------------------------------------------------------------------------
function cashCats_(raw) {
  try {
    var arr = JSON.parse(raw || '');
    if (Object.prototype.toString.call(arr) !== '[object Array]' || !arr.length) throw 0;
    return arr.map(function (c) {
      return {
        name: String(c.name || ''),
        policy: (c.policy === 'review' || c.policy === 'approve') ? c.policy : 'self',
        cap: (c.cap == null || c.cap === '') ? null : Number(c.cap)
      };
    }).filter(function (c) { return c.name; });
  } catch (e) { return DEFAULT_CASH_CATS; }
}

function cashMeta_() {
  var c = readConfig_();
  var vmap = {};
  c.validators.filter(function (v) { return v.active; }).forEach(function (v) {
    (vmap[v.pharmacy] = vmap[v.pharmacy] || []).push(v.name); // names only — never emails
  });
  return {
    ok: true,
    reviewCeiling: c.cash.threshold, ackThreshold: c.cash.threshold, // ackThreshold kept for old cached pages
    pharmacies: c.pharmacies.filter(function (p) { return p.active; }).map(function (p) { return p.name; }),
    categories: c.cash.categories,
    validators: vmap // the on-behalf claim path needs an approver picker
  };
}

// Review flooring (mirrored in cash-log.html). Returns {pending, flags}.
function cashJudge_(pl, cat, c, req) {
  var flags = [], pending = false;
  function need(f) { pending = true; if (f) flags.push(f); }

  if (cat.policy === 'review') pending = true;
  if (isLocumCat_(pl.category)) pending = true;           // money to people is always seen
  if (pl.wantReview) pending = true;
  if (pl.amount >= c.cash.threshold) pending = true;      // global ceiling
  if (cat.policy === 'self' && cat.cap != null && pl.amount > cat.cap) pending = true;
  if (pl.paidFrom === 'pocket') need('Paid from someone’s own pocket — reimbursement owed (mark repaid below once settled).');
  if (pl.emergency) need('Spent without asking first (emergency) — review.');

  if (cat.policy === 'approve') {
    if (!req) need('This category needs approval before spending — no approval is linked. Treat as an emergency spend and review.');
  }
  if (req) {
    if (req.status !== 'APPROVED') need('Linked approval ' + req.ref + ' is ' + req.status + ', not APPROVED.');
    else {
      if (req.linkedCashRef) need('Approval ' + req.ref + ' was already spent against (entry ' + req.linkedCashRef + ') — second spend on one approval.');
      var cap = req.cap === '' || req.cap == null ? null : Number(req.cap);
      if (cap != null && pl.amount > cap + 0.005) need('£' + money_(pl.amount) + ' against an approval capped at £' + money_(cap) + '.');
    }
  }
  return { pending: pending, flags: flags };
}

// Locum-category link checks (spec §6a). Returns {errs, flags, claim} — a
// claimRef that does not resolve is a hard error, not a flag: storing a typo
// would orphan the payment (no email to chase, no claim to settle).
function cashLocumChecks_(pl) {
  var errs = [], flags = [], claim = null;
  if (!isLocumCat_(pl.category)) return { errs: errs, flags: flags, claim: claim };
  if (pl.claimRef) {
    claim = findByRef_('Claims', CLAIM_COLS, String(pl.claimRef).trim().toUpperCase());
    if (!claim) errs.push('Claim ' + String(pl.claimRef).trim().toUpperCase() + ' was not found — check the reference, or leave it blank and give their email instead.');
    else {
      if (claim.status === 'PAID') flags.push('Claim ' + claim.ref + ' is already marked PAID — this may be a double payment.');
      else if (claim.status !== 'APPROVED') flags.push('Claim ' + claim.ref + ' is ' + claim.status + ' — not yet approved by the validator.');
      if (Math.abs(Number(claim.totalAmount) - pl.amount) > 0.005)
        flags.push('Amount £' + money_(pl.amount) + ' does not match claim ' + claim.ref + ' total £' + money_(claim.totalAmount) + '.');
      if (pl.person && String(claim.locumName).toLowerCase().trim() !== String(pl.person).toLowerCase().trim())
        flags.push('Paid-to name "' + pl.person + '" does not match the claim’s locum "' + claim.locumName + '".');
    }
  } else {
    flags.push('No claim linked — ask the locum to submit a claim so validation and duplicate-day checks run.');
  }
  return { errs: errs, flags: flags, claim: claim };
}

function cashLog_(pl) {
  var c = readConfig_();
  var errs = [];
  if (!pl.manager) errs.push('Your name');
  if (!pl.pharmacy) errs.push('Pharmacy');
  if (!pl.category) errs.push('What it was for');
  if (!(pl.amount > 0)) errs.push('Amount (£)');
  if (!pl.date) errs.push('Date');
  if (!pl.reason) errs.push('Reason / details');
  if (['till', 'pocket', 'invoice'].indexOf(pl.paidFrom) < 0) errs.push('Where the money came from');
  if (isLocumCat_(pl.category)) {
    if (!pl.person) errs.push('Who was paid');
    if (!pl.role) errs.push('Role');
    if (pl.role === 'Pharmacist' && !/^\d{7}$/.test(pl.gphc || '')) errs.push('GPhC number (7 digits)');
    if (!pl.rtw) errs.push('Right-to-work confirmation');
    // no existing claim = the branch fills the worked days HERE and a claim is
    // raised on the locum's behalf (spec §6b) — if the locum could have
    // submitted one, the payment wouldn't be coming through this route
    if (!pl.claimRef) {
      var pd = parseLocumDays_(pl.locumDays);
      errs = errs.concat(locumDayErrors_(pd));
      if (!pd.dayKeys.length && !pd.bad.length && !pd.dupes.length)
        errs.push('The days they worked, with hours — or link their claim reference');
    }
  }
  if (pl.paidFrom === 'pocket' && pl.payerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pl.payerEmail))
    errs.push('A valid email for the person owed (or leave it blank)');
  if (errs.length) return { ok: false, errors: errs };

  var cat = null;
  c.cash.categories.forEach(function (x) { if (x.name === pl.category) cat = x; });
  if (!cat) return { ok: false, errors: ['That category is not available any more — reload and pick again.'] };

  var req = null;
  if (pl.requestRef) {
    req = findByRef_('Cash Requests', REQ_COLS, String(pl.requestRef).trim().toUpperCase());
    if (!req) return { ok: false, errors: ['Approval ' + String(pl.requestRef).trim().toUpperCase() + ' was not found — check the reference.'] };
  }

  var loc = pl.claimRef ? cashLocumChecks_(pl) : { errs: [], flags: [], claim: null };
  if (loc.errs.length) return { ok: false, errors: loc.errs };
  var judged = cashJudge_(pl, cat, c, req);
  var flags = judged.flags.concat(loc.flags);

  // duplicate-entry tripwire (same pharmacy + category + amount + date)
  rows_('Cash Log', CASH_COLS).forEach(function (r) {
    if (r.status !== 'QUERIED' && r.pharmacy === pl.pharmacy && r.category === pl.category &&
        Number(r.amount) === Number(pl.amount) && String(r.date) === String(pl.date))
      flags.push('Looks like a repeat of ' + r.ref + ' (same pharmacy, category, amount and date). Check this is not logged twice.');
  });

  var ref = 'CX-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();

  // no claim linked → raise one from the branch's own input, before the entry
  // is written (any claim-side validation error stops the whole log)
  var raised = null;
  if (isLocumCat_(pl.category) && !pl.claimRef) {
    var days = parseLocumDays_(pl.locumDays);
    var rate = Math.round(pl.amount / days.totalHours * 100) / 100;
    raised = branchClaimCore_(pl, c, { origin: 'branch-cash', rate: rate, totalAmount: pl.amount, bank: null, cashRef: ref });
    if (!raised.ok) return { ok: false, errors: raised.errors };
    flags = flags.concat(raised.flags);
    flags.push('Claim ' + raised.ref + ' raised from this entry — awaiting approval by ' + raised.validator + '.');
  }

  var pending = judged.pending || flags.length > 0;
  var receiptUrl = '';
  if (pl.receipt && pl.receipt.indexOf('data:') === 0) {
    try {
      var m = pl.receipt.match(/^data:([^;]+);base64,(.*)$/);
      var f = DriveApp.createFile(Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], ref + '-receipt'));
      receiptUrl = f.getUrl();
    } catch (e) { receiptUrl = ''; }
  }
  var row = {};
  CASH_COLS.forEach(function (k) { row[k] = ''; });
  row.ref = ref; row.at = new Date().toISOString(); row.status = pending ? 'PENDING' : 'RECORDED';
  row.pharmacy = pl.pharmacy; row.manager = pl.manager; row.category = pl.category;
  row.amount = pl.amount; row.date = pl.date; row.reason = pl.reason;
  row.fromTill = pl.paidFrom === 'till'; row.paidFrom = pl.paidFrom;
  row.payerEmail = pl.payerEmail || ''; row.emergency = !!pl.emergency;
  row.requestRef = req ? req.ref : '';
  // only locum-category entries carry a claim ref — a claim ref on any other
  // category is ignored, so it can never settle a claim through the back door
  row.claimRef = raised ? raised.ref
    : (isLocumCat_(pl.category) && loc.claim) ? loc.claim.ref
    : (isLocumCat_(pl.category) && pl.claimRef) ? String(pl.claimRef).trim().toUpperCase()
    : '';
  row.locumEmail = (pl.locumEmail || (loc.claim ? loc.claim.locumEmail : '') || '').toLowerCase();
  row.receiptUrl = receiptUrl; row.notes = pl.notes || ''; row.flagsJson = JSON.stringify(flags);
  row.person = pl.person || ''; row.role = pl.role || ''; row.gphc = pl.gphc || ''; row.rtw = !!pl.rtw;
  sheet_('Cash Log').appendRow(CASH_COLS.map(function (k) { return row[k]; }));

  if (req && req.status === 'APPROVED' && !req.linkedCashRef)
    writeCell_('Cash Requests', req._row, REQ_COLS, 'linkedCashRef', ref);

  // late paperwork: the claim was already settled as cash (ambiguous back-fill
  // skipped it) and the branch now logs the entry naming it — complete the
  // two-way link
  if (loc.claim && loc.claim.status === 'PAID' && String(loc.claim.paidMethod) === 'cash' && !loc.claim.cashEntryRef)
    writeCell_('Claims', loc.claim._row, CLAIM_COLS, 'cashEntryRef', ref);

  if (pending) {
    var tok = mintToken_('cash', ref, 'ack');
    sendMail_(c.emails.cashAck, 'Cash entry ' + ref + ' £' + money_(pl.amount) + ' needs your review',
      pl.manager + ' at ' + pl.pharmacy + ' logged £' + money_(pl.amount) + ': ' + pl.category + ' — "' + pl.reason + '".\n' +
      'Paid from: ' + (pl.paidFrom === 'till' ? 'the till' : pl.paidFrom === 'pocket' ? 'their own pocket (reimbursement owed)' : 'supplier invoice to head office') + '.\n' +
      (flags.length ? '\nCheck these:\n- ' + flags.join('\n- ') + '\n' : '') +
      '\nReview it:\n' + cashUrl_() + '?token=' + tok);
  }
  return { ok: true, ref: ref, status: pending ? 'PENDING' : 'RECORDED', flags: flags };
}

function cashGet_(tok) {
  var t = lookupToken_(tok);
  if (!t) return { ok: false, code: 'invalid' };
  if (t.expired) return { ok: false, code: 'expired' };

  if (t.kind === 'cashreq') {
    var q = findByRef_('Cash Requests', REQ_COLS, t.ref);
    if (!q) return { ok: false, code: 'invalid' };
    if (q.status !== 'REQUESTED') return { ok: false, code: 'processed', ref: q.ref, status: q.status, decidedAt: q.decidedAt };
    var reqOut = {};
    REQ_COLS.forEach(function (k) { reqOut[k] = q[k]; });
    return { ok: true, view: 'decide', request: reqOut };
  }

  var r = findByRef_('Cash Log', CASH_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  var entry = {};
  CASH_COLS.forEach(function (k) { entry[k] = r[k]; });
  entry.receipt = r.receiptUrl; // page shows img or link
  entry.flags = JSON.parse(r.flagsJson || '[]');
  if (entry.claimRef) {
    var cl = findByRef_('Claims', CLAIM_COLS, entry.claimRef);
    if (cl) entry.claim = { ref: cl.ref, status: cl.status, locumName: cl.locumName, totalAmount: Number(cl.totalAmount), // never bank
      amountMatches: Math.abs(Number(cl.totalAmount) - Number(r.amount)) <= 0.005 };
  }
  if (r.status === 'ACKNOWLEDGED' || r.status === 'QUERIED') {
    // a pocket entry stays actionable after acknowledgment until it is repaid
    if (r.status === 'ACKNOWLEDGED' && r.paidFrom === 'pocket' && !r.repaidAt)
      return { ok: true, view: 'repay', entry: entry };
    return { ok: false, code: 'processed', ref: r.ref, status: r.status, decidedAt: r.ackAt, repaidAt: r.repaidAt || '' };
  }
  return { ok: true, view: 'ack', entry: entry };
}

function cashDecide_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired || t.kind === 'cashreq') return { ok: false, code: 'invalid' };
  var r = findByRef_('Cash Log', CASH_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.status === 'ACKNOWLEDGED' || r.status === 'QUERIED') return { ok: false, code: 'processed', ref: r.ref, status: r.status };
  var now = new Date().toISOString();

  if (p.action === 'ack') {
    // acknowledging a claim-linked entry settles the claim — that moves money,
    // so it needs a typed name (same non-repudiation rule as accounts' Paid).
    // Amount mismatch = NO auto-settle: the entry is recorded, the claim stays
    // with accounts, who see the mismatch flag and decide with full context.
    // only a locum-category entry can settle a claim (a 'sundries' row citing a
    // claim ref must never move it), and only for the SAME pharmacy — otherwise
    // one branch could tick another branch's approved claim as paid-in-cash and
    // suppress the real bank payment
    var claim = (isLocumCat_(r.category) && r.claimRef) ? findByRef_('Claims', CLAIM_COLS, r.claimRef) : null;
    var amountOk = claim && Math.abs(Number(claim.totalAmount) - Number(r.amount)) <= 0.005;
    var pharmacyOk = claim && String(claim.pharmacy) === String(r.pharmacy);
    var settles = claim && claim.status === 'APPROVED' && amountOk && pharmacyOk;
    if (settles && !p.by) return { ok: false, message: 'Your name is required — acknowledging this marks claim ' + claim.ref + ' as paid in cash.' };
    // any payment to a person carries a name, settling or not
    if (isLocumCat_(r.category) && !p.by) return { ok: false, message: 'Your name is required — this entry pays a person.' };

    writeCell_('Cash Log', r._row, CASH_COLS, 'status', 'ACKNOWLEDGED');
    writeCell_('Cash Log', r._row, CASH_COLS, 'ackAt', now);
    if (p.by) writeCell_('Cash Log', r._row, CASH_COLS, 'ackBy', p.by);

    if (settles) {
      var c = readConfig_();
      writeCell_('Claims', claim._row, CLAIM_COLS, 'status', 'PAID');
      writeCell_('Claims', claim._row, CLAIM_COLS, 'paidBy', p.by + ' — cash at ' + r.pharmacy + ' (entry ' + r.ref + ')');
      writeCell_('Claims', claim._row, CLAIM_COLS, 'paidAt', now);
      writeCell_('Claims', claim._row, CLAIM_COLS, 'paidMethod', 'cash');
      writeCell_('Claims', claim._row, CLAIM_COLS, 'cashEntryRef', r.ref); // machine-readable both ways
      sendMail_(claim.locumEmail, 'Your claim ' + claim.ref + ' was paid in cash',
        '£' + money_(claim.totalAmount) + ' for claim ' + claim.ref + ' was paid to you in cash at ' + r.pharmacy + ' (cash entry ' + r.ref + ').\nNo bank transfer will follow — this settles the claim.');
      sendMail_(c.emails.accounts, 'Claim ' + claim.ref + ' settled in CASH — do not pay by bank',
        'Claim ' + claim.ref + ' (' + claim.locumName + ', £' + money_(claim.totalAmount) + ') was paid in cash at ' + r.pharmacy + ' — cash entry ' + r.ref + ', acknowledged by ' + p.by + '.\nIt is now marked PAID. Do not send a bank transfer for it.');
    }
    return { ok: true, ref: r.ref, status: 'ACKNOWLEDGED', settledClaim: settles ? claim.ref : '' };
  }

  if (!p.reason) return { ok: false, message: 'A reason is required.' };
  writeCell_('Cash Log', r._row, CASH_COLS, 'status', 'QUERIED');
  writeCell_('Cash Log', r._row, CASH_COLS, 'queryReason', p.reason);
  if (r.payerEmail) sendMail_(r.payerEmail, 'Cash entry ' + r.ref + ' was queried',
    'Head office queried this entry:\n\n' + p.reason + '\n\nSpeak to head office, then log a corrected entry if needed.');
  return { ok: true, ref: r.ref, status: 'QUERIED' };
}

function cashRepay_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired || t.kind === 'cashreq') return { ok: false, code: 'invalid' };
  var r = findByRef_('Cash Log', CASH_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.paidFrom !== 'pocket') return { ok: false, message: 'This entry was not paid from anyone’s pocket.' };
  if (r.status !== 'ACKNOWLEDGED') return { ok: false, message: 'Acknowledge the entry first, then mark it repaid.' };
  if (r.repaidAt) return { ok: false, code: 'processed', ref: r.ref, status: 'REPAID' };
  if (!p.by) return { ok: false, message: 'Your name is required.' };
  var now = new Date().toISOString();
  writeCell_('Cash Log', r._row, CASH_COLS, 'repaidBy', p.by);
  writeCell_('Cash Log', r._row, CASH_COLS, 'repaidAt', now);
  if (r.payerEmail) sendMail_(r.payerEmail, 'You have been repaid for cash entry ' + r.ref,
    '£' + money_(r.amount) + ' (' + r.category + ' at ' + r.pharmacy + ') has been repaid to you, marked by ' + p.by + '.');
  return { ok: true, ref: r.ref, repaidAt: now };
}

// ---------------------------------------------------------------------------
// CASH REQUESTS (pre-approval) — REQUESTED → APPROVED | REJECTED | LAPSED
// ---------------------------------------------------------------------------
function cashRequest_(pl) {
  var c = readConfig_();
  var errs = [];
  if (!pl.manager) errs.push('Your name');
  if (!pl.pharmacy) errs.push('Pharmacy');
  if (!pl.category) errs.push('What it is for');
  if (!pl.reason) errs.push('What you need and why');
  if (pl.amountKnown && !(pl.estAmount > 0)) errs.push('The expected cost (or mark it not known yet)');
  if (pl.managerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(pl.managerEmail)) errs.push('A valid email (or leave it blank)');
  if (errs.length) return { ok: false, errors: errs };

  var ref = 'CR-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
  var row = {};
  REQ_COLS.forEach(function (k) { row[k] = ''; });
  row.ref = ref; row.at = new Date().toISOString(); row.status = 'REQUESTED';
  row.pharmacy = pl.pharmacy; row.manager = pl.manager; row.managerEmail = pl.managerEmail || '';
  row.category = pl.category; row.estAmount = pl.amountKnown ? pl.estAmount : '';
  row.reason = pl.reason; row.notes = pl.notes || '';
  sheet_('Cash Requests').appendRow(REQ_COLS.map(function (k) { return row[k]; }));

  var tok = mintToken_('cashreq', ref, 'decide');
  sendMail_(c.emails.cashAck, 'Spend approval ' + ref + ' requested — ' + pl.category + (pl.amountKnown ? ' £' + money_(pl.estAmount) : ' (cost not known yet)'),
    pl.manager + ' at ' + pl.pharmacy + ' is asking to spend' + (pl.amountKnown ? ' £' + money_(pl.estAmount) : ' (cost not known yet)') + ' on ' + pl.category + ':\n\n"' + pl.reason + '"\n\n' +
    'Nothing has been spent. Approve (optionally with a cap) or turn it down:\n' + cashUrl_() + '?token=' + tok);
  return { ok: true, ref: ref, status: 'REQUESTED' };
}

function cashReqDecide_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired || t.kind !== 'cashreq') return { ok: false, code: 'invalid' };
  var q = findByRef_('Cash Requests', REQ_COLS, t.ref);
  if (!q) return { ok: false, code: 'invalid' };
  if (q.status !== 'REQUESTED') return { ok: false, code: 'processed', ref: q.ref, status: q.status };
  if (!p.by) return { ok: false, message: 'Your name is required.' };
  var now = new Date().toISOString();

  if (p.action === 'cashapprove') {
    if (p.cap != null && p.cap !== '' && !(Number(p.cap) > 0)) return { ok: false, message: 'The cap must be a positive amount, or left blank.' };
    writeCell_('Cash Requests', q._row, REQ_COLS, 'status', 'APPROVED');
    writeCell_('Cash Requests', q._row, REQ_COLS, 'decidedBy', p.by);
    writeCell_('Cash Requests', q._row, REQ_COLS, 'decidedAt', now);
    if (p.cap != null && p.cap !== '') writeCell_('Cash Requests', q._row, REQ_COLS, 'cap', Number(p.cap));
    if (q.managerEmail) sendMail_(q.managerEmail, 'Approved: ' + q.ref + ' — ' + q.category,
      p.by + ' approved your request ' + q.ref + (p.cap != null && p.cap !== '' ? ' up to £' + money_(p.cap) : '') + '.\n' +
      'When you spend it, log the payment on the cash-log page and link ' + q.ref + '. The approval lapses in 30 days if unused.');
    return { ok: true, ref: q.ref, status: 'APPROVED', cap: p.cap != null && p.cap !== '' ? Number(p.cap) : null };
  }

  if (!p.reason) return { ok: false, message: 'A reason is required.' };
  writeCell_('Cash Requests', q._row, REQ_COLS, 'status', 'REJECTED');
  writeCell_('Cash Requests', q._row, REQ_COLS, 'decidedBy', p.by);
  writeCell_('Cash Requests', q._row, REQ_COLS, 'decidedAt', now);
  writeCell_('Cash Requests', q._row, REQ_COLS, 'decideReason', p.reason);
  if (q.managerEmail) sendMail_(q.managerEmail, 'Not approved: ' + q.ref + ' — ' + q.category,
    p.by + ' turned down request ' + q.ref + ':\n\n' + p.reason);
  return { ok: true, ref: q.ref, status: 'REJECTED' };
}

// Safe-fields status lookup for the refs a branch device remembers. No token:
// branch staff find outcomes on the page they already use (copy rule) — so
// only non-sensitive fields ever leave here.
function cashReqStatus_(refsCsv) {
  var refs = String(refsCsv || '').toUpperCase().split(',').map(function (s) { return s.trim(); }).filter(String).slice(0, 20);
  var out = [];
  refs.forEach(function (ref) {
    var q = findByRef_('Cash Requests', REQ_COLS, ref);
    if (!q) return;
    // lazy lapse: an unused approval dies after 30 days
    if (q.status === 'APPROVED' && !q.linkedCashRef && q.decidedAt &&
        (new Date() - new Date(q.decidedAt)) > 30 * 24 * 3600 * 1000) {
      writeCell_('Cash Requests', q._row, REQ_COLS, 'status', 'LAPSED');
      q.status = 'LAPSED';
    }
    // This endpoint is tokenless (a branch device polls the refs it created),
    // so it must leak nothing sensitive: refs are only 5 chars and enumerable.
    // Return the outcome the branch needs — NOT the decider's name or the
    // verbatim rejection reason (those reach the requester by email, and would
    // otherwise be harvestable across every branch in the estate).
    out.push({
      ref: q.ref, status: q.status, category: q.category, estAmount: q.estAmount,
      cap: q.cap === '' || q.cap == null ? null : Number(q.cap),
      spent: q.linkedCashRef ? true : false
    });
  });
  return { ok: true, requests: out };
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
function hashPin_(pin, salt) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + pin)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function adminAuth_(p) {
  // rate limit: 5 fails per rolling hour -> locked 30 min. Required, not optional.
  var now = Date.now();
  var st = JSON.parse(PROPS.getProperty('AUTH_FAILS') || '{"fails":[],"lockedUntil":0}');
  if (st.lockedUntil > now) return { ok: false, code: 'locked', message: 'Too many wrong PINs. Locked for 30 minutes.' };
  st.fails = st.fails.filter(function (t) { return now - t < 3600000; });

  var c = readConfig_();
  if (hashPin_(String(p.pin), c._pin.salt) !== c._pin.hash) {
    st.fails.push(now);
    if (st.fails.length >= 5) { st.lockedUntil = now + 1800000; st.fails = []; }
    PROPS.setProperty('AUTH_FAILS', JSON.stringify(st));
    logChange_('(failed sign-in attempt by "' + (p.by || '?') + '")');
    return { ok: false, code: st.lockedUntil > now ? 'locked' : 'badpin', message: st.lockedUntil > now ? 'Too many wrong PINs. Locked for 30 minutes.' : '' };
  }
  PROPS.setProperty('AUTH_FAILS', JSON.stringify({ fails: [], lockedUntil: 0 }));
  var session = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PROPS.setProperty('SESSION_' + session, JSON.stringify({ by: p.by, exp: now + 7200000 }));
  var cfg = { pharmacies: c.pharmacies, validators: c.validators, emails: c.emails, locum: c.locum, cash: c.cash }; // never the pin
  return { ok: true, session: session, config: cfg, defaultPin: hashPin_('0000', c._pin.salt) === c._pin.hash };
}

function checkSession_(s) {
  var raw = PROPS.getProperty('SESSION_' + s);
  if (!raw) return null;
  var o = JSON.parse(raw);
  if (o.exp < Date.now()) { PROPS.deleteProperty('SESSION_' + s); return null; }
  // sliding expiry: an active session never dies mid-edit
  o.exp = Date.now() + 7200000;
  PROPS.setProperty('SESSION_' + s, JSON.stringify(o));
  return o;
}

// ---------------------------------------------------------------------------
// One-off: seed the REAL Crest estate (24 trading branches; Adastral excluded,
// merged into Canford) with one test validator each. Run from the editor as
// the owner. Overwrites the Pharmacies + Validators tabs.
// ---------------------------------------------------------------------------
function seedEstate() {
  var ESTATE = [
    ['Meriden', 'James Whitfield', 'james'],
    ['Linden', 'Sarah Bennett', 'sarah'],
    ['Keresley', 'Aisha Khan', 'aisha'],
    ['Holbrooks', 'Tom Ellis', 'tom'],
    ['Clay', 'Priya Shah', 'priya'],
    ['Franche', 'Daniel Okoro', 'daniel'],
    ['Ridgacre', 'Emma Clarke', 'emma'],
    ['Albert', 'Hassan Ali', 'hassan'],
    ['Faraday', 'Lucy Grant', 'lucy'],
    ['Hillfields', 'Mark Osei', 'mark'],
    ['Dosthill', 'Nina Patel', 'nina'],
    ['Fazeley', 'Oliver Reed', 'oliver'],
    ['Humber', 'Fatima Noor', 'fatima'],
    ['Aldergate', 'George Hall', 'george'],
    ['Canford', 'Zara Ahmed', 'zara'],
    ['Hamworthy', 'Peter Lowe', 'peter'],
    ['Grendon', 'Megan Price', 'megan'],
    ['Farndon', 'Ravi Kumar', 'ravi'],
    ['Hagley', 'Chloe Turner', 'chloe'],
    ['Walmley', 'Sam Okafor', 'sam'],
    ['Hawthorne', 'Ben Carter', 'ben'],
    ['Davies', 'Rhian Evans', 'rhian'],
    ['Kilgetty', 'Gareth Jones', 'gareth'],
    ['Crook', 'Bethan Hughes', 'bethan']
  ];
  var ss = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID'));
  var ph = ss.getSheetByName('Pharmacies');
  ph.clearContents();
  ph.getRange(1, 1, ESTATE.length + 1, 2).setValues(
    [['name', 'active']].concat(ESTATE.map(function (r) { return [r[0], true]; })));
  var vs = ss.getSheetByName('Validators');
  vs.clearContents();
  vs.getRange(1, 1, ESTATE.length + 1, 4).setValues(
    [['pharmacy', 'name', 'email', 'active']].concat(ESTATE.map(function (r) {
      return [r[0], r[1], 'moukik.cyber+val.' + r[2] + '@gmail.com', true];
    })));
  logChange_('Estate seeded: ' + ESTATE.length + ' pharmacies, one validator each', 'seedEstate()');
  PROPS.deleteProperty('CONFIG_CACHE');
  Logger.log('Seeded ' + ESTATE.length + ' pharmacies + validators.');
}

function adminSave_(p) {
  if (!checkSession_(p.session)) return { ok: false, code: 'session' };
  var cfg = p.config, e = [];
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var names = {};
  (cfg.pharmacies || []).forEach(function (ph) {
    if (!ph.name) e.push('A pharmacy has no name.');
    if (names[ph.name]) e.push('Duplicate pharmacy "' + ph.name + '".');
    names[ph.name] = true;
  });
  (cfg.validators || []).forEach(function (v) {
    if (!v.name) e.push('A validator has no name.');
    if (!EMAIL_RE.test(v.email || '')) e.push((v.name || 'A validator') + ': invalid email.');
    if (!names[v.pharmacy]) e.push((v.name || 'A validator') + ' is linked to an unknown pharmacy.');
  });
  cfg.pharmacies.filter(function (ph) { return ph.active; }).forEach(function (ph) {
    var n = cfg.validators.filter(function (v) { return v.pharmacy === ph.name && v.active; }).length;
    if (!n) e.push(ph.name + ' is in use but has no validator switched on.');
  });
  ['accounts', 'locumHandling', 'cashAck'].forEach(function (k) {
    if (!EMAIL_RE.test((cfg.emails || {})[k] || '')) e.push('Global email "' + k + '" is invalid.');
  });
  if (!(cfg.locum.reminderDays >= 1) || !(cfg.locum.escalateDays > cfg.locum.reminderDays)) e.push('Reminder/escalation days are wrong.');
  if (!(cfg.cash.threshold >= 0)) e.push('Cash review ceiling must be 0 or more.');
  var cats = cfg.cash.categories;
  if (cats != null) {
    if (Object.prototype.toString.call(cats) !== '[object Array]' || !cats.length) e.push('At least one cash category is needed.');
    else {
      var catNames = {};
      cats.forEach(function (ct) {
        if (!ct.name) e.push('A cash category has no name.');
        if (catNames[ct.name]) e.push('Duplicate cash category "' + ct.name + '".');
        catNames[ct.name] = true;
        if (['self', 'review', 'approve'].indexOf(ct.policy) < 0) e.push('Category "' + ct.name + '": policy must be self, review or approve.');
        if (ct.cap != null && ct.cap !== '' && !(Number(ct.cap) >= 0)) e.push('Category "' + ct.name + '": the cap must be 0 or more, or blank.');
      });
      // the locum linkage, chase cron and P&L filter all key off this prefix
      if (!cats.some(function (ct) { return isLocumCat_(ct.name); }))
        e.push('Keep one category starting with "Locum" — the locum payment linkage depends on it.');
    }
  }
  if (e.length) return { ok: false, code: 'validation', errors: e };

  var ss = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID'));
  var ph = ss.getSheetByName('Pharmacies');
  ph.clearContents();
  ph.getRange(1, 1, cfg.pharmacies.length + 1, 2).setValues(
    [['name', 'active']].concat(cfg.pharmacies.map(function (x) { return [x.name, x.active]; })));
  var vs = ss.getSheetByName('Validators');
  vs.clearContents();
  vs.getRange(1, 1, cfg.validators.length + 1, 4).setValues(
    [['pharmacy', 'name', 'email', 'active']].concat(cfg.validators.map(function (x) { return [x.pharmacy, x.name, x.email, x.active]; })));
  var g = ss.getSheetByName('Global').getDataRange().getValues();
  var gs = ss.getSheetByName('Global');
  g.forEach(function (r, i) {
    if (r[0] === 'email.accounts') gs.getRange(i + 1, 2).setValue(cfg.emails.accounts);
    if (r[0] === 'email.locumHandling') gs.getRange(i + 1, 2).setValue(cfg.emails.locumHandling);
    if (r[0] === 'email.cashAck') gs.getRange(i + 1, 2).setValue(cfg.emails.cashAck);
  });
  var ts = ss.getSheetByName('Tools');
  var catsJson = cats != null ? JSON.stringify(cats.map(function (ct) {
    return { name: ct.name, policy: ct.policy, cap: ct.cap == null || ct.cap === '' ? null : Number(ct.cap) };
  })) : null;
  var sawCats = false;
  ts.getDataRange().getValues().forEach(function (r, i) {
    if (r[0] === 'locum.reminderDays') ts.getRange(i + 1, 2).setValue(cfg.locum.reminderDays);
    if (r[0] === 'locum.escalateDays') ts.getRange(i + 1, 2).setValue(cfg.locum.escalateDays);
    if (r[0] === 'cash.threshold') ts.getRange(i + 1, 2).setValue(cfg.cash.threshold);
    if (r[0] === 'cash.categories') { sawCats = true; if (catsJson) ts.getRange(i + 1, 2).setValue(catsJson); }
  });
  if (catsJson && !sawCats) ts.appendRow(['cash.categories', catsJson]);
  (p.changes || []).forEach(function (ch) { logChange_(ch, p.by); });
  PROPS.deleteProperty('CONFIG_CACHE'); // bust last-good so next read is fresh
  return { ok: true, updatedAt: new Date().toISOString() };
}

function adminPin_(p) {
  if (!checkSession_(p.session)) return { ok: false, code: 'session' };
  if (!/^\d{4,8}$/.test(String(p.newPin))) return { ok: false, message: 'PIN must be 4 to 8 digits.' };
  var ss = SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID'));
  var gs = ss.getSheetByName('Global');
  var salt = Utilities.getUuid();
  gs.getDataRange().getValues().forEach(function (r, i) {
    if (r[0] === 'adminPinHash') gs.getRange(i + 1, 2).setValue(hashPin_(String(p.newPin), salt));
    if (r[0] === 'adminPinSalt') gs.getRange(i + 1, 2).setValue(salt);
  });
  PROPS.deleteProperty('CONFIG_CACHE');
  logChange_('PIN changed', p.by); // never log the PIN itself
  return { ok: true };
}

function logChange_(change, by) {
  SpreadsheetApp.openById(PROPS.getProperty('CONFIG_SS_ID')).getSheetByName('ChangeLog')
    .appendRow([new Date().toISOString(), by || '', change]);
}

// ---------------------------------------------------------------------------
// REMINDERS + ESCALATION (weekday trigger, ~09:00)
// Nothing here ever approves anything — a slow validator gets chased, then a
// human gets told. Max one reminder + one escalation per claim.
// ---------------------------------------------------------------------------
function remindAndEscalate() {
  var day = new Date().getDay();
  if (day === 0 || day === 6) return; // weekdays only
  var c = readConfig_();
  rows_('Claims', CLAIM_COLS).forEach(function (r) {
    if (r.status !== 'SUBMITTED' && r.status !== 'RAISED') return;
    var lastAction = r.raisedAt || r.submittedAt;
    var d = workingDaysSince_(new Date(lastAction));
    if (d >= c.locum.escalateDays && !r.escalatedAt) {
      sendMail_(c.emails.locumHandling, 'Escalation: claim ' + r.ref + ' waiting ' + d + ' working days',
        'Claim ' + r.ref + ' (' + r.locumName + ', £' + money_(r.totalAmount) + ', ' + r.pharmacy + ') has sat ' + d +
        ' working days with ' + r.validatorName + '.\nA reminder was already sent; this is the escalation. Please chase or reassign.');
      writeCell_('Claims', r._row, CLAIM_COLS, 'escalatedAt', new Date().toISOString());
    } else if (d >= c.locum.reminderDays && !r.remindedAt) {
      var tok = mintToken_('claim', r.ref, 'validator');
      sendMail_(r.validatorEmail, 'Reminder: claim ' + r.ref + ' is waiting for you',
        'Claim ' + r.ref + ' (' + r.locumName + ', £' + money_(r.totalAmount) + ') has been waiting ' + d + ' working days.\n' +
        'Approve or reject it:\n' + webUrl_() + '?token=' + tok);
      writeCell_('Claims', r._row, CLAIM_COLS, 'remindedAt', new Date().toISOString());
    }
  });

  // Locum paid in cash BEFORE any claim exists: the claim is the only record
  // of the worked days/hours (the P&L month split), so chase until one is
  // linked. Same cadence as validator chasing, max one nudge + one escalation.
  var allClaims = rows_('Claims', CLAIM_COLS);
  rows_('Cash Log', CASH_COLS).forEach(function (r) {
    if (!isLocumCat_(r.category) || r.claimRef || !r.locumEmail || r.status === 'QUERIED') return;
    // if any live claim from this locum exists, the link lands at settle time —
    // the normal claim chasing covers the rest, don't nag the locum again
    var submitted = allClaims.some(function (cl) {
      return String(cl.locumEmail).toLowerCase() === String(r.locumEmail).toLowerCase() && cl.status !== 'REJECTED';
    });
    if (submitted) return;
    var d = workingDaysSince_(new Date(r.at));
    if (d >= c.locum.escalateDays && !r.claimEscalatedAt) {
      sendMail_(c.emails.locumHandling, 'No claim yet for cash payment ' + r.ref,
        'Cash entry ' + r.ref + ' (£' + money_(r.amount) + ' to ' + r.person + ' at ' + r.pharmacy + ', ' + r.date + ') still has no claim linked after ' + d + ' working days.\n' +
        'Until they submit a claim, the worked days and hours behind this payment are not on record. Please chase directly.');
      writeCell_('Cash Log', r._row, CASH_COLS, 'claimEscalatedAt', new Date().toISOString());
    } else if (d >= c.locum.reminderDays && !r.claimChasedAt && !r.claimEscalatedAt) {
      sendMail_(r.locumEmail, 'Please submit a claim for your cash payment at ' + r.pharmacy,
        'You were paid £' + money_(r.amount) + ' in cash at ' + r.pharmacy + ' on ' + r.date + ' (entry ' + r.ref + ').\n' +
        'Nothing more is owed — but please submit a payment claim so the days and hours you worked are on record:\n' + webUrl_() + '\n' +
        'Pick the days you worked and your rate; your validator confirms it as usual.');
      writeCell_('Cash Log', r._row, CASH_COLS, 'claimChasedAt', new Date().toISOString());
    }
  });
}

// Ceiling: Mon–Fri only, no bank-holiday awareness. Add a Holidays tab to
// config and subtract if a day-early nudge over a bank holiday ever matters.
function workingDaysSince_(from) {
  var n = 0, d = new Date(from);
  while (d < new Date()) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------
function money_(n) { return Number(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function webUrl_() { return PROPS.getProperty('PAGE_URL_CLAIM') || 'https://bmoukik.github.io/locum-claim/index.html'; }
function cashUrl_() { return PROPS.getProperty('PAGE_URL_CASH') || 'https://bmoukik.github.io/locum-claim/cash-log.html'; }
function sendMail_(to, subject, body) {
  if (!to) return; // branch-raised claims may have no locum email on file
  var c = readConfig_();
  MailApp.sendEmail({ to: to, subject: subject, body: body + '\n\n— ' + COMPANY + ' apps', replyTo: c.emails.locumHandling, name: COMPANY });
}

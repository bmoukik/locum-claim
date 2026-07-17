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
  t.getRange(1, 1, 4, 2).setValues([
    ['key', 'value'],
    ['locum.reminderDays', 2],
    ['locum.escalateDays', 4],
    ['cash.threshold', 20]
  ]);
  cfg.insertSheet('ChangeLog').getRange(1, 1, 1, 3).setValues([['at', 'by', 'change']]);

  var data = SpreadsheetApp.create('Crest Apps Data');
  var c = data.getActiveSheet(); c.setName('Claims');
  c.getRange(1, 1, 1, CLAIM_COLS.length).setValues([CLAIM_COLS]);
  data.insertSheet('Cash Log').getRange(1, 1, 1, CASH_COLS.length).setValues([CASH_COLS]);
  data.insertSheet('Tokens').getRange(1, 1, 1, 5).setValues([['token', 'kind', 'ref', 'view', 'createdAt']]);

  PROPS.setProperty('CONFIG_SS_ID', cfg.getId());
  PROPS.setProperty('DATA_SS_ID', data.getId());

  ScriptApp.newTrigger('remindAndEscalate').timeBased().everyDays(1).atHour(9).create();

  Logger.log('Config sheet: ' + cfg.getUrl());
  Logger.log('Data sheet:   ' + data.getUrl());
}

var CLAIM_COLS = ['ref', 'submittedAt', 'status', 'locumName', 'locumEmail', 'locumPhone', 'role', 'roleOther', 'gphc', 'rtw',
  'pharmacy', 'validatorName', 'validatorEmail', 'rate', 'monthsJson', 'totalHours', 'totalAmount',
  'bankName', 'sortCode', 'accountNumber', 'notes', 'flagsJson',
  'approvedBy', 'approvedAt', 'rejectReason', 'paidBy', 'paidAt',
  'raisedBy', 'raisedTo', 'raisedReason', 'raisedAt', 'remindedAt', 'escalatedAt'];
var CASH_COLS = ['ref', 'at', 'status', 'pharmacy', 'manager', 'category', 'amount', 'date', 'reason', 'fromTill',
  'receiptUrl', 'notes', 'person', 'role', 'gphc', 'rtw', 'ackAt', 'queryReason'];

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
    if (a === 'ack' || a === 'query') return out_(cashDecide_(p));
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
      cash: { threshold: tools['cash.threshold'] == null ? 20 : Number(tools['cash.threshold']) },
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
    validators: vmap, locum: c.locum, cash: { threshold: c.cash.threshold }
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
    flags: JSON.parse(r.flagsJson || '[]'), notes: r.notes
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
    return { ok: true, ref: r.ref, status: 'REJECTED', locum: r.locumName };
  }

  // re-check self-approval at approve time — config can change between submit and approval
  if (String(r.validatorEmail).toLowerCase() === String(r.locumEmail).toLowerCase())
    return { ok: false, message: 'This claim cannot be approved by its own claimant.' };

  writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'APPROVED');
  writeCell_('Claims', r._row, CLAIM_COLS, 'approvedBy', r.validatorName);
  writeCell_('Claims', r._row, CLAIM_COLS, 'approvedAt', now);
  var atok = mintToken_('claim', r.ref, 'accounts');
  var flags = JSON.parse(r.flagsJson || '[]');
  sendMail_(c.emails.accounts, 'Locum claim ' + r.ref + ' approved — ready to pay £' + money_(r.totalAmount),
    'Claim ' + r.ref + ' was approved by ' + r.validatorName + '.\n\n' +
    'Pay £' + money_(r.totalAmount) + ' to ' + r.bankName + ', sort ' + r.sortCode + ', account ' + r.accountNumber + ', reference ' + r.ref + '.\n' +
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
    writeCell_('Claims', r._row, CLAIM_COLS, 'status', 'PAID');
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidBy', p.by);
    writeCell_('Claims', r._row, CLAIM_COLS, 'paidAt', now);
    sendMail_(r.locumEmail, 'Your payment for claim ' + r.ref + ' is on its way',
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
// CASH LOG
// ---------------------------------------------------------------------------
function cashMeta_() {
  var c = readConfig_();
  return {
    ok: true, ackThreshold: c.cash.threshold,
    pharmacies: c.pharmacies.filter(function (p) { return p.active; }).map(function (p) { return p.name; }),
    categories: []
  };
}

function cashLog_(pl) {
  var c = readConfig_();
  if (!pl.manager || !pl.pharmacy || !pl.category || !(pl.amount > 0) || !pl.date || !pl.reason)
    return { ok: false, errors: ['Missing required fields'] };
  var ref = 'CX-' + Utilities.getUuid().replace(/-/g, '').slice(0, 5).toUpperCase();
  var pending = pl.amount >= c.cash.threshold;
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
  row.amount = pl.amount; row.date = pl.date; row.reason = pl.reason; row.fromTill = !!pl.fromTill;
  row.receiptUrl = receiptUrl; row.notes = pl.notes || '';
  row.person = pl.person || ''; row.role = pl.role || ''; row.gphc = pl.gphc || ''; row.rtw = !!pl.rtw;
  sheet_('Cash Log').appendRow(CASH_COLS.map(function (k) { return row[k]; }));

  if (pending) {
    var tok = mintToken_('cash', ref, 'ack');
    sendMail_(c.emails.cashAck, 'Cash entry ' + ref + ' £' + money_(pl.amount) + ' needs acknowledgement',
      pl.manager + ' at ' + pl.pharmacy + ' logged £' + money_(pl.amount) + ' from the till: ' + pl.category + ' — "' + pl.reason + '".\n' +
      'This is at or over the £' + c.cash.threshold + ' threshold, so it needs your acknowledgement:\n' +
      cashUrl_() + '?token=' + tok);
  }
  return { ok: true, ref: ref, status: pending ? 'PENDING' : 'RECORDED', threshold: c.cash.threshold };
}

function cashGet_(tok) {
  var t = lookupToken_(tok);
  if (!t) return { ok: false, code: 'invalid' };
  if (t.expired) return { ok: false, code: 'expired' };
  var r = findByRef_('Cash Log', CASH_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.status === 'ACKNOWLEDGED' || r.status === 'QUERIED') return { ok: false, code: 'processed', ref: r.ref, status: r.status, decidedAt: r.ackAt };
  var entry = {};
  CASH_COLS.forEach(function (k) { entry[k] = r[k]; });
  entry.receipt = r.receiptUrl; // page shows img or link
  return { ok: true, entry: entry };
}

function cashDecide_(p) {
  var t = lookupToken_(p.token);
  if (!t || t.expired) return { ok: false, code: 'invalid' };
  var r = findByRef_('Cash Log', CASH_COLS, t.ref);
  if (!r) return { ok: false, code: 'invalid' };
  if (r.status === 'ACKNOWLEDGED' || r.status === 'QUERIED') return { ok: false, code: 'processed', ref: r.ref, status: r.status };
  var now = new Date().toISOString();
  if (p.action === 'ack') {
    writeCell_('Cash Log', r._row, CASH_COLS, 'status', 'ACKNOWLEDGED');
    writeCell_('Cash Log', r._row, CASH_COLS, 'ackAt', now);
    return { ok: true, ref: r.ref, status: 'ACKNOWLEDGED' };
  }
  if (!p.reason) return { ok: false, message: 'A reason is required.' };
  writeCell_('Cash Log', r._row, CASH_COLS, 'status', 'QUERIED');
  writeCell_('Cash Log', r._row, CASH_COLS, 'queryReason', p.reason);
  return { ok: true, ref: r.ref, status: 'QUERIED' };
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
  if (!(cfg.cash.threshold >= 0)) e.push('Cash threshold must be 0 or more.');
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
  ts.getDataRange().getValues().forEach(function (r, i) {
    if (r[0] === 'locum.reminderDays') ts.getRange(i + 1, 2).setValue(cfg.locum.reminderDays);
    if (r[0] === 'locum.escalateDays') ts.getRange(i + 1, 2).setValue(cfg.locum.escalateDays);
    if (r[0] === 'cash.threshold') ts.getRange(i + 1, 2).setValue(cfg.cash.threshold);
  });
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
}

// ponytail: Mon–Fri only, no bank-holiday awareness. Add a Holidays tab to
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
  var c = readConfig_();
  MailApp.sendEmail({ to: to, subject: subject, body: body + '\n\n— ' + COMPANY + ' apps', replyTo: c.emails.locumHandling, name: COMPANY });
}

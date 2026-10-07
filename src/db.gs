/**
 * db.gs
 * Small helpers that treat each Sheet tab like a database table.
 * Row 1 is the header row; every other row is one record.
 */

var ss__ = null;
function ss_() {
  if (!ss__) ss__ = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  return ss__;
}

function sheet_(key) {
  var sh = ss_().getSheetByName(TABLES[key].name);
  if (!sh) throw new Error('Tab "' + TABLES[key].name + '" is missing. Run setup() once from the Apps Script editor.');
  return sh;
}

function formatDate_(d, pattern) {
  return Utilities.formatDate(d, CONFIG.TIMEZONE, pattern);
}

/** Turns a cell value into something safe to send to the browser (no Date objects). */
function fromCell_(header, v) {
  if (v instanceof Date) {
    if (header === 'date') return formatDate_(v, 'yyyy-MM-dd');
    if (header === 'time') return formatDate_(v, 'HH:mm');
    if (header === 'start_month' || header === 'end_month') return formatDate_(v, 'yyyy-MM');
    return formatDate_(v, 'yyyy-MM-dd HH:mm:ss');
  }
  if (header === 'amount' || header === 'budget' || header === 'order') {
    return v === '' || v === null ? '' : Number(v);
  }
  if (header === 'archived') return v === true || String(v).toUpperCase() === 'TRUE';
  if (header === 'splits') return parseSplits_(v);
  if (header === 'months') return parseMonths_(v);
  if (header === 'start_month' || header === 'end_month') {
    var mo = String(v === null || v === undefined ? '' : v).trim();
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(mo) ? mo : '';   // a hand-typed "Oct" is ignored rather than breaking the app
  }
  if (header === 'day') return v === '' || v === null ? '' : Number(v);
  return v === null || v === undefined ? '' : String(v);
}

/** Turns a value from the app into what gets written to the cell. */
function toCell_(header, v) {
  if (v === null || v === undefined) return '';
  if (header === 'date') {
    var m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : '';
  }
  if (header === 'amount' || header === 'budget' || header === 'order') {
    return v === '' ? '' : Number(v);
  }
  if (header === 'archived') return v === true;
  if (header === 'splits') return formatSplits_(v);
  if (header === 'months') return formatMonths_(v);
  if (header === 'day') return v === '' ? '' : Number(v);
  var s = String(v);
  // Stop text like "=..." being treated as a formula
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** Reads a whole tab in ONE call to Google Sheets (header row skipped). */
function readTable_(key) {
  var headers = TABLES[key].headers;
  var values = sheet_(key).getDataRange().getValues();
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var line = values[r];
    var empty = true;
    for (var e = 0; e < headers.length; e++) { if (line[e] !== '' && line[e] !== null && line[e] !== undefined) { empty = false; break; } }
    if (empty) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = line[c] === undefined ? '' : line[c];   // tab may be narrower if the last columns are empty
      obj[headers[c]] = fromCell_(headers[c], v);
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * A split bill keeps its parts in one readable cell, e.g. "Food: 300 | Drink: 50 | Entertainment: 50".
 * Empty for normal single-category transactions.
 */
function parseSplits_(v) {
  var text = String(v === null || v === undefined ? '' : v).trim();
  if (!text) return [];
  return text.split('|').map(function (part) {
    var i = part.lastIndexOf(':');
    if (i < 0) return null;
    var amount = Number(part.substr(i + 1).replace(/[,\s฿]/g, ''));
    var category = part.substr(0, i).trim();
    return category && amount > 0 ? { category: category, amount: Math.round(amount * 100) / 100 } : null;
  }).filter(Boolean);
}

function formatSplits_(splits) {
  if (!splits || !splits.length) return '';
  return splits.map(function (s) {
    var a = Number(s.amount);
    return String(s.category).replace(/[|:]/g, ' ').trim() + ': ' + (a % 1 ? a.toFixed(2) : String(a));
  }).join(' | ');
}

/**
 * Month-only changes of a recurring rule, kept readable in one cell:
 * "2026-10: 9000 | 2026-12: skip"  <->  { '2026-10': 9000, '2026-12': 'skip' }
 */
function parseMonths_(v) {
  var out = {};
  String(v === null || v === undefined ? '' : v).split('|').forEach(function (part) {
    var m = part.match(/(\d{4}-\d{2})\s*:\s*(skip|[\d,.]+)/i);
    if (!m) return;
    if (/skip/i.test(m[2])) out[m[1]] = 'skip';
    else { var n = Number(m[2].replace(/,/g, '')); if (n > 0) out[m[1]] = Math.round(n * 100) / 100; }
  });
  return out;
}

function formatMonths_(months) {
  if (!months || typeof months !== 'object') return '';
  return Object.keys(months).sort().map(function (k) {
    var v = months[k];
    return k + ': ' + (v === 'skip' ? 'skip' : (Number(v) % 1 ? Number(v).toFixed(2) : String(Number(v))));
  }).join(' | ');
}

function rowFromObject_(key, obj) {
  return TABLES[key].headers.map(function (h) { return toCell_(h, obj[h]); });
}

/** Cell formats per column: text by default so references like 2026...908 stay exact. */
function formatsFor_(key) {
  return TABLES[key].headers.map(function (h) {
    if (h === 'date') return 'yyyy-mm-dd';
    if (h === 'amount') return '#,##0.00';
    if (h === 'budget') return '#,##0';
    if (h === 'order' || h === 'day') return '0';
    if (h === 'archived') return 'General';
    return '@';
  });
}

function appendRecord_(key, obj) {
  var sh = sheet_(key);
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var range = sh.getRange(row, 1, 1, TABLES[key].headers.length);
  range.setNumberFormats([formatsFor_(key)]);
  range.setValues([rowFromObject_(key, obj)]);
}

/** Row number (1-based) of the record whose first column equals id, or -1. */
function findRowById_(key, id) {
  var sh = sheet_(key);
  var last = sh.getLastRow();
  if (last < 2 || !id) return -1;
  var hit = sh.getRange(2, 1, last - 1, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : -1;
}

function updateRecord_(key, row, obj) {
  var range = sheet_(key).getRange(row, 1, 1, TABLES[key].headers.length);
  range.setNumberFormats([formatsFor_(key)]);
  range.setValues([rowFromObject_(key, obj)]);
}

function readRecordAt_(key, row) {
  var headers = TABLES[key].headers;
  var values = sheet_(key).getRange(row, 1, 1, headers.length).getValues()[0];
  var obj = {};
  headers.forEach(function (h, i) { obj[h] = fromCell_(h, values[i]); });
  return obj;
}

/** Replaces every record in a small table (used for Categories and Accounts). */
function replaceTable_(key, objects) {
  var sh = sheet_(key);
  var headers = TABLES[key].headers;
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
  if (objects.length) {
    if (objects.length + 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), objects.length);
    var range = sh.getRange(2, 1, objects.length, headers.length);
    var f = formatsFor_(key);
    range.setNumberFormats(objects.map(function () { return f; }));
    range.setValues(objects.map(function (o) { return rowFromObject_(key, o); }));
  }
}

/** Adds any header cells missing from row 1 (new columns added in an update). Never moves data. */
function ensureHeaders_(key) {
  var sh = sheet_(key);
  var headers = TABLES[key].headers;
  var row = sh.getRange(1, 1, 1, headers.length);
  var current = row.getValues()[0];
  var missing = false;
  for (var i = 0; i < headers.length; i++) if (current[i] === '' || current[i] === null) { current[i] = headers[i]; missing = true; }
  if (missing) row.setValues([current]).setFontWeight('bold').setBackground('#F1F3F5').setFontColor('#212529');
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function nowString_() {
  return formatDate_(new Date(), 'yyyy-MM-dd HH:mm:ss');
}

function newId_() {
  return 't_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

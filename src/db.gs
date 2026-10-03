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
    return formatDate_(v, 'yyyy-MM-dd HH:mm:ss');
  }
  if (header === 'amount' || header === 'budget' || header === 'order') {
    return v === '' || v === null ? '' : Number(v);
  }
  if (header === 'archived') return v === true || String(v).toUpperCase() === 'TRUE';
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
  var s = String(v);
  // Stop text like "=..." being treated as a formula
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function readTable_(key) {
  var sh = sheet_(key);
  var headers = TABLES[key].headers;
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  var rows = [];
  for (var r = 0; r < values.length; r++) {
    if (values[r].every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = fromCell_(headers[c], values[r][c]);
    rows.push(obj);
  }
  return rows;
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
    if (h === 'order') return '0';
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

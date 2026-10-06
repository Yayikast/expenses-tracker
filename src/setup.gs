/**
 * setup.gs
 * Run setup() ONCE from the Apps Script editor (Run > setup).
 * It is safe to run again: it only adds what is missing and never deletes your data.
 */

function setup() {
  var ss = ss_();
  ss.setSpreadsheetTimeZone(CONFIG.TIMEZONE);

  Object.keys(TABLES).forEach(function (key) { ensureTab_(key); });

  formatTransactions_();
  formatSmallTab_('categories', { budget: '#,##0', order: '0' }, [140, 90, 60, 90, 90, 60, 80]);
  formatSmallTab_('accounts', { order: '0' }, [140, 90, 120, 60, 80]);
  formatSmallTab_('rules', {}, [220, 120, 90, 150]);

  seed_('categories', DEFAULT_CATEGORIES.map(function (c, i) {
    return { name: c[0], type: c[1], emoji: c[2], color: c[3], budget: c[4], order: i + 1, archived: false };
  }));
  seed_('accounts', DEFAULT_ACCOUNTS.map(function (a, i) {
    return { name: a[0], kind: a[1], default_method: a[2], order: i + 1, archived: false };
  }));
  seed_('rules', DEFAULT_RULES.map(function (r) {
    return { pattern: r[0], category: r[1], match: r[2], updated_at: '' };
  }));

  addValidation_();
  ensureSummaryTab_();
  removeEmptyDefaultTab_();
  pendingFolder_();

  Logger.log('Setup done. Sheet: ' + ss.getUrl());
}

function ensureTab_(key) {
  var ss = ss_();
  var t = TABLES[key];
  var sh = ss.getSheetByName(t.name) || ss.insertSheet(t.name);
  var first = sh.getRange(1, 1, 1, t.headers.length).getValues()[0];
  if (first.join('') === '') {
    sh.getRange(1, 1, 1, t.headers.length).setValues([t.headers]);
  } else {
    ensureHeaders_(key);   // newer columns (e.g. splits) added to an existing tab
  }
  sh.getRange(1, 1, 1, t.headers.length)
    .setFontWeight('bold').setBackground('#F1F3F5').setFontColor('#212529');
  sh.setFrozenRows(1);
  return sh;
}

function formatTransactions_() {
  var sh = sheet_('transactions');
  var h = TABLES.transactions.headers;
  var rows = sh.getMaxRows() - 1;
  // Everything plain text first, so long reference numbers never turn into 2.6E+24
  sh.getRange(2, 1, rows, h.length).setNumberFormat('@');
  sh.getRange(2, h.indexOf('date') + 1, rows, 1).setNumberFormat('yyyy-mm-dd');
  sh.getRange(2, h.indexOf('amount') + 1, rows, 1).setNumberFormat('#,##0.00');
  var widths = [120, 95, 60, 100, 90, 110, 200, 110, 220, 90, 110, 70, 220, 200, 150, 150, 300];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

function formatSmallTab_(key, numberFormats, widths) {
  var sh = sheet_(key);
  var h = TABLES[key].headers;
  var rows = sh.getMaxRows() - 1;
  sh.getRange(2, 1, rows, h.length).setNumberFormat('@');
  Object.keys(numberFormats).forEach(function (col) {
    sh.getRange(2, h.indexOf(col) + 1, rows, 1).setNumberFormat(numberFormats[col]);
  });
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

function seed_(key, objects) {
  if (sheet_(key).getLastRow() >= 2) return; // already has data
  objects.forEach(function (o) { appendRecord_(key, o); });
}

/** Dropdowns in the Sheet, so hand edits stay valid. */
function addValidation_() {
  var ss = ss_();
  var sh = sheet_('transactions');
  var h = TABLES.transactions.headers;
  var rows = sh.getMaxRows() - 1;
  function col(name) { return sh.getRange(2, h.indexOf(name) + 1, rows, 1); }

  col('type').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(TX_TYPES, true).setAllowInvalid(false).build());
  col('method').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(METHODS, true).setAllowInvalid(true).build());
  col('category').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(TABLES.categories.name).getRange('A2:A'), true)
    .setAllowInvalid(true).build());
  col('account').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInRange(ss.getSheetByName(TABLES.accounts.name).getRange('A2:A'), true)
    .setAllowInvalid(true).build());
  col('amount').setDataValidation(SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0).setAllowInvalid(false).build());

  var cat = sheet_('categories');
  cat.getRange(2, 2, cat.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['expense', 'income'], true).build());
}

/** A read-only tab with month x category totals, in case you want to look at the numbers in Sheets. */
function ensureSummaryTab_() {
  var ss = ss_();
  if (ss.getSheetByName('Summary')) return;
  var sh = ss.insertSheet('Summary');
  sh.getRange('A1').setValue('Spending per month by category (updates by itself, do not edit)').setFontWeight('bold');
  sh.getRange('A3').setFormula(
    '=QUERY(Transactions!A2:P, "select year(B), month(B)+1, sum(E) where D = \'expense\' and B is not null ' +
    'group by year(B), month(B)+1 pivot F ' +
    'label year(B) \'Year\', month(B)+1 \'Month\'", 0)'
  );
  sh.setFrozenRows(3);
}

function removeEmptyDefaultTab_() {
  var ss = ss_();
  ['Sheet1', 'แผ่น1', 'Sheet 1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

/**
 * api.gs
 * What the app can do. Called only through doPost() in Code.gs after the session check.
 * (Names ending in _ are private in Apps Script.)
 */

/** Everything the app needs on load, in one round trip. */
function getAppData_() {
  return {
    transactions: readTable_('transactions'),
    categories: readTable_('categories'),
    accounts: readTable_('accounts'),
    rules: readTable_('rules'),
    types: TX_TYPES,
    methods: METHODS,
    links: {
      sheet: ss_().getUrl(),
      folder: 'https://drive.google.com/drive/folders/' + CONFIG.SLIP_FOLDER_ID
    }
  };
}

/** Creates (no id) or updates (with id) a transaction. Returns the saved record. */
function saveTransaction_(input) {
  var tx = cleanTransaction_(input);
  return withLock_(function () {
    if (input.source === 'slip' && tx.slip_ref && !input.allowDuplicate) {
      var dup = findDuplicate_(tx.slip_ref, '', '', '', tx.id);
      if (dup) throw new Error('DUPLICATE: this slip is already saved (' + dup.date + ', ฿' + dup.amount + ').');
    }

    var row = tx.id ? findRowById_('transactions', tx.id) : -1;
    var existing = row > 0 ? readRecordAt_('transactions', row) : null;

    if (input.slipFileId) {
      tx.slip_url = fileSlip_(input.slipFileId, tx);
    } else if (existing) {
      tx.slip_url = existing.slip_url;
    }

    if (existing) {
      tx.created_at = existing.created_at;
      tx.source = existing.source || tx.source;
      if (!tx.slip_ref) tx.slip_ref = existing.slip_ref;
      tx.updated_at = nowString_();
      updateRecord_('transactions', row, tx);
    } else {
      tx.id = newId_();
      tx.created_at = nowString_();
      tx.updated_at = '';
      appendRecord_('transactions', tx);
    }

    if (tx.payee && tx.category && (tx.type === 'expense' || tx.type === 'income')) {
      learnPayee_(tx.payee, tx.category);
    }
    return tx;
  });
}

function deleteTransaction_(id) {
  return withLock_(function () {
    var row = findRowById_('transactions', id);
    if (row < 0) throw new Error('Transaction not found. It may already be deleted.');
    var tx = readRecordAt_('transactions', row);
    sheet_('transactions').deleteRow(row);
    var fileId = fileIdFromUrl_(tx.slip_url);
    if (fileId) {
      try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) { /* already gone */ }
    }
    return id;
  });
}

/**
 * Saves the Settings screen.
 * categories: [{ name, originalName, type, emoji, color, budget, archived }]
 * accounts:   [{ name, kind, default_method, archived }]
 * Renamed categories are also renamed on past transactions.
 */
function saveSettings_(settings) {
  return withLock_(function () {
    var cats = (settings.categories || []).filter(function (c) { return String(c.name || '').trim(); });
    var renames = cats.filter(function (c) { return c.originalName && c.originalName !== c.name; });

    replaceTable_('categories', cats.map(function (c, i) {
      return {
        name: String(c.name).trim(), type: c.type === 'income' ? 'income' : 'expense',
        emoji: c.emoji || '', color: c.color || '#868E96',
        budget: c.budget === '' || c.budget === null ? '' : Math.max(0, Number(c.budget) || 0),
        order: i + 1, archived: !!c.archived
      };
    }));

    var accs = (settings.accounts || []).filter(function (a) { return String(a.name || '').trim(); });
    replaceTable_('accounts', accs.map(function (a, i) {
      return {
        name: String(a.name).trim(), kind: a.kind || 'bank',
        default_method: METHODS.indexOf(a.default_method) >= 0 ? a.default_method : 'PromptPay',
        order: i + 1, archived: !!a.archived
      };
    }));

    if (renames.length) renameCategories_(renames);
    return getAppData_();
  });
}

/* ------------------------------------------------------------------ */

function cleanTransaction_(input) {
  function str(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 200); }
  var type = str(input.type);
  if (TX_TYPES.indexOf(type) < 0) throw new Error('Unknown type: ' + type);

  var amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Amount must be more than 0.');

  var date = str(input.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Date is missing.');
  var time = str(input.time);
  if (time && !/^\d{2}:\d{2}$/.test(time)) time = '';

  var person = str(input.person, 80);
  if (FRIEND_TYPES.indexOf(type) >= 0 && !person) throw new Error('Pick which friend this is for.');

  var category = str(input.category, 60);
  if ((type === 'expense' || type === 'income') && !category) category = 'Other';
  if (type !== 'expense' && type !== 'income') category = '';

  return {
    id: str(input.id, 40),
    date: date,
    time: time,
    type: type,
    amount: amount,
    category: category,
    payee: str(input.payee, 120),
    person: FRIEND_TYPES.indexOf(type) >= 0 ? person : '',
    note: str(input.note, 300),
    method: str(input.method, 30),
    account: str(input.account, 60),
    source: input.source === 'slip' ? 'slip' : 'manual',
    slip_ref: str(input.slip_ref, 80),
    slip_url: '',
    created_at: '',
    updated_at: ''
  };
}

/**
 * Same slip saved before?
 * 1. Reference numbers match (one may be a longer version of the other: QR vs printed)
 * 2. No reference: same date, time and amount
 */
function findDuplicate_(ref, date, time, amount, excludeId) {
  var all = readTable_('transactions');
  ref = String(ref || '').replace(/\s/g, '');
  for (var i = 0; i < all.length; i++) {
    var t = all[i];
    if (excludeId && t.id === excludeId) continue;
    var r = String(t.slip_ref || '');
    if (ref && r && ref.length >= 10 && r.length >= 10 && (r.indexOf(ref) >= 0 || ref.indexOf(r) >= 0)) return t;
  }
  if (!ref && date && time && amount) {
    for (var j = 0; j < all.length; j++) {
      var u = all[j];
      if (u.date === date && u.time === time && Number(u.amount) === Number(amount)) return u;
    }
  }
  return null;
}

/** Remembers payee -> category so the next slip from the same shop is pre-filled. */
function learnPayee_(payee, category) {
  var key = normalizePayee(payee);
  if (!key) return;
  var sh = sheet_('rules');
  var rules = readTable_('rules');
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].match === 'exact' && normalizePayee(rules[i].pattern) === key) {
      if (rules[i].category !== category) {
        sh.getRange(i + 2, 2, 1, 3).setValues([[category, 'exact', nowString_()]]);
      }
      return;
    }
  }
  appendRecord_('rules', { pattern: payee, category: category, match: 'exact', updated_at: nowString_() });
}

function renameCategories_(renames) {
  var sh = sheet_('transactions');
  var last = sh.getLastRow();
  if (last < 2) return;
  var typeCol = TABLES.transactions.headers.indexOf('type') + 1;
  var catCol = TABLES.transactions.headers.indexOf('category') + 1;
  var types = sh.getRange(2, typeCol, last - 1, 1).getValues();
  var catRange = sh.getRange(2, catCol, last - 1, 1);
  var cats = catRange.getValues();
  var changed = false;
  for (var i = 0; i < cats.length; i++) {
    renames.forEach(function (r) {
      var group = r.type === 'income' ? 'income' : 'expense';
      if (cats[i][0] === r.originalName && types[i][0] === group) { cats[i][0] = r.name; changed = true; }
    });
  }
  if (changed) catRange.setValues(cats);

  // keep learned rules pointing at the new name
  var rsh = sheet_('rules');
  var rl = rsh.getLastRow();
  if (rl >= 2) {
    var rr = rsh.getRange(2, 2, rl - 1, 1);
    var rv = rr.getValues();
    renames.forEach(function (r) {
      if (r.type === 'income') return;
      rv.forEach(function (row) { if (row[0] === r.originalName) row[0] = r.name; });
    });
    rr.setValues(rv);
  }
}

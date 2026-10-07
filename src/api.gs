/**
 * api.gs
 * What the app can do. Called only through doPost() in Code.gs after the session check.
 * (Names ending in _ are private in Apps Script.)
 */

/** Everything the app needs on load, in one round trip (4 Sheet reads). */
function getAppData_() {
  return {
    transactions: readTable_('transactions'),
    categories: readTable_('categories'),
    accounts: readTable_('accounts'),
    rules: readTable_('rules'),
    recurring: readRecurring_(),
    types: TX_TYPES,
    methods: METHODS,
    links: {
      sheet: 'https://docs.google.com/spreadsheets/d/' + CONFIG.SHEET_ID + '/edit',  // no extra call to Google
      folder: 'https://drive.google.com/drive/folders/' + CONFIG.SLIP_FOLDER_ID
    }
  };
}

/**
 * Creates (no id) or updates (with id) a transaction. Returns the saved record.
 *
 * Safe to call more than once for the same review card: the app sends a requestId
 * (one per card), and slips also carry their unique pending fileId. If an earlier
 * attempt already saved (for example the reply got lost on a bad connection), this
 * updates that same row instead of adding a second one or reporting a duplicate.
 */
function saveTransaction_(input) {
  var tx = cleanTransaction_(input);
  var requestId = String(input.requestId || '').slice(0, 80);
  return withLock_(function () {
    var earlier = !tx.id ? findEarlierSave_(requestId, input.slipFileId) : null;
    if (earlier) tx.id = earlier.id;

    // Only brand-new slips are checked; editing a saved transaction never counts as a duplicate
    if (!tx.id && input.source === 'slip' && !input.allowDuplicate) {
      var dup = findDuplicate_(tx.slip_ref, '', '', '', tx.id);
      if (dup && dup.match === 'ref') {
        throw codedError_('DUPLICATE', 'This slip is already saved (' + dup.tx.date + ', ฿' + dup.tx.amount + ').', dup.tx);
      }
    }

    if (tx.splits.length || tx.recurring) ensureHeaders_('transactions');
    var row = tx.id ? findRowById_('transactions', tx.id) : -1;
    if (tx.id && row < 0) throw new Error('This transaction no longer exists. It may have been deleted.');
    var existing = row > 0 ? readRecordAt_('transactions', row) : null;

    // Monthly recurring link: an edit that doesn't mention it keeps it; one month = one transaction
    if (tx.recurring === undefined) tx.recurring = existing ? (existing.recurring || '') : '';
    if (tx.recurring) {
      var problem = recurringLinkProblem_(tx.recurring, tx.type);
      if (problem && input.recurring === undefined) tx.recurring = '';   // kept link no longer fits (e.g. changed to expense): unlink
      else if (problem) throw new Error(problem);
    }
    if (tx.recurring) {
      var taken = findRecurringTaken_(tx.recurring, tx.id);
      if (taken) {
        throw codedError_('RECURRING_TAKEN', 'This month is already recorded (' + taken.date + ', ฿' + taken.amount + ').', taken);
      }
    }

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
    rememberSave_(requestId, tx.id);

    if (tx.payee && tx.category && !tx.splits.length && (tx.type === 'expense' || tx.type === 'income')) {
      learnPayee_(tx.payee, tx.category);
    }
    return tx;
  });
}

/** Did an earlier attempt of this same review card already create a row? */
function findEarlierSave_(requestId, slipFileId) {
  if (requestId) {
    var id = CacheService.getScriptCache().get('save_' + requestId);
    if (id) {
      var row = findRowById_('transactions', id);
      if (row > 0) return readRecordAt_('transactions', row);
    }
  }
  if (slipFileId) {
    var all = readTable_('transactions');
    for (var i = 0; i < all.length; i++) {
      if (fileIdFromUrl_(all[i].slip_url) === slipFileId) return all[i];
    }
  }
  return null;
}

function rememberSave_(requestId, txId) {
  if (requestId) CacheService.getScriptCache().put('save_' + requestId, txId, 21600); // 6 hours
}

/** An error the app can recognise by code, optionally carrying data (e.g. the existing transaction). */
function codedError_(code, message, data) {
  var e = new Error(message);
  e.code = code;
  e.data = data || null;
  return e;
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

    if (renames.length) { renameCategories_(renames); renameRecurringCategories_(renames); }
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

  // Split across several categories (expenses only). One part = a normal transaction.
  var splits = cleanSplits_(input.splits, amount);
  if (splits.length === 1) { category = splits[0].category; splits = []; }
  if (splits.length) {
    if (type !== 'expense') throw new Error('Only expenses can be split across categories.');
    category = 'Split';
  }

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
    source: input.source === 'slip' ? 'slip' : input.source === 'recurring' ? 'recurring' : 'manual',
    slip_ref: str(input.slip_ref, 80),
    slip_url: '',
    created_at: '',
    updated_at: '',
    splits: splits,
    recurring: recurringTag_(input.recurring, type)
  };
}

/** "r_ab12cd34ef56:2026-10" links a transaction to one month of a recurring rule (income/expense only). */
function recurringTag_(v, type) {
  if (v === undefined) return undefined;   // not mentioned: an edit keeps the existing link
  var tag = String(v || '').trim();
  if (!tag) return '';
  if (!RECURRING_TAG_RE_.test(tag)) throw new Error('Recurring link is not in the right format.');
  if (type !== 'income' && type !== 'expense') throw new Error('Only income and expenses can be monthly recurring.');
  return tag;
}

/**
 * Checks the category parts of a split bill:
 * every part has a category and an amount above 0, no category twice,
 * and the parts add up EXACTLY to the total (compared in satang, so no rounding slips through).
 */
function cleanSplits_(raw, total) {
  if (!raw || !raw.length) return [];
  if (!Array.isArray(raw)) throw new Error('Category split is not in the right format.');
  if (raw.length > MAX_SPLITS) throw new Error('A bill can be split into at most ' + MAX_SPLITS + ' categories.');
  var seen = {};
  var sum = 0;
  var parts = raw.map(function (p) {
    var category = String(p && p.category || '').trim().slice(0, 60);
    var amount = Math.round(Number(p && p.amount) * 100) / 100;
    if (!category) throw new Error('Pick a category for every part of the split.');
    if (!(amount > 0)) throw new Error('Enter an amount above 0 for ' + category + '.');
    var key = category.toLowerCase();
    if (seen[key]) throw new Error(category + ' is in the split twice.');
    seen[key] = true;
    sum += Math.round(amount * 100);
    return { category: category, amount: amount };
  });
  if (parts.length > 1 && sum !== Math.round(total * 100)) {
    throw new Error('The category amounts add up to ฿' + (sum / 100).toFixed(2) + ' but the total is ฿' + total.toFixed(2) + '.');
  }
  return parts;
}

/**
 * Is this slip already in the Sheet?
 * Returns { match: 'ref' | 'datetime', tx } or null.
 *
 * 'ref'      the bank reference number matches: it IS the same payment.
 *            (The QR reference can be a longer version of the printed one, e.g. Krungsri.)
 * 'datetime' no usable reference, but a transaction with the same date, time and amount
 *            exists: only a POSSIBLE duplicate (two real payments can look like this).
 */
function findDuplicate_(ref, date, time, amount, excludeId) {
  var all = readTable_('transactions');
  if (isUsableRef_(ref)) {
    for (var i = 0; i < all.length; i++) {
      var t = all[i];
      if (excludeId && t.id === excludeId) continue;
      if (isUsableRef_(t.slip_ref) && refsMatch_(ref, t.slip_ref)) return { match: 'ref', tx: t };
    }
    return null;
  }
  if (date && time && amount) {
    for (var j = 0; j < all.length; j++) {
      var u = all[j];
      if (excludeId && u.id === excludeId) continue;
      if (u.date === date && u.time === time && Number(u.amount) === Number(amount)) return { match: 'datetime', tx: u };
    }
  }
  return null;
}

function normalizeRef_(ref) {
  return String(ref || '').replace(/\s/g, '').toUpperCase();
}

/** A real bank reference: long enough and mostly numbers (not a word OCR picked up by mistake). */
function isUsableRef_(ref) {
  var r = normalizeRef_(ref);
  return r.length >= 10 && (r.match(/\d/g) || []).length >= 6;
}

/** Same reference, or one is the start of the other (printed ref vs longer QR ref). */
function refsMatch_(a, b) {
  a = normalizeRef_(a); b = normalizeRef_(b);
  if (a === b) return true;
  var shorter = a.length < b.length ? a : b, longer = a.length < b.length ? b : a;
  return shorter.length >= 16 && longer.indexOf(shorter) === 0;
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

  // ...and inside split bills
  var splitCol = TABLES.transactions.headers.indexOf('splits') + 1;
  if (sh.getLastColumn() >= splitCol) {
    var splitRange = sh.getRange(2, splitCol, last - 1, 1);
    var splitVals = splitRange.getValues();
    var splitChanged = false;
    for (var k = 0; k < splitVals.length; k++) {
      if (!splitVals[k][0]) continue;
      var parts = parseSplits_(splitVals[k][0]);
      parts.forEach(function (p) {
        renames.forEach(function (r) { if (r.type !== 'income' && p.category === r.originalName) { p.category = r.name; splitChanged = true; } });
      });
      splitVals[k][0] = formatSplits_(parts);
    }
    if (splitChanged) splitRange.setValues(splitVals);
  }

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

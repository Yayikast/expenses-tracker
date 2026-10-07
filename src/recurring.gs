/**
 * recurring.gs
 * Monthly recurring income and expenses (e.g. Mom ฿10,000, AIS ฿345).
 *
 * Two layers:
 *   1. The rule (Recurring tab): the DEFAULT amount, category, account...
 *      Its "months" cell holds this-month-only changes: "2026-10: 9000 | 2026-12: skip".
 *   2. Each month: until you mark it received/paid it is only "pending" and is not saved anywhere
 *      (the app works it out from the rule). Marking it creates ONE normal transaction whose
 *      "recurring" column is "<rule id>:<YYYY-MM>". A rule-month can be linked to one transaction only,
 *      so it can never be counted twice.
 */

var RECURRING_TAG_RE_ = /^r_[a-z0-9]{6,20}:\d{4}-(0[1-9]|1[0-2])$/;
var MONTH_RE_ = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The Recurring tab, created the first time it's needed (no need to run setup again). */
function recurringSheet_() {
  var sh = ss_().getSheetByName(TABLES.recurring.name);
  if (sh) return sh;
  sh = ensureTab_('recurring');
  formatSmallTab_('recurring', { amount: '#,##0.00', day: '0', order: '0' },
    [120, 120, 80, 90, 110, 110, 90, 50, 120, 90, 90, 260, 50, 150, 150]);
  return sh;
}

function readRecurring_() {
  if (!ss_().getSheetByName(TABLES.recurring.name)) return [];
  return readTable_('recurring');
}

/** Creates (no id) or updates (with id) a recurring rule. Returns all rules. */
function saveRecurring_(input) {
  var rule = cleanRecurring_(input || {});
  return withLock_(function () {
    recurringSheet_();
    var row = rule.id ? findRowById_('recurring', rule.id) : -1;
    if (rule.id && row < 0) throw new Error('This recurring item no longer exists.');
    if (row > 0) {
      var existing = readRecordAt_('recurring', row);
      rule.months = existing.months;          // month-only changes are edited separately
      rule.order = existing.order;
      rule.created_at = existing.created_at;
      rule.updated_at = nowString_();
      updateRecord_('recurring', row, rule);
    } else {
      rule.id = 'r_' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
      rule.months = {};
      rule.order = readRecurring_().length + 1;
      rule.created_at = nowString_();
      rule.updated_at = '';
      appendRecord_('recurring', rule);
    }
    return readRecurring_();
  });
}

/** Removes a rule. Months already received stay as normal transactions. */
function deleteRecurring_(id) {
  return withLock_(function () {
    if (!ss_().getSheetByName(TABLES.recurring.name)) return [];
    var row = findRowById_('recurring', id);
    if (row > 0) sheet_('recurring').deleteRow(row);
    return readRecurring_();
  });
}

/**
 * Changes ONE month of a rule without touching the default:
 *   value > 0   that month expects this amount instead (e.g. 9000)
 *   'skip'      nothing expected that month
 *   '' / null   back to the default
 */
function setRecurringMonth_(id, month, value) {
  month = String(month || '');
  if (!MONTH_RE_.test(month)) throw new Error('Month is missing.');
  return withLock_(function () {
    var row = ss_().getSheetByName(TABLES.recurring.name) ? findRowById_('recurring', id) : -1;
    if (row < 0) throw new Error('This recurring item no longer exists.');
    var rule = readRecordAt_('recurring', row);
    var months = rule.months || {};
    if (value === 'skip') months[month] = 'skip';
    else if (value === '' || value === null || value === undefined) delete months[month];
    else {
      var n = Math.round(Number(value) * 100) / 100;
      if (!(n > 0)) throw new Error('Amount must be more than 0.');
      months[month] = n;
    }
    rule.months = months;
    rule.updated_at = nowString_();
    updateRecord_('recurring', row, rule);
    return readRecurring_();
  });
}

function cleanRecurring_(input) {
  function str(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 100); }
  var name = str(input.name, 60);
  if (!name) throw new Error('Give it a name, e.g. Mom or AIS.');
  var type = input.type === 'income' ? 'income' : 'expense';
  var amount = Math.round(Number(input.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('Enter the usual monthly amount.');
  var day = Math.round(Number(input.day) || 1);
  day = Math.min(31, Math.max(1, day));
  var start = str(input.start_month, 7);
  if (!MONTH_RE_.test(start)) start = formatDate_(new Date(), 'yyyy-MM');
  var end = str(input.end_month, 7);
  if (end && (!MONTH_RE_.test(end) || end < start)) end = '';
  return {
    id: str(input.id, 40),
    name: name,
    type: type,
    amount: amount,
    category: str(input.category, 60) || 'Other',
    account: str(input.account, 60),
    method: METHODS.indexOf(input.method) >= 0 ? input.method : '',
    day: day,
    match: str(input.match, 60),
    start_month: start,
    end_month: end,
    months: {},
    order: '',
    created_at: '',
    updated_at: ''
  };
}

/** Why this transaction can't hold this link ('' = fine): the rule must exist and be the same kind (income/expense). */
function recurringLinkProblem_(tag, type) {
  var id = String(tag).split(':')[0];
  var rule = readRecurring_().filter(function (r) { return r.id === id; })[0];
  if (!rule) return 'This monthly item no longer exists.';
  if (rule.type !== type) return rule.name + ' is monthly ' + rule.type + ', so it can only be linked to ' + rule.type + '.';
  return '';
}

/** The transaction already holding this rule-month, other than excludeId (or null). */
function findRecurringTaken_(tag, excludeId) {
  var all = readTable_('transactions');
  for (var i = 0; i < all.length; i++) {
    if (all[i].recurring === tag && all[i].id !== excludeId) return all[i];
  }
  return null;
}

/** Category renames reach the recurring rules too. */
function renameRecurringCategories_(renames) {
  if (!ss_().getSheetByName(TABLES.recurring.name)) return;
  var rules = readTable_('recurring');
  rules.forEach(function (r, i) {
    renames.forEach(function (n) {
      if (r.category === n.originalName && r.type === (n.type === 'income' ? 'income' : 'expense')) {
        r.category = n.name;
        updateRecord_('recurring', i + 2, r);
      }
    });
  });
}

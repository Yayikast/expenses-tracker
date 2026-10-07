// Monthly recurring income/expenses on the server.
// Run: node tests/recurring.test.js
const server = require('./fake-apps-script').createServer();
const { ctx, run, sheets } = server;
let fail = 0;
const check = (name, cond, extra) => { if (cond) console.log('ok  ', name); else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const err = code => { try { run(code); return null; } catch (e) { return e; } };

// An existing Sheet from before this update: no Recurring tab, no "recurring" column header
run('setup()');
delete sheets.Recurring;
sheets.Transactions.rows[0] = sheets.Transactions.rows[0].slice(0, 17);
check('no Recurring tab -> empty list, app still loads', JSON.stringify(run('getAppData_()').recurring) === '[]');

ctx.input = { name: 'Mom', type: 'income', amount: '10000', category: 'Allowance', account: 'Bangkok Bank', day: 1, start_month: '2026-09' };
let list = run('saveRecurring_(input)');
check('first rule creates the Recurring tab', !!sheets.Recurring && list.length === 1);
const mom = list[0];
check('rule saved with default amount', /^r_[a-z0-9]{12}$/.test(mom.id) && mom.amount === 10000 && mom.type === 'income' && mom.start_month === '2026-09' && mom.day === 1, mom);
ctx.input = { name: 'AIS', type: 'expense', amount: 345, category: 'Bills', match: 'AIS', day: 16 };
list = run('saveRecurring_(input)');
const ais = list[1];
check('start month defaults to this month', /^\d{4}-\d{2}$/.test(ais.start_month), ais);

// One month only
list = run(`setRecurringMonth_('${mom.id}', '2026-10', 9000)`);
let m = list.find(r => r.id === mom.id);
check('October changed to 9,000; default still 10,000', m.months['2026-10'] === 9000 && m.amount === 10000, m);
check('stored readably in the Sheet', sheets.Recurring.rows[1].includes('2026-10: 9000'), sheets.Recurring.rows[1]);
list = run(`setRecurringMonth_('${mom.id}', '2026-12', 'skip')`);
check('skip a month', list.find(r => r.id === mom.id).months['2026-12'] === 'skip');
list = run(`setRecurringMonth_('${mom.id}', '2026-12', '')`);
m = list.find(r => r.id === mom.id);
check('back to default removes only that month', !('2026-12' in m.months) && m.months['2026-10'] === 9000, m.months);
check('bad month rejected', /Month/.test(err(`setRecurringMonth_('${mom.id}', 'Oct', 5)`).message));

// Editing the default keeps month-only changes
ctx.input = { ...mom, amount: 11000 };
m = run('saveRecurring_(input)').find(r => r.id === mom.id);
check('new default 11,000 keeps October 9,000', m.amount === 11000 && m.months['2026-10'] === 9000, m);

// Mark received -> a normal transaction linked to the month
const tag = mom.id + ':2026-10';
ctx.input = { type: 'income', amount: 9000, date: '2026-10-05', category: 'Allowance', payee: 'Mom', source: 'recurring', recurring: tag };
const t1 = run('saveTransaction_(input)');
check('received month saved as normal income with link', t1.recurring === tag && t1.source === 'recurring' && t1.amount === 9000);
check('column header added to an older Sheet', sheets.Transactions.rows[0][17] === 'recurring');
check('read back with link', run('getAppData_()').transactions.find(t => t.id === t1.id).recurring === tag);

// Same month can't be recorded twice
ctx.input = { type: 'income', amount: 9000, date: '2026-10-06', category: 'Allowance', payee: 'Mom', recurring: tag };
let e = err('saveTransaction_(input)');
check('second link for the same month refused (no double counting)', e && e.code === 'RECURRING_TAKEN' && e.data.id === t1.id, e && e.message);

// Editing without mentioning the link keeps it; explicit '' unlinks
ctx.input = { id: t1.id, type: 'income', amount: 9500, date: '2026-10-05', category: 'Allowance', payee: 'Mom' };
let t2 = run('saveTransaction_(input)');
check('edit keeps the link and source', t2.recurring === tag && t2.amount === 9500 && t2.source === 'recurring', t2);
ctx.input = { id: t1.id, type: 'income', amount: 9500, date: '2026-10-05', category: 'Allowance', payee: 'Mom', recurring: '' };
t2 = run('saveTransaction_(input)');
check('explicit unlink', t2.recurring === '');
ctx.input = { id: t1.id, type: 'income', amount: 9500, date: '2026-10-05', category: 'Allowance', payee: 'Mom', recurring: tag };
check('link again', run('saveTransaction_(input)').recurring === tag);

// Links must fit the rule
ctx.input = { type: 'expense', amount: 50, date: '2026-10-05', category: 'Food', recurring: mom.id + ':2026-11' };
check('income rule cannot be linked to an expense', /only be linked to income/.test((err('saveTransaction_(input)') || {}).message), (err('saveTransaction_(input)') || {}).message);
ctx.input = { type: 'income', amount: 50, date: '2026-10-05', category: 'Other', recurring: 'r_zzzzzzzzzzzz:2026-11' };
check('link to a rule that does not exist refused', /no longer exists/.test((err('saveTransaction_(input)') || {}).message));
ctx.input = { type: 'income', amount: 50, date: '2026-10-05', category: 'Other', recurring: mom.id + ':2026-13' };
check('month 13 refused', /format/.test((err('saveTransaction_(input)') || {}).message));
ctx.input = { id: t1.id, type: 'expense', amount: 9500, date: '2026-10-05', category: 'Food', payee: 'Mom' };
const switched = run('saveTransaction_(input)');
check('changing a linked income to expense unlinks it (month goes back to pending)', switched.recurring === '' && switched.type === 'expense', switched);
ctx.input = { id: t1.id, type: 'income', amount: 9500, date: '2026-10-05', category: 'Allowance', payee: 'Mom', recurring: tag };
check('relink after switching back', run('saveTransaction_(input)').recurring === tag);
ctx.input = { type: 'expense', amount: 12, date: '2026-10-05', category: 'Food', payee: 'New one' };
check('new transaction without a link saves with an empty link', run('saveTransaction_(input)').recurring === '');

// A hand-typed bad month in the Sheet is ignored, not passed to the app
const startCol = server.ctx.TABLES.recurring.headers.indexOf('start_month');
sheets.Recurring.rows[2][startCol] = 'Oct';
check('bad start month read as empty', run('readRecurring_()').find(r => r.id === ais.id).start_month === '');
sheets.Recurring.rows[2][startCol] = '2026-10';

// Validation
ctx.input = { type: 'lend', amount: 50, date: '2026-10-05', person: 'Matt', recurring: tag };
check('friend money cannot be recurring', /income and expenses/.test(err('saveTransaction_(input)').message));
ctx.input = { type: 'expense', amount: 50, date: '2026-10-05', recurring: 'garbage' };
check('bad link rejected', /format/.test(err('saveTransaction_(input)').message));
ctx.input = { name: '', type: 'expense', amount: 5 };
check('rule needs a name', /name/.test(err('saveRecurring_(input)').message));
ctx.input = { name: 'X', type: 'expense', amount: 0 };
check('rule needs an amount', /amount/.test(err('saveRecurring_(input)').message));

// Category rename reaches rules
ctx.settings = { categories: run('readTable_("categories")').map(c => ({ ...c, originalName: c.name, name: c.name === 'Bills' ? 'Bills & phone' : c.name })), accounts: run('readTable_("accounts")') };
run('saveSettings_(settings)');
check('renamed category updates the rule', run('readRecurring_()').find(r => r.id === ais.id).category === 'Bills & phone');

// Delete a rule: received months stay
list = run(`deleteRecurring_('${mom.id}')`);
check('rule deleted', list.length === 1 && list[0].id === ais.id);
check('its received transaction is kept', run('readTable_("transactions")').some(t => t.id === t1.id && t.amount === 9500));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);

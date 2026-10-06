// Runs the Apps Script server code against a fake in-memory Sheet + Drive.
// Run: node tests/server.test.js
const fs = require('fs'), path = require('path');
const server = require('./fake-apps-script').createServer();
const { ctx, run, sheets, files, props, tokens } = server;

let fail = 0;
const check = (name, cond, extra) => { if (cond) console.log('ok  ', name); else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

run('setup()');
check('tabs created', ['Transactions', 'Categories', 'Accounts', 'PayeeRules', 'Summary'].every(n => sheets[n]));
check('11 categories seeded', run('readTable_("categories")').length === 11);
run('setup()');
check('setup twice does not duplicate', run('readTable_("categories")').length === 11);

ctx.input = { type: 'expense', amount: '45.5', category: 'Drink', payee: 'Cha Tra Mue', date: '2026-10-03', time: '14:00', account: 'Cash', method: 'Cash' };
const t1 = run('saveTransaction_(input)');
check('save returns id', /^t_/.test(t1.id));
let all = run('getAppData_()').transactions;
check('read back', all.length === 1 && all[0].amount === 45.5 && all[0].date === '2026-10-03' && all[0].time === '14:00', all[0]);
check('payee learned', run('readTable_("rules")').some(r => r.pattern === 'Cha Tra Mue' && r.match === 'exact' && r.category === 'Drink'));

ctx.input = { ...t1, note: '=HYPERLINK("x")', category: 'Food' };
run('saveTransaction_(input)');
all = run('getAppData_()').transactions;
check('edit in place', all.length === 1 && all[0].note === '=HYPERLINK("x")' && all[0].updated_at, all[0]);
check('rule updated to new category', run('readTable_("rules")').filter(r => r.pattern === 'Cha Tra Mue').length === 1 && run('readTable_("rules")').find(r => r.pattern === 'Cha Tra Mue').category === 'Food');

// slip
server.setOcr(fs.readFileSync(path.join(__dirname, 'fixtures', 'krungsri.tesseract.txt'), 'utf8'));
ctx.payload = { base64: 'x', mimeType: 'image/jpeg', qrText: '0046000600000101030250225KSA00000000951560434407ac5102TH9104F69B' };
const r1 = run('readSlip_(payload)');
check('readSlip draft', r1.draft.amount === 195 && r1.draft.payee === 'LINE MAN' && r1.draft.account === 'Krungsri' && r1.draft.category === 'Food' && !r1.duplicate, r1.draft);
ctx.input = { type: 'expense', amount: r1.draft.amount, category: r1.draft.category, payee: r1.draft.payee, date: r1.draft.date, time: r1.draft.time, account: r1.draft.account, source: 'slip', slip_ref: r1.draft.ref, slipFileId: r1.fileId };
const t2 = run('saveTransaction_(input)');
check('slip filed into month folder', files[r1.fileId].parent === 'ROOT/2026-09' && files[r1.fileId].name === '2026-09-30_2019_195.00_LINE MAN.jpg', files[r1.fileId]);
check('slip_url stored', /\/d\/F/.test(t2.slip_url));
check('long ref stays text', run('getAppData_()').transactions.find(t => t.id === t2.id).slip_ref === 'KSA00000000951560434407ac');

const r2 = run('readSlip_(payload)');
check('duplicate detected on re-upload', r2.duplicate && r2.duplicate.id === t2.id);
ctx.payload2 = { base64: 'x', qrText: '' };
const r3 = run('readSlip_(payload2)');
check('duplicate detected without QR (printed ref)', r3.duplicate && r3.duplicate.id === t2.id, r3.draft.ref);
check('readSlip says the match is by reference', r2.duplicate.match === 'ref' && r3.duplicate.match === 'ref', [r2.duplicate.match, r3.duplicate.match]);

// Same review card sent again (reply lost on a bad connection): must NOT say duplicate, must NOT add a row
const rowsBefore = run('readTable_("transactions")').length;
const again = run('saveTransaction_(input)');
check('resending the same slip card returns the saved row', again.id === t2.id, again);
check('resending the same slip card adds no row', run('readTable_("transactions")').length === rowsBefore);

// A DIFFERENT card (re-uploaded image) for a slip that is really saved: blocked, with the existing row attached
ctx.dupInput = { ...ctx.input, slipFileId: r2.fileId, requestId: 'card-B' };
let threw = null;
try { run('saveTransaction_(dupInput)'); } catch (e) { threw = e; }
check('server blocks a real duplicate', threw && threw.code === 'DUPLICATE' && threw.data && threw.data.id === t2.id, threw && threw.message);
check('blocked duplicate adds no row', run('readTable_("transactions")').length === rowsBefore);
run('discardSlip_("' + r2.fileId + '")');
check('discard trashes pending', files[r2.fileId].trashed === true);
check('discard refuses filed slip', run('discardSlip_("' + r1.fileId + '")') === false && !files[r1.fileId].trashed);

// friends + validation
let err = '';
try { ctx.input = { type: 'lend', amount: 200, date: '2026-10-01' }; run('saveTransaction_(input)'); } catch (e) { err = e.message; }
check('lend needs friend', /friend/.test(err), err);
try { ctx.input = { type: 'expense', amount: 0, date: '2026-10-01' }; run('saveTransaction_(input)'); } catch (e) { err = e.message; }
check('amount > 0', /Amount/.test(err), err);
ctx.input = { type: 'lend', amount: 200, date: '2026-10-01', person: 'Mint', category: 'Food' };
const t3 = run('saveTransaction_(input)');
check('lend saved without category', t3.person === 'Mint' && t3.category === '');

// rename category
ctx.settings = { categories: run('readTable_("categories")').map(c => ({ ...c, originalName: c.name, name: c.name === 'Food' && c.type === 'expense' ? 'Meals' : c.name })), accounts: run('readTable_("accounts")') };
run('saveSettings_(settings)');
all = run('getAppData_()').transactions;
check('rename updates past transactions', all.filter(t => t.category === 'Meals').length === 2 && !all.some(t => t.category === 'Food'), all.map(t => t.category));
check('rename updates rules', run('readTable_("rules")').some(r => r.category === 'Meals') && !run('readTable_("rules")').some(r => r.category === 'Food'));

// delete
run('deleteTransaction_("' + t2.id + '")');
check('delete removes row + trashes slip', run('getAppData_()').transactions.length === 2 && files[r1.fileId].trashed);

// OCR failure path
ctx.Drive.Files.create = () => { throw new Error('Drive is not defined'); };
const r4 = run('readSlip_(payload2)');
check('OCR failure handled', r4.ocrError && r4.fileId && r4.draft.amount === '', r4);

// ---------- Paotang: the amount paid (bottom) is what gets saved ----------
ctx.Drive.Files.create = () => ({ id: server.folders.ROOT.createFile().id });   // OCR working again (an earlier test broke it on purpose)
server.setOcr(fs.readFileSync(path.join(__dirname, 'fixtures', 'paotang.columns.txt'), 'utf8'));
ctx.paoPayload = { base64: 'x', qrText: '' };
const pao = run('readSlip_(paoPayload)');
check('Paotang slip: draft amount is the amount paid', pao.draft.amount === 96.2, pao.draft.amount);
ctx.paoSave = { type: 'expense', amount: pao.draft.amount, date: pao.draft.date, time: pao.draft.time, payee: pao.draft.payee,
  category: pao.draft.category, account: pao.draft.account, note: pao.draft.note, source: 'slip', slip_ref: pao.draft.ref, slipFileId: pao.fileId, requestId: 'card-PAO' };
const paoSaved = run('saveTransaction_(paoSave)');
const paoRow = run('readTable_("transactions")').find(t => t.id === paoSaved.id);
check('Paotang slip: the Sheet row holds the amount paid', paoRow && paoRow.amount === 96.2 && paoRow.account === 'Paotang', paoRow);
run('deleteTransaction_("' + paoSaved.id + '")');

// ---------- Saving: retries, duplicates, edits ----------
const count = () => run('readTable_("transactions")').length;

// Manual save resent with the same requestId (first reply lost) -> same row, latest values
ctx.m1 = { type: 'expense', amount: 80, date: '2026-10-04', time: '12:00', category: 'Food', payee: 'Retry test', requestId: 'card-M1' };
const n0 = count();
const m1 = run('saveTransaction_(m1)');
ctx.m1b = { ...ctx.m1, amount: 85 };
const m1b = run('saveTransaction_(m1b)');
check('manual resend with same requestId updates, not duplicates', m1b.id === m1.id && count() === n0 + 1 && m1b.amount === 85, [m1.id, m1b.id, count() - n0]);
ctx.m2 = { ...ctx.m1, requestId: 'card-M2' };
check('a new card with the same details is a new row (no false block)', run('saveTransaction_(m2)').id !== m1.id && count() === n0 + 2);

// Reference rules
check('word picked up by OCR is not a reference', !run('isUsableRef_("Bankreferenceno")') && !run('isUsableRef_("")'));
check('real references are usable', run('isUsableRef_("KSA00000000951560434")') && run('isUsableRef_("dc6230a7-9828-4e70-b148-a095d7d6c9e3")'));
check('printed ref matches longer QR ref', run('refsMatch_("KSA00000000951560434", "KSA00000000951560434407ac")'));
check('different slips do not match', !run('refsMatch_("2026090615434424004302908", "2026090615434424004302909")'));
check('short ref inside another does not match', !run('refsMatch_("0951560434", "KSA00000000951560434407ac")'));

ctx.g1 = { type: 'expense', amount: 50, date: '2026-10-04', time: '13:00', payee: 'Shop A', source: 'slip', slip_ref: 'Bankreferenceno', requestId: 'card-G1' };
ctx.g2 = { ...ctx.g1, amount: 70, payee: 'Shop B', requestId: 'card-G2' };
run('saveTransaction_(g1)');
let gErr = null; try { run('saveTransaction_(g2)'); } catch (e) { gErr = e; }
check('two slips with a junk "reference" are not treated as the same', !gErr, gErr && gErr.message);

// Same date + time + amount but no reference: only a POSSIBLE duplicate, never blocks
ctx.dt = { type: 'expense', amount: 50, date: '2026-10-04', time: '13:00', payee: 'Shop C', source: 'slip', slip_ref: '', requestId: 'card-DT' };
let dtErr = null; try { run('saveTransaction_(dt)'); } catch (e) { dtErr = e; }
check('same date/time/amount without a reference is not blocked', !dtErr, dtErr && dtErr.message);
const fd = run('findDuplicate_("", "2026-10-04", "13:00", 50, "")');
check('same date/time/amount is reported as only "datetime"', fd && fd.match === 'datetime', fd);

// "Save anyway" really saves
ctx.anyway = { ...ctx.dupInput, requestId: 'card-ANY', allowDuplicate: true };
const nA = count();
check('save anyway adds the row', run('saveTransaction_(anyway)').id && count() === nA + 1);

// Editing a slip transaction that shares a reference with another row is not blocked
ctx.edit = { ...run('readTable_("transactions")').find(t => t.slip_ref === 'KSA00000000951560434407ac'), note: 'edited', source: 'slip' };
let eErr = null; try { run('saveTransaction_(edit)'); } catch (e) { eErr = e; }
check('editing a saved slip is never a duplicate', !eErr, eErr && eErr.message);

// Editing a row that was deleted does not quietly create a new one
ctx.ghost = { id: 't_doesnotexist', type: 'expense', amount: 10, date: '2026-10-04' };
const nG = count();
let ghostErr = null; try { run('saveTransaction_(ghost)'); } catch (e) { ghostErr = e; }
check('editing a deleted row errors instead of adding', ghostErr && count() === nG);

// ---------- API + sign-in ----------
ctx.CONFIG.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
const exp = Math.floor(Date.now() / 1000) + 3600;
tokens.good = { aud: 'client-123.apps.googleusercontent.com', iss: 'https://accounts.google.com', exp: String(exp), email: 'owner@gmail.com', email_verified: 'true', nonce: 'n1' };
tokens.otherUser = { ...tokens.good, email: 'someone@gmail.com' };
tokens.otherApp = { ...tokens.good, aud: 'evil-app.apps.googleusercontent.com' };
tokens.expired = { ...tokens.good, exp: String(Math.floor(Date.now() / 1000) - 10) };
const post = body => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text);

let r = post({ action: 'getAppData', args: [] });
check('no session -> AUTH', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'getAppData', args: [], session: 'x'.repeat(72) });
check('made-up session -> AUTH', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'login', args: [{ idToken: 'otherUser', nonce: 'n1' }] });
check('other Google account rejected', !r.ok && r.code === 'AUTH' && /someone@gmail.com/.test(r.error), r);
r = post({ action: 'login', args: [{ idToken: 'otherApp', nonce: 'n1' }] });
check('token for another app rejected', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'login', args: [{ idToken: 'expired', nonce: 'n1' }] });
check('expired token rejected', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'login', args: [{ idToken: 'good', nonce: 'WRONG' }] });
check('wrong nonce rejected', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'login', args: [{ idToken: 'fake', nonce: 'n1' }] });
check('forged token rejected', !r.ok && r.code === 'AUTH', r);
r = post({ action: 'login', args: [{ idToken: 'good', nonce: 'n1' }] });
check('owner signs in', r.ok && r.result.session.length > 60 && r.result.email === 'owner@gmail.com', r);
const sess = r.result.session;
check('session stored hashed (not raw)', !Object.keys(props).some(k => k.includes(sess)) && Object.keys(props).some(k => k.startsWith('sess_')));
r = post({ action: 'getAppData', args: [], session: sess });
check('API works with session', r.ok && Array.isArray(r.result.transactions) && r.result.user.email === 'owner@gmail.com', r.error);
r = post({ action: 'saveTransaction', args: [{ type: 'expense', amount: 60, date: '2026-10-03', category: 'Food', payee: 'API test' }], session: sess });
check('save through API', r.ok && r.result.id, r);
r = post({ action: 'setup', args: [], session: sess });
check('unknown/private action blocked', !r.ok && r.code === 'BAD_REQUEST', r);
const freshSlip = run('readSlip_(payload2)');
r = post({ action: 'saveTransaction', args: [{ ...ctx.dupInput, slipFileId: freshSlip.fileId, requestId: 'card-API' }], session: sess });
check('duplicate comes back through the API with code + existing row', !r.ok && r.code === 'DUPLICATE' && r.data && r.data.id && /already saved/.test(r.error), r);
r = post({ action: 'saveTransaction', args: [{ type: 'expense', amount: -5, date: '2026-10-03' }], session: sess });
check('validation errors come back as messages', !r.ok && r.code === 'ERROR' && /Amount/.test(r.error), r);
check('bad JSON handled', JSON.parse(ctx.doPost({ postData: { contents: '{nope' } }).text).code === 'BAD_REQUEST');
r = post({ action: 'logout', args: [], session: sess });
r = post({ action: 'getAppData', args: [], session: sess });
check('logout ends session', !r.ok && r.code === 'AUTH');
const s2 = post({ action: 'login', args: [{ idToken: 'good', nonce: 'n1' }] }).result.session;
const s3 = post({ action: 'login', args: [{ idToken: 'good', nonce: 'n1' }] }).result.session;
post({ action: 'logoutAll', args: [], session: s2 });
check('sign out all devices', !post({ action: 'getAppData', args: [], session: s3 }).ok);
const s4 = post({ action: 'login', args: [{ idToken: 'good', nonce: 'n1' }] }).result.session;
const key = Object.keys(props).find(k => k.startsWith('sess_'));
props[key] = JSON.stringify({ ...JSON.parse(props[key]), expires: Date.now() - 1 });
check('expired session rejected', !post({ action: 'getAppData', args: [], session: s4 }).ok);
check('doGet does not expose data', /API is running/.test(ctx.doGet().text));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
process.exit(fail ? 1 : 0);

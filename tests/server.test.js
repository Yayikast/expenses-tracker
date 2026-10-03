// Runs the Apps Script server code against a fake in-memory Sheet + Drive.
// Run: node tests/server.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');

function makeSheet(name) {
  const sh = { name, rows: [], max: 1000 };
  const cell = (r, c) => (sh.rows[r - 1] || [])[c - 1] ?? '';
  const set = (r, c, v) => { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = v; };
  const range = (r, c, nr = 1, nc = 1) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r + i, c + j))),
    setValues: vals => { vals.forEach((row, i) => row.forEach((v, j) => {
      if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
      set(r + i, c + j, v);
    })); return range(r, c, nr, nc); },
    setNumberFormats: () => range(r, c, nr, nc), setNumberFormat: () => range(r, c, nr, nc),
    clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) set(r + i, c + j, ''); },
    createTextFinder: text => ({ matchEntireCell: () => ({ findNext: () => {
      for (let i = 0; i < nr; i++) if (String(cell(r + i, c)) === text) return { getRow: () => r + i };
      return null; } }) }),
    setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setDataValidation() { return this; },
    setValue(v) { set(r, c, v); return this; }, setFormula(v) { set(r, c, v); return this; }
  });
  Object.assign(sh, {
    getName: () => name,
    getRange: (r, c, nr, nc) => typeof r === 'string' ? range(1, 1) : range(r, c, nr, nc),
    getLastRow: () => { for (let i = sh.rows.length; i > 0; i--) if ((sh.rows[i - 1] || []).some(v => v !== '' && v !== undefined)) return i; return 0; },
    getMaxRows: () => sh.max, insertRowsAfter: (a, n) => { sh.max += n; },
    appendRow: row => { set(sh.getLastRow() + 1, 1, row[0]); row.forEach((v, j) => set(sh.getLastRow(), j + 1, v)); },
    deleteRow: r => { sh.rows.splice(r - 1, 1); },
    setFrozenRows() {}, setColumnWidth() {}
  });
  return sh;
}
const sheets = {};
const files = {};
let fileN = 0;
const mkFolder = (id, name) => ({ id, name, getId: () => id, getFoldersByName: n => { const f = folders[id + '/' + n]; return { hasNext: () => !!f, next: () => f }; },
  createFolder: n => (folders[id + '/' + n] = mkFolder(id + '/' + n, n)),
  createFile: blob => { const fid = 'F' + (++fileN) + 'xxxxxxxxxxxxxxxxxxxxxx'; const f = files[fid] = { id: fid, name: '', parent: id, trashed: false,
    getId: () => fid, setName(n) { f.name = n; return f; }, moveTo(folder) { f.parent = folder.getId(); }, getUrl: () => 'https://drive.google.com/file/d/' + fid + '/view',
    setTrashed(t) { f.trashed = t; }, getParents: () => { let done = false; return { hasNext: () => !done, next: () => { done = true; return { getId: () => f.parent }; } }; },
    getBlob: () => ({ getContentType: () => 'image/jpeg', getBytes: () => [1, 2, 3] }) }; return f; } });
const folders = { ROOT: mkFolder('ROOT', 'root') };
let ocrText = '';
const ctx = {
  console,
  SpreadsheetApp: { openById: () => ({
    getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet(n)), getUrl: () => 'https://sheet',
    setSpreadsheetTimeZone() {}, getSheets: () => Object.values(sheets), deleteSheet: s => delete sheets[s.name] }),
    newDataValidation: () => { const b = { requireValueInList: () => b, requireValueInRange: () => b, requireNumberGreaterThan: () => b, setAllowInvalid: () => b, build: () => ({}) }; return b; } },
  DriveApp: { getFolderById: () => folders.ROOT, getFileById: id => files[id] },
  Drive: { Files: { create: () => { const f = folders.ROOT.createFile(); return { id: f.id }; } } },
  DocumentApp: { openById: () => ({ getBody: () => ({ getText: () => ocrText }) }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, str) => Array.from(require('crypto').createHash('sha256').update(str).digest()).map(b => b > 127 ? b - 256 : b),
    formatDate: (d, tz, p) => { const z = n => String(n).padStart(2, '0');
      return p.replace('yyyy', d.getFullYear()).replace('MM', z(d.getMonth() + 1)).replace('dd', z(d.getDate())).replace('HH', z(d.getHours())).replace('mm', z(d.getMinutes())).replace('ss', z(d.getSeconds())); },
    getUuid: () => require('crypto').randomUUID(),
    newBlob: () => ({}), base64Decode: () => [], base64Encode: () => 'AAA'
  },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  Logger: { log() {} }, MimeType: {},
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; },
    getProperties: () => ({ ...props }) }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@gmail.com' }) },
  UrlFetchApp: { fetch: url => { const tok = decodeURIComponent(url.split('id_token=')[1]); const info = tokens[tok];
    return { getResponseCode: () => info ? 200 : 400, getContentText: () => JSON.stringify(info || { error: 'invalid_token' }) }; } }
};
const props = {};
const tokens = {};
vm.createContext(ctx);
for (const f of ['config.gs', 'parsers.gs', 'db.gs', 'api.gs', 'slip.gs', 'setup.gs', 'auth.gs', 'Code.gs'])
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'), ctx, { filename: f });

let fail = 0;
const check = (name, cond, extra) => { if (cond) console.log('ok  ', name); else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const run = code => vm.runInContext(code, ctx);

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
ocrText = fs.readFileSync(path.join(__dirname, 'fixtures', 'krungsri.tesseract.txt'), 'utf8');
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
let threw = '';
try { run('saveTransaction_(input)'); } catch (e) { threw = e.message; }
check('server blocks duplicate save', /^DUPLICATE/.test(threw), threw);
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

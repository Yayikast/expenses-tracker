// A fake Google (Sheets, Drive, Cache, Properties, sign-in check) that runs the real
// Apps Script files from src/ in Node. Used by tests/server.test.js and the browser tests.
const fs = require('fs'), path = require('path'), vm = require('vm');

function createServer() {
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
      getDataRange: () => { const lr = sh.getLastRow(); let lc = 0; sh.rows.slice(0, lr).forEach(row => { for (let j = row.length; j > 0; j--) if (row[j - 1] !== '' && row[j - 1] !== undefined) { lc = Math.max(lc, j); break; } }); return range(1, 1, Math.max(lr, 1), Math.max(lc, 1)); },
      getLastRow: () => { for (let i = sh.rows.length; i > 0; i--) if ((sh.rows[i - 1] || []).some(v => v !== '' && v !== undefined)) return i; return 0; },
      getMaxRows: () => sh.max, insertRowsAfter: (a, n) => { sh.max += n; },
      getLastColumn: () => sh.rows.reduce((m, row) => { for (let j = row.length; j > 0; j--) if (row[j - 1] !== '' && row[j - 1] !== undefined) return Math.max(m, j); return m; }, 0),
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
  const cache = {};
  ctx.CacheService = { getScriptCache: () => ({
    get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); }, remove: k => { delete cache[k]; } }) };
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  const configPath = fs.existsSync(path.join(root, 'src', 'config.gs')) ? path.join(root, 'src', 'config.gs') : path.join(root, 'setup', 'config.example.gs');
  vm.runInContext(fs.readFileSync(configPath, 'utf8'), ctx, { filename: 'config.gs' });
  for (const f of ['parsers.gs', 'db.gs', 'api.gs', 'slip.gs', 'setup.gs', 'auth.gs', 'Code.gs'])
    vm.runInContext(fs.readFileSync(path.join(root, 'src', f), 'utf8'), ctx, { filename: f });
  const run = code => vm.runInContext(code, ctx);
  return {
    ctx, run, sheets, files, folders, props, tokens, cache,
    setOcr: t => { ocrText = t; },
    post: body => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text)
  };
}

module.exports = { createServer };

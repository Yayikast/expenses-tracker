// Fake backend for local preview only. Never pushed to Apps Script.
(function () {
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const d = (y, m, day) => `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const now = new Date();
  const Y = now.getFullYear(), M = now.getMonth() + 1;
  const ym = back => { const x = new Date(Y, M - 1 - back, 1); return [x.getFullYear(), x.getMonth() + 1]; };
  let n = 0;
  const tx = (back, day, type, amount, category, payee, extra = {}) => {
    const [y, m] = ym(back);
    return { id: 't_mock' + (++n), date: d(y, m, Math.min(day, 28)), time: '12:' + String(10 + n % 50), type, amount, category, payee,
      person: '', note: '', method: 'PromptPay', account: 'Krungsri', source: 'manual', slip_ref: '', slip_url: '', created_at: '', updated_at: '', ...extra };
  };
  const seed = [];
  for (let b = 0; b < 7; b++) {
    seed.push(tx(b, 1, 'income', 8000, 'Allowance', 'Mom', { account: 'Bangkok Bank', method: 'Transfer' }));
    for (let k = 0; k < 9 + (b % 3) * 3; k++) seed.push(tx(b, 2 + k * 2, 'expense', [65, 120, 45, 89, 195][k % 5], 'Food', ['LINE MAN', 'ร้านข้าวมันไก่', '7-Eleven'][k % 3]));
    seed.push(tx(b, 5, 'expense', 75, 'Drink', 'Café Amazon'));
    seed.push(tx(b, 9, 'expense', 120 + b * 10, 'Dessert', 'After You'));
    seed.push(tx(b, 12, 'expense', 450 + b * 40, 'Transport', 'Grab', { method: 'Card' }));
    seed.push(tx(b, 16, 'expense', 299, 'Bills', 'AIS Fibre'));
    if (b % 2 === 0) seed.push(tx(b, 20, 'expense', 890, 'Shopping', 'Shopee'));
    if (b % 3 === 0) seed.push(tx(b, 22, 'expense', 240, 'Entertainment', 'Major Cineplex'));
    seed.push(tx(b, 25, 'expense', 150, 'Education', 'Copy shop SIIT', { account: 'Cash', method: 'Cash' }));
  }
  seed.push(tx(0, 3, 'lend', 300, '', '', { person: 'Mint' }));
  seed.push(tx(0, 4, 'lend_return', 100, '', '', { person: 'Mint' }));
  seed.push(tx(1, 10, 'borrow', 150, '', '', { person: 'Ploy' }));
  seed.push(tx(2, 8, 'lend', 200, '', '', { person: 'Beam' }));
  seed.push(tx(2, 18, 'lend_return', 200, '', '', { person: 'Beam' }));

  const db = {
    transactions: seed,
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ name: c[0], type: c[1], emoji: c[2], color: c[3], budget: c[0] === 'Food' ? 1500 : c[0] === 'Shopping' ? 800 : '', order: i + 1, archived: false })),
    accounts: DEFAULT_ACCOUNTS.map((a, i) => ({ name: a[0], kind: a[1], default_method: a[2], order: i + 1, archived: false })),
    rules: DEFAULT_RULES.map(r => ({ pattern: r[0], category: r[1], match: r[2] }))
  };
  const appData = () => JSON.parse(JSON.stringify({ ...db, types: TX_TYPES, methods: METHODS, links: { sheet: '#sheet', folder: '#folder' } }));
  window.__mockLog = [];

  window.__mockApi = async (fn, ...args) => {
    window.__mockLog.push([fn, args]);
    await delay(fn === 'readSlip' ? 700 : 200);
    if (fn === 'getAppData') return appData();
    if (fn === 'saveTransaction') {
      const t = { ...args[0] };
      const norm = r => String(r || '').replace(/\s/g, '').toUpperCase();
      const usable = r => norm(r).length >= 10 && (norm(r).match(/\d/g) || []).length >= 6;
      const same = (a, b) => { a = norm(a); b = norm(b); if (a === b) return true; const s2 = a.length < b.length ? a : b, l = a.length < b.length ? b : a; return s2.length >= 16 && l.indexOf(s2) === 0; };
      // same review card sent again -> same row
      const earlier = !t.id && ((t.requestId && db.transactions.find(x => x._req === t.requestId)) ||
        (t.slipFileId && db.transactions.find(x => String(x.slip_url).includes('/d/' + t.slipFileId))));
      if (earlier) t.id = earlier.id;
      if (!t.id && t.source === 'slip' && usable(t.slip_ref) && !t.allowDuplicate) {
        const ex = db.transactions.find(x => usable(x.slip_ref) && same(x.slip_ref, t.slip_ref));
        if (ex) { const e = new Error('This slip is already saved (' + ex.date + ', ฿' + ex.amount + ').'); e.code = 'DUPLICATE'; e.data = JSON.parse(JSON.stringify(ex)); throw e; }
      }
      if (!t.id) t.id = 't_new' + (++n);
      t.slip_url = t.slipFileId ? 'https://drive.google.com/file/d/' + t.slipFileId + 'xxxxxxxxxxxxxxxxxxxx/view' : (db.transactions.find(x => x.id === t.id) || {}).slip_url || '';
      t._req = t.requestId;
      delete t.slipFileId; delete t.allowDuplicate; delete t.requestId;
      t.created_at = t.created_at || '2026-10-03 15:00:00';
      if (!['expense', 'income'].includes(t.type)) t.category = '';
      const i = db.transactions.findIndex(x => x.id === t.id);
      if (i >= 0) db.transactions[i] = t; else db.transactions.push(t);
      return JSON.parse(JSON.stringify(t));
    }
    if (fn === 'deleteTransaction') { db.transactions = db.transactions.filter(x => x.id !== args[0]); return args[0]; }
    if (fn === 'saveSettings') { db.categories = args[0].categories.filter(c => c.name).map((c, i) => ({ ...c, order: i + 1 })); db.accounts = args[0].accounts.filter(a => a.name); return appData(); }
    if (fn === 'discardSlip') return true;
    if (fn === 'getSlipImage') return window.__lastPreview || '';
    if (fn === 'readSlip') {
      const p = args[0];
      const qr = parseSlipQr(p.qrText);
      const text = qr && qr.bank === 'Krungsri' ? window.__fixtures.krungsri : qr && qr.bank === 'Bangkok Bank' ? window.__fixtures.bangkok : window.__fixtures.paotang;
      const draft = parseSlipText(text, qr);
      draft.category = guessCategory(draft.payee, draft.categoryHint, db.rules);
      const acc = db.accounts.find(a => a.name.toLowerCase() === String(draft.bank).toLowerCase());
      draft.account = acc ? acc.name : ''; draft.method = acc ? acc.default_method : 'PromptPay';
      const nr = r => String(r || '').replace(/\s/g, '').toUpperCase();
      const dupTx = draft.ref && db.transactions.find(x => x.slip_ref && (nr(x.slip_ref) === nr(draft.ref) || nr(x.slip_ref).startsWith(nr(draft.ref)) || nr(draft.ref).startsWith(nr(x.slip_ref))));
      const dup = dupTx ? { match: 'ref', ...dupTx } : null;
      window.__lastPreview = 'data:image/jpeg;base64,' + p.base64;
      return { fileId: 'file' + (++n), draft, duplicate: dup || null, ocrError: '', _qr: p.qrText };
    }
    throw new Error('mock: unknown ' + fn);
  };
})();

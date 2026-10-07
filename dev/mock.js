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
  let seed = [];
  // Monthly recurring sample: Mom ฿10,000 and AIS ฿345, started 3 months ago.
  // Past months are received/paid (linked); this month is still pending (AIS is ฿350 this month only).
  const mk = back => { const [y, m] = ym(back); return `${y}-${String(m).padStart(2, '0')}`; };
  let recurring = [
    { id: 'r_mockmom0001', name: 'Mom', type: 'income', amount: 10000, category: 'Allowance', account: 'Bangkok Bank', method: 'Transfer', day: 1, match: '', start_month: mk(3), end_month: '', months: {}, order: 1 },
    { id: 'r_mockais0001', name: 'AIS', type: 'expense', amount: 345, category: 'Bills', account: 'Krungsri', method: 'PromptPay', day: 16, match: 'AIS', start_month: mk(3), end_month: '', months: { [mk(0)]: 350 }, order: 2 }
  ];
  for (let b = 0; b < 7; b++) {
    if (b === 0) { /* this month: Mom not received yet */ }
    else if (b <= 3) seed.push(tx(b, 1, 'income', b === 2 ? 9000 : 10000, 'Allowance', 'Mom', { account: 'Bangkok Bank', method: 'Transfer', source: 'recurring', recurring: 'r_mockmom0001:' + mk(b) }));
    else seed.push(tx(b, 1, 'income', 8000, 'Allowance', 'Mom', { account: 'Bangkok Bank', method: 'Transfer' }));
    for (let k = 0; k < 9 + (b % 3) * 3; k++) seed.push(tx(b, 2 + k * 2, 'expense', [65, 120, 45, 89, 195][k % 5], 'Food', ['LINE MAN', 'ร้านข้าวมันไก่', '7-Eleven'][k % 3]));
    seed.push(tx(b, 5, 'expense', 75, 'Drink', 'Café Amazon'));
    seed.push(tx(b, 9, 'expense', 120 + b * 10, 'Dessert', 'After You'));
    seed.push(tx(b, 12, 'expense', 450 + b * 40, 'Transport', 'Grab', { method: 'Card' }));
    if (b >= 1 && b <= 3) seed.push(tx(b, 16, 'expense', 345, 'Bills', 'AIS Fibre', { source: 'slip', recurring: 'r_mockais0001:' + mk(b) }));
    else if (b > 3) seed.push(tx(b, 16, 'expense', 299, 'Bills', 'AIS Fibre'));
    if (b % 2 === 0) seed.push(tx(b, 20, 'expense', 890, 'Shopping', 'Shopee'));
    if (b % 3 === 0) seed.push(tx(b, 22, 'expense', 240, 'Entertainment', 'Major Cineplex'));
    seed.push(tx(b, 25, 'expense', 150, 'Education', 'Copy shop SIIT', { account: 'Cash', method: 'Cash' }));
  }
  seed.push(tx(0, 3, 'lend', 300, '', '', { person: 'Mint' }));
  seed.push(tx(0, 4, 'lend_return', 100, '', '', { person: 'Mint' }));
  seed.push(tx(1, 10, 'borrow', 150, '', '', { person: 'Ploy' }));
  seed.push(tx(2, 8, 'lend', 200, '', '', { person: 'Beam' }));
  seed.push(tx(2, 18, 'lend_return', 200, '', '', { person: 'Beam' }));

  /* ---------- QA cases: other states of the screens (preview only, picked from the QA circle) ---------- */
  const QA_CASES = [
    ['sample', 'Sample data', 'Mom pending, AIS pending (฿350 this month only)'],
    ['all-pending', 'Monthly: all pending', 'Nothing received or paid yet this month'],
    ['all-done', 'Monthly: all done', 'Everything paid: no Monthly card on Home'],
    ['skipped', 'Monthly: skipped month', 'Mom skipped + Netflix paid (both hidden), AIS pending'],
    ['overdue', 'Monthly: last month not done', 'Go to last month to see "Was due"'],
    ['ended', 'Monthly: item that ended', 'Gym ended last month (see Settings)'],
    ['many', 'Monthly: many items', '8 items: 4 still to do, 3 paid + 1 skipped (hidden)'],
    ['no-monthly', 'No monthly items', 'No Monthly card on Home'],
    ['overspent', 'Overspent this month', 'Negative savings this month'],
    ['no-friends', 'No friends money', 'No lending or borrowing'],
    ['new-user', 'New user', 'No data at all']
  ];
  let qaCase = 'sample';
  try { qaCase = localStorage.getItem('et_qa_case') || 'sample'; } catch (e) { /* storage blocked */ }
  // #qa-<case>, e.g. #qa-sample (the hash works even when storage is blocked; an old --d<n> suffix is ignored)
  const hm = location.hash.match(/^#qa-([a-z-]+?)(?:--d\d)?$/) || [];
  if (hm[1]) qaCase = hm[1];
  if (!QA_CASES.some(c => c[0] === qaCase)) qaCase = 'sample';
  window.__qa = { cases: QA_CASES, current: qaCase };

  const now0 = mk(0), last = mk(1);
  const mom = () => recurring.find(r => r.id === 'r_mockmom0001');
  const ais = () => recurring.find(r => r.id === 'r_mockais0001');
  const rule = (id, name, type, amount, category, day, start, extra = {}) =>
    ({ id, name, type, amount, category, account: 'Krungsri', method: 'PromptPay', day, match: '', start_month: start, end_month: '', months: {}, order: recurring.length + 1, ...extra });
  const paid = (back, r, amount, day) => tx(back, day || r.day, r.type, amount || r.amount, r.category, r.name, { source: 'recurring', recurring: r.id + ':' + mk(back) });

  if (qaCase === 'all-pending') ais().months = {};
  if (qaCase === 'all-done') {
    seed.push(paid(0, mom(), 10000, 1));
    seed.push(tx(0, 6, 'expense', 350, 'Bills', 'AIS Fibre', { source: 'slip', recurring: ais().id + ':' + now0 }));
  }
  if (qaCase === 'skipped') {
    mom().months = { [now0]: 'skip' };
    const nf = rule('r_mocknetflix', 'Netflix', 'expense', 419, 'Entertainment', 5, mk(2));
    recurring.push(nf);
    [0, 1, 2].forEach(b => seed.push(paid(b, nf)));
  }
  if (qaCase === 'overdue') seed = seed.filter(t => !String(t.recurring || '').endsWith(':' + last));
  if (qaCase === 'ended') {
    const gym = rule('r_mockgym0001', 'Gym', 'expense', 900, 'Other', 3, mk(5), { end_month: last });
    recurring.push(gym);
    [1, 2, 3, 4, 5].forEach(b => seed.push(paid(b, gym)));
  }
  if (qaCase === 'many') {
    const more = [
      rule('r_mockjob0001', 'Part-time job', 'income', 3000, 'Other', 25, mk(2), { account: 'Krungsri' }),
      rule('r_mockscho001', 'Scholarship', 'income', 5000, 'Other', 5, mk(2)),
      rule('r_mockdorm001', 'Dorm rent', 'expense', 4500, 'Bills', 1, mk(2)),
      rule('r_mocknetflix', 'Netflix', 'expense', 419, 'Entertainment', 5, mk(2)),
      rule('r_mockspot001', 'Spotify', 'expense', 69, 'Entertainment', 9, mk(2)),
      rule('r_mockicl0001', 'iCloud', 'expense', 35, 'Other', 12, mk(2), { months: { [now0]: 'skip' } })
    ];
    recurring.push(...more);
    seed.push(paid(0, more[1]), paid(0, more[3]), paid(0, more[4], 89));
    [1, 2].forEach(b => more.forEach(r => seed.push(paid(b, r))));
  }
  if (qaCase === 'no-monthly' || qaCase === 'new-user') {
    recurring = [];
    seed.forEach(t => { delete t.recurring; if (t.source === 'recurring') t.source = 'manual'; });
  }
  if (qaCase === 'overspent') seed.push(tx(0, 6, 'expense', 15900, 'Shopping', 'iStudio', { method: 'Card' }));
  if (qaCase === 'no-friends') seed = seed.filter(t => !['lend', 'lend_return', 'borrow', 'borrow_return'].includes(t.type));
  if (qaCase === 'new-user') seed = [];

  const db = {
    transactions: seed,
    categories: DEFAULT_CATEGORIES.map((c, i) => ({ name: c[0], type: c[1], emoji: c[2], color: c[3], budget: c[0] === 'Food' ? 1500 : c[0] === 'Shopping' ? 800 : '', order: i + 1, archived: false })),
    accounts: DEFAULT_ACCOUNTS.map((a, i) => ({ name: a[0], kind: a[1], default_method: a[2], order: i + 1, archived: false })),
    rules: DEFAULT_RULES.map(r => ({ pattern: r[0], category: r[1], match: r[2] })),
    recurring
  };
  const recList = () => JSON.parse(JSON.stringify(db.recurring));
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
      // split bills: same rules as the server
      const parts = Array.isArray(t.splits) ? t.splits : [];
      if (parts.length === 1) { t.category = parts[0].category; t.splits = []; }
      if (parts.length > 1) {
        const sum = parts.reduce((a, p) => a + Math.round(p.amount * 100), 0);
        if (sum !== Math.round(t.amount * 100)) throw new Error('The category amounts add up to ฿' + (sum / 100).toFixed(2) + ' but the total is ฿' + Number(t.amount).toFixed(2) + '.');
        t.category = 'Split';
      } else t.splits = [];
      // monthly recurring link: edits that don't mention it keep it; one month = one transaction
      const prev = t.id && db.transactions.find(x => x.id === t.id);
      if (prev && t.recurring === undefined) t.recurring = prev.recurring || '';
      const kept = prev && args[0].recurring === undefined;
      t.recurring = ['income', 'expense'].includes(t.type) ? (t.recurring || '') : '';
      if (t.recurring) {
        const rule = db.recurring.find(r => r.id === t.recurring.split(':')[0]);
        const problem = !rule ? 'This monthly item no longer exists.' : rule.type !== t.type ? `${rule.name} is monthly ${rule.type}, so it can only be linked to ${rule.type}.` : '';
        if (problem && kept) t.recurring = ''; else if (problem) throw new Error(problem);
      }
      if (t.recurring) {
        const taken = db.transactions.find(x => x.recurring === t.recurring && x.id !== t.id);
        if (taken) { const e = new Error('This month is already recorded (' + taken.date + ', ฿' + taken.amount + ').'); e.code = 'RECURRING_TAKEN'; e.data = JSON.parse(JSON.stringify(taken)); throw e; }
      }
      if (prev) t.source = prev.source || t.source;
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
    if (fn === 'saveRecurring') {
      const r = { ...args[0] };
      if (!String(r.name || '').trim()) throw new Error('Give it a name, e.g. Mom or AIS.');
      if (!(Number(r.amount) > 0)) throw new Error('Enter the usual monthly amount.');
      r.amount = Math.round(Number(r.amount) * 100) / 100;
      r.start_month = /^\d{4}-\d{2}$/.test(r.start_month || '') ? r.start_month : mk(0);
      const i = db.recurring.findIndex(x => x.id === r.id);
      if (i >= 0) db.recurring[i] = { ...db.recurring[i], ...r, months: db.recurring[i].months };
      else db.recurring.push({ ...r, id: 'r_new' + String(++n).padStart(8, '0'), months: {}, order: db.recurring.length + 1 });
      return recList();
    }
    if (fn === 'deleteRecurring') { db.recurring = db.recurring.filter(x => x.id !== args[0]); return recList(); }
    if (fn === 'setRecurringMonth') {
      const [id, month, v] = args;
      const r = db.recurring.find(x => x.id === id);
      if (!r) throw new Error('This recurring item no longer exists.');
      r.months = { ...(r.months || {}) };
      if (v === 'skip') r.months[month] = 'skip'; else if (v === '' || v == null) delete r.months[month]; else r.months[month] = Math.round(Number(v) * 100) / 100;
      return recList();
    }
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

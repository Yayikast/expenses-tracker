(() => {
'use strict';
/* =====================================================================
 * Expenses Tracker – front end
 * Talks to the Apps Script functions in api.gs / slip.gs.
 * ===================================================================== */

/* ---------- Server calls ---------- */
const CFG = window.APP_CONFIG || {};
const SESSION_KEY = 'et_session';
const auth = {
  get() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  clear() { try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
};

class ApiError extends Error {
  constructor(message, code, data) { super(message); this.code = code; this.data = data || null; }
}

/** True when we don't know if the server finished (connection dropped / reply lost). */
const isUnknownOutcome = err => err && (err.code === 'NETWORK' || err.code === 'BAD_REPLY');

/**
 * Requests that are safe to send twice. saveTransaction counts only when it carries a
 * requestId: the server then updates the same row instead of adding another one.
 */
function canRetry(action, args) {
  if (action === 'saveTransaction') return !!(args[0] && args[0].requestId);
  if (action === 'saveRecurring') return !!(args[0] && args[0].id);   // editing is safe to repeat, adding isn't
  return ['getAppData', 'getSlipImage', 'discardSlip', 'setRecurringMonth', 'deleteRecurring'].includes(action);
}

async function api(action, ...args) {
  if (window.__mockApi) return window.__mockApi(action, ...args); // local preview only
  const s = auth.get();
  const body = JSON.stringify({ action, args, session: s && s.session });
  let data = null, lastProblem = '';
  // Google sometimes sends a one-off odd reply. Try twice, but only for requests that are safe to repeat.
  const attempts = canRetry(action, args) ? 2 : 1;
  for (let attempt = 1; attempt <= attempts && !data; attempt++) {
    let res;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        // text/plain keeps this a "simple" request, so Apps Script doesn't need CORS preflight
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body,
        credentials: 'omit',
        cache: 'no-store'
      });
    } catch (e) {
      lastProblem = 'network';
      if (attempt === attempts) throw new ApiError("Can't reach the server. Check your internet and try again.", 'NETWORK');
      await new Promise(r => setTimeout(r, 800));
      continue;
    }
    const text = await res.text();
    try { data = JSON.parse(text); } catch (e) {
      const snippet = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      lastProblem = `HTTP ${res.status}${snippet ? ': ' + snippet : ''}`;
      console.warn('[api] unexpected reply', action, res.status, res.url, text.slice(0, 500));
      if (attempt < attempts) await new Promise(r => setTimeout(r, 800));
    }
  }
  if (!data) throw new ApiError(`The server sent an unexpected reply (${lastProblem}). Tap Try again; if it keeps happening, send this message to whoever set up the app.`, 'BAD_REPLY');
  if (!data.ok) {
    if (data.code === 'AUTH' && action !== 'login') { auth.clear(); clearCachedData(); showLogin(data.error); }
    throw new ApiError(data.error || 'Something went wrong', data.code, data.data);
  }
  return data.result;
}

/* ---------- Sign in with Google (redirect flow, works in home-screen apps too) ---------- */
function randomString() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
}

function redirectUri() {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

function startGoogleSignIn() {
  const state = randomString(), nonce = randomString();
  try { sessionStorage.setItem('et_oauth', JSON.stringify({ state, nonce })); } catch (e) { /* ignore */ }
  try { localStorage.setItem('et_oauth', JSON.stringify({ state, nonce })); } catch (e) { /* ignore */ }
  const params = new URLSearchParams({
    client_id: CFG.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'id_token',
    scope: 'openid email',
    nonce, state,
    prompt: 'select_account'   // always show the account chooser
  });
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

/** After Google sends us back: #id_token=...&state=... */
async function finishGoogleSignIn() {
  if (!location.hash || !/id_token=|error=/.test(location.hash)) return false;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem('et_oauth') || localStorage.getItem('et_oauth') || 'null'); } catch (e) { /* ignore */ }
  try { sessionStorage.removeItem('et_oauth'); localStorage.removeItem('et_oauth'); } catch (e) { /* ignore */ }

  if (p.get('error')) { showLogin(p.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Google sign-in failed: ' + p.get('error')); return true; }
  if (!saved || saved.state !== p.get('state')) { showLogin('Sign-in expired. Please try again.'); return true; }

  showLogin('', true);
  try {
    const r = await api('login', { idToken: p.get('id_token'), nonce: saved.nonce });
    clearCachedData();   // fresh sign-in: never show someone else's old data
    auth.set(r);
    return false; // continue normal start
  } catch (err) {
    showLogin(err.message);
    return true;
  }
}

function showLogin(message, busy) {
  $('#app').hidden = true;
  const el = $('#login');
  el.hidden = false;
  el.innerHTML = `
    <div class="login-card">
      <img class="login-icon" src="icon.svg" alt="">
      <h1>Expenses</h1>
      <p class="muted">Your slips, spending and friends' IOUs in one place.</p>
      ${message ? `<div class="banner danger">${esc(message)}</div>` : ''}
      ${busy ? `<div class="loading"><div class="spinner"></div>Signing you in…</div>` : `
      <button class="google-btn" id="google-btn">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        Sign in with Google
      </button>
      <p class="small muted">Only the owner's Google account can open this app.</p>`}
    </div>`;
  const b = $('#google-btn');
  if (b) b.addEventListener('click', startGoogleSignIn);
}

function hideLogin() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

/* ---------- Small helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad2 = n => String(n).padStart(2, '0');
const store = {
  get(k, d) { try { const v = localStorage.getItem('et_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('et_' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};

/* ---------- Light / Dark / System (saved on this device only) ---------- */
const THEMES = ['system', 'light', 'dark'];
function getTheme() { const t = store.get('theme', 'system'); return THEMES.includes(t) ? t : 'system'; }
function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  // Phone status bar color follows the choice too
  $$('meta[name="theme-color"]').forEach(m => {
    if (!m.dataset.orig) m.dataset.orig = m.content;
    m.content = t === 'light' ? '#F5F4F0' : t === 'dark' ? '#111112' : m.dataset.orig;
  });
}
function setTheme(t) {
  store.set('theme', t);
  applyTheme(t);
  render();   // charts and icons read colors when drawn, so redraw the screen
}

/* ---------- Libraries, loaded only when needed ---------- */
const CHART_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const JSQR_URL = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
const loadingScripts = {};
function loadScript(url) {
  if (!loadingScripts[url]) {
    loadingScripts[url] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url;
      el.async = true;
      el.onload = resolve;
      el.onerror = () => { delete loadingScripts[url]; reject(new Error('Could not load ' + url)); };
      document.head.appendChild(el);
    });
  }
  return loadingScripts[url];
}
/** Charts draw as soon as Chart.js arrives; the rest of the screen doesn't wait for it. */
let chartsWaiting = false;
function loadCharts() {
  if (window.Chart || chartsWaiting) return;
  chartsWaiting = true;
  loadScript(CHART_URL).then(() => {
    // draw whatever Home shows now (the Spending card may be on another period)
    if (S.data && S.view === 'home') { drawDonut(catShown); drawBars(S.month); }
  }).catch(() => { chartsWaiting = false; /* charts are optional; numbers and lists still show */ });
}
/** The QR reader is only needed when scanning slips. */
const loadJsQr = () => (window.jsQR ? Promise.resolve() : loadScript(JSQR_URL));

/* ---------- Local copy of your data, so the app opens instantly ---------- */
// Shown straight away on the next open, then replaced by fresh data from Google.
// Kept only on this device and removed when you sign out.
const DATA_KEY = 'et_data_v1';
let localWrites = 0;      // changes made in this session (used to avoid overwriting them with older data)
function readCachedData() {
  try { const d = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); return d && Array.isArray(d.transactions) ? d : null; } catch (e) { return null; }
}
function persistData() {
  try { if (S.data) localStorage.setItem(DATA_KEY, JSON.stringify(S.data)); } catch (e) { /* storage full or blocked: app still works */ }
}
function clearCachedData() {
  try { localStorage.removeItem(DATA_KEY); } catch (e) { /* ignore */ }
}
/** Call after any change you make (save, delete, settings) so the local copy stays in step. */
function noteLocalChange() { localWrites++; persistData(); }

function money(n, opts = {}) {
  const v = Math.abs(Number(n) || 0);
  const hasSatang = Math.round(v * 100) % 100 !== 0;
  const s = v.toLocaleString('en-US', { minimumFractionDigits: hasSatang ? 2 : 0, maximumFractionDigits: 2 });
  return (opts.sign || '') + '฿' + s;
}
function today() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function nowTime() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function monthOf(date) { return String(date || '').slice(0, 7); }
function thisMonth() { return monthOf(today()); }
function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "2026-10" -> "Oct 2026" */
function monthShortYear(key) { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${y}`; }
function monthLabel(key, short) {
  const [y, m] = key.split('-').map(Number);
  return short ? MONTHS[m - 1].slice(0, 3) + (short === 'y' ? ' ' + String(y).slice(2) : '') : `${MONTHS[m - 1]} ${y}`;
}
function dayLabel(date) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (date === today()) return 'Today';
  const yest = new Date(); yest.setDate(yest.getDate() - 1);
  if (dt.toDateString() === yest.toDateString()) return 'Yesterday';
  // Same month names as the rest of the app ("Sep", not the phone's "Sept")
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()];
  return `${wd}, ${d} ${MONTHS[m - 1].slice(0, 3)}${y === new Date().getFullYear() ? '' : ' ' + y}`;
}

/* ---------- Transaction types ---------- */
const TYPE = {
  expense:       { label: 'Expense',            sign: '-', short: 'Expense' },
  income:        { label: 'Income',             sign: '+', short: 'Income' },
  transfer:      { label: 'Transfer',           sign: '',  short: 'Transfer' },
  lend:          { label: 'Lent to',            sign: '-', short: 'I lent',         help: 'You gave a friend money' },
  lend_return:   { label: 'Paid back by',       sign: '+', short: 'They paid back', help: 'A friend returned your money' },
  borrow:        { label: 'Borrowed from',      sign: '+', short: 'I borrowed',     help: 'A friend gave you money' },
  borrow_return: { label: 'Paid back to',       sign: '-', short: 'I paid back',    help: 'You returned a friend\'s money' }
};
const FRIEND_TYPES = ['lend', 'lend_return', 'borrow', 'borrow_return'];
const isFriend = t => FRIEND_TYPES.includes(t);
const groupOf = t => isFriend(t) ? 'friend' : t;

/* ---------- App state ---------- */
const S = {
  data: null,
  view: 'home',
  month: thisMonth(),
  hist: { q: '', type: 'all', month: 'all', cat: '' },
  charts: {}
};

function txs() { return S.data ? S.data.transactions : []; }
function activeCats(type) {
  return (S.data.categories || []).filter(c => c.type === type && !c.archived)
    .sort((a, b) => (a.order || 0) - (b.order || 0));
}
function catInfo(name, type) {
  const c = (S.data.categories || []).find(c => c.name === name && c.type === (type === 'income' ? 'income' : 'expense'));
  return c || { name: name || 'Other', emoji: '📦', color: '#868E96' };
}
function activeAccounts() {
  return (S.data.accounts || []).filter(a => !a.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
}
/** The parts of a split bill, or null for a normal one-category transaction. */
function splitsOf(t) {
  return t && Array.isArray(t.splits) && t.splits.length > 1 ? t.splits : null;
}
/** Biggest part first: decides the icon and the "Food + 2 more" label. */
function mainSplit(t) {
  const parts = splitsOf(t);
  return parts ? parts.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a)) : null;
}
/** How much of a transaction counts as spending in one category (the whole amount if no category is given). */
function spentIn(t, cat) {
  const parts = splitsOf(t);
  if (!cat || !parts) return Number(t.amount) || 0;
  const p = parts.find(x => x.category === cat);
  return p ? Number(p.amount) || 0 : 0;
}
/** All categories a transaction belongs to. */
function categoriesOf(t) {
  const parts = splitsOf(t);
  return parts ? parts.map(p => p.category) : (t.category ? [t.category] : []);
}

function txIcon(t) {
  if (isFriend(t.type)) {
    // green: I lent, red: I borrowed, gray: a payback
    if (t.type === 'lend_return' || t.type === 'borrow_return') return { emoji: '🤝', color: '#868E96' };
    const v = t.type === 'lend' ? '--owed-me' : '--i-owe';
    return { emoji: '🤝', color: getComputedStyle(document.documentElement).getPropertyValue(v).trim() || (t.type === 'lend' ? '#2B8A3E' : '#E03131') };
  }
  if (t.type === 'transfer') return { emoji: '🔁', color: '#868E96' };
  const main = mainSplit(t);
  const c = catInfo(main ? main.category : t.category, t.type);
  return { emoji: c.emoji || '📦', color: c.color || '#868E96' };
}
function txTitle(t) {
  if (isFriend(t.type)) return `${TYPE[t.type].label} ${t.person}`;
  if (t.type === 'transfer') return t.payee || 'Transfer';
  return t.payee || t.category || TYPE[t.type].label;
}
function sortTx(list) {
  return list.slice().sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || String(b.created_at).localeCompare(String(a.created_at)));
}
function people() {
  const seen = new Map();
  sortTx(txs()).forEach(t => { if (t.person && !seen.has(norm(t.person))) seen.set(norm(t.person), t.person); });
  return Array.from(seen.values());
}
function payees() {
  const seen = new Map();
  sortTx(txs()).forEach(t => { if (t.payee && !seen.has(norm(t.payee))) seen.set(norm(t.payee), t.payee); });
  return Array.from(seen.values()).slice(0, 300);
}
function guessCategory(payee) {
  const p = norm(payee);
  if (!p) return '';
  const rules = S.data.rules || [];
  let r = rules.find(r => r.match === 'exact' && norm(r.pattern) === p);
  if (!r) r = rules.find(r => r.match !== 'exact' && norm(r.pattern) && p.includes(norm(r.pattern)));
  return r ? r.category : '';
}
function learnLocally(t) {
  if (!t.payee || !t.category || splitsOf(t) || !['expense', 'income'].includes(t.type)) return;
  const rules = S.data.rules || (S.data.rules = []);
  const r = rules.find(r => r.match === 'exact' && norm(r.pattern) === norm(t.payee));
  if (r) r.category = t.category; else rules.push({ pattern: t.payee, category: t.category, match: 'exact' });
}

/*
 * Friend balances: ONE net number per friend, worked out from every lend/borrow record with them.
 *   lend           I gave them money      -> they owe me more   (+)
 *   lend_return    they paid me back      -> they owe me less   (-)
 *   borrow         they gave me money     -> I owe them more    (-)
 *   borrow_return  I paid them back       -> I owe them less    (+)
 * net > 0: they owe me net.  net < 0: I owe them -net.  net = 0: settled.
 * Each record is added exactly once, in whole satang, so 50 borrowed and 20 lent is exactly "I owe 30".
 * The records themselves are never changed; only this summary is netted.
 */
const FRIEND_SIGN = { lend: 1, lend_return: -1, borrow: -1, borrow_return: 1 };
function friendBalances() {
  const map = new Map();
  txs().forEach(t => {
    if (!FRIEND_SIGN[t.type] || !String(t.person || '').trim()) return;
    const k = norm(t.person);
    const p = map.get(k) || { name: String(t.person).trim(), net: 0, last: '' };
    p.net += FRIEND_SIGN[t.type] * Math.round((Number(t.amount) || 0) * 100);
    if (String(t.date || '') > p.last) p.last = String(t.date);
    map.set(k, p);
  });
  const list = Array.from(map.values()).map(p => {
    const net = p.net / 100;
    return {
      name: p.name, last: p.last, net,
      status: net > 0 ? 'owes_you' : net < 0 ? 'you_owe' : 'settled',
      owesYou: Math.max(0, net),       // what they still owe me (0 if not)
      youOwe: Math.max(0, -net)        // what I still owe them (0 if not)
    };
  });
  const sum = key => Math.round(list.reduce((s, p) => s + p[key] * 100, 0)) / 100;
  return {
    list: list.sort((a, b) => b.last.localeCompare(a.last)),
    owesYou: sum('owesYou'),   // total of friends whose net balance says they owe me
    youOwe: sum('youOwe')      // total of friends whose net balance says I owe them
  };
}
function friendStatusText(p) {
  if (p.status === 'owes_you') return `<span class="t-lend">Owes you ${money(p.owesYou)}</span>`;
  if (p.status === 'you_owe') return `<span class="t-borrow">You owe ${money(p.youOwe)}</span>`;
  return `<span>Settled — ${money(0)}</span>`;
}

/* =====================================================================
 * Monthly recurring (e.g. Mom ฿10,000 income, AIS ฿345 bill)
 *
 * A rule holds the DEFAULT. Each month it is:
 *   pending  expected, NOT counted anywhere yet (only worked out here, never saved)
 *   done     a normal transaction exists whose `recurring` is "<rule id>:<YYYY-MM>" (counted like any other)
 *   skipped  nothing expected this month
 * rule.months holds this-month-only changes: { '2026-10': 9000, '2026-12': 'skip' }.
 * ===================================================================== */
/** "r_x:2026-10" -> "Mom · October 2026" */
function recLabel(tag) {
  const [id, month] = String(tag).split(':');
  const r = recRules().find(x => x.id === id);
  return `${r ? r.name : 'Monthly item'} · ${month ? monthLabel(month) : ''}`;
}
function recRules() { return (S.data && S.data.recurring) || []; }
const recTag = (r, month) => r.id + ':' + month;
function recActive(r, month) { return !!r.start_month && r.start_month <= month && (!r.end_month || month <= r.end_month); }
function recLinks() { const m = new Map(); txs().forEach(t => { if (t.recurring) m.set(t.recurring, t); }); return m; }
function recItem(r, month, links = recLinks()) {
  const tag = recTag(r, month);
  const tx = links.get(tag) || null;
  const mv = (r.months || {})[month];
  const custom = typeof mv === 'number';
  return {
    rule: r, month, tag, tx,
    status: tx ? 'done' : mv === 'skip' ? 'skipped' : 'pending',
    amount: tx ? Number(tx.amount) : custom ? mv : Number(r.amount),
    custom
  };
}
function recItems(month) {
  const links = recLinks();
  return recRules().filter(r => recActive(r, month))
    .sort((a, b) => (a.type === b.type ? 0 : a.type === 'income' ? -1 : 1) || (a.order || 0) - (b.order || 0))
    .map(r => recItem(r, month, links));
}
/** The rule's usual day in that month (31 -> 30 in a 30-day month). */
function recDueDate(r, month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${month}-${pad2(Math.min(Number(r.day) || 1, last))}`;
}
const recDoneWord = r => r.type === 'income' ? 'Received' : 'Paid';
function shortDate(date) { const [, m, d] = date.split('-').map(Number); return `${d} ${MONTHS[m - 1].slice(0, 3)}`; }

/** Which pending rule-month a new transaction probably is (same type and month, payee matches). */
function recSuggestion(type, date, payee) {
  if (!['income', 'expense'].includes(type) || !/^\d{4}-\d{2}/.test(date || '')) return null;
  const p = norm(payee);
  if (p.length < 2) return null;
  const month = monthOf(date);
  const links = recLinks();
  for (const r of recRules()) {
    if (r.type !== type || !recActive(r, month) || links.has(recTag(r, month))) continue;
    const m = norm(r.match || r.name);
    if (m && (p.includes(m) || (p.length >= 3 && m.includes(p)))) return { rule: r, month, tag: recTag(r, month) };
  }
  return null;
}

/** Mark a month received/paid: creates one normal transaction linked to that month. */
async function recConfirm(item, amount, btn) {
  const r = item.rule;
  const acc = activeAccounts().find(a => a.name === r.account);
  const payload = {
    type: r.type, amount, category: r.category || 'Other', payee: r.name,
    date: item.month === thisMonth() ? today() : recDueDate(r, item.month), time: '',
    account: r.account || '', method: r.method || (acc && acc.default_method) || 'Transfer',
    note: '', source: 'recurring', recurring: item.tag, requestId: 'r_' + randomString()
  };
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    const saved = await api('saveTransaction', payload);
    upsertTx(saved);
    toast(`${r.name}: ${recDoneWord(r).toLowerCase()} ${money(saved.amount)}`);
    render();
    return saved;
  } catch (err) {
    if (err.code === 'RECURRING_TAKEN' && err.data) { upsertTx(err.data); render(); toast('Already recorded for this month'); return err.data; }
    toast(err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = label; }
    return null;
  }
}

/** Back to pending: removes a transaction made by "Received", or just unlinks a slip you added yourself. */
async function recUndo(item) {
  const t = item.tx;
  if (!t) return;
  if (t.source === 'recurring') {
    await api('deleteTransaction', t.id);
    S.data.transactions = S.data.transactions.filter(x => x.id !== t.id);
    noteLocalChange();
  } else {
    const saved = await api('saveTransaction', { ...t, recurring: '' });
    upsertTx(saved);
  }
  render();
}

async function recSetMonth(rule, month, value) {
  S.data.recurring = await api('setRecurringMonth', rule.id, month, value);
  noteLocalChange();
  render();
}

/** One rule in one month: change this month's amount, mark received/paid, skip, undo. */
function openRecItem(ruleId, month) {
  const rule = recRules().find(r => r.id === ruleId);
  if (!rule) return;
  const sheet = openSheet({ title: `${rule.name} · ${monthLabel(month)}`, body: '', foot: '' });
  const word = recDoneWord(rule);

  function draw() {
    const r = recRules().find(x => x.id === ruleId) || rule;
    const it = recItem(r, month);
    const cls = r.type === 'income' ? 't-income' : '';
    let html = '', foot = '';
    const mon = monthLabel(month, true);
    if (it.status === 'done') {
      const t = it.tx;
      html = `
        <div class="detail-amt"><div class="big num ${cls}">${money(t.amount)}</div><div class="rec-chip done">✓ ${word} ${esc(shortDate(t.date))}</div></div>
        <div class="card">
          <div class="kv"><span>Default</span><b>${money(r.amount)} / month</b></div>
          ${t.account ? `<div class="kv"><span>Account</span><b>${esc(t.account)}</b></div>` : ''}
          <div class="kv"><span>Counted in</span><b>${monthLabel(month)} ${r.type === 'income' ? 'income' : 'spending'}</b></div>
        </div>`;
      foot = `<button class="btn" data-ri="undo">Undo</button><button class="btn btn-primary" data-ri="open">Open transaction</button>`;
    } else {
      const skipped = it.status === 'skipped';
      const cands = skipped ? [] : txs().filter(t => t.type === r.type && !t.recurring && monthOf(t.date) === month &&
        norm(t.payee).includes(norm(r.match || r.name))).slice(0, 3);
      html = `
        <div class="rec-chip ${skipped ? 'skipped' : 'pending'}" style="margin:0 auto 12px">${skipped ? 'Skipped this month' : 'Pending · not counted yet'}</div>
        ${skipped ? '' : `
        <div class="field">
          <label for="ri-amount">Amount for ${mon} only</label>
          <div class="amount-field" id="ri-wrap"><span class="cur">฿</span><input id="ri-amount" inputmode="decimal" value="${esc(String(it.amount))}" autocomplete="off"></div>
          <div class="small muted" style="text-align:center">Usually ${money(r.amount)}/month${it.custom ? ` · <button class="link-btn" data-ri="reset">Reset</button>` : ''}</div>
        </div>
        <button class="btn btn-block" data-ri="save-amount" hidden>Save ${mon} amount</button>`}
        ${cands.length ? `<div class="card" style="margin-top:12px"><h3>Already added it?</h3>
          <div class="small muted" style="margin:-6px 0 6px">Link it instead, so it isn't counted twice.</div>
          ${cands.map(t => `<div class="rec-cand"><span>${esc(t.payee)} · ${esc(shortDate(t.date))}</span><b class="num">${money(t.amount)}</b><button class="btn btn-sm" data-ri-link="${esc(t.id)}">Link</button></div>`).join('')}</div>` : ''}`;
      foot = skipped
        ? `<button class="btn btn-primary" data-ri="unskip">Don't skip ${mon}</button>`
        : `<button class="btn" data-ri="skip">Skip ${mon}</button><button class="btn btn-primary" data-ri="done">${word} ${money(it.amount)}</button>`;
    }
    html += `<button class="link-btn" data-ri="rule" style="display:block;margin:14px auto 0">Edit default (${money(r.amount)}/month) →</button>`;
    sheet.setBody(html);
    sheet.setFoot(foot);
    sizeAmount($('#ri-amount', sheet.body));
  }

  const amountNow = () => Number(String(($('#ri-amount', sheet.body) || {}).value || '').replace(/,/g, ''));
  sheet.body.addEventListener('input', e => {
    if (e.target.id !== 'ri-amount') return;
    e.target.value = e.target.value.replace(/[^\d.,]/g, '');
    sizeAmount(e.target);
    const r = recRules().find(x => x.id === ruleId) || rule;
    const it = recItem(r, month);
    const v = amountNow();
    $('[data-ri="save-amount"]', sheet.body).hidden = !(v > 0) || v === it.amount;
    const done = $('[data-ri="done"]', sheet.foot);
    done.disabled = !(v > 0);
    done.textContent = v > 0 ? `${word} ${money(v)}` : 'Enter an amount';
  });
  const onClick = async e => {
    const b = e.target.closest('[data-ri], [data-ri-link]');
    if (!b) return;
    const r = recRules().find(x => x.id === ruleId) || rule;
    const it = recItem(r, month);
    const act = b.dataset.ri;
    const busy = label => { b.disabled = true; b.textContent = label; };
    try {
      if (b.dataset.riLink) {
        busy('Linking…');
        const t = txs().find(x => x.id === b.dataset.riLink);
        upsertTx(await api('saveTransaction', { ...t, recurring: it.tag }));
        toast(`Linked to ${r.name} ${monthLabel(month, true)}`);
        render(); return draw();
      }
      if (act === 'rule') { sheet.close(); return openRuleEditor(r); }
      if (act === 'open') { sheet.close(); return openDetail(it.tx.id); }
      if (act === 'undo') {
        if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Tap again to undo'; return; }
        busy('Undoing…'); await recUndo(it); toast('Back to pending'); return draw();
      }
      if (act === 'done') {
        const v = amountNow();
        if (!(v > 0)) return;
        if (await recConfirm(it, v, b)) draw();
        return;
      }
      if (act === 'save-amount') {
        const v = amountNow();
        busy('Saving…');
        await recSetMonth(r, month, v === Number(r.amount) ? '' : v);
        toast(`${monthLabel(month, true)} set to ${money(v)}`);
        return draw();
      }
      if (act === 'reset') { busy('Saving…'); await recSetMonth(r, month, ''); return draw(); }
      if (act === 'skip') { busy('Saving…'); await recSetMonth(r, month, 'skip'); toast(`Skipped ${monthLabel(month, true)}`); return draw(); }
      if (act === 'unskip') { busy('Saving…'); await recSetMonth(r, month, ''); return draw(); }
    } catch (err) {
      toast(err.message, true);
      draw();
    }
  };
  sheet.body.addEventListener('click', onClick);
  sheet.foot.addEventListener('click', onClick);
  draw();
}

/** Add or edit a recurring rule (the default). */
function openRuleEditor(rule) {
  const isEdit = !!(rule && rule.id);
  const accounts = activeAccounts();
  const f = {
    type: (rule && rule.type) || 'expense',
    name: (rule && rule.name) || '',
    amount: rule && rule.amount ? String(rule.amount) : '',
    category: (rule && rule.category) || '',
    account: rule ? (rule.account || '') : ((accounts[0] || {}).name || ''),
    day: (rule && rule.day) || 1,
    start_month: (rule && rule.start_month) || thisMonth(),
    end_month: (rule && rule.end_month) || '',
    match: (rule && rule.match) || ''
  };
  let confirmDelete = false;
  const sheet = openSheet({
    title: isEdit ? 'Edit monthly item' : 'New monthly item', body: '',
    foot: `${isEdit ? '<button class="btn btn-danger" data-rd>Delete</button>' : ''}<button class="btn btn-primary" data-rs>Save</button>`
  });
  // Start month: this month or up to 2 years back (to fill in past months)
  const startChoices = Array.from({ length: 25 }, (_, i) => addMonths(thisMonth(), -i));
  if (!startChoices.includes(f.start_month)) startChoices.push(f.start_month);

  // Last month (inclusive): from the start month up to 3 years ahead
  function endChoices() {
    const list = [];
    for (let m = f.start_month; m <= addMonths(thisMonth(), 36); m = addMonths(m, 1)) list.push(m);
    if (f.end_month && !list.includes(f.end_month)) list.push(f.end_month);
    return list;
  }

  function draw() {
    const cats = activeCats(f.type);
    if (f.category && !cats.some(c => c.name === f.category)) cats.push({ ...catInfo(f.category, f.type), name: f.category });
    sheet.setBody(`
      <div class="segmented">
        <button type="button" class="${f.type === 'income' ? 'is-on' : ''}" data-rt="income">Income</button>
        <button type="button" class="${f.type === 'expense' ? 'is-on' : ''}" data-rt="expense">Expense</button>
      </div>
      <div class="field"><label for="r-name">Name</label>
        <input class="input" id="r-name" value="${esc(f.name)}" placeholder="${f.type === 'income' ? 'e.g. Mom' : 'e.g. AIS'}" autocomplete="off"></div>
      <div class="field"><label for="r-amount">Usual amount per month</label>
        <div class="amount-field" id="r-wrap"><span class="cur">฿</span><input id="r-amount" inputmode="decimal" placeholder="0" value="${esc(f.amount)}" autocomplete="off"></div>
        ${isEdit ? `<div class="small muted" style="text-align:center">Applies to this month (if not received yet) and future months. Months already ${f.type === 'income' ? 'received' : 'paid'} keep their amount.</div>` : ''}
      </div>
      <div class="field"><span class="label">Category</span>
        <div class="cat-grid">${cats.map(c => `<button type="button" class="cat-pick ${f.category === c.name ? 'is-on' : ''}" data-rc="${esc(c.name)}"><span class="e">${esc(c.emoji || '📦')}</span>${esc(c.name)}</button>`).join('')}</div>
      </div>
      <div class="two">
        <div class="field"><label for="r-account">Account</label>
          <select class="input" id="r-account">
            ${accounts.map(a => `<option ${f.account === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
            <option value="" ${!f.account ? 'selected' : ''}>None</option>
          </select></div>
        <div class="field"><label for="r-day">Usually on day</label>
          <select class="input" id="r-day">${Array.from({ length: 31 }, (_, i) => `<option ${Number(f.day) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></div>
      </div>
      <div class="two">
        <div class="field"><label for="r-start">Starts from</label>
          <select class="input" id="r-start">${startChoices.map(m => `<option value="${m}" ${f.start_month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div>
        <div class="field"><label for="r-end">Last month</label>
          <select class="input" id="r-end">
            <option value="" ${!f.end_month ? 'selected' : ''}>No end</option>
            ${endChoices().map(m => `<option value="${m}" ${f.end_month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
          </select></div>
      </div>
      <div class="field"><label for="r-match">Slips that count as this <span class="label-hint">optional</span></label>
        <input class="input" id="r-match" value="${esc(f.match)}" placeholder="Name on the slip, e.g. ${f.type === 'income' ? 'Mom' : 'AIS'}" autocomplete="off"></div>
      ${isEdit && recActive(rule, thisMonth()) ? (() => {
        const it = recItem(rule, thisMonth());
        const st = it.status === 'done' ? `✓ ${recDoneWord(rule)} ${money(it.amount)}` : it.status === 'skipped' ? 'Skipped' : `Pending ${money(it.amount)}`;
        return `<button type="button" class="link-row" data-rmonth>📅 <span>${monthLabel(thisMonth())} <span class="small muted">· ${esc(st)}</span></span><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`;
      })() : ''}
      <div id="r-error"></div>`);
    sizeAmount($('#r-amount', sheet.body));
  }

  sheet.body.addEventListener('input', e => {
    if (e.target.id === 'r-name') f.name = e.target.value;
    if (e.target.id === 'r-amount') { e.target.value = e.target.value.replace(/[^\d.,]/g, ''); f.amount = e.target.value; sizeAmount(e.target); }
    if (e.target.id === 'r-match') f.match = e.target.value;
  });
  sheet.body.addEventListener('change', e => {
    if (e.target.id === 'r-account') f.account = e.target.value;
    if (e.target.id === 'r-day') f.day = Number(e.target.value);
    if (e.target.id === 'r-start') {
      f.start_month = e.target.value;
      if (f.end_month && f.end_month < f.start_month) f.end_month = '';
      draw();
    }
    if (e.target.id === 'r-end') { f.end_month = e.target.value; draw(); }
  });
  sheet.body.addEventListener('click', e => {
    const t = e.target.closest('[data-rt]');
    if (t && t.dataset.rt !== f.type) { f.type = t.dataset.rt; f.category = ''; return draw(); }
    if (e.target.closest('[data-rmonth]')) { sheet.close(); return openRecItem(rule.id, thisMonth()); }
    const c = e.target.closest('[data-rc]');
    if (c) { f.category = c.dataset.rc; $$('[data-rc]', sheet.body).forEach(b => b.classList.toggle('is-on', b === c)); return; }
  });
  $('[data-rs]', sheet.foot).addEventListener('click', async e => {
    const btn = e.currentTarget;
    const amount = Number(String(f.amount).replace(/,/g, ''));
    const err = msg => { $('#r-error', sheet.body).innerHTML = `<div class="banner danger">${esc(msg)}</div>`; };
    if (!f.name.trim()) return err('Give it a name, e.g. Mom or AIS.');
    if (!(amount > 0)) return err('Enter the usual monthly amount.');
    if (!f.category) return err('Pick a category.');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const acc = accounts.find(a => a.name === f.account);
      S.data.recurring = await api('saveRecurring', {
        id: isEdit ? rule.id : '', name: f.name.trim(), type: f.type, amount, category: f.category,
        account: f.account, method: (acc && acc.default_method) || '', day: f.day,
        start_month: f.start_month, end_month: f.end_month, match: f.match.trim()
      });
      noteLocalChange();
      toast(isEdit ? 'Saved' : `Added ${f.name.trim()}`);
      sheet.close();
      render();
    } catch (ex) {
      err(ex.message);
      btn.disabled = false; btn.textContent = 'Save';
    }
  });
  const del = $('[data-rd]', sheet.foot);
  if (del) del.addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!confirmDelete) { confirmDelete = true; btn.textContent = 'Tap again to delete'; return; }
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      S.data.recurring = await api('deleteRecurring', rule.id);
      noteLocalChange();
      toast(`Deleted. Months already ${f.type === 'income' ? 'received' : 'paid'} stay in your history.`);
      sheet.close();
      render();
    } catch (ex) { toast(ex.message, true); btn.disabled = false; btn.textContent = 'Delete'; confirmDelete = false; }
  });
  draw();
  if (!isEdit) setTimeout(() => { const n = $('#r-name', sheet.body); if (n) n.focus(); }, 280);
}

/* ---------- Savings: received income − expenses, per month (never a transaction) ---------- */
function savingsHistory() {
  const months = new Set(txs().filter(t => t.type === 'income' || t.type === 'expense').map(t => monthOf(t.date)).filter(m => m && m <= thisMonth()));
  months.add(thisMonth());
  const list = Array.from(months).sort().map(m => {
    const t = monthTotals(m);
    return { month: m, income: t.income, spent: t.spent, saved: Math.round((t.income - t.spent) * 100) / 100 };
  });
  let run = 0;
  list.forEach(x => { run = Math.round((run + x.saved) * 100) / 100; x.total = run; });
  return { list, total: run };
}
const savedMoney = v => (v < 0 ? '-' : '') + money(v);           // same minus sign as the rest of the app
const savedClass = v => v < 0 ? 't-over' : v > 0 ? 't-income' : '';
function savedText(v) { return `<span class="${savedClass(v)}">${savedMoney(v)}</span>`; }
function openSavings() {
  const h = savingsHistory();
  const sheet = openSheet({
    title: 'Savings',
    body: `
      <div class="card net-card"><span>Total saved</span><b class="num ${savedClass(h.total)}">${savedMoney(h.total)}</b></div>
      <div class="card"><div class="tx-list">${h.list.slice().reverse().map(x => `
        <button class="tx" data-sv="${x.month}">
          <span class="tx-main"><span class="tx-title">${monthLabel(x.month)}</span>
            <span class="tx-sub">In ${money(x.income)} · Out ${money(x.spent)} · Total ${savedMoney(x.total)}</span></span>
          <span class="tx-amt num">${savedText(x.saved)}</span>
        </button>`).join('')}</div></div>`
  });
  sheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-sv]');
    if (!b) return;
    S.month = b.dataset.sv;
    sheet.close();
    go('home');
  });
}

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 4200 : 2200);
}

/* =====================================================================
 * Navigation
 * ===================================================================== */
function go(view) {
  S.view = view;
  $$('.tab[data-view]').forEach(b => b.classList.toggle('is-active', b.dataset.view === view));
  $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + view; });
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (!S.data) return;
  ({ home: renderHome, history: renderHistory, friends: renderFriends, settings: renderSettings })[S.view]();
}

/* =====================================================================
 * Home / dashboard
 * ===================================================================== */
function monthTotals(key) {
  let spent = 0, income = 0;
  const byCat = new Map();
  txs().forEach(t => {
    if (monthOf(t.date) !== key) return;
    const a = Number(t.amount) || 0;
    if (t.type === 'expense') {
      spent += a;
      const parts = splitsOf(t);
      if (parts) parts.forEach(p => byCat.set(p.category, (byCat.get(p.category) || 0) + (Number(p.amount) || 0)));
      else byCat.set(t.category || 'Other', (byCat.get(t.category || 'Other') || 0) + a);
    } else if (t.type === 'income') income += a;
  });
  // Whole satang, so 100.30 - (50.10 + 50.20) is exactly 0, not -0.00000000000001
  const r2 = v => Math.round(v * 100) / 100;
  byCat.forEach((v, k) => byCat.set(k, r2(v)));
  return { spent: r2(spent), income: r2(income), byCat };
}

const CAT_TOP = 5;
let catsOpen = false;   // "Spending by category": showing all categories?

/* ---------- Spending by category, for a chosen period ---------- */
// kind: 'month' (follows the month at the top) | '3' | '12' (ending at that month) | 'all' | 'custom'
let catPeriod = { kind: 'month', from: '', to: '' };
// A list, not an object: number-like keys ('3', '12') would otherwise jump to the front
const PERIOD_LIST = [['month', 'This month'], ['3', 'Last 3 months'], ['12', 'Last 12 months'], ['all', 'All time'], ['custom', 'Custom']];
const PERIODS = Object.fromEntries(PERIOD_LIST);
let catShown = null;   // totals the donut is drawing
function monthsBetween(from, to) { const out = []; for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m); return out; }
function firstExpenseMonth() {
  let first = thisMonth();
  txs().forEach(t => { if (t.type === 'expense' && t.date && monthOf(t.date) < first) first = monthOf(t.date); });
  return first;
}
function catRange() {
  const end = S.month, p = catPeriod;
  if (p.kind === '3') return [addMonths(end, -2), end];
  if (p.kind === '12') return [addMonths(end, -11), end];
  if (p.kind === 'all') return [firstExpenseMonth(), thisMonth()];
  if (p.kind === 'custom') {
    const from = p.from || `${end.slice(0, 4)}-01`, to = p.to || end;
    return from <= to ? [from, to] : [to, from];
  }
  return [end, end];
}
function rangeLabel(from, to) {
  if (from === to) return monthLabel(from);
  const [fy] = from.split('-'), [ty] = to.split('-');
  return fy === ty ? `${monthLabel(from, true)} – ${monthShortYear(to)}` : `${monthShortYear(from)} – ${monthShortYear(to)}`;
}
function catCardHtml() {
  const [from, to] = catRange();
  const months = monthsBetween(from, to);
  const n = months.length;
  const tot = { spent: 0, byCat: new Map() };
  months.forEach(m => {
    const t = monthTotals(m);
    tot.spent += t.spent;
    t.byCat.forEach((v, k) => tot.byCat.set(k, (tot.byCat.get(k) || 0) + v));
  });
  tot.spent = Math.round(tot.spent * 100) / 100;
  catShown = tot;

  const rows = Array.from(tot.byCat.entries()).sort((a, b) => b[1] - a[1]).map(([name, amt]) => {
    const c = catInfo(name, 'expense');
    const pct = tot.spent ? Math.round(amt / tot.spent * 100) : 0;
    const budget = (Number(c.budget) || 0) * n;   // monthly budget × months in the period
    // The bar is always this category's share of the spending (same as the %).
    // Budget progress is only in the line underneath, which turns red when over.
    let note = '';
    if (budget > 0) {
      const over = amt > budget;
      note = `<div class="budget-note ${over ? 'over' : ''}">${money(amt)} of ${money(budget)} budget${over ? ` · ${money(amt - budget)} over` : ` · ${money(budget - amt)} left`}</div>`;
    }
    return `<li class="cat-row">
      <div class="cat-row-top">
        <span class="cat-emoji" style="background:${c.color}22">${esc(c.emoji || '📦')}</span>
        <span class="cat-name">${esc(name)}</span>
        <span class="cat-amt num">${money(amt)}</span>
        <span class="cat-pct num">${pct}%</span>
      </div>
      <div class="bar"><i style="width:${tot.spent ? amt / tot.spent * 100 : 0}%;background:${c.color}"></i></div>${note}
    </li>`;
  });
  // Budgeted categories with nothing spent in the period
  const unspent = activeCats('expense').filter(c => Number(c.budget) > 0 && !tot.byCat.has(c.name)).map(c => `
    <li class="cat-row">
      <div class="cat-row-top">
        <span class="cat-emoji" style="background:${c.color}22">${esc(c.emoji)}</span>
        <span class="cat-name">${esc(c.name)}</span><span class="cat-amt num">฿0</span><span class="cat-pct num">0%</span>
      </div>
      <div class="bar"><i style="width:0"></i></div>
      <div class="budget-note">${money(0)} of ${money(Number(c.budget) * n)} budget</div>
    </li>`);
  // Biggest 5 first; the rest are tucked behind "View more"
  const items = rows.concat(unspent).map((li, i) => i < CAT_TOP ? li : li.replace('<li class="cat-row">', '<li class="cat-row cat-extra">'));

  // Tap the period to pick from a list (bottom sheet); the average shows for longer periods
  const head = `<div class="card-head"><h3>Spending</h3><button class="link-btn period-link" data-act="period-sheet" aria-label="Change period">${catPeriod.kind === 'month' ? monthLabel(from) : rangeLabel(from, to)} ›</button></div>
      ${n > 1 && tot.spent > 0 ? `<div class="cat-range"><span>${catPeriod.kind === '3' || catPeriod.kind === '12' ? PERIODS[catPeriod.kind] : n + ' months'}</span><span>avg <b class="num">${money(Math.round(tot.spent / n))}</b>/month</span></div>` : ''}`;
  return `
    ${head}
    ${tot.spent > 0 ? `
    <div class="donut-wrap">
      <canvas id="donut"></canvas>
      <div class="donut-center"><div><b class="num">${money(tot.spent)}</b><span>${tot.byCat.size} ${tot.byCat.size === 1 ? 'category' : 'categories'}</span></div></div>
    </div>` : `<div class="small muted cat-empty">No spending in ${n > 1 ? 'this period' : monthLabel(from)}.</div>`}
    <ul class="cat-list ${catsOpen ? 'is-open' : ''}">${items.join('')}</ul>
    ${items.length > CAT_TOP ? `<button class="more-btn" data-act="cats-more">${catsOpen ? 'Show less' : `View more (${items.length - CAT_TOP})`}</button>` : ''}`;
}
/** Pick the period for the Spending card from a list; Custom shows From/To months. */
function openPeriodSheet() {
  const sheet = openSheet({ title: 'Show spending for', body: '' });
  function draw() {
    const saved = catPeriod;
    const row = k => {
      catPeriod = { ...saved, kind: k };
      const [f, t] = catRange();
      catPeriod = saved;
      const sub = k === 'month' ? monthLabel(f) : k === 'custom' ? 'Pick the months' : rangeLabel(f, t);
      return `<button class="period-row ${saved.kind === k ? 'is-on' : ''}" data-psel="${k}"><span><b>${PERIODS[k]}</b><small>${sub}</small></span>${saved.kind === k ? '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>' : ''}</button>`;
    };
    const [from, to] = catRange();
    const choices = monthsBetween(addMonths(thisMonth(), -24) < firstExpenseMonth() ? addMonths(thisMonth(), -24) : firstExpenseMonth(), thisMonth()).reverse();
    sheet.setBody(`<div class="card period-list">${PERIOD_LIST.map(p => p[0]).map(row).join('')}</div>
      ${saved.kind === 'custom' ? `<div class="two">
        <div class="field"><label for="ps-from">From</label><select class="input" id="ps-from">${choices.map(m => `<option value="${m}" ${m === from ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div>
        <div class="field"><label for="ps-to">To</label><select class="input" id="ps-to">${choices.map(m => `<option value="${m}" ${m === to ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></div>
      </div>` : ''}`);
    sheet.setFoot(saved.kind === 'custom' ? `<button class="btn btn-primary" data-pdone>Show ${rangeLabel(from, to)}</button>` : '');
  }
  sheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-psel]');
    if (!b) return;
    catPeriod = { ...catPeriod, kind: b.dataset.psel };
    catsOpen = false;
    refreshCatCard();
    if (b.dataset.psel === 'custom') draw(); else sheet.close();
  });
  sheet.body.addEventListener('change', e => {
    if (e.target.id !== 'ps-from' && e.target.id !== 'ps-to') return;
    let [from, to] = catRange();
    if (e.target.id === 'ps-from') { from = e.target.value; if (from > to) to = from; } else { to = e.target.value; if (to < from) from = to; }
    catPeriod = { kind: 'custom', from, to };
    refreshCatCard();
    draw();
  });
  sheet.foot.addEventListener('click', e => { if (e.target.closest('[data-pdone]')) sheet.close(); });
  draw();
}

/** Redraw only the category card (keeps your place on the page). */
function refreshCatCard() {
  const card = $('#cat-card');
  if (!card) return;
  card.innerHTML = catCardHtml();
  drawDonut(catShown);
}
function renderHome() {
  const el = $('#view-home');
  const key = S.month;
  const cur = monthTotals(key);
  const prev = monthTotals(addMonths(key, -1));
  const fb = friendBalances();
  const monthTx = sortTx(txs().filter(t => monthOf(t.date) === key));
  const isLatest = key >= thisMonth();

  let delta = '';
  if (prev.spent > 0 && cur.spent > 0) {
    const pct = Math.round((cur.spent - prev.spent) / prev.spent * 100);
    const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
    delta = `<span class="delta ${cls}">${pct > 0 ? '▲' : pct < 0 ? '▼' : '='} ${Math.abs(pct)}% vs ${monthLabel(addMonths(key, -1), true)}</span>`;
  }

  const friendsCard = (fb.owesYou > 0 || fb.youOwe > 0) ? `
    <button class="card friends-mini" data-go="friends">
      <span class="fm-ico">🤝</span>
      <span class="fm-text">
        ${fb.owesYou > 0 ? `Friends owe you <b class="t-lend num">${money(fb.owesYou)}</b>` : ''}
        ${fb.owesYou > 0 && fb.youOwe > 0 ? '<br>' : ''}
        ${fb.youOwe > 0 ? `You owe friends <b class="t-borrow num">${money(fb.youOwe)}</b>` : ''}
      </span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </button>` : '';

  const empty = !monthTx.length;

  // Monthly recurring for this month: pending ones are shown but not counted
  const items = recItems(key).filter(it => it.status === 'pending');   // only what's still to receive/pay
  const recRow = it => {
    const r = it.rule, c = catInfo(r.category, r.type);
    const sub = `${key < thisMonth() ? 'Was due' : 'Due'} ${shortDate(recDueDate(r, key))}`;
    return `<div class="rec-row" data-rec="${esc(r.id)}">
      <span class="tx-ico" style="background:${c.color || '#868E96'}22">${esc(c.emoji || '🔁')}</span>
      <span class="tx-main"><span class="tx-title">${esc(r.name)}</span><span class="tx-sub">${esc(sub)}${it.custom ? `<br>Usually ${money(r.amount)}` : ''}</span></span>
      <span class="rec-amt num">${r.type === 'income' ? '+' : '-'}${money(it.amount)}</span>
      <button class="btn btn-sm rec-btn" data-rec-done="${esc(r.id)}">${recDoneWord(r)}</button>
    </div>`;
  };
  const recCard = items.length ? `
    <div class="card">
      <div class="card-head"><h3>Monthly</h3><button class="link-btn" data-act="add-rule">+ Add</button></div>
      <div class="rec-list">${items.map(recRow).join('')}</div>
    </div>` : '';

  const sv = savingsHistory();
  const hasMoney = txs().some(t => t.type === 'income' || t.type === 'expense');

  // How much of this month's income is spent (same numbers as Left over: received income only)
  let spendBar = '';
  if (cur.income > 0 || cur.spent > 0) {
    const used = cur.income > 0 ? cur.spent / cur.income * 100 : 100;
    const over = cur.spent > cur.income;   // same moment Left over turns orange
    const color = over ? 'var(--lend)' : 'var(--accent)';
    const note = cur.income <= 0 ? (key === thisMonth() ? 'No income received yet this month' : `No income received in ${monthLabel(key, true)}`)
      : used > 100 ? `${money(cur.spent - cur.income)} more than your income`
      : `${money(cur.spent)} of ${money(cur.income)} income`;
    spendBar = `
      <div class="spend-bar" role="img" aria-label="${Math.round(used)}% of income spent"><i style="width:${Math.min(100, used)}%;background:${color}"></i></div>
      <div class="spend-note ${over ? 'over' : ''}"><span>${note}</span>${cur.income > 0 ? `<span class="num">${Math.round(used)}%</span>` : ''}</div>`;
  }

  el.innerHTML = `
    <div class="month-switch">
      <button class="icon-btn" data-month="-1" aria-label="Previous month"><svg viewBox="0 0 24 24"><path d="m15 6-6 6 6 6"/></svg></button>
      <h2>${monthLabel(key)}</h2>
      <button class="icon-btn" data-month="1" aria-label="Next month" ${isLatest ? 'disabled' : ''}><svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>
    </div>

    <div class="card hero">
      <div class="label">Spent in ${monthLabel(key, true)}</div>
      <div class="big num">${money(cur.spent)}</div>
      ${delta}
      ${spendBar}
      <div class="hero-row">
        <div><span>Income</span><b class="num t-income">${money(cur.income)}</b></div>
        <button class="hero-tile" data-act="savings"><span>Left over</span><b class="num ${savedClass(cur.income - cur.spent)}">${savedMoney(cur.income - cur.spent)}</b>${hasMoney ? `<small>Total ${savedMoney(sv.total)} ›</small>` : ''}</button>
      </div>

    </div>

    ${recCard}
    ${friendsCard}

    ${empty ? `
      <div class="card empty">
        <span class="big-emoji">🧾</span>
        Nothing in ${monthLabel(key)} yet.
        <div class="empty-actions">
          <button class="btn btn-primary btn-sm" data-act="scan">📷 Scan slips</button>
          <button class="btn btn-sm" data-act="manual">Add manually</button>
        </div>
      </div>` : ''}

    ${txs().some(t => t.type === 'expense') || activeCats('expense').some(c => Number(c.budget) > 0) ? `<div class="card" id="cat-card">${catCardHtml()}</div>` : ''}

    <div class="card">
      <div class="card-head"><h3>Spending per month</h3><span class="small muted">tap a bar</span></div>
      <div class="chart-box"><canvas id="bars"></canvas></div>
    </div>

    ${!empty ? `
    <div class="card">
      <div class="card-head"><h3>Recent</h3><button class="link-btn" data-act="see-month">See all</button></div>
      <div class="tx-list">${monthTx.slice(0, 6).map(txRow).join('')}</div>
    </div>` : ''}
  `;

  drawDonut(catShown);
  drawBars(key);
}

function sizeAmount(input) {
  if (input) input.style.width = Math.max(1, String(input.value || input.placeholder).length) + 0.6 + 'ch';
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawDonut(cur) {
  if (S.charts.donut) { S.charts.donut.destroy(); S.charts.donut = null; }
  const canvas = $('#donut');
  if (!canvas) return;
  if (!window.Chart) return loadCharts();
  const entries = Array.from(cur.byCat.entries()).sort((a, b) => b[1] - a[1]);
  S.charts.donut = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: entries.map(e => e[0]),
      datasets: [{
        data: entries.map(e => Math.round(e[1] * 100) / 100),
        backgroundColor: entries.map(e => catInfo(e[0], 'expense').color),
        borderColor: cssVar('--card'), borderWidth: 3, hoverOffset: 4
      }]
    },
    options: {
      cutout: '72%', maintainAspectRatio: false, animation: { duration: 400 },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.label}: ${money(c.raw)}` } } }
    }
  });
}

function drawBars(selected) {
  if (S.charts.bars) { S.charts.bars.destroy(); S.charts.bars = null; }
  const canvas = $('#bars');
  if (!canvas) return;
  if (!window.Chart) return loadCharts();
  const end = selected > thisMonth() ? selected : (addMonths(selected, 3) <= thisMonth() ? addMonths(selected, 3) : thisMonth());
  const keys = Array.from({ length: 12 }, (_, i) => addMonths(end, i - 11));
  const values = keys.map(k => Math.round(monthTotals(k).spent * 100) / 100);
  const accent = cssVar('--accent'), faint = cssVar('--line'), muted = cssVar('--muted');
  S.charts.bars = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: keys.map(k => monthLabel(k, true)),
      datasets: [{
        data: values,
        backgroundColor: keys.map(k => k === selected ? accent : faint),
        borderRadius: 6, borderSkipped: false, maxBarThickness: 26
      }]
    },
    options: {
      maintainAspectRatio: false, animation: { duration: 300 },
      onClick: (e, els) => { if (els.length) { S.month = keys[els[0].index]; renderHome(); } },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default'; },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { size: 10.5 }, maxRotation: 0, autoSkip: false } },
        y: { grid: { color: faint }, border: { display: false }, ticks: { color: muted, font: { size: 10.5 }, maxTicksLimit: 4, callback: v => v >= 1000 ? (v / 1000) + 'k' : v } }
      },
      plugins: { legend: { display: false }, tooltip: { callbacks: { title: c => monthLabel(keys[c[0].dataIndex]), label: c => ' Spent ' + money(c.raw) } } }
    }
  });
}

function txRow(t) {
  const ic = txIcon(t);
  const sub = [
    isFriend(t.type) ? (t.payee || TYPE[t.type].short) : (t.type === 'transfer' ? 'Transfer'
      : splitsOf(t) ? `${mainSplit(t).category} + ${splitsOf(t).length - 1} more` : t.category),
    t.account, t.time
  ].filter(Boolean).join(' · ');
  return `<button class="tx" data-tx="${esc(t.id)}">
    <span class="tx-ico" style="background:${ic.color}22">${esc(ic.emoji)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(txTitle(t))}</span>
      <span class="tx-sub">${t.recurring ? '🔁 ' : ''}${esc(sub)}${t.slip_url ? ' · 📎' : ''}${t.note ? ' · ' + esc(t.note) : ''}</span>
    </span>
    <span class="tx-amt num t-${t.type}">${money(t.amount, { sign: TYPE[t.type].sign })}</span>
  </button>`;
}

/* =====================================================================
 * History
 * ===================================================================== */
/* Already-sorted transactions (newest first) -> [{ date, items }], one group per day */
function groupByDay(list) {
  const groups = [];
  list.forEach(t => {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  });
  return groups;
}
let histLimit = 150;
function filteredHistory() {
  const h = S.hist;
  const q = norm(h.q);
  return sortTx(txs().filter(t => {
    if (h.month !== 'all' && monthOf(t.date) !== h.month) return false;
    if (h.type !== 'all' && groupOf(t.type) !== h.type) return false;
    if (h.cat && !categoriesOf(t).includes(h.cat)) return false;
    if (q) {
      const hay = norm([t.payee, t.person, t.note, categoriesOf(t).join(' '), t.account, t.amount, t.date].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  }));
}

function renderHistory(keepSearchFocus) {
  const el = $('#view-history');
  const h = S.hist;
  const months = Array.from(new Set(txs().map(t => monthOf(t.date)))).sort().reverse();
  const cats = Array.from(new Set(txs().flatMap(categoriesOf).filter(c => c && c !== 'Split'))).sort();
  const list = filteredHistory();
  // With a category filter, a split bill only counts its part in that category
  const spent = list.filter(t => t.type === 'expense').reduce((s, t) => s + spentIn(t, h.cat), 0);
  const income = list.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);

  const groups = groupByDay(list.slice(0, histLimit));

  const typeChip = (v, label) => `<button class="chip ${h.type === v ? 'is-on' : ''}" data-htype="${v}">${label}</button>`;

  if (!keepSearchFocus || !$('#hist-q')) {
    el.innerHTML = `
      <h1 class="page-title">History</h1>
      <div class="search">
        <div class="search-box">
          <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>
          <input id="hist-q" type="search" placeholder="Search shop, friend, note, amount" value="${esc(h.q)}" autocomplete="off">
        </div>
        <div class="filter-row">
          <select class="input" id="hist-month">
            <option value="all">All time</option>
            ${months.map(m => `<option value="${m}" ${h.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}
          </select>
          <select class="input" id="hist-cat">
            <option value="">All categories</option>
            ${cats.map(c => `<option ${h.cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div class="chips" style="margin-top:10px">
          ${typeChip('all', 'All')}${typeChip('expense', 'Expenses')}${typeChip('income', 'Income')}${typeChip('friend', 'Friends')}${typeChip('transfer', 'Transfers')}
        </div>
      </div>
      <div id="hist-results"></div>`;
  }

  $('#hist-results').innerHTML = list.length ? `
    <div class="hist-total"><span>${list.length} item${list.length === 1 ? '' : 's'}</span><span>${spent ? 'Spent ' + money(spent) : ''}${spent && income ? ' · ' : ''}${income ? 'In ' + money(income) : ''}</span></div>
    ${groups.map(g => {
      const daySpent = g.items.filter(t => t.type === 'expense').reduce((s, t) => s + spentIn(t, h.cat), 0);
      return `<div class="day-group">
        <div class="day-head"><span>${dayLabel(g.date)}</span><span class="num">${daySpent ? money(daySpent) : ''}</span></div>
        <div class="card"><div class="tx-list">${g.items.map(txRow).join('')}</div></div>
      </div>`;
    }).join('')}
    ${list.length > histLimit ? `<button class="btn btn-block" data-act="more">Show more</button>` : ''}
  ` : `<div class="card empty"><span class="big-emoji">🔍</span>${txs().length ? 'Nothing matches these filters.' : 'No transactions yet. Tap + to add your first one.'}</div>`;
}

/* =====================================================================
 * Friends
 * ===================================================================== */
function renderFriends() {
  const el = $('#view-friends');
  const fb = friendBalances();
  const open = fb.list.filter(p => p.status !== 'settled');
  const settled = fb.list.filter(p => p.status === 'settled');

  const row = p => {
    return `<button class="person" data-person="${esc(p.name)}">
      <span class="avatar">${esc(p.name.trim().charAt(0).toUpperCase())}</span>
      <span class="person-main"><b>${esc(p.name)}</b>${friendStatusText(p)}</span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </button>`;
  };

  el.innerHTML = `
    <h1 class="page-title">Friends</h1>
    <div class="balance-grid" style="margin-bottom:12px">
      <div class="card"><span>Friends owe you</span><b class="num ${fb.owesYou > 0 ? 't-lend' : ''}">${money(fb.owesYou)}</b></div>
      <div class="card"><span>You owe friends</span><b class="num ${fb.youOwe > 0 ? 't-borrow' : ''}">${money(fb.youOwe)}</b></div>
    </div>
    <button class="btn btn-primary btn-block" data-act="friend-new" style="margin-bottom:12px">+ Lend or borrow</button>
    ${open.length ? `<div class="card"><h3>Not settled</h3>${open.map(row).join('')}</div>` : ''}
    ${settled.length ? `<div class="card"><details class="settled"><summary>Settled (${settled.length}) ▾</summary>${settled.map(row).join('')}</details></div>` : ''}
    ${!fb.list.length ? `<div class="card empty"><span class="big-emoji">🤝</span>When you lend or borrow money, it shows up here so you know who still owes what.</div>` : ''}
  `;
}

function openPerson(name) {
  const p = friendBalances().list.find(x => norm(x.name) === norm(name));
  if (!p) return;
  const hist = sortTx(txs().filter(t => isFriend(t.type) && norm(t.person) === norm(name)));
  // Only the action that settles the NET balance is offered, filled in with exactly that amount
  const actions = [];
  if (p.status === 'owes_you') actions.push(`<button class="btn btn-primary btn-block" data-pact="lend_return">They paid back ${money(p.owesYou)}</button>`);
  if (p.status === 'you_owe') actions.push(`<button class="btn btn-primary btn-block" data-pact="borrow_return">I paid back ${money(p.youOwe)}</button>`);
  const netLabel = p.status === 'owes_you' ? `${esc(p.name)} owes you` : p.status === 'you_owe' ? `You owe ${esc(p.name)}` : 'Settled';
  const netClass = p.status === 'owes_you' ? 't-lend' : p.status === 'you_owe' ? 't-borrow' : '';
  const sheet = openSheet({
    title: p.name,
    body: `
      <div class="card net-card" style="margin-bottom:12px">
        <span>${netLabel}</span><b class="num ${netClass}">${money(p.status === 'owes_you' ? p.owesYou : p.youOwe)}</b>
        <small>Balance after all lending and borrowing with ${esc(p.name)}</small>
      </div>
      <div style="display:grid;gap:8px;margin-bottom:12px">${actions.join('')}
        <div class="two"><button class="btn" data-pact="lend">Lend more</button><button class="btn" data-pact="borrow">Borrow</button></div>
      </div>
      <h3 class="sheet-sub">History</h3>
      ${groupByDay(hist).map(g => `<div class="day-group">
        <div class="day-head"><span>${dayLabel(g.date)}</span></div>
        <div class="card"><div class="tx-list">${g.items.map(txRow).join('')}</div></div>
      </div>`).join('')}`
  });
  sheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-pact]');
    if (b) {
      const type = b.dataset.pact;
      const amount = type === 'lend_return' ? p.owesYou : type === 'borrow_return' ? p.youOwe : '';
      sheet.close();
      openEditor({ type, person: p.name, amount });
      return;
    }
    const tx = e.target.closest('[data-tx]');
    if (tx) { sheet.close(); openDetail(tx.dataset.tx); }
  });
}

/* =====================================================================
 * Settings
 * ===================================================================== */
let draftSettings = null;
function renderSettings() {
  const el = $('#view-settings');
  if (!draftSettings) {
    draftSettings = {
      categories: (S.data.categories || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(c => ({ ...c, originalName: c.name })),
      accounts: (S.data.accounts || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(a => ({ ...a })),
      dirty: false
    };
  }
  const d = draftSettings;
  const eye = hidden => `<svg viewBox="0 0 24 24">${hidden ? '<path d="M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 8.5 4.5 9 6-.3.9-1.4 2.6-3.2 4M6.3 7.6C4.4 9 3.3 10.9 3 12c.5 1.5 4 6 9 6 1.5 0 2.9-.4 4-1"/>' : '<path d="M3 12c.5-1.5 4-6 9-6s8.5 4.5 9 6c-.5 1.5-4 6-9 6s-8.5-4.5-9-6z"/><circle cx="12" cy="12" r="2.6"/>'}</svg>`;
  const catRow = (c, i) => `
    <div class="set-row ${c.type === 'income' ? 'income' : ''} ${c.archived ? 'is-hidden' : ''}">
      <input class="input emoji-in" data-cat="${i}" data-k="emoji" value="${esc(c.emoji)}" maxlength="4" aria-label="Emoji">
      <input class="input" data-cat="${i}" data-k="name" value="${esc(c.name)}" placeholder="Name" aria-label="Category name">
      ${c.type === 'income' ? '' : `<input class="input num" data-cat="${i}" data-k="budget" value="${esc(c.budget)}" inputmode="numeric" placeholder="Budget" aria-label="Monthly budget">`}
      <button class="eye" data-cat-toggle="${i}" aria-label="${c.archived ? 'Show' : 'Hide'} category" title="${c.archived ? 'Hidden. Tap to show' : 'Tap to hide'}">${eye(c.archived)}</button>
    </div>`;
  const accRow = (a, i) => `
    <div class="set-row acc ${a.archived ? 'is-hidden' : ''}">
      <input class="input" data-acc="${i}" data-k="name" value="${esc(a.name)}" placeholder="Account name" aria-label="Account name">
      <select class="input" data-acc="${i}" data-k="default_method" aria-label="Usual method">
        ${S.data.methods.map(m => `<option ${a.default_method === m ? 'selected' : ''}>${m}</option>`).join('')}
      </select>
      <button class="eye" data-acc-toggle="${i}" aria-label="${a.archived ? 'Show' : 'Hide'} account">${eye(a.archived)}</button>
    </div>`;

  el.innerHTML = `
    <h1 class="page-title">Settings</h1>
    <div class="card">
      <div class="set-section-title">Appearance</div>
      <div class="segmented" role="radiogroup" aria-label="Appearance" style="margin-bottom:0">
        ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button role="radio" aria-checked="${getTheme() === v}" class="${getTheme() === v ? 'is-on' : ''}" data-theme-pick="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="set-section-title">Monthly items</div>
      ${recRules().map(r => `<button class="link-row" data-rule="${esc(r.id)}">${esc(catInfo(r.category, r.type).emoji || '🔁')} <span>${esc(r.name)} <span class="small muted">· ${r.type === 'income' ? 'Income' : 'Expense'} · ${money(r.amount)}/month${r.end_month ? (r.end_month < thisMonth() ? ' · ended ' : ' · until ') + monthShortYear(r.end_month) : ''}</span></span><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>`).join('')}
      <button class="btn btn-sm" data-act="add-rule" style="margin-top:6px">+ Add monthly item</button>
    </div>
    <div class="card">
      <div class="set-section-title">Expense categories · monthly budget</div>
      ${d.categories.map((c, i) => c.type === 'expense' ? catRow(c, i) : '').join('')}
      <button class="btn btn-sm" data-add-cat="expense">+ Add category</button>
    </div>
    <div class="card">
      <div class="set-section-title">Income categories</div>
      ${d.categories.map((c, i) => c.type === 'income' ? catRow(c, i) : '').join('')}
      <button class="btn btn-sm" data-add-cat="income">+ Add category</button>
    </div>
    <div class="card">
      <div class="set-section-title">Accounts · usual payment method</div>
      ${d.accounts.map(accRow).join('')}
      <button class="btn btn-sm" data-add-acc>+ Add account</button>
    </div>
    <div class="card">
      <div class="set-section-title">Your data</div>
      <a class="link-row" href="${esc(S.data.links.sheet)}" target="_blank" rel="noopener">📊 <span>Open Google Sheet</span><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>
      <a class="link-row" href="${esc(S.data.links.folder)}" target="_blank" rel="noopener">🗂️ <span>Open slips folder</span><svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></a>
    </div>
    <div class="card">
      <div class="set-section-title">Account</div>
      <div class="kv"><span>Signed in as</span><b>${esc((S.data.user && S.data.user.email) || '')}</b></div>
      <div class="two" style="margin-top:10px">
        <button class="btn btn-sm" data-act="logout">Sign out</button>
        <button class="btn btn-sm btn-danger" data-act="logout-all">Sign out all devices</button>
      </div>
    </div>
    <p class="small muted" style="text-align:center">Hidden categories stay on old transactions but won't show when adding new ones.</p>
    <div class="save-bar" ${d.dirty ? '' : 'hidden'}><button class="btn btn-primary btn-block" data-act="save-settings">Save changes</button></div>
  `;
}

/* =====================================================================
 * Bottom sheets
 * ===================================================================== */
function openSheet({ title, count = '', body, foot = '', onClose, canDismiss }) {
  const root = $('#sheet-root');
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.setAttribute('aria-modal', 'true');
  sh.innerHTML = `
    <div class="grabber"></div>
    <div class="sheet-head">
      <h2>${esc(title)}</h2><span class="count">${esc(count)}</span>
      <button class="icon-btn" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="sheet-body">${body}</div>
    <div class="sheet-foot" ${foot ? '' : 'hidden'}>${foot}</div>`;
  root.append(back, sh);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { back.classList.add('is-open'); sh.classList.add('is-open'); });
  let closed = false;
  const api = {
    el: sh,
    body: $('.sheet-body', sh),
    foot: $('.sheet-foot', sh),
    close(reason) {
      if (closed) return;
      if (reason === 'dismiss' && canDismiss && !canDismiss()) return;
      closed = true;
      back.classList.remove('is-open'); sh.classList.remove('is-open');
      setTimeout(() => { back.remove(); sh.remove(); if (!$('.sheet', root)) document.body.style.overflow = ''; }, 240);
      if (onClose) onClose(reason);
    },
    setBody(html) { this.body.innerHTML = html; },
    setFoot(html) { this.foot.innerHTML = html; this.foot.hidden = !html; }
  };
  back.addEventListener('click', () => api.close('dismiss'));
  $('[data-close]', sh).addEventListener('click', () => api.close('dismiss'));
  return api;
}

/* ---------- "+" menu ---------- */
function openAddMenu() {
  loadJsQr().catch(() => {});   // get the QR reader ready while you choose
  const sheet = openSheet({
    title: 'Add',
    body: `<div class="action-list">
      <button class="action" data-a="scan"><span class="a-ico">📷</span><span><b>Scan slips</b><span>Pick one or more payment slips from your photos</span></span></button>
      <button class="action" data-a="manual"><span class="a-ico">✍️</span><span><b>Add manually</b><span>Cash, income, or anything without a slip</span></span></button>
      <button class="action" data-a="friend"><span class="a-ico">🤝</span><span><b>Lend or borrow</b><span>Track money between you and a friend</span></span></button>
    </div>`
  });
  sheet.body.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    sheet.close();
    if (b.dataset.a === 'scan') pickSlips();
    if (b.dataset.a === 'manual') openEditor({ type: 'expense' });
    if (b.dataset.a === 'friend') openEditor({ type: 'lend' });
  });
}

/* =====================================================================
 * Transaction editor (quick add, edit, slip review)
 * ===================================================================== */
/**
 * initial: transaction fields to pre-fill
 * opts.slip: { fileId, previewUrl, duplicate, ocrError, index, total, draft }
 * Resolves with 'saved' | 'skipped' | 'cancel'
 */
function openEditor(initial = {}, opts = {}) {
  return new Promise(resolve => {
    const isEdit = !!initial.id;
    const slip = opts.slip || null;
    const initialSplits = splitsOf(initial);
    const accounts = activeAccounts();
    const lastAcc = store.get('lastAccount', '');
    const defaultAcc = initial.account || (accounts.find(a => a.name === lastAcc) || accounts[0] || {}).name || '';
    const f = {
      id: initial.id || '',
      type: initial.type || 'expense',
      amount: initial.amount === undefined || initial.amount === null ? '' : initial.amount,
      // Picked categories. One = normal transaction. Two or more = split bill (expenses only).
      cats: initialSplits ? initialSplits.map(p => p.category) : (initial.category && initial.category !== 'Split' ? [initial.category] : []),
      splitAmt: initialSplits ? Object.fromEntries(initialSplits.map(p => [p.category, String(p.amount)])) : {},
      payee: initial.payee || '',
      person: initial.person || '',
      note: initial.note || '',
      date: initial.date || today(),
      time: initial.time !== undefined ? initial.time : (isEdit ? '' : nowTime()),
      account: defaultAcc,
      method: initial.method || ((accounts.find(a => a.name === defaultAcc) || {}).default_method) || 'PromptPay',
      slip_ref: initial.slip_ref || '',
      // Monthly recurring link: kept on edit; for new ones the app suggests one (switch, on by default)
      recurring: initial.recurring || '',
      recOff: false,
      // A category the app filled in for you (slip/shop guess). Tapping another one replaces it instead of splitting.
      catGuessed: false
    };
    if (!isEdit && f.cats.length === 1) f.catGuessed = true;
    if (!f.cats.length && f.payee) { const g = guessCategory(f.payee); if (g) { f.cats = [g]; f.catGuessed = true; } }
    let result = 'cancel';
    let saving = false;
    let allowDuplicate = false;
    // One id per card: if a save is sent twice (lost reply, second tap), the server updates the same row
    const requestId = 'r_' + randomString();
    // Set only from what the server says is really saved: 'ref' = same slip already saved, 'datetime' = possible duplicate
    let dupState = slip && slip.duplicate ? { match: slip.duplicate.match || 'ref', tx: slip.duplicate } : null;
    // True when a save was sent but we never heard back, so we don't know if it went through
    let uncertain = false;

    const title = slip ? 'Check slip' : isEdit ? 'Edit' : (isFriend(f.type) ? 'Lend or borrow' : 'Add');
    const sheet = openSheet({
      title,
      count: slip && slip.total > 1 ? `${slip.index + 1} of ${slip.total}` : '',
      body: '',
      foot: '',
      canDismiss: () => !saving,
      onClose: reason => {
        if (uncertain && result !== 'saved') resyncAfterUnknownSave(slip);
        resolve(reason === 'dismiss' && slip ? 'cancel' : result);
      }
    });

    function slipStrip() {
      if (!slip) return '';
      const d = slip.draft || {};
      return `
        <div class="slip-strip">
          <img class="slip-thumb" src="${esc(slip.previewUrl)}" alt="Slip">
          <div class="slip-meta">
            <b>${esc(d.bank || 'Unknown bank')}</b>
            ${d.ref ? `Ref ${esc(String(d.ref).slice(-10))}` : 'No reference found'}<br>
            Check the details below, then save.
          </div>
        </div>
        <div id="ed-dup">${dupBanner()}</div>
        ${slip.ocrError ? `<div class="banner warn">ℹ️ <span>Couldn't read the text on this slip, so please fill in the details yourself.${/Drive/.test(slip.ocrError) ? ' (Is the Drive API service turned on?)' : ''}</span></div>` :
          (!d.amount || !d.date) ? `<div class="banner warn">ℹ️ <span>Some details couldn't be read. Please fill in the empty ones.</span></div>` : ''}
        ${d.note ? `<div class="banner info">💡 <span>${esc(d.note)}</span></div>` : ''}`;
    }

    function dupBanner() {
      if (!dupState || allowDuplicate) return '';
      const t = dupState.tx || {};
      const what = `${money(t.amount)}${t.payee ? ' to ' + esc(t.payee) : ''} on ${esc(t.date || '')}${t.time ? ' at ' + esc(t.time) : ''}`;
      if (dupState.match === 'ref') {
        return `<div class="banner danger">⚠️ <span><b>Already added.</b> This slip is already saved: ${what}. Skip it, or tap <b>Save anyway</b> if it really is a separate payment.</span></div>`;
      }
      return `<div class="banner warn">ℹ️ <span><b>Possible duplicate.</b> You already have ${what}. Check it isn't the same payment before saving.</span></div>`;
    }

    function typeSection() {
      const grp = groupOf(f.type);
      const seg = (g, label) => `<button type="button" class="${grp === g ? 'is-on' : ''}" data-grp="${g}">${label}</button>`;
      let html = `<div class="segmented">${seg('expense', 'Expense')}${seg('income', 'Income')}${seg('friend', 'Friend')}${seg('transfer', 'Transfer')}</div>`;
      if (grp === 'friend') {
        html += `<div class="sub-chips">${FRIEND_TYPES.map(t => `
          <button type="button" class="${f.type === t ? 'is-on' : ''}" data-ftype="${t}">${TYPE[t].short}<small>${TYPE[t].help}</small></button>`).join('')}</div>`;
      }
      return html;
    }

    function detailsSection() {
      const grp = groupOf(f.type);
      const ppl = people();
      const cats = grp === 'expense' || grp === 'income' ? activeCats(grp) : [];
      f.cats.forEach(name => {   // hidden/old categories still show if this transaction uses them
        if (cats.length && !cats.some(c => c.name === name)) cats.push({ ...catInfo(name, grp), name });
      });
      const payeeLabel = grp === 'income' ? 'From' : grp === 'transfer' ? 'To which account / note' : grp === 'friend' ? 'Shop or reason (optional)' : 'Paid to';
      return `
        ${grp === 'friend' ? `
          <div class="field">
            <label for="f-person">Friend</label>
            <input class="input" id="f-person" list="dl-people" value="${esc(f.person)}" placeholder="Friend's name" autocomplete="off">
            ${ppl.length ? `<div class="person-chips">${ppl.slice(0, 6).map(p => `<button type="button" data-pick-person="${esc(p)}">${esc(p)}</button>`).join('')}</div>` : ''}
          </div>` : ''}
        ${cats.length ? `
          <div class="field">
            <span class="label">Category${grp === 'expense' ? ' <span class="label-hint">tap more than one to split the bill</span>' : ''}</span>
            <div class="cat-grid">${cats.map(c => `
              <button type="button" class="cat-pick ${f.cats.includes(c.name) ? 'is-on' : ''}" data-cat-pick="${esc(c.name)}"><span class="e">${esc(c.emoji || '📦')}</span>${esc(c.name)}</button>`).join('')}
            </div>
            <div id="ed-split">${splitSection()}</div>
          </div>` : ''}
        <div class="field">
          <label for="f-payee">${payeeLabel}</label>
          <input class="input" id="f-payee" list="dl-payees" value="${esc(f.payee)}" placeholder="${grp === 'income' ? 'e.g. Mom' : 'e.g. LINE MAN, 7-Eleven'}" autocomplete="off">
        </div>
        <div id="ed-rec">${recSection()}</div>
        <div class="two">
          <div class="field"><label for="f-date">Date</label><input class="input" type="date" id="f-date" value="${esc(f.date)}"></div>
          <div class="field"><label for="f-time">Time</label><input class="input" type="time" id="f-time" value="${esc(f.time)}"></div>
        </div>
        <div class="two">
          <div class="field"><label for="f-account">Account</label>
            <select class="input" id="f-account">
              ${accounts.map(a => `<option ${f.account === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}
              ${f.account && !accounts.some(a => a.name === f.account) ? `<option selected>${esc(f.account)}</option>` : ''}
              <option value="" ${!f.account ? 'selected' : ''}>None</option>
            </select>
          </div>
          <div class="field"><label for="f-method">Method</label>
            <select class="input" id="f-method">
              ${S.data.methods.map(m => `<option ${f.method === m ? 'selected' : ''}>${m}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="field"><label for="f-note">Note</label><input class="input" id="f-note" value="${esc(f.note)}" placeholder="Optional" autocomplete="off"></div>
        <datalist id="dl-people">${ppl.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
        <datalist id="dl-payees">${payees().map(p => `<option value="${esc(p)}">`).join('')}</datalist>`;
    }

    /* ----- Monthly recurring: "Counts as monthly AIS (October)" ----- */
    function recTarget() {
      if (!['income', 'expense'].includes(f.type)) return null;
      if (f.recurring) {
        // Kept while it's still the same kind (switching Mom's income to Expense unlinks it)
        const rule = recRules().find(r => r.id === f.recurring.split(':')[0]);
        return !rule || rule.type === f.type ? { tag: f.recurring, label: recLabel(f.recurring), existing: true } : null;
      }
      if (isEdit) return null;   // suggestions are for new transactions; link old ones from the month popup
      const sug = recSuggestion(f.type, f.date, f.payee);
      return sug ? { tag: sug.tag, label: `${sug.rule.name} · ${monthLabel(sug.month)}` } : null;
    }
    function recSection() {
      const t = recTarget();
      if (!t) return '';
      return `<label class="rec-link"><input type="checkbox" id="f-rec" ${f.recOff ? '' : 'checked'}>
        <span>🔁 Counts as monthly <b>${esc(t.label)}</b><small>${t.existing ? 'Untick to unlink it from that month.' : 'So that month shows as done instead of pending.'}</small></span></label>`;
    }
    function updateRec() { const box = $('#ed-rec', sheet.body); if (box) box.innerHTML = recSection(); }

    /* ----- Split bill: amounts per category, only when 2+ categories are picked ----- */
    const isSplit = () => groupOf(f.type) === 'expense' && f.cats.length >= 2;
    // Money as whole satang, so 60.10 + 36.10 is exactly 96.20 (no floating-point surprises)
    const toSatang = v => {
      const t = String(v === undefined || v === null ? '' : v).replace(/,/g, '').trim();
      if (!t) return null;
      const n = Number(t);
      return isFinite(n) ? Math.round(n * 100) : null;
    };
    function splitState() {
      const total = toSatang(f.amount) || 0;
      let sum = 0, empty = [], bad = 0;
      f.cats.forEach(c => { const a = toSatang(f.splitAmt[c]); if (a === null) empty.push(c); else if (a <= 0) bad++; else sum += a; });
      return { total, sum, remaining: total - sum, empty, bad };
    }
    /** Why Save is locked for a split bill ('' = OK to save). */
    function splitBlockReason() {
      if (!isSplit()) return '';
      const st = splitState();
      if (!(st.total > 0)) return 'Enter the total first';
      if (st.remaining > 0) return `Assign ${money(st.remaining / 100)} more`;
      if (st.remaining < 0) return `Over by ${money(-st.remaining / 100)}`;
      if (st.empty.length || st.bad) return 'Fill in every amount';
      return '';
    }
    function remainingHtml(st) {
      const pct = st.total > 0 ? Math.min(100, Math.max(0, st.sum / st.total * 100)) : 0;
      let cls = 'warn', text = `Remaining <b class="num">${money(st.remaining / 100)}</b>`;
      if (st.remaining === 0 && !st.empty.length && !st.bad && st.total > 0) { cls = 'ok'; text = 'All assigned ✓'; }
      else if (st.remaining === 0 && st.total > 0) text = 'Remaining <b class="num">฿0</b> · fill in or untap the empty ones';
      else if (st.remaining < 0) { cls = 'bad'; text = `Over by <b class="num">${money(-st.remaining / 100)}</b>`; }
      return `<div class="split-bar"><i class="${cls}" style="width:${pct}%"></i></div><div class="split-rem ${cls}">${text}</div>`;
    }
    function splitSection() {
      if (!isSplit()) return '';
      return `<div class="split-box">
        ${f.cats.map(c => {
          const ci = catInfo(c, 'expense');
          return `<div class="split-row">
            <span class="split-cat"><span class="e">${esc(ci.emoji || '📦')}</span><span class="n">${esc(c)}</span></span>
            <button type="button" class="btn btn-sm split-use" data-split-use="${esc(c)}" hidden></button>
            <span class="split-amt"><span class="cur">฿</span><input class="input num" inputmode="decimal" data-split-amt="${esc(c)}" value="${esc(f.splitAmt[c] || '')}" placeholder="0" autocomplete="off" aria-label="Amount for ${esc(c)}"></span>
          </div>`;
        }).join('')}
        <div id="split-remaining"></div>
      </div>`;
    }
    /** Refresh the remaining line, the one-tap "Use ฿X" button and Save, without redrawing the inputs you're typing in. */
    function updateSplitUI() {
      if (isSplit()) {
        const st = splitState();
        const rem = $('#split-remaining', sheet.body);
        if (rem) rem.innerHTML = remainingHtml(st);
        $$('[data-split-use]', sheet.body).forEach(b => {
          const show = st.remaining > 0 && st.empty.length === 1 && st.empty[0] === b.dataset.splitUse;
          b.hidden = !show;
          if (show) b.textContent = `Use ${money(st.remaining / 100)}`;
        });
      }
      updateSaveButton();
    }
    function refreshCats() {
      $$('[data-cat-pick]', sheet.body).forEach(b => b.classList.toggle('is-on', f.cats.includes(b.dataset.catPick)));
      const box = $('#ed-split', sheet.body);
      if (box) box.innerHTML = splitSection();
      updateSplitUI();
    }
    /** Save stays locked (and says why) until a split adds up exactly. */
    function updateSaveButton() {
      const save = $('[data-save]', sheet.foot);
      if (!save || saving) return;
      const reason = splitBlockReason();
      save.disabled = !!reason;
      save.textContent = reason || save.dataset.label;
    }

    function draw() {
      sheet.setBody(`
        ${slipStrip()}
        <div id="ed-type">${typeSection()}</div>
        <div class="amount-field" id="amount-wrap"><span class="cur">฿</span>
          <input id="f-amount" inputmode="decimal" placeholder="0" value="${esc(f.amount)}" autocomplete="off" aria-label="Amount">
        </div>
        <div id="ed-details">${detailsSection()}</div>
        <div id="ed-error"></div>`);
      sizeAmount($('#f-amount', sheet.body));
      renderFoot();
      updateSplitUI();
    }

    function footHtml() {
      const next = slip && slip.total > 1 && slip.index + 1 < slip.total ? ' & next' : '';
      if (slip && dupState && dupState.match === 'ref' && !allowDuplicate) {
        return `<button class="btn" data-save data-anyway data-label="Save anyway">Save anyway</button><button class="btn btn-primary" data-skip>Skip${next}</button>`;
      }
      if (slip) return `<button class="btn" data-skip>Skip</button><button class="btn btn-primary" data-save data-label="Save${next}">Save${next}</button>`;
      const label = isEdit ? 'Save changes' : 'Save';
      return `<button class="btn btn-primary" data-save data-label="${label}">${label}</button>`;
    }
    function renderFoot() {
      sheet.setFoot(footHtml());
      wireFoot();
      updateSaveButton();
    }
    /** While saving, every button in the footer is locked and the sheet can't be closed. */
    function setBusy(on) {
      $$('button', sheet.foot).forEach(b => { b.disabled = on; });
      const save = $('[data-save]', sheet.foot);
      if (on && save) save.textContent = 'Saving…';
    }
    function redrawPart() {
      $('#ed-type', sheet.body).innerHTML = typeSection();
      $('#ed-details', sheet.body).innerHTML = detailsSection();
      updateSplitUI();
    }

    function wireFoot() {
      const save = $('[data-save]', sheet.foot);
      save.addEventListener('click', () => {
        if (save.hasAttribute('data-anyway')) allowDuplicate = true;
        onSave();
      });
      const skip = $('[data-skip]', sheet.foot);
      if (skip) skip.addEventListener('click', () => { if (saving) return; result = 'skipped'; sheet.close('skip'); });
    }

    sheet.body.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'f-amount') { f.amount = e.target.value.replace(/[^\d.,]/g, ''); sizeAmount(e.target); $('#amount-wrap', sheet.body).classList.remove('is-invalid'); updateSplitUI(); }
      if (e.target.dataset.splitAmt !== undefined) {
        f.splitAmt[e.target.dataset.splitAmt] = e.target.value.replace(/[^\d.,]/g, '');
        updateSplitUI();
      }
      if (id === 'f-payee') {
        f.payee = e.target.value;
        if ((f.catGuessed || !f.cats.length) && ['expense', 'income'].includes(f.type)) {
          const g = guessCategory(f.payee);
          if (g && !(f.cats.length === 1 && f.cats[0] === g) && activeCats(f.type).some(c => c.name === g)) {
            f.cats = [g];
            f.catGuessed = true;
            refreshCats();
          }
        }
      }
      if (id === 'f-person') { f.person = e.target.value; e.target.classList.remove('is-invalid'); }
      if (id === 'f-payee' || id === 'f-date') { if (id === 'f-date') f.date = e.target.value; if (!f.recurring) updateRec(); }
      if (id === 'f-rec') f.recOff = !e.target.checked;
      if (id === 'f-note') f.note = e.target.value;
      if (id === 'f-date') f.date = e.target.value;
      if (id === 'f-time') f.time = e.target.value;
    });
    sheet.body.addEventListener('change', e => {
      if (e.target.id === 'f-account') {
        f.account = e.target.value;
        const acc = accounts.find(a => a.name === f.account);
        if (acc && acc.default_method) { f.method = acc.default_method; $('#f-method', sheet.body).value = f.method; }
      }
      if (e.target.id === 'f-method') f.method = e.target.value;
      if (e.target.id === 'f-rec') f.recOff = !e.target.checked;
    });
    sheet.body.addEventListener('click', e => {
      const grp = e.target.closest('[data-grp]');
      if (grp) {
        const g = grp.dataset.grp;
        const newType = g === 'friend' ? (isFriend(f.type) ? f.type : 'lend') : g;
        if (newType !== f.type) {
          const wasGroup = groupOf(f.type);
          f.type = newType;
          if (g !== wasGroup) {
            f.cats = []; f.catGuessed = false;
            const guess = ['expense', 'income'].includes(g) ? guessCategory(f.payee) : '';
            if (guess && activeCats(g).some(c => c.name === guess)) { f.cats = [guess]; f.catGuessed = true; }
          }
          if (g === 'friend' && !f.person && slip && f.payee) f.person = f.payee;
          redrawPart();
        }
        return;
      }
      const ft = e.target.closest('[data-ftype]');
      if (ft) { f.type = ft.dataset.ftype; redrawPart(); return; }
      const cp = e.target.closest('[data-cat-pick]');
      if (cp) {
        const name = cp.dataset.catPick;
        if (groupOf(f.type) !== 'expense') f.cats = [name];                          // income: one category
        else if (f.cats.includes(name)) f.cats = f.cats.filter(c => c !== name);     // tap again to un-pick
        else if (f.catGuessed && f.cats.length === 1) f.cats = [name];               // replace the app's guess
        else f.cats = f.cats.concat(name);                                          // add: 2+ = split bill
        f.catGuessed = false;
        refreshCats();
        return;
      }
      const use = e.target.closest('[data-split-use]');
      if (use) {
        const st = splitState();
        const v = (st.remaining / 100).toFixed(2).replace(/\.00$/, '');
        f.splitAmt[use.dataset.splitUse] = v;
        const inp = $$('[data-split-amt]', sheet.body).find(i => i.dataset.splitAmt === use.dataset.splitUse);
        if (inp) inp.value = v;
        updateSplitUI();
        return;
      }
      const pp = e.target.closest('[data-pick-person]');
      if (pp) { f.person = pp.dataset.pickPerson; const inp = $('#f-person', sheet.body); inp.value = f.person; inp.classList.remove('is-invalid'); return; }
    });

    function fail(msg, focusSel) {
      $('#ed-error', sheet.body).innerHTML = `<div class="banner danger">${msg}</div>`;
      if (focusSel) {
        const el = $(focusSel, sheet.body);
        if (el) { (el.closest('.amount-field') || el).classList.add('is-invalid', 'shake'); setTimeout(() => (el.closest('.amount-field') || el).classList.remove('shake'), 350); el.focus(); }
      }
    }

    async function onSave() {
      if (saving) return;
      $('#ed-error', sheet.body).innerHTML = '';
      const dupBox = $('#ed-dup', sheet.body);
      if (dupBox) dupBox.innerHTML = dupBanner();
      const amount = Number(String(f.amount).replace(/,/g, ''));
      if (!(amount > 0)) return fail('Enter an amount.', '#f-amount');
      if (isFriend(f.type) && !f.person.trim()) return fail('Which friend is this?', '#f-person');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return fail('Pick a date.', '#f-date');
      const splitProblem = splitBlockReason();
      if (splitProblem) return fail(esc(splitProblem) + '. The category amounts must add up to the total.');
      const splits = isSplit() ? f.cats.map(c => ({ category: c, amount: toSatang(f.splitAmt[c]) / 100 })) : [];

      saving = true;
      setBusy(true);
      try {
        const payload = {
          id: f.id, type: f.type, amount, category: splits.length ? 'Split' : (f.cats[0] || ''), splits, payee: f.payee.trim(), person: f.person.trim(),
          note: f.note.trim(), date: f.date, time: f.time, account: f.account, method: f.method,
          source: slip ? 'slip' : (initial.source || 'manual'), slip_ref: f.slip_ref,
          slipFileId: slip ? slip.fileId : '', requestId, allowDuplicate,
          recurring: (() => { const t = recTarget(); return t && !f.recOff ? t.tag : ''; })()
        };
        const saved = await api('saveTransaction', payload);
        // Confirmed by the server: show it straight away
        upsertTx(saved);
        learnLocally(saved);
        if (f.account) store.set('lastAccount', f.account);
        uncertain = false;
        result = 'saved';
        saving = false;
        // Show the month the transaction belongs to, so it's visible straight away
        if (monthOf(saved.date) <= thisMonth()) S.month = monthOf(saved.date);
        toast(isEdit ? 'Changes saved' : `Saved ${money(saved.amount)}`);
        sheet.close('saved');
        render();
      } catch (err) {
        saving = false;
        if (err.code === 'RECURRING_TAKEN') {
          // That month is already recorded by another transaction: save this one without the link?
          if (err.data && err.data.id) { upsertTx(err.data); render(); }
          f.recOff = true; updateRec();
          renderFoot();
          fail(`<span><b>That month is already recorded</b> (${money(err.data && err.data.amount)} on ${esc(err.data && err.data.date || '')}). The link is now off. Tap <b>Save</b> to save this as a separate transaction.</span>`);
        } else if (err.code === 'DUPLICATE') {
          // The server found this slip already saved. Show that saved transaction in the app too.
          dupState = { match: 'ref', tx: err.data || {} };
          allowDuplicate = false;
          if (err.data && err.data.id) { upsertTx(err.data); render(); }
          const box = $('#ed-dup', sheet.body);
          if (box) box.innerHTML = dupBanner(); else fail(esc(err.message));
          box && box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          renderFoot();
        } else if (isUnknownOutcome(err)) {
          uncertain = true;
          renderFoot();
          fail(`<span><b>Not sure it saved.</b> ${esc(err.message)} Tap <b>Save</b> again: it won't be added twice.</span>`);
        } else {
          renderFoot();
          fail(esc(err.message));
        }
      }
    }

    draw();
    if (!slip && !isEdit && f.amount === '') setTimeout(() => { const a = $('#f-amount', sheet.body); if (a) a.focus(); }, 280);
  });
}

function upsertTx(t) {
  const list = S.data.transactions;
  const i = list.findIndex(x => x.id === t.id);
  if (i >= 0) list[i] = t; else list.push(t);
  noteLocalChange();
}

function slipFileIdOf(url) {
  const m = String(url || '').match(/\/d\/([A-Za-z0-9_-]{20,})/);
  return m ? m[1] : '';
}

/**
 * A save was sent but we never got the answer, and the card was then closed.
 * Reload from the server so the app shows exactly what is stored.
 */
async function resyncAfterUnknownSave(slip) {
  try {
    const data = await api('getAppData');
    S.data = data;
    persistData();
    render();
    if (slip && data.transactions.some(t => slipFileIdOf(t.slip_url) === slip.fileId)) {
      toast('That slip did get saved. It is in your list.');
    }
  } catch (e) { /* keep showing what we have */ }
}

/* =====================================================================
 * Transaction detail
 * ===================================================================== */
function openDetail(id) {
  const t = txs().find(x => x.id === id);
  if (!t) return;
  const ic = txIcon(t);
  const rows = [
    ['Type', isFriend(t.type) ? TYPE[t.type].short : TYPE[t.type].label],
    isFriend(t.type) ? ['Friend', t.person] : null,
    ...(splitsOf(t)
      ? [['Split into', `${splitsOf(t).length} categories`]].concat(splitsOf(t).map(p => [`${catInfo(p.category, 'expense').emoji || '📦'} ${p.category}`, money(p.amount)]))
      : [t.category ? ['Category', `${ic.emoji} ${t.category}`] : null]),
    t.payee ? [t.type === 'income' ? 'From' : 'Paid to', t.payee] : null,
    ['Date', `${dayLabel(t.date)}${t.time ? ', ' + t.time : ''}`],
    t.account ? ['Account', t.account] : null,
    t.method ? ['Method', t.method] : null,
    t.note ? ['Note', t.note] : null,
    t.slip_ref ? ['Slip ref', t.slip_ref] : null,
    t.recurring ? ['Monthly', recLabel(t.recurring)] : null,
    ['Added', `${t.source === 'slip' ? 'From slip' : t.source === 'recurring' ? 'Marked ' + (t.type === 'income' ? 'received' : 'paid') : 'Manually'}${t.created_at ? ' · ' + t.created_at.slice(0, 16) : ''}`]
  ].filter(Boolean);

  let confirmDelete = false;
  const sheet = openSheet({
    title: txTitle(t),
    body: `
      <div class="detail-amt"><div class="big num t-${t.type}">${money(t.amount, { sign: TYPE[t.type].sign })}</div></div>
      <div class="card">${rows.map(([k, v]) => `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>
      ${t.slip_url ? `<div id="slip-area"><button class="btn btn-block" data-show-slip>🧾 Show slip</button></div>` : ''}`,
    foot: `<button class="btn btn-danger" data-del>Delete</button><button class="btn btn-primary" data-edit>Edit</button>`
  });
  sheet.body.addEventListener('click', async e => {
    if (!e.target.closest('[data-show-slip]')) return;
    const area = $('#slip-area', sheet.body);
    area.innerHTML = `<div class="loading"><div class="spinner"></div>Loading slip…</div>`;
    try {
      const url = await api('getSlipImage', t.slip_url);
      area.innerHTML = `<img class="slip-full" src="${esc(url)}" alt="Slip"><a class="link-row" href="${esc(t.slip_url)}" target="_blank" rel="noopener">🗂️ <span>Open in Google Drive</span></a>`;
    } catch (err) {
      area.innerHTML = `<div class="banner warn">Couldn't load the slip. <a href="${esc(t.slip_url)}" target="_blank" rel="noopener">Open in Drive</a></div>`;
    }
  });
  $('[data-edit]', sheet.foot).addEventListener('click', () => { sheet.close(); openEditor(t); });
  $('[data-del]', sheet.foot).addEventListener('click', async e => {
    const btn = e.currentTarget;
    if (!confirmDelete) { confirmDelete = true; btn.textContent = 'Tap again to delete'; return; }
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      await api('deleteTransaction', t.id);
      S.data.transactions = S.data.transactions.filter(x => x.id !== t.id);
      noteLocalChange();
      toast('Deleted');
      sheet.close();
      render();
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false; btn.textContent = 'Delete'; confirmDelete = false;
    }
  });
}

/* =====================================================================
 * Slips: pick, read QR, upload, review one by one
 * ===================================================================== */
function pickSlips() {
  loadJsQr().catch(() => {});
  const input = $('#slip-input');
  input.value = '';
  input.click();
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error('Could not open this image.'));
    img.src = url;
  });
}

function scanQr(img, width) {
  if (!window.jsQR) return '';
  const scale = Math.min(1, width / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const r = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    return r ? r.data : '';
  } catch (e) { return ''; }
}

/** Shrinks the image (faster upload) and reads the slip QR code in the browser. */
async function prepareSlip(file) {
  await loadJsQr().catch(() => { /* no QR reader: the slip text is still read */ });
  const { img, url } = await loadImage(file);
  let qrText = scanQr(img, 1400) || scanQr(img, 800) || scanQr(img, 2000);
  const maxW = 1400;
  const scale = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const base64 = c.toDataURL('image/jpeg', 0.88).split(',')[1];
  return { base64, qrText, previewUrl: url };
}

async function readOneSlip(file) {
  const prep = await prepareSlip(file);
  const res = await api('readSlip', { base64: prep.base64, mimeType: 'image/jpeg', qrText: prep.qrText });
  return { ...res, previewUrl: prep.previewUrl };
}

async function startSlipFlow(files) {
  files = Array.from(files || []).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|webp)$/i.test(f.name));
  if (!files.length) return;

  // Read slips one after another in the background, review them in order
  let chain = Promise.resolve();
  const jobs = files.map(file => {
    const p = chain.then(() => readOneSlip(file)).catch(err => ({ error: err.message || String(err) }));
    chain = p;
    return p;
  });

  let saved = 0, skipped = 0, failed = 0;
  for (let i = 0; i < jobs.length; i++) {
    const wait = openSheet({
      title: 'Reading slip',
      count: files.length > 1 ? `${i + 1} of ${files.length}` : '',
      body: `<div class="loading"><div class="spinner"></div><div>Reading the slip…<br><span class="small">This takes a few seconds.</span></div></div>`
    });
    let cancelled = false;
    const origClose = wait.close.bind(wait);
    const res = await Promise.race([jobs[i], new Promise(r => { wait.close = reason => { if (reason === 'dismiss') { cancelled = true; r(null); } origClose(reason); }; })]);
    wait.close('done');
    if (cancelled) { await discardRest(jobs.slice(i)); break; }

    if (res.error) {
      failed++;
      toast(`Slip ${i + 1}: ${res.error}`, true);
      continue;
    }
    const d = res.draft || {};
    const outcome = await openEditor({
      type: 'expense',
      amount: d.amount,
      date: d.date || today(),
      time: d.time || '',
      payee: d.payee,
      category: d.category,
      account: d.account || undefined,
      method: d.method,
      note: d.note,
      slip_ref: d.ref
    }, { slip: { ...res, draft: d, index: i, total: files.length } });

    if (outcome === 'saved') saved++;
    else {
      api('discardSlip', res.fileId).catch(() => {});
      if (outcome === 'skipped') skipped++;
      else { await discardRest(jobs.slice(i + 1)); break; }
    }
  }
  if (files.length > 1) toast(`${saved} saved${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed` : ''}`, failed > 0 && !saved);
}

async function discardRest(rest) {
  for (const p of rest) {
    p.then(r => { if (r && r.fileId) api('discardSlip', r.fileId).catch(() => {}); });
  }
}

/* =====================================================================
 * Events
 * ===================================================================== */
function wireEvents() {
  $$('.tab[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  $('#btn-add').addEventListener('click', openAddMenu);
  $('#slip-input').addEventListener('change', e => startSlipFlow(e.target.files));

  $('#main').addEventListener('click', e => {
    const tx = e.target.closest('[data-tx]');
    if (tx) return openDetail(tx.dataset.tx);
    const m = e.target.closest('[data-month]');
    if (m) { S.month = addMonths(S.month, Number(m.dataset.month)); return renderHome(); }
    const g = e.target.closest('[data-go]');
    if (g) return go(g.dataset.go);
    const person = e.target.closest('[data-person]');
    if (person) return openPerson(person.dataset.person);
    const rd = e.target.closest('[data-rec-done]');
    if (rd) {
      const r = recRules().find(x => x.id === rd.dataset.recDone);
      if (r) { const it = recItem(r, S.month); recConfirm(it, it.amount, rd); }
      return;
    }
    const rec = e.target.closest('[data-rec]');
    if (rec) return openRecItem(rec.dataset.rec, S.month);
    const rule = e.target.closest('[data-rule]');
    if (rule) return openRuleEditor(recRules().find(x => x.id === rule.dataset.rule));

    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'scan') return pickSlips();
      if (act === 'manual') return openEditor({ type: 'expense' });
      if (act === 'friend-new') return openEditor({ type: 'lend' });
      if (act === 'add-rule') return openRuleEditor(null);
      if (act === 'savings') return openSavings();
      if (act === 'period-sheet') return openPeriodSheet();
      if (act === 'see-month') { S.hist = { q: '', type: 'all', month: S.month, cat: '' }; return go('history'); }
      if (act === 'more') { histLimit += 150; return renderHistory(); }
      if (act === 'cats-more') {
        catsOpen = !catsOpen;
        a.previousElementSibling.classList.toggle('is-open', catsOpen);
        const extra = $$('.cat-extra', a.parentElement).length;
        a.textContent = catsOpen ? 'Show less' : `View more (${extra})`;
        return;
      }
      if (act === 'save-settings') return saveSettingsNow(a);
      if (act === 'reload') return location.reload();
      if (act === 'logout' || act === 'logout-all') return signOut(act === 'logout-all', a);
    }

    const ht = e.target.closest('[data-htype]');
    if (ht) { S.hist.type = ht.dataset.htype; histLimit = 150; return renderHistory(); }

    // Settings
    const th = e.target.closest('[data-theme-pick]');
    if (th) return setTheme(th.dataset.themePick);
    const ct = e.target.closest('[data-cat-toggle]');
    if (ct) { const c = draftSettings.categories[+ct.dataset.catToggle]; c.archived = !c.archived; draftSettings.dirty = true; return renderSettings(); }
    const at = e.target.closest('[data-acc-toggle]');
    if (at) { const x = draftSettings.accounts[+at.dataset.accToggle]; x.archived = !x.archived; draftSettings.dirty = true; return renderSettings(); }
    const ac = e.target.closest('[data-add-cat]');
    if (ac) {
      draftSettings.categories.push({ name: '', type: ac.dataset.addCat, emoji: '🏷️', color: pickColor(), budget: '', archived: false });
      draftSettings.dirty = true; renderSettings();
      const inputs = $$(`[data-k="name"][data-cat]`); inputs[inputs.length - 1].focus();
      return;
    }
    if (e.target.closest('[data-add-acc]')) {
      draftSettings.accounts.push({ name: '', kind: 'bank', default_method: 'PromptPay', archived: false });
      draftSettings.dirty = true; renderSettings();
      const inputs = $$('[data-k="name"][data-acc]'); inputs[inputs.length - 1].focus();
    }
  });

  $('#main').addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'hist-q') { S.hist.q = t.value; histLimit = 150; return renderHistory(true); }
    if (t.dataset.cat !== undefined) { draftSettings.categories[+t.dataset.cat][t.dataset.k] = t.value; markDirty(); }
    if (t.dataset.acc !== undefined) { draftSettings.accounts[+t.dataset.acc][t.dataset.k] = t.value; markDirty(); }
  });
  $('#main').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'hist-month') { S.hist.month = t.value; histLimit = 150; return renderHistory(true); }
    if (t.id === 'hist-cat') { S.hist.cat = t.value; histLimit = 150; return renderHistory(true); }
    if (t.dataset.acc !== undefined) { draftSettings.accounts[+t.dataset.acc][t.dataset.k] = t.value; markDirty(); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const close = $$('.sheet [data-close]').pop(); if (close) close.click(); }
  });
}

function markDirty() {
  if (!draftSettings.dirty) { draftSettings.dirty = true; const bar = $('.save-bar'); if (bar) bar.hidden = false; }
}

const PALETTE = ['#E8590C', '#1C7ED6', '#7048E8', '#0C8599', '#2F9E44', '#D6336C', '#F08C00', '#5C7CFA', '#12B886', '#AE3EC9'];
function pickColor() {
  const used = new Set((draftSettings.categories || []).map(c => c.color));
  return PALETTE.find(c => !used.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

async function signOut(everywhere, btn) {
  btn.disabled = true;
  try { await api(everywhere ? 'logoutAll' : 'logout'); } catch (e) { /* sign out locally anyway */ }
  auth.clear();
  clearCachedData();
  S.data = null;
  draftSettings = null;
  showLogin(everywhere ? 'Signed out on all devices.' : 'Signed out.');
}

async function saveSettingsNow(btn) {
  const d = draftSettings;
  const names = new Set();
  for (const c of d.categories) {
    c.name = String(c.name || '').trim();
    if (!c.name) continue;
    const k = c.type + ':' + c.name.toLowerCase();
    if (names.has(k)) return toast(`"${c.name}" is listed twice`, true);
    names.add(k);
    if (c.budget !== '' && c.budget !== null && !(Number(c.budget) >= 0)) return toast(`Budget for ${c.name} must be a number`, true);
  }
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const data = await api('saveSettings', { categories: d.categories, accounts: d.accounts });
    S.data = { ...data, user: S.data && S.data.user };
    noteLocalChange();
    draftSettings = null;
    toast('Settings saved');
    renderSettings();
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

/* =====================================================================
 * Start
 * ===================================================================== */
async function boot() {
  applyTheme(getTheme());
  try {
    // When set to System, redraw if the phone switches between light and dark
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getTheme() === 'system') render(); });
  } catch (e) { /* older browsers */ }
  wireEvents();
  if (!window.__mockApi) {
    if (!CFG.API_URL || !CFG.GOOGLE_CLIENT_ID || /PASTE/.test(CFG.API_URL + CFG.GOOGLE_CLIENT_ID)) {
      showLogin('Setup not finished: fill in API_URL and GOOGLE_CLIENT_ID in docs/config.js.');
      $('#google-btn').disabled = true;
      return;
    }
    if (await finishGoogleSignIn()) return;
    if (!auth.get()) return showLogin();
  }
  hideLogin();

  // Opened before on this device? Show that data right away, then refresh it.
  const cached = window.__mockApi ? null : readCachedData();
  if (cached) {
    S.data = cached;
    render();
    refreshData();
    return;
  }

  // First open on this device: nothing to show until Google answers.
  $('#view-home').innerHTML = `
    <div class="skeleton" style="height:44px;margin:4px 0 12px"></div>
    <div class="skeleton" style="height:180px;margin-bottom:12px"></div>
    <div class="skeleton" style="height:300px"></div>`;
  loadCharts();   // download charts while we wait for the data
  try {
    S.data = await api('getAppData');
    persistData();
    render();
  } catch (err) {
    if (err.code === 'AUTH') return;
    $('#view-home').innerHTML = `
      <div class="card empty" style="margin-top:30px">
        <span class="big-emoji">⚠️</span>
        <b>Couldn't load your data.</b><br>${esc(err.message)}
        <div class="empty-actions"><button class="btn btn-primary btn-sm" data-act="reload">Try again</button></div>
      </div>`;
  }
}

/**
 * Gets fresh data from Google and swaps it in.
 * If you saved/deleted something while it was loading, it asks again, so a
 * slower, older answer never hides a change you just made.
 */
async function refreshData() {
  for (let attempt = 0; attempt < 3; attempt++) {
    const writesBefore = localWrites;
    let fresh;
    try {
      fresh = await api('getAppData');
    } catch (err) {
      if (err.code !== 'AUTH') toast("Couldn't refresh. Showing your data from last time.");
      return;
    }
    if (localWrites !== writesBefore) continue;   // something changed meanwhile: get a newer copy
    const changed = JSON.stringify(fresh) !== JSON.stringify(S.data);
    S.data = fresh;
    persistData();
    if (changed) rerenderAfterRefresh();
    return;
  }
}

/** Redraw with fresh data without throwing away what you're in the middle of. */
function rerenderAfterRefresh() {
  if (S.view === 'history' && $('#hist-q')) return renderHistory(true);   // keep search box + focus
  if (S.view === 'settings') {
    if (draftSettings && draftSettings.dirty) return;                       // keep unsaved settings edits
    draftSettings = null;
  }
  render();
}
boot();
})();

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
  constructor(message, code) { super(message); this.code = code; }
}

async function api(action, ...args) {
  if (window.__mockApi) return window.__mockApi(action, ...args); // local preview only
  const s = auth.get();
  const body = JSON.stringify({ action, args, session: s && s.session });
  let data = null, lastProblem = '';
  // Google sometimes sends a one-off odd reply, so try twice before giving up
  for (let attempt = 1; attempt <= 2 && !data; attempt++) {
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
      if (attempt === 2) throw new ApiError("Can't reach the server. Check your internet and try again.", 'NETWORK');
      await new Promise(r => setTimeout(r, 800));
      continue;
    }
    const text = await res.text();
    try { data = JSON.parse(text); } catch (e) {
      const snippet = text.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      lastProblem = `HTTP ${res.status}${snippet ? ': ' + snippet : ''}`;
      console.warn('[api] unexpected reply', action, res.status, res.url, text.slice(0, 500));
      if (attempt < 2) await new Promise(r => setTimeout(r, 800));
    }
  }
  if (!data) throw new ApiError(`The server sent an unexpected reply (${lastProblem}). Tap Try again; if it keeps happening, send this message to whoever set up the app.`, 'BAD_REPLY');
  if (!data.ok) {
    if (data.code === 'AUTH' && action !== 'login') { auth.clear(); showLogin(data.error); }
    throw new ApiError(data.error || 'Something went wrong', data.code);
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
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: y === new Date().getFullYear() ? undefined : 'numeric' });
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
function txIcon(t) {
  if (isFriend(t.type)) return { emoji: '🤝', color: getComputedStyle(document.documentElement).getPropertyValue(t.type.startsWith('lend') ? '--lend' : '--borrow').trim() || '#C66A00' };
  if (t.type === 'transfer') return { emoji: '🔁', color: '#868E96' };
  const c = catInfo(t.category, t.type);
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
  if (!t.payee || !t.category || !['expense', 'income'].includes(t.type)) return;
  const rules = S.data.rules || (S.data.rules = []);
  const r = rules.find(r => r.match === 'exact' && norm(r.pattern) === norm(t.payee));
  if (r) r.category = t.category; else rules.push({ pattern: t.payee, category: t.category, match: 'exact' });
}

/* Friend balances: positive owesYou = they owe you, positive youOwe = you owe them */
function friendBalances() {
  const map = new Map();
  txs().forEach(t => {
    if (!isFriend(t.type) || !t.person) return;
    const k = norm(t.person);
    const p = map.get(k) || { name: t.person, owesYou: 0, youOwe: 0, last: '' };
    const a = Number(t.amount) || 0;
    if (t.type === 'lend') p.owesYou += a;
    if (t.type === 'lend_return') p.owesYou -= a;
    if (t.type === 'borrow') p.youOwe += a;
    if (t.type === 'borrow_return') p.youOwe -= a;
    if (t.date > p.last) p.last = t.date;
    map.set(k, p);
  });
  const list = Array.from(map.values()).map(p => ({ ...p, owesYou: Math.round(p.owesYou * 100) / 100, youOwe: Math.round(p.youOwe * 100) / 100 }));
  return {
    list: list.sort((a, b) => b.last.localeCompare(a.last)),
    owesYou: list.reduce((s, p) => s + Math.max(0, p.owesYou), 0),
    youOwe: list.reduce((s, p) => s + Math.max(0, p.youOwe), 0)
  };
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
      byCat.set(t.category || 'Other', (byCat.get(t.category || 'Other') || 0) + a);
    } else if (t.type === 'income') income += a;
  });
  return { spent, income, byCat };
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

  const cats = activeCats('expense');
  const catRows = Array.from(cur.byCat.entries()).sort((a, b) => b[1] - a[1]).map(([name, amt]) => {
    const c = catInfo(name, 'expense');
    const pct = cur.spent ? Math.round(amt / cur.spent * 100) : 0;
    const budget = Number(c.budget) || 0;
    let barW = pct, barColor = c.color, note = '';
    if (budget > 0) {
      barW = Math.min(100, amt / budget * 100);
      const over = amt > budget;
      if (over) barColor = 'var(--danger)';
      note = `<div class="budget-note ${over ? 'over' : ''}">${money(amt)} of ${money(budget)} budget${over ? ` · ${money(amt - budget)} over` : ` · ${money(budget - amt)} left`}</div>`;
    }
    return `<li class="cat-row">
      <div class="cat-row-top">
        <span class="cat-emoji" style="background:${c.color}22">${esc(c.emoji || '📦')}</span>
        <span class="cat-name">${esc(name)}</span>
        <span class="cat-amt num">${money(amt)}</span>
        <span class="cat-pct num">${pct}%</span>
      </div>
      <div class="bar"><i style="width:${barW}%;background:${barColor}"></i></div>${note}
    </li>`;
  }).join('');

  // Budgeted categories with no spending yet this month
  const unspentBudgets = cats.filter(c => Number(c.budget) > 0 && !cur.byCat.has(c.name)).map(c => `
    <li class="cat-row">
      <div class="cat-row-top">
        <span class="cat-emoji" style="background:${c.color}22">${esc(c.emoji)}</span>
        <span class="cat-name">${esc(c.name)}</span><span class="cat-amt num">฿0</span><span class="cat-pct num">0%</span>
      </div>
      <div class="bar"><i style="width:0"></i></div>
      <div class="budget-note">${money(0)} of ${money(c.budget)} budget</div>
    </li>`).join('');

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
      <div class="hero-row">
        <div><span>Income</span><b class="num t-income">${money(cur.income)}</b></div>
        <div><span>${cur.income - cur.spent >= 0 ? 'Left over' : 'Overspent'}</span><b class="num ${cur.income - cur.spent < 0 ? 't-lend' : ''}">${money(cur.income - cur.spent)}</b></div>
      </div>
    </div>

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

    ${cur.spent > 0 || unspentBudgets ? `
    <div class="card">
      <h3>Where it went</h3>
      ${cur.spent > 0 ? `
      <div class="donut-wrap">
        <canvas id="donut"></canvas>
        <div class="donut-center"><div><b class="num">${money(cur.spent)}</b><span>${cur.byCat.size} ${cur.byCat.size === 1 ? 'category' : 'categories'}</span></div></div>
      </div>` : ''}
      <ul class="cat-list">${catRows}${unspentBudgets}</ul>
    </div>` : ''}

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

  drawDonut(cur);
  drawBars(key);
}

function sizeAmount(input) {
  if (input) input.style.width = Math.max(1, String(input.value || input.placeholder).length) + 0.6 + 'ch';
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawDonut(cur) {
  if (S.charts.donut) { S.charts.donut.destroy(); S.charts.donut = null; }
  const canvas = $('#donut');
  if (!canvas || !window.Chart) return;
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
  if (!canvas || !window.Chart) return;
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
    isFriend(t.type) ? (t.payee || TYPE[t.type].short) : (t.type === 'transfer' ? 'Transfer' : t.category),
    t.account, t.time
  ].filter(Boolean).join(' · ');
  return `<button class="tx" data-tx="${esc(t.id)}">
    <span class="tx-ico" style="background:${ic.color}22">${esc(ic.emoji)}</span>
    <span class="tx-main">
      <span class="tx-title">${esc(txTitle(t))}</span>
      <span class="tx-sub">${esc(sub)}${t.slip_url ? ' · 📎' : ''}${t.note ? ' · ' + esc(t.note) : ''}</span>
    </span>
    <span class="tx-amt num t-${t.type}">${money(t.amount, { sign: TYPE[t.type].sign })}</span>
  </button>`;
}

/* =====================================================================
 * History
 * ===================================================================== */
let histLimit = 150;
function filteredHistory() {
  const h = S.hist;
  const q = norm(h.q);
  return sortTx(txs().filter(t => {
    if (h.month !== 'all' && monthOf(t.date) !== h.month) return false;
    if (h.type !== 'all' && groupOf(t.type) !== h.type) return false;
    if (h.cat && t.category !== h.cat) return false;
    if (q) {
      const hay = norm([t.payee, t.person, t.note, t.category, t.account, t.amount, t.date].join(' '));
      if (!hay.includes(q)) return false;
    }
    return true;
  }));
}

function renderHistory(keepSearchFocus) {
  const el = $('#view-history');
  const h = S.hist;
  const months = Array.from(new Set(txs().map(t => monthOf(t.date)))).sort().reverse();
  const cats = Array.from(new Set(txs().filter(t => t.category).map(t => t.category))).sort();
  const list = filteredHistory();
  const spent = list.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const income = list.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);

  const groups = [];
  list.slice(0, histLimit).forEach(t => {
    const g = groups[groups.length - 1];
    if (g && g.date === t.date) g.items.push(t); else groups.push({ date: t.date, items: [t] });
  });

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
      const daySpent = g.items.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
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
  const open = fb.list.filter(p => p.owesYou !== 0 || p.youOwe !== 0);
  const settled = fb.list.filter(p => p.owesYou === 0 && p.youOwe === 0);

  const row = p => {
    const parts = [];
    if (p.owesYou > 0) parts.push(`<span class="t-lend">owes you ${money(p.owesYou)}</span>`);
    if (p.owesYou < 0) parts.push(`<span>paid you ${money(p.owesYou)} extra</span>`);
    if (p.youOwe > 0) parts.push(`<span class="t-borrow">you owe ${money(p.youOwe)}</span>`);
    if (p.youOwe < 0) parts.push(`<span>you paid ${money(p.youOwe)} extra</span>`);
    return `<button class="person" data-person="${esc(p.name)}">
      <span class="avatar">${esc(p.name.trim().charAt(0).toUpperCase())}</span>
      <span class="person-main"><b>${esc(p.name)}</b><span>${parts.join(' · ') || 'All settled'}</span></span>
      <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>
    </button>`;
  };

  el.innerHTML = `
    <h1 class="page-title">Friends</h1>
    <div class="balance-grid" style="margin-bottom:12px">
      <div class="card"><span>Friends owe you</span><b class="num t-lend">${money(fb.owesYou)}</b></div>
      <div class="card"><span>You owe friends</span><b class="num t-borrow">${money(fb.youOwe)}</b></div>
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
  const actions = [];
  if (p.owesYou > 0) actions.push(`<button class="btn btn-primary btn-block" data-pact="lend_return">They paid back ${money(p.owesYou)}</button>`);
  if (p.youOwe > 0) actions.push(`<button class="btn btn-primary btn-block" data-pact="borrow_return">I paid back ${money(p.youOwe)}</button>`);
  const sheet = openSheet({
    title: p.name,
    body: `
      <div class="balance-grid" style="margin-bottom:12px">
        <div class="card"><span>Owes you</span><b class="num t-lend">${money(Math.max(0, p.owesYou))}</b></div>
        <div class="card"><span>You owe</span><b class="num t-borrow">${money(Math.max(0, p.youOwe))}</b></div>
      </div>
      <div style="display:grid;gap:8px;margin-bottom:12px">${actions.join('')}
        <div class="two"><button class="btn" data-pact="lend">Lend more</button><button class="btn" data-pact="borrow">Borrow</button></div>
      </div>
      <div class="card"><h3>History</h3><div class="tx-list">${hist.map(txRow).join('')}</div></div>`
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
function openSheet({ title, count = '', body, foot = '', onClose }) {
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
    const accounts = activeAccounts();
    const lastAcc = store.get('lastAccount', '');
    const defaultAcc = initial.account || (accounts.find(a => a.name === lastAcc) || accounts[0] || {}).name || '';
    const f = {
      id: initial.id || '',
      type: initial.type || 'expense',
      amount: initial.amount === undefined || initial.amount === null ? '' : initial.amount,
      category: initial.category || '',
      payee: initial.payee || '',
      person: initial.person || '',
      note: initial.note || '',
      date: initial.date || today(),
      time: initial.time !== undefined ? initial.time : (isEdit ? '' : nowTime()),
      account: defaultAcc,
      method: initial.method || ((accounts.find(a => a.name === defaultAcc) || {}).default_method) || 'PromptPay',
      slip_ref: initial.slip_ref || '',
      catTouched: !!initial.category && isEdit
    };
    if (!f.category && f.payee) f.category = guessCategory(f.payee);
    let result = 'cancel';
    let saving = false;
    let allowDuplicate = false;

    const title = slip ? 'Check slip' : isEdit ? 'Edit' : (isFriend(f.type) ? 'Lend or borrow' : 'Add');
    const sheet = openSheet({
      title,
      count: slip && slip.total > 1 ? `${slip.index + 1} of ${slip.total}` : '',
      body: '',
      foot: '',
      onClose: reason => resolve(reason === 'dismiss' && slip ? 'cancel' : result)
    });

    function slipStrip() {
      if (!slip) return '';
      const d = slip.draft || {};
      const dup = slip.duplicate;
      return `
        <div class="slip-strip">
          <img class="slip-thumb" src="${esc(slip.previewUrl)}" alt="Slip">
          <div class="slip-meta">
            <b>${esc(d.bank || 'Unknown bank')}</b>
            ${d.ref ? `Ref ${esc(String(d.ref).slice(-10))}` : 'No reference found'}<br>
            Check the details below, then save.
          </div>
        </div>
        ${dup ? `<div class="banner danger">⚠️ <span><b>Looks like a duplicate.</b> You already saved this slip on ${esc(dup.date)} (${money(dup.amount)}${dup.payee ? ', ' + esc(dup.payee) : ''}).</span></div>` : ''}
        ${slip.ocrError ? `<div class="banner warn">ℹ️ <span>Couldn't read the text on this slip, so please fill in the details yourself.${/Drive/.test(slip.ocrError) ? ' (Is the Drive API service turned on?)' : ''}</span></div>` :
          (!d.amount || !d.date) ? `<div class="banner warn">ℹ️ <span>Some details couldn't be read. Please fill in the empty ones.</span></div>` : ''}
        ${d.note ? `<div class="banner info">💡 <span>${esc(d.note)}</span></div>` : ''}`;
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
      if (f.category && cats.length && !cats.some(c => c.name === f.category)) {
        const old = catInfo(f.category, grp);
        cats.push({ ...old, name: f.category });
      }
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
            <span class="label">Category</span>
            <div class="cat-grid">${cats.map(c => `
              <button type="button" class="cat-pick ${f.category === c.name ? 'is-on' : ''}" data-cat-pick="${esc(c.name)}"><span class="e">${esc(c.emoji || '📦')}</span>${esc(c.name)}</button>`).join('')}
            </div>
          </div>` : ''}
        <div class="field">
          <label for="f-payee">${payeeLabel}</label>
          <input class="input" id="f-payee" list="dl-payees" value="${esc(f.payee)}" placeholder="${grp === 'income' ? 'e.g. Mom' : 'e.g. LINE MAN, 7-Eleven'}" autocomplete="off">
        </div>
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
      sheet.setFoot(slip
        ? `<button class="btn" data-skip>Skip</button><button class="btn btn-primary" data-save>Save${slip.total > 1 && slip.index + 1 < slip.total ? ' & next' : ''}</button>`
        : `${isEdit ? '' : ''}<button class="btn btn-primary" data-save>${isEdit ? 'Save changes' : 'Save'}</button>`);
      wireFoot();
    }
    function redrawPart() {
      $('#ed-type', sheet.body).innerHTML = typeSection();
      $('#ed-details', sheet.body).innerHTML = detailsSection();
    }

    function wireFoot() {
      const save = $('[data-save]', sheet.foot);
      save.addEventListener('click', onSave);
      const skip = $('[data-skip]', sheet.foot);
      if (skip) skip.addEventListener('click', () => { result = 'skipped'; sheet.close('skip'); });
    }

    sheet.body.addEventListener('input', e => {
      const id = e.target.id;
      if (id === 'f-amount') { f.amount = e.target.value.replace(/[^\d.,]/g, ''); sizeAmount(e.target); $('#amount-wrap', sheet.body).classList.remove('is-invalid'); }
      if (id === 'f-payee') {
        f.payee = e.target.value;
        if (!f.catTouched && ['expense', 'income'].includes(f.type)) {
          const g = guessCategory(f.payee);
          if (g && g !== f.category && activeCats(f.type).some(c => c.name === g)) {
            f.category = g;
            $$('[data-cat-pick]', sheet.body).forEach(b => b.classList.toggle('is-on', b.dataset.catPick === g));
          }
        }
      }
      if (id === 'f-person') { f.person = e.target.value; e.target.classList.remove('is-invalid'); }
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
    });
    sheet.body.addEventListener('click', e => {
      const grp = e.target.closest('[data-grp]');
      if (grp) {
        const g = grp.dataset.grp;
        const newType = g === 'friend' ? (isFriend(f.type) ? f.type : 'lend') : g;
        if (newType !== f.type) {
          const wasGroup = groupOf(f.type);
          f.type = newType;
          if (g !== wasGroup) { f.category = ''; f.catTouched = false; if (['expense', 'income'].includes(g)) f.category = guessCategory(f.payee); }
          if (g === 'friend' && !f.person && slip && f.payee) f.person = f.payee;
          redrawPart();
        }
        return;
      }
      const ft = e.target.closest('[data-ftype]');
      if (ft) { f.type = ft.dataset.ftype; redrawPart(); return; }
      const cp = e.target.closest('[data-cat-pick]');
      if (cp) {
        f.category = cp.dataset.catPick; f.catTouched = true;
        $$('[data-cat-pick]', sheet.body).forEach(b => b.classList.toggle('is-on', b === cp));
        return;
      }
      const pp = e.target.closest('[data-pick-person]');
      if (pp) { f.person = pp.dataset.pickPerson; const inp = $('#f-person', sheet.body); inp.value = f.person; inp.classList.remove('is-invalid'); return; }
      if (e.target.closest('[data-allow-dup]')) { allowDuplicate = true; onSave(); }
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
      const amount = Number(String(f.amount).replace(/,/g, ''));
      if (!(amount > 0)) return fail('Enter an amount.', '#f-amount');
      if (isFriend(f.type) && !f.person.trim()) return fail('Which friend is this?', '#f-person');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return fail('Pick a date.', '#f-date');

      saving = true;
      const btn = $('[data-save]', sheet.foot);
      const btnText = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        const payload = {
          id: f.id, type: f.type, amount, category: f.category, payee: f.payee.trim(), person: f.person.trim(),
          note: f.note.trim(), date: f.date, time: f.time, account: f.account, method: f.method,
          source: slip ? 'slip' : (initial.source || 'manual'), slip_ref: f.slip_ref,
          slipFileId: slip ? slip.fileId : '', allowDuplicate: allowDuplicate || !!(slip && slip.duplicate && slip.confirmedDuplicate)
        };
        const saved = await api('saveTransaction', payload);
        const list = S.data.transactions;
        const i = list.findIndex(t => t.id === saved.id);
        if (i >= 0) list[i] = saved; else list.push(saved);
        learnLocally(saved);
        if (f.account) store.set('lastAccount', f.account);
        result = 'saved';
        if (!slip) S.month = monthOf(saved.date) <= thisMonth() ? monthOf(saved.date) : S.month;
        toast(isEdit ? 'Changes saved' : `Saved ${money(saved.amount)}`);
        sheet.close('saved');
        render();
      } catch (err) {
        const msg = err.message || String(err);
        if (/^DUPLICATE/.test(msg)) {
          $('#ed-error', sheet.body).innerHTML = `<div class="banner danger"><span>${esc(msg.replace(/^DUPLICATE:\s*/, ''))}<br><button class="btn btn-sm btn-danger" data-allow-dup style="margin-top:8px">Save anyway</button></span></div>`;
        } else {
          fail(esc(msg));
        }
        btn.disabled = false; btn.textContent = btnText;
      } finally {
        saving = false;
      }
    }

    draw();
    if (!slip && !isEdit && f.amount === '') setTimeout(() => { const a = $('#f-amount', sheet.body); if (a) a.focus(); }, 280);
  });
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
    t.category ? ['Category', `${ic.emoji} ${t.category}`] : null,
    t.payee ? [t.type === 'income' ? 'From' : 'Paid to', t.payee] : null,
    ['Date', `${dayLabel(t.date)}${t.time ? ', ' + t.time : ''}`],
    t.account ? ['Account', t.account] : null,
    t.method ? ['Method', t.method] : null,
    t.note ? ['Note', t.note] : null,
    t.slip_ref ? ['Slip ref', t.slip_ref] : null,
    ['Added', `${t.source === 'slip' ? 'From slip' : 'Manually'}${t.created_at ? ' · ' + t.created_at.slice(0, 16) : ''}`]
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
    }, { slip: { ...res, draft: d, index: i, total: files.length, confirmedDuplicate: !!res.duplicate } });

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

    const a = e.target.closest('[data-act]');
    if (a) {
      const act = a.dataset.act;
      if (act === 'scan') return pickSlips();
      if (act === 'manual') return openEditor({ type: 'expense' });
      if (act === 'friend-new') return openEditor({ type: 'lend' });
      if (act === 'see-month') { S.hist = { q: '', type: 'all', month: S.month, cat: '' }; return go('history'); }
      if (act === 'more') { histLimit += 150; return renderHistory(); }
      if (act === 'save-settings') return saveSettingsNow(a);
      if (act === 'reload') return location.reload();
      if (act === 'logout' || act === 'logout-all') return signOut(act === 'logout-all', a);
    }

    const ht = e.target.closest('[data-htype]');
    if (ht) { S.hist.type = ht.dataset.htype; histLimit = 150; return renderHistory(); }

    // Settings
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
    S.data = data;
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
  $('#view-home').innerHTML = `
    <div class="skeleton" style="height:44px;margin:4px 0 12px"></div>
    <div class="skeleton" style="height:180px;margin-bottom:12px"></div>
    <div class="skeleton" style="height:300px"></div>`;
  try {
    S.data = await api('getAppData');
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
boot();
})();

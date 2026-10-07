// QA panel for the local preview only (never part of the real app in docs/).
// A small circle in the corner; tap it to load the app with other data, e.g. "No monthly items".
(function () {
  const qa = window.__qa;
  if (!qa) return;

  const css = `
    :root { --qa: #7048E8; --qa-soft: #EFEBFF; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --qa: #9775FA; --qa-soft: #2A2342; } }
    :root[data-theme="dark"] { --qa: #9775FA; --qa-soft: #2A2342; }
    #qa-fab { position: fixed; left: 12px; bottom: calc(var(--tabbar-h, 64px) + env(safe-area-inset-bottom, 0px) + 14px); z-index: 30;   /* above the page, under popups */
      width: 40px; height: 40px; border-radius: 50%; border: 2px dashed var(--qa); background: var(--qa-soft); color: var(--qa);
      font: 700 11px/1 system-ui, sans-serif; letter-spacing: .04em; opacity: .7; box-shadow: var(--shadow); cursor: pointer; }
    #qa-fab:hover, #qa-fab:focus-visible, #qa-fab[aria-expanded="true"] { opacity: 1; outline: none; }
    #qa-panel { position: fixed; left: 12px; bottom: calc(var(--tabbar-h, 64px) + env(safe-area-inset-bottom, 0px) + 62px); z-index: 35;
      width: min(310px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto; background: var(--card); color: var(--text);
      border: 2px dashed var(--qa); border-radius: 16px; padding: 12px; box-shadow: 0 8px 30px rgba(0,0,0,.18); }
    #qa-panel h4 { margin: 0 0 2px; font-size: 14px; color: var(--qa); }
    #qa-panel .qa-note { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
    #qa-panel button.qa-case { display: block; width: 100%; text-align: left; padding: 9px 10px; border-radius: 10px; border: 1px solid transparent;
      background: none; color: var(--text); cursor: pointer; }
    #qa-panel button.qa-case:hover { background: var(--card-2); }
    #qa-panel button.qa-case.is-on { border-color: var(--qa); background: var(--qa-soft); }
    #qa-panel button.qa-case b { display: block; font-size: 14px; font-weight: 600; }
    #qa-panel button.qa-case span { display: block; font-size: 12px; color: var(--muted); }`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const fab = document.createElement('button');
  fab.id = 'qa-fab';
  fab.type = 'button';
  fab.textContent = 'QA';
  fab.setAttribute('aria-label', 'Test cases (preview only)');
  fab.setAttribute('aria-expanded', 'false');

  const panel = document.createElement('div');
  panel.id = 'qa-panel';
  panel.hidden = true;
  const current = qa.cases.find(c => c[0] === qa.current) || qa.cases[0];
  panel.innerHTML = `
    <h4>Test cases</h4>
    <div class="qa-note">Preview only. Loads the app with this data. Now: <b>${current[1]}</b></div>
    ${qa.cases.map(([id, name, hint]) => `<button type="button" class="qa-case ${id === qa.current ? 'is-on' : ''}" data-qa="${id}"><b>${name}</b><span>${hint}</span></button>`).join('')}`;

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    fab.setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', e => {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== fab) { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); }
  });
  panel.addEventListener('click', e => {
    const c = e.target.closest('[data-qa]');
    if (!c) return;
    try { localStorage.setItem('et_qa_case', c.dataset.qa); } catch (err) { /* storage blocked: the #hash below still works */ }
    location.hash = 'qa-' + c.dataset.qa;
    location.reload();
  });
  document.body.append(fab, panel);
})();

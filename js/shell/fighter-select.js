/* Robot Fight shell: fighter select over the real arena.
   Both chosen robots stand on glowing pads in the ring. Side panels list the seven
   fighters (same model, data-driven paint / skin / stats). Portraits are snapshots
   rendered once offscreen and cached — no per-card live 3D. */
import { getFighterStats, STAT_BAR_KEYS, FIGHTER_PROFILES } from '../config.js';
import { aiConfig, AI_PROVIDERS } from '../api-brain.js';

const S = window.RFShell;
const BAR_KEYS = STAT_BAR_KEYS || ['power', 'speed', 'armor', 'reach', 'recovery'];
const LABEL = { power: 'Power', speed: 'Speed', armor: 'Armor', reach: 'Reach', recovery: 'Recovery' };
const SIDE_COLOR = { p1: '#3f7dff', p2: '#ff4040' };

const st = { active: false, host: null, portraits: {}, busy: false, ptr: false, painted: false };

const esc = (t) => S.esc(t);
const H = () => S.selectHooks;
const mode = () => S.state.mode;
const isCpu = (side) => (side === 'p2' ? mode() !== 'versus' : mode() === 'watch');
const roster = () => S.ROSTER || [];
const fighter = (id) => (id && id !== 'random' && S.fighterOf ? S.fighterOf(id) : null);

/* ---------- AI API brain (same keys as Settings; the key is never shown or logged) ---------- */
const LS = { on: 'rf_ai_on', provider: 'rf_ai_provider', model: 'rf_ai_model', key: 'rf_ai_key', p1: 'rf_ai_brain_p1', p2: 'rf_ai_brain_p2' };
const SET_ID = { on: 'aiOn', provider: 'aiProvider', model: 'aiModel', key: 'aiKey', p1: 'aiBrainP1', p2: 'aiBrainP2' };
function aiWrite(k, v) {
  const el = document.getElementById(SET_ID[k]);
  if (el) {
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  try {
    if (k === 'on') localStorage.setItem(LS.on, v ? '1' : '0');
    else if (v === '' || v == null) localStorage.removeItem(LS[k]);
    else localStorage.setItem(LS[k], v);
  } catch (_) { /* storage blocked */ }
}
const apiAllowed = (side) => (side === 'p1' ? !['arcade', 'training'].includes(mode()) : mode() !== 'training');
function brainOf(side) {
  if (!isCpu(side)) return 'player';
  const c = aiConfig();
  return c.on && c.brain[side] === 'api' ? 'api' : 'cpu';
}
function apiStatus(side) {
  const c = aiConfig();
  const f = S.fighters && S.fighters()[side === 'p1' ? 0 : 1];
  const bs = f && f.brain && f.brain.kind === 'api' ? f.brain.stats : null;
  if (bs && bs.errors > 0 && bs.lastError) return { cls: 'err', txt: 'Last request failed: ' + String(bs.lastError).slice(0, 48) };
  if (!c.key) return { cls: 'warn', txt: 'Add an API key to use the AI brain' };
  if (!c.base || !c.model) return { cls: 'warn', txt: 'Set a base URL and model in Settings' };
  return { cls: 'ok', txt: 'Ready · key saved in this browser' };
}
function apiPanel(side) {
  const c = aiConfig();
  let model = '';
  try { model = localStorage.getItem(LS.model) || ''; } catch (_) { /* ignore */ }
  const st0 = apiStatus(side);
  return `<div class="fs-api" data-side="${side}">
    <div class="fs-apistat"><i class="fs-dot ${st0.cls}"></i><span>${esc(st0.txt)}</span></div>
    <label><span>Provider</span><select class="fs-in" data-api="provider">${Object.entries(AI_PROVIDERS).map(([k, p]) => `<option value="${k}"${k === c.provider ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
    <label><span>Model</span><input class="fs-in" data-api="model" list="fsModels-${side}" value="${esc(model)}" placeholder="${esc(AI_PROVIDERS[c.provider].model || 'model name')}" autocomplete="off" spellcheck="false">
      <datalist id="fsModels-${side}">${Object.values(AI_PROVIDERS).filter((p) => p.model).map((p) => `<option value="${esc(p.model)}"></option>`).join('')}</datalist></label>
    <label><span>API key</span><input class="fs-in" type="password" data-api="key" autocomplete="off" spellcheck="false" placeholder="${c.key ? 'Saved · type to replace' : 'Paste key'}"></label>
  </div>`;
}
function paintApi() {
  if (!st.host) return;
  st.host.querySelectorAll('.fs-api').forEach((el) => {
    const r = apiStatus(el.dataset.side);
    const dot = el.querySelector('.fs-dot');
    if (dot) dot.className = 'fs-dot ' + r.cls;
    const span = el.querySelector('.fs-apistat span');
    if (span) span.textContent = r.txt;
    const key = el.querySelector('[data-api="key"]');
    if (key && document.activeElement !== key) key.placeholder = aiConfig().key ? 'Saved · type to replace' : 'Paste key';
  });
}
function onChange(e) {
  const t = e.target;
  if (!t.dataset || !t.dataset.api) return;
  const k = t.dataset.api;
  if (k === 'provider') { aiWrite('provider', t.value); render(); return; }
  if (k === 'model') aiWrite('model', t.value.trim());
  else if (k === 'key') { const v = t.value.trim(); if (v) aiWrite('key', v); t.value = ''; t.blur(); }
  S.sfx('click');
  paintApi();
}

function ctrlToggle(side) {
  const m = mode();
  const cur = brainOf(side);
  let lockP = false;
  let lockC = false;
  let note = '';
  if (side === 'p1' && (m === 'arcade' || m === 'training')) { lockC = true; note = m === 'arcade' ? 'Arcade is played by you.' : 'Training is played by you.'; }
  else if (side === 'p1' && m === 'watch') note = 'Bot vs Bot: both robots run on a CPU or AI brain.';
  else if (side === 'p2' && m === 'arcade') { lockP = true; note = 'Arcade is a solo ladder.'; }
  else if (side === 'p2' && m === 'training') { lockP = true; note = 'Training uses a dummy (no brain).'; }
  const lockA = !apiAllowed(side);
  const b = (v, label, locked) => `<button type="button" class="rfs-f fs-tog" data-fs="ctrl" data-side="${side}" data-v="${v}" aria-pressed="${cur === v}"${locked ? ' aria-disabled="true"' : ''}>${label}</button>`;
  return `<div class="fs-ctrl" role="group" aria-label="${side.toUpperCase()} control">${b('player', side === 'p1' ? 'Player' : 'Player', lockP)}${b('cpu', m === 'training' && side === 'p2' ? 'Dummy' : 'CPU', lockC)}${b('api', 'AI API', lockA)}</div>
    ${note ? `<p class="fs-note">${note}</p>` : ''}${cur === 'api' ? apiPanel(side) : ''}`;
}

/* ---------- picks + stats ---------- */
function pickOf(side) {
  const sel = H().sel;
  if (side === 'p1') return sel.p1Id || roster()[0].id;
  if (mode() === 'versus') return sel.p2Id || roster()[0].id;
  if (mode() === 'training') return 'dummy';
  if (mode() === 'arcade') return (S.arcade && roster()[S.arcade.idx] && roster()[S.arcade.idx].id) || roster()[0].id;
  return sel.opp || 'sprocket';
}
function setPick(side, id) {
  const sel = H().sel;
  if (side === 'p1') {
    sel.p1Id = id;
    S.save('p1Id', id);
  } else {
    sel.p2Id = id;
    sel.opp = id;
    S.save('p2Id', id);
    S.save('opp', id);
  }
  if (H().syncSelPaint) H().syncSelPaint();
  if (H().previewSelect) H().previewSelect();
  paint();
}
function statsOf(id) {
  const f = fighter(id);
  const pid = (f && (f.profile || f.id)) || id;
  try { return getFighterStats(pid); } catch (_) { return null; }
}
function traitsOf(id) {
  const g = statsOf(id);
  const p = g && FIGHTER_PROFILES[g.id];
  if (!p) return { strengths: [], weaknesses: [] };
  return { strengths: (p.strengths || []).slice(), weaknesses: (p.weaknesses || []).slice() };
}
function statBars(id) {
  const g = statsOf(id);
  if (!g) return '';
  return BAR_KEYS.map((k) => {
    const v = g.ratings[k] || 0;
    const pct = Math.max(6, Math.min(100, (v / 10) * 100));
    return `<div class="fs-bar" title="${LABEL[k]} ${v}/10"><span>${LABEL[k]}</span><i><u style="--v:${pct.toFixed(1)}%"></u></i></div>`;
  }).join('');
}
function portraitHtml(id, alt) {
  const src = st.portraits[id];
  return `<span class="fs-pic">${src ? `<img src="${src}" alt="${esc(alt || '')}">` : ''}</span>`;
}

function canPick(side) {
  const m = mode();
  if (side === 'p2' && (m === 'arcade' || m === 'training')) return false;
  return true;
}

function card(f, side, selected) {
  const locked = !canPick(side);
  return `<button type="button" class="rfs-f fs-card${selected ? ' is-on' : ''}${locked ? ' is-locked' : ''}" data-fs="pick" data-side="${side}" data-id="${f.id}" aria-pressed="${selected}" ${locked ? 'aria-disabled="true"' : ''} ${selected && side === 'p1' ? 'data-autofocus' : ''} style="--a:${f.primary};--b:${f.accent}">
    ${portraitHtml(f.id, f.name)}
    <span class="fs-meta">
      <b>${esc(f.name)}</b>
      <em>${esc(f.style)}</em>
      <span class="fs-bars">${statBars(f.id)}</span>
    </span>
  </button>`;
}

function sideTitle(side) {
  const m = mode();
  if (side === 'p1') {
    if (m === 'watch') return { kicker: 'Blue corner', title: 'Choose your fighter' };
    if (m === 'versus') return { kicker: 'Blue corner', title: 'Choose your fighter' };
    return { kicker: 'Blue corner', title: 'Choose your fighter' };
  }
  if (m === 'versus') return { kicker: 'Red corner', title: 'Choose opponent' };
  if (m === 'training') return { kicker: 'Red corner', title: 'Training dummy' };
  if (m === 'arcade') return { kicker: 'Red corner', title: 'The ladder' };
  return { kicker: 'Red corner', title: 'Choose opponent' };
}

function randomBtn(side) {
  if (!canPick(side)) return '';
  const on = pickOf(side) === 'random';
  return `<button type="button" class="rfs-f fs-random${on ? ' is-on' : ''}" data-fs="pick" data-side="${side}" data-id="random" aria-pressed="${on}">Random</button>`;
}

function sidePanel(side) {
  const m = mode();
  const head = sideTitle(side);
  const cur = pickOf(side);
  let body;
  if (side === 'p2' && m === 'training') {
    const sel = H().sel;
    body = `<div class="fs-seg">
      <button type="button" class="rfs-f fs-tog" data-fs="dummy" data-v="idle" aria-pressed="${!sel.dummyBlock}">Stand idle</button>
      <button type="button" class="rfs-f fs-tog" data-fs="dummy" data-v="block" aria-pressed="${!!sel.dummyBlock}">Hold block</button>
    </div>
    <p class="fs-note">No timer. Press <kbd>R</kbd> to reset damage, <kbd>B</kbd> to toggle blocking.</p>`;
  } else if (side === 'p2' && m === 'arcade') {
    const idx = (S.arcade && S.arcade.idx) || 0;
    body = `<div class="fs-cards fs-ladder">${roster().map((f, i) => `
      <div class="fs-card is-locked${i === idx ? ' is-next' : ''}${i < idx ? ' is-beaten' : ''}" style="--a:${f.primary};--b:${f.accent}">
        ${portraitHtml(f.id, f.name)}
        <span class="fs-meta"><b>${esc(f.name)}</b><em>${esc(f.style)}${i === idx ? ' · Next' : (i < idx ? ' · Beaten' : '')}</em></span>
      </div>`).join('')}</div>`;
  } else {
    body = `<div class="fs-cards" role="listbox" aria-label="${esc(head.title)}">${roster().map((f) => card(f, side, cur === f.id)).join('')}</div>${randomBtn(side)}`;
  }
  return `<section class="fs-side" data-side="${side}" style="--pc:${SIDE_COLOR[side]}">
    <header class="fs-head"><small>${esc(head.kicker)}</small><b>${esc(head.title)}</b></header>
    ${ctrlToggle(side)}
    ${body}
  </section>`;
}

function vsHalf(id) {
  if (id === 'random') {
    return `<div class="fs-vsbox">
      <p class="fs-trait up"><b>Strengths</b><span>Any of the seven</span></p>
      <p class="fs-trait down"><b>Weaknesses</b><span>A surprise pick</span></p>
    </div>`;
  }
  if (id === 'dummy') {
    return `<div class="fs-vsbox">
      <p class="fs-trait up"><b>Strengths</b><span>Holds still</span></p>
      <p class="fs-trait down"><b>Weaknesses</b><span>Does not fight back</span></p>
    </div>`;
  }
  const f = fighter(id);
  const tr = traitsOf(id);
  return `<div class="fs-vsbox">
    ${tr.strengths.length ? `<p class="fs-trait up"><b>Strengths</b><span>${tr.strengths.map(esc).join(', ')}</span></p>` : ''}
    ${tr.weaknesses.length ? `<p class="fs-trait down"><b>Weaknesses</b><span>${tr.weaknesses.map(esc).join(', ')}</span></p>` : ''}
    ${f ? `<small>${esc(f.name)} · ${esc(f.style)}</small>` : ''}
  </div>`;
}

function vsBlock() {
  return `<div class="fs-vsrow" aria-live="polite">${vsHalf(pickOf('p1'))}<div class="fs-vs" aria-hidden="true">VS</div>${vsHalf(pickOf('p2'))}</div>`;
}

function selScreen() { return document.querySelector('.rfs-screen[data-screen="select"]'); }

function render() {
  const scr = selScreen();
  if (!scr) return;
  const m = mode();
  const sub = (H().modeInfo ? H().modeInfo(m) : H().MODE_INFO[m])[1];
  const title = (H().MODE_INFO[m] || ['Choose', ''])[0];
  scr.classList.add('fs-on');
  let host = scr.querySelector('.fs');
  if (!host) {
    host = document.createElement('div');
    host.className = 'fs';
    scr.appendChild(host);
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.addEventListener('keydown', (e) => { if (e.target.matches && e.target.matches('input, select')) e.stopPropagation(); });
    host.addEventListener('pointermove', () => { st.ptr = true; });
    host.addEventListener('keydown', () => { st.ptr = false; }, true);
  }
  st.host = host;
  host.innerHTML = `
    <header class="fs-top"><small>${esc(title)} · ${esc(sub)}</small></header>
    ${sidePanel('p1')}
    ${sidePanel('p2')}
    ${vsBlock()}
    <footer class="fs-foot">
      <button type="button" class="rfs-f rfs-btn rfs-small" data-fs="back">Back</button>
      <button type="button" class="rfs-f rfs-btn rfs-go fs-go" data-fs="go" data-autofocus>${m === 'arcade' ? 'To the ladder' : 'Start'}</button>
    </footer>`;
  paint();
}

function paint() {
  const host = st.host;
  if (!host) return;
  const cpu = host.querySelector('.fs-cpu');
  if (cpu) { const c = S.cpuSetting(); cpu.textContent = c[0].toUpperCase() + c.slice(1); }
  paintApi();
  host.querySelectorAll('.fs-pic').forEach((el) => {
    const card = el.closest('[data-id]');
    const id = card && card.dataset.id;
    if (id && st.portraits[id] && !el.querySelector('img')) {
      const img = document.createElement('img');
      img.src = st.portraits[id];
      img.alt = '';
      el.appendChild(img);
    }
  });
}

function onClick(e) {
  const b = e.target.closest('[data-fs]');
  if (!b || st.busy) return;
  const sel = H().sel;
  const side = b.dataset.side;
  switch (b.dataset.fs) {
    case 'pick':
      if (b.classList.contains('is-locked') || b.getAttribute('aria-disabled') === 'true') return;
      S.sfx('click');
      setPick(side, b.dataset.id);
      render();
      return;
    case 'ctrl': {
      if (b.getAttribute('aria-disabled') === 'true') {
        const v0 = b.dataset.v;
        S.sfx('close');
        return S.toast(v0 === 'api'
          ? (side === 'p1' ? 'P1 is you in this mode, so it has no brain to swap.' : 'The training dummy has no brain.')
          : side === 'p1' ? 'P1 is you in this mode.' : (mode() === 'arcade' ? 'Arcade is solo: P2 is always the CPU ladder.' : 'Training always uses the dummy.'));
      }
      const v = b.dataset.v;
      const m0 = mode();
      const before = brainOf(side);
      if (before === v) return;
      let want = m0;
      if (v === 'player') want = side === 'p2' ? 'versus' : (m0 === 'watch' ? 'fight' : m0);
      else if (side === 'p2') want = (m0 === 'versus') ? 'fight' : m0;
      else want = 'watch';
      S.sfx('click');
      S.state.mode = want;
      if (v === 'api') { aiWrite(side, 'api'); if (!aiConfig().on) aiWrite('on', true); }
      else if (v === 'cpu') aiWrite(side, 'cpu');
      render();
      if (want !== m0 && H().previewSelect) H().previewSelect();
      return;
    }
    case 'dummy':
      sel.dummyBlock = b.dataset.v === 'block';
      S.save('dummyBlock', sel.dummyBlock);
      S.sfx('click');
      st.host.querySelectorAll('[data-fs="dummy"]').forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.v === 'block') === sel.dummyBlock)));
      return;
    case 'back':
      return S.nav('back');
    case 'go':
      return go();
    default:
  }
}

function go() {
  st.busy = true;
  try { H().start(); } catch (err) {
    console.error('[fighter-select]', err);
    st.busy = false;
  }
}

function ensurePortraits() {
  if (st.painted || !S.api || typeof S.api.renderRosterPortraits !== 'function') return;
  st.painted = true;
  const list = roster().map((o) => ({ id: o.id, name: o.name, primary: o.primary, accent: o.accent, profile: o.profile || o.id }));
  try {
    const map = S.api.renderRosterPortraits(list);
    st.portraits = map || {};
    paint();
  } catch (err) {
    console.warn('[fighter-select] portraits', err);
    st.painted = false;
  }
}

function open(m) {
  const hooks = H();
  if (!hooks || !S.api) return false;
  S.state.mode = m;
  st.busy = false;
  st.active = true;
  document.body.classList.add('fs-open');
  render();
  S.showScreen('select');
  requestAnimationFrame(() => {
    if (!st.active) return;
    try { ensurePortraits(); } catch (err) { console.warn('[fighter-select] portraits', err); }
    try { hooks.previewSelect(); } catch (err) { console.error('[fighter-select] preview', err); }
  });
  return true;
}

function close() {
  st.active = false;
  document.body.classList.remove('fs-open');
  const scr = selScreen();
  if (scr) scr.classList.remove('fs-on');
}

if (S) {
  S.fighterSelect = { open, ROBOTS: roster() };
  const baseShow = S.showScreen;
  S.showScreen = (name) => {
    const was = st.active;
    if (was && name !== 'select') close();
    baseShow(name);
    if (!was && name === 'select' && H() && S.state.mode) open(S.state.mode);
  };
  const baseNav = S.nav;
  S.nav = (act) => {
    if (st.active && st.busy && act !== 'back') return;
    baseNav(act);
  };
  S.on('pads', () => { if (st.active) paint(); });
}

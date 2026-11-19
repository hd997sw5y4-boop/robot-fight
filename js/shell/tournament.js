'use strict';
import {
  testApiKey, AI_PROVIDERS, corsNote, saveEntrantKey, loadEntrantKey, clearEntrantKey,
  onApiDecision, apiStatsSnapshot,
} from '../api-brain.js';

const STORE = 'rf_ai_tourney_v1';
const ELO0 = 1500;
const EK = 32;
const PRESET_COLORS = ['#22c3e6', '#ff7a2f', '#3fd6a6', '#e23b3b', '#8b5cf6', '#ff6fa8', '#dde8f5', '#4a505c'];

function uid() { return 'e' + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

function loadSetup() {
  try {
    const raw = JSON.parse(lsGet(STORE, 'null'));
    if (raw && Array.isArray(raw.entrants) && raw.entrants.length >= 2) {
      return raw.entrants.map((e) => ({
        id: e.id || uid(),
        name: e.name || 'Entrant',
        color: e.color || PRESET_COLORS[0],
        provider: AI_PROVIDERS[e.provider] ? e.provider : 'xai',
        base: e.base || '',
        model: e.model || '',
      }));
    }
  } catch (_) {}
  return [
    { id: uid(), name: 'Grok', color: PRESET_COLORS[0], provider: 'xai', base: '', model: '' },
    { id: uid(), name: 'GPT', color: PRESET_COLORS[1], provider: 'openai', base: '', model: '' },
  ];
}
function saveSetup(list) {
  const entrants = list.map((e) => ({ id: e.id, name: e.name, color: e.color, provider: e.provider, base: e.base || '', model: e.model || '' }));
  lsSet(STORE, JSON.stringify({ entrants }));
}

function resolved(e) {
  const def = AI_PROVIDERS[e.provider] || AI_PROVIDERS.custom;
  return {
    ...e,
    base: (e.base || def.base || '').replace(/\/+$/, ''),
    model: (e.model || def.model || '').trim(),
    key: loadEntrantKey(e.id),
  };
}

function eloExpected(a, b) { return 1 / (1 + 10 ** ((b - a) / 400)); }
function eloUpdate(ra, rb, sa) {
  const ea = eloExpected(ra, rb);
  return [+(ra + EK * (sa - ea)).toFixed(1), +(rb + EK * ((1 - sa) - (1 - ea))).toFixed(1)];
}

function makeSchedule(ids) {
  const bouts = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      bouts.push([ids[i], ids[j]]);
      bouts.push([ids[j], ids[i]]);
    }
  }
  return bouts;
}

function boot() {
  const S = window.RFShell;
  if (!S || !S.showScreen) return requestAnimationFrame(boot);
  const root = document.getElementById('rfs') || document.body;

  function screen(name, cls) {
    let el = root.querySelector(`.rfs-screen[data-screen="${name}"]`);
    if (el) return el;
    el = document.createElement('section');
    el.className = 'rfs-screen ' + (cls || '');
    el.dataset.screen = name;
    root.appendChild(el);
    return el;
  }
  const setupEl = screen('tourney');
  const resultsEl = screen('tourney-results', 'rfs-dim');

  let entrants = loadSetup();
  let tourney = null; // { entrants, bouts, idx, standings, log, running }
  let hud = null;
  let nextTimer = null;

  function blankStanding(e) {
    return { id: e.id, name: e.name, color: e.color, provider: e.provider, model: resolved(e).model, w: 0, l: 0, d: 0, elo: ELO0, lat: [], errors: 0, targets: {}, styles: {}, parts: 0, bestCombo: 0, fallbackMs: 0, calls: 0 };
  }

  S.openTournament = () => {
    stopHud();
    tourney = null;
    entrants = loadSetup();
    paintSetup();
    S.showScreen('tourney');
  };

  function paintSetup() {
    saveSetup(entrants);
    const canAdd = entrants.length < 8;
    const canStart = entrants.length >= 2;
    setupEl.innerHTML = `
      <div class="rft-wrap">
        ${S.esc ? '' : ''}
        <div class="rfs-brand"><small>Window Workshop Games</small><b>Robot Fight</b></div>
        <h1>AI Tournament</h1>
        <p class="rft-sub">Round-robin · 2–8 API brains · same prompt, budget and throttle · sides swapped</p>
        <div class="rft-grid">${entrants.map((e, i) => cardHtml(e, i)).join('')}</div>
        <div class="rft-actions">
          <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="add" ${canAdd ? '' : 'disabled'}><b>Add entrant</b></button>
          <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="back"><b>Back</b></button>
          <button type="button" class="rfs-f rfs-btn rfs-go" data-rft="start" data-autofocus ${canStart ? '' : 'disabled'}><b>Start tournament</b></button>
        </div>
        <p class="rft-note">Each key stays only in this browser, is sent only to that entrant’s endpoint as <code>Authorization: Bearer</code>, and is never written to the fight log or a URL. ${corsNote('xai')} ${corsNote('openai')}</p>
      </div>`;
    setupEl.querySelectorAll('[data-rft="add"]').forEach((b) => { b.onclick = addEntrant; });
    setupEl.querySelectorAll('[data-rft="back"]').forEach((b) => { b.onclick = () => S.showScreen('main'); });
    setupEl.querySelectorAll('[data-rft="start"]').forEach((b) => { b.onclick = startTourney; });
    setupEl.querySelectorAll('[data-eid]').forEach(bindCard);
  }

  function cardHtml(e, i) {
    const def = AI_PROVIDERS[e.provider] || AI_PROVIDERS.custom;
    const hasKey = !!loadEntrantKey(e.id);
    const provOpts = Object.entries(AI_PROVIDERS).map(([k, v]) => `<option value="${k}" ${e.provider === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    const colorOpts = PRESET_COLORS.map((c) => `<option value="${c}" ${e.color === c ? 'selected' : ''}>${c}</option>`).join('');
    return `<article class="rft-card" data-eid="${esc(e.id)}">
      <h3><i class="rft-sw" style="background:${esc(e.color)}"></i> Entrant ${i + 1}
        <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="del" ${entrants.length <= 2 ? 'disabled' : ''} style="margin-left:auto">Remove</button></h3>
      <label>Name <input type="text" data-f="name" value="${esc(e.name)}" maxlength="24" autocomplete="off" spellcheck="false"></label>
      <label>Color <select data-f="color">${colorOpts}</select></label>
      <label>Provider <select data-f="provider">${provOpts}</select></label>
      <label>Base URL <input type="url" data-f="base" value="${esc(e.base)}" placeholder="${esc(def.base || 'https://your-endpoint/v1')}" autocomplete="off" spellcheck="false"></label>
      <label>Model <input type="text" data-f="model" value="${esc(e.model)}" placeholder="${esc(def.model || 'model name')}" autocomplete="off" spellcheck="false"></label>
      <label>API key <input type="password" data-f="key" value="${hasKey ? '••••••••' : ''}" placeholder="${hasKey ? 'Key saved in this browser' : 'Paste key'}" autocomplete="off" spellcheck="false"></label>
      <div class="rft-row">
        <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="test">Test key</button>
        <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="clearkey">Clear key</button>
      </div>
      <p class="rft-status" data-rft="status">${hasKey ? 'Key saved in this browser only.' : 'No key saved.'}</p>
    </article>`;
  }

  function bindCard(card) {
    const id = card.dataset.eid;
    const find = () => entrants.find((x) => x.id === id);
    card.querySelectorAll('input, select').forEach((el) => {
      el.addEventListener('keydown', (ev) => ev.stopPropagation());
      const apply = () => {
        const e = find();
        if (!e) return;
        const f = el.dataset.f;
        if (f === 'key') {
          const v = el.value.trim();
          if (v && v !== '••••••••') saveEntrantKey(id, v);
          return;
        }
        e[f] = el.value;
        if (f === 'provider') { e.base = ''; e.model = ''; saveSetup(entrants); paintSetup(); return; }
        saveSetup(entrants);
        if (f === 'color') {
          const sw = card.querySelector('.rft-sw');
          if (sw) sw.style.background = e.color;
        }
      };
      el.addEventListener('change', apply);
      el.addEventListener('blur', apply);
    });
    const del = card.querySelector('[data-rft="del"]');
    if (del) del.onclick = () => {
      if (entrants.length <= 2) return;
      clearEntrantKey(id);
      entrants = entrants.filter((x) => x.id !== id);
      saveSetup(entrants);
      paintSetup();
    };
    const test = card.querySelector('[data-rft="test"]');
    const status = card.querySelector('[data-rft="status"]');
    if (test) test.onclick = async () => {
      const e = find();
      const keyEl = card.querySelector('[data-f="key"]');
      const typed = keyEl && keyEl.value.trim();
      if (typed && typed !== '••••••••') saveEntrantKey(id, typed);
      const c = resolved(e);
      if (status) { status.className = 'rft-status'; status.textContent = 'Testing key…'; }
      const out = await testApiKey({ provider: c.provider, base: c.base, model: c.model, key: c.key });
      if (!status) return;
      if (out.ok) { status.className = 'rft-status ok'; status.textContent = 'OK · ' + (out.model || c.model) + ' · ' + out.latency + ' ms'; }
      else if (out.kind === 'key_rejected') { status.className = 'rft-status bad'; status.textContent = 'Key rejected.'; }
      else if (out.kind === 'cors') { status.className = 'rft-status bad'; status.textContent = 'CORS or network error. ' + corsNote(c.provider); }
      else { status.className = 'rft-status bad'; status.textContent = out.error || 'Test failed'; }
    };
    const ck = card.querySelector('[data-rft="clearkey"]');
    if (ck) ck.onclick = () => { clearEntrantKey(id); paintSetup(); };
  }

  function addEntrant() {
    if (entrants.length >= 8) return;
    const n = entrants.length + 1;
    entrants.push({ id: uid(), name: 'Entrant ' + n, color: PRESET_COLORS[n % PRESET_COLORS.length], provider: 'xai', base: '', model: '' });
    saveSetup(entrants);
    paintSetup();
  }

  function startTourney() {
    saveSetup(entrants);
    const ready = entrants.map(resolved);
    const missing = ready.filter((e) => !e.key || !e.base || !e.model);
    if (missing.length) {
      alert('Every entrant needs a provider, a model, and an API key. Missing: ' + missing.map((e) => e.name).join(', '));
      return;
    }
    tourney = {
      entrants: ready,
      byId: Object.fromEntries(ready.map((e) => [e.id, e])),
      standings: Object.fromEntries(ready.map((e) => [e.id, blankStanding(e)])),
      bouts: makeSchedule(ready.map((e) => e.id)),
      idx: 0,
      log: [],
      running: true,
    };
    launchBout();
  }

  function launchBout() {
    if (!tourney || tourney.idx >= tourney.bouts.length) { finishTourney(); return; }
    const [aId, bId] = tourney.bouts[tourney.idx];
    const a = tourney.byId[aId], b = tourney.byId[bId];
    const paint = (e, fallback) => ({ primary: e.color, accent: fallback });
    S.startMatch({
      mode: 'tournament',
      bestOf: 1,
      skipIntro: true,
      p1: {
        name: a.name, label: a.name,
        paint: paint(a, '#dde8f5'),
        apiBrain: { provider: a.provider, base: a.base, model: a.model, entrantId: a.id },
      },
      p2: {
        name: b.name, label: b.name,
        paint: paint(b, '#1b1e26'),
        apiBrain: { provider: b.provider, base: b.base, model: b.model, entrantId: b.id },
      },
    });
    showHud(a, b);
  }

  S.onTournamentMatchEnd = (w) => {
    if (!tourney) return;
    const [aId, bId] = tourney.bouts[tourney.idx];
    const A = tourney.standings[aId], B = tourney.standings[bId];
    const sa = w == null ? 0.5 : (w === 0 ? 1 : 0);
    const [na, nb] = eloUpdate(A.elo, B.elo, sa);
    A.elo = na; B.elo = nb;
    if (w == null) { A.d += 1; B.d += 1; }
    else if (w === 0) { A.w += 1; B.l += 1; }
    else { B.w += 1; A.l += 1; }
    const fighters = S.fighters && S.fighters();
    if (fighters) {
      harvestStats(A, fighters[0]);
      harvestStats(B, fighters[1]);
    }
    const M = S.match;
    const parts = (M && M.total) || [{ parts: 0 }, { parts: 0 }];
    A.parts += (parts[1] && parts[1].parts) || 0;
    B.parts += (parts[0] && parts[0].parts) || 0;
    tourney.log.push({ a: aId, b: bId, w, n: tourney.idx + 1 });
    tourney.idx += 1;
    stopHud(false);
    if (tourney.idx >= tourney.bouts.length) { finishTourney(); return; }
    const nxt = tourney.bouts[tourney.idx];
    const naN = tourney.byId[nxt[0]].name, nbN = tourney.byId[nxt[1]].name;
    showBetween(`Next: ${naN} vs ${nbN}  ·  match ${tourney.idx + 1} / ${tourney.bouts.length}`);
    clearTimeout(nextTimer);
    nextTimer = setTimeout(() => { nextTimer = null; if (tourney && tourney.running) launchBout(); }, 2200);
  };

  function harvestStats(st, f) {
    if (!f || !f.brain || f.brain.kind !== 'api') return;
    const snap = apiStatsSnapshot(f.brain);
    st.calls += snap.calls || 0;
    st.errors += (snap.errors || 0);
    st.fallbackMs += snap.fallbackMs || 0;
    if (snap.avgLatency) st.lat.push(snap.avgLatency);
    const raw = f.brain.apiStats;
    if (raw && raw.targets) for (const [k, n] of Object.entries(raw.targets)) st.targets[k] = (st.targets[k] || 0) + n;
    if (raw && raw.styles) for (const [k, n] of Object.entries(raw.styles)) st.styles[k] = (st.styles[k] || 0) + n;
  }

  function finishTourney() {
    tourney.running = false;
    stopHud();
    paintResults();
    S.showScreen('tourney-results');
  }

  function ranked() {
    return Object.values(tourney.standings).sort((a, b) => b.elo - a.elo || (b.w - a.w) || (a.l - b.l));
  }
  function winRate(s) {
    const n = s.w + s.l + s.d;
    return n ? s.w / n : 0;
  }
  function fav(map, fallback) {
    let best = fallback, n = -1;
    for (const [k, v] of Object.entries(map || {})) if (v > n) { n = v; best = k; }
    return best;
  }
  function avg(arr) { return arr && arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

  function paintResults() {
    const rows = ranked();
    const nE = tourney.entrants.length;
    const nM = tourney.bouts.length;
    const mostParts = rows.slice().sort((a, b) => b.parts - a.parts)[0];
    const styleKing = rows.slice().sort((a, b) => {
      const ta = Object.values(a.styles).reduce((x, y) => x + y, 0);
      const tb = Object.values(b.styles).reduce((x, y) => x + y, 0);
      const fa = fav(a.styles, '');
      return ((b.styles[fav(b.styles, '')] || 0) / (tb || 1)) - ((a.styles[fa] || 0) / (ta || 1));
    })[0];
    const styleName = fav(styleKing.styles, 'balanced');
    const styleN = Object.values(styleKing.styles).reduce((a, b) => a + b, 0);
    const stylePct = styleN ? Math.round(100 * (styleKing.styles[styleName] || 0) / styleN) : 0;
    resultsEl.innerHTML = `
      <div class="rft-wrap">
        <h1>Tournament Results</h1>
        <p class="rft-sub">Round-robin · ${nE} models · ${nM} matches · same prompt &amp; budget · sides swapped</p>
        <table class="rft-table">
          <thead><tr><th>#</th><th>Model</th><th>W – L</th><th>Win rate</th><th>Elo</th><th>Avg reply</th><th>Errors</th><th>Favorite target</th></tr></thead>
          <tbody>${rows.map((s, i) => {
            const wr = winRate(s);
            const lat = avg(s.lat);
            const bar = `<span class="rft-bar"><i style="width:${Math.round(wr * 100)}%;background:${esc(s.color)}"></i></span>`;
            return `<tr>
              <td>${i + 1}</td>
              <td><i class="rft-sw" style="background:${esc(s.color)};display:inline-block;margin-right:8px;vertical-align:middle"></i>${esc(s.name)}</td>
              <td>${s.w} – ${s.l}${s.d ? ' – ' + s.d : ''}</td>
              <td>${bar}</td>
              <td>${Math.round(s.elo)}</td>
              <td>${lat != null ? (lat / 1000).toFixed(1) + 's' : '–'}</td>
              <td>${s.errors}</td>
              <td>${esc(fav(s.targets, '–'))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
        <div class="rft-hl">
          <div class="rft-card"><small>Most limbs torn off</small><b>${esc(mostParts.name)} · ${mostParts.parts}</b></div>
          <div class="rft-card"><small>Favorite style</small><b>${esc(styleKing.name)} · ${esc(styleName)} ${stylePct}%</b></div>
          <div class="rft-card"><small>Matches</small><b>${nM} · same call budget</b></div>
        </div>
        <div class="rft-actions">
          <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="menu">Main menu</button>
          <button type="button" class="rfs-f rfs-btn rfs-go" data-rft="again" data-autofocus>New tournament</button>
        </div>
      </div>`;
    resultsEl.querySelector('[data-rft="menu"]').onclick = () => { tourney = null; S.abortMatch(); S.showScreen('main'); };
    resultsEl.querySelector('[data-rft="again"]').onclick = () => S.openTournament();
  }

  let unsubDec = null;
  const decisions = [];
  function showHud(a, b) {
    stopHud(false);
    hud = document.createElement('div');
    hud.className = 'rft-hud';
    hud.innerHTML = `
      <div class="rft-meta l" data-side="p1"></div>
      <div class="rft-meta r" data-side="p2"></div>
      <div class="rft-banner">AI vs AI · Match ${tourney.idx + 1} / ${tourney.bouts.length}</div>
      <div class="rft-bubble l" data-bub="p1"><b>${esc(a.name)} · plan</b><div data-plan>—</div><div class="rft-tags"></div></div>
      <div class="rft-bubble r" data-bub="p2"><b>${esc(b.name)} · plan</b><div data-plan>—</div><div class="rft-tags"></div></div>
      <div class="rft-dlog" data-dlog></div>
      <div class="rft-bar2">
        <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="skip">Skip wait</button>
        <button type="button" class="rfs-f rfs-btn rfs-small" data-rft="stop">Stop tournament</button>
      </div>`;
    document.body.appendChild(hud);
    hud.querySelector('[data-rft="stop"]').onclick = () => { tourney.running = false; clearTimeout(nextTimer); if (S.abortMatch) S.abortMatch(); stopHud(); S.openTournament(); };
    hud.querySelector('[data-rft="skip"]').onclick = () => { if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; if (tourney && tourney.running) launchBout(); } };
    decisions.length = 0;
    unsubDec = onApiDecision((rec) => {
      const name = rec.id === 'p1' ? a.name : b.name;
      const line = rec.error
        ? `${name} ${rec.kind === 'timeout' ? 'timeout → kept last plan' : (rec.kind || 'error')}`
        : `${name} ${rec.action || ''}${rec.target ? ' → ' + rec.target : ''}`;
      decisions.unshift(line);
      if (decisions.length > 8) decisions.pop();
      const log = hud && hud.querySelector('[data-dlog]');
      if (log) log.innerHTML = decisions.map((d) => `<div>${esc(d)}</div>`).join('');
      const bub = hud && hud.querySelector(`[data-bub="${rec.id}"]`);
      if (bub && rec.action) {
        bub.querySelector('[data-plan]').textContent = rec.plan || rec.action;
        const tags = bub.querySelector('.rft-tags');
        tags.innerHTML = `<span>${esc(rec.action)}</span>` + (rec.target ? `<span>target: ${esc(rec.target)}</span>` : '');
      }
      paintMeta();
    });
    paintMeta();
  }
  function paintMeta() {
    if (!hud || !S.fighters) return;
    const fs = S.fighters();
    if (!fs) return;
    for (const [i, side] of [['p1', 0], ['p2', 1]]) {
      const f = fs[side];
      const el = hud.querySelector(`.rft-meta[data-side="${i}"]`);
      if (!el || !f || !f.brain) continue;
      const s = apiStatsSnapshot(f.brain);
      const avg = s.avgLatency != null ? (s.avgLatency / 1000).toFixed(1) + 's' : '–';
      el.textContent = `avg reply ${avg}  ·  ${s.errors || 0} errors` + (s.timeouts ? `  ·  ${s.timeouts} timeout` : '');
    }
  }
  function showBetween(msg) {
    if (!hud) return;
    const b = hud.querySelector('.rft-banner');
    if (b) b.textContent = msg;
  }
  function stopHud(remove = true) {
    if (unsubDec) { unsubDec(); unsubDec = null; }
    if (remove && hud && hud.parentNode) hud.parentNode.removeChild(hud);
    if (remove) hud = null;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

'use strict';
/*
 * Optional "AI API Brain" (Settings > AI API Brain, off by default). Plugs into the brain
 * seam in brain.js: think(snapshot) -> intent. A few times a second (throttled) it sends a
 * compact state JSON to an OpenAI-compatible chat-completions endpoint (xAI Grok, OpenAI, or
 * any base URL) and asks for ONE action from the game's action set. The reply steers the
 * robot until the next one; on any error, timeout or invalid reply the built-in CPU brain
 * drives, so a fight never stalls.
 *
 * The API key is typed in by the user and kept only in this browser's localStorage. No key
 * ships with the game and nothing is sent anywhere except the endpoint the user picks.
 */

export const AI_ACTIONS = ['approach', 'retreat', 'circle_left', 'circle_right', 'punch', 'kick', 'jump_kick', 'flip_back', 'flip_front', 'block', 'ground', 'wait'];

export const AI_PROVIDERS = {
  // grok-4.3 with reasoning off is xAI's fast current model (grok-3-mini and the old fast slugs
  // now redirect to reasoning models, which spend a small token budget thinking and reply empty).
  xai: { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-4.3', effort: 'none' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  custom: { label: 'Other OpenAI-compatible', base: '', model: '' },
};

const K = {
  on: 'rf_ai_on', provider: 'rf_ai_provider', base: 'rf_ai_base', model: 'rf_ai_model',
  key: 'rf_ai_key', p1: 'rf_ai_brain_p1', p2: 'rf_ai_brain_p2',
};
const ls = {
  get(k, d = '') { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

export function aiConfig() {
  const provider = AI_PROVIDERS[ls.get(K.provider)] ? ls.get(K.provider) : 'xai';
  const def = AI_PROVIDERS[provider];
  return {
    on: ls.get(K.on) === '1',
    provider,
    base: (ls.get(K.base) || def.base).replace(/\/+$/, ''),
    model: ls.get(K.model) || def.model,
    key: ls.get(K.key),
    brain: { p1: ls.get(K.p1, 'cpu') === 'api' ? 'api' : 'cpu', p2: ls.get(K.p2, 'cpu') === 'api' ? 'api' : 'cpu' },
  };
}

// Does this fighter want the API brain right now?
export function wantsApiBrain(id) {
  const c = aiConfig();
  return c.on && !!c.key && !!c.base && !!c.model && c.brain[id] === 'api';
}

const SYSTEM = 'You control one heavy humanoid robot in a 3D fighting game. Each message is the current '
  + 'state as JSON (distances in metres, health 0-100, parts 0-1 health, 0 means torn off). Reply with JSON '
  + '{"action":"<one of: ' + AI_ACTIONS.join(', ') + '>"} and nothing else. Punch lands within strikeRange.punch, '
  + 'kick within strikeRange.kick; ground only works when opp.groundable is true; block when the opponent attacks; flip_back dodges a heavy strike '
  + '(only when self.canFlip); flip_front flips over or toward the opponent; jump_kick is a flying kick (needs canFlip).';

function compact(s) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const side = (x) => x && ({
    health: Math.round(x.health), state: x.state, attacking: !!x.attacking, blocking: !!x.blocking,
    down: !!x.down, edge: r2(x.edge || 0), parts: x.parts && Object.fromEntries(Object.entries(x.parts).map(([k, v]) => [k, r2(v)])),
    canPunch: x.canPunch, canKick: x.canKick, groundable: x.groundable, canFlip: x.canFlip, heavy: x.heavy,
  });
  return { dist: r2(s.dist || 0), strikeRange: s.strikeRange && { punch: r2(s.strikeRange.punch), kick: r2(s.strikeRange.kick) }, self: side(s.self), opp: side(s.opp) };
}

// Reply text from any OpenAI-compatible shape (string or content parts).
function replyText(j) {
  const m = j && j.choices && j.choices[0] && (j.choices[0].message || j.choices[0].delta);
  if (!m) return '';
  const c = m.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : (p && (p.text || p.content)) || '')).join('');
  return '';
}

const norm = (v) => String(v || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
export function parseAction(text) {
  if (!text) return null;
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // 1) JSON anywhere in the reply ({"action": "..."}), fenced or not.
  const objs = t.match(/\{[^{}]*\}/g) || [];
  for (const o of objs) {
    try { const j = JSON.parse(o); const a = norm(j.action || j.move || j.Action); if (AI_ACTIONS.includes(a)) return a; } catch (_) {}
  }
  // 2) "action": "..." without valid JSON.
  const kv = t.match(/action["'\s]*[:=]\s*["']?([a-z _-]+)/i);
  if (kv && AI_ACTIONS.includes(norm(kv[1]))) return norm(kv[1]);
  // 3) A bare action word ("circle left", "Punch."). The last mention wins (models reason first).
  const re = new RegExp('\\b(' + AI_ACTIONS.map((a) => a.replace('_', '[\\s_-]?')).join('|') + ')\\b', 'gi');
  const all = t.match(re);
  return all ? norm(all[all.length - 1]).replace(/^circle(left|right)$/, 'circle_$1') : null;
}

/* ---------- shared status + call log ---------- */
export const apiStatus = { ok: 0, fail: 0, lastOk: 0, lastFail: 0, lastError: '', lastLatency: 0, lastAction: '' };
const apiLog = [];
const LOG_MAX = 5000;
const listeners = new Set();
function bump() { for (const fn of listeners) { try { fn(apiStatus); } catch (_) {} } }
export function onApiStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function apiStatusText() {
  if (!apiStatus.ok && !apiStatus.fail) return 'API: waiting for the first reply';
  const failing = apiStatus.lastFail > apiStatus.lastOk;
  if (failing) return 'API failed, using CPU: ' + (apiStatus.lastError || 'error');
  return 'API: OK (' + apiStatus.lastLatency + ' ms, ' + apiStatus.ok + ' replies' + (apiStatus.fail ? ', ' + apiStatus.fail + ' failed' : '') + ')';
}
export function downloadApiLog() {
  const blob = new Blob([apiLog.map((r) => JSON.stringify(r)).join('\n') + (apiLog.length ? '\n' : '')], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'robot-fight-ai-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function apiLogSize() { return apiLog.length; }
// Models that take reasoning_effort; a 400 for it turns it off for the session.
let effortRejected = false;
function effortFor(c) {
  if (effortRejected) return null;
  const p = AI_PROVIDERS[c.provider];
  if (/^grok-4\.20|^grok-build/.test(c.model)) return null; // these reject the field
  if (/^grok-4\.[5-9]/.test(c.model)) return 'low';        // reasoning is always on: keep it short
  if (/^(o\d|gpt-5)/.test(c.model)) return 'low';
  if (c.provider === 'xai' || /^grok/.test(c.model)) return 'none'; // grok-4.3 and old slugs redirected to it
  return p && p.model === c.model && p.effort ? p.effort : null;
}

function actionIntent(a) {
  const it = { move: 0, strafe: 0, attack: null, block: false, run: false };
  if (a === 'approach') it.move = 1;
  else if (a === 'retreat') it.move = -1;
  else if (a === 'circle_left') it.strafe = -1;
  else if (a === 'circle_right') it.strafe = 1;
  else if (a === 'punch' || a === 'kick' || a === 'ground') it.attack = a;
  else if (a === 'jump_kick') it.attack = 'jump';
  else if (a === 'flip_back') it.dodge = 'back';
  else if (a === 'flip_front') it.dodge = 'front';
  else if (a === 'block') it.block = true;
  return it;
}

export function createApiBrain(fallback, id) {
  const st = { action: null, at: 0, used: false, inflight: false, lastReq: 0, backoff: 0, errors: 0, ok: 0 };
  const INTERVAL = 700;   // ms between requests
  const FRESH = 1400;     // ms an answer steers the robot
  const TIMEOUT = 6000;   // ms before a request counts as failed
  const MAX_TOKENS = 400;

  async function ask(snap) {
    const c = aiConfig();
    st.inflight = true;
    st.lastReq = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    const state = compact(snap);
    const rec = { t: new Date().toISOString(), robot: id, model: c.model, state, reply: null, action: null, latencyMs: 0, error: null };
    const t0 = performance.now();
    try {
      const effort = effortFor(c);
      // Room for a reasoning model's thinking plus the one-line answer (it stays a short reply
      // when reasoning is off).
      const body = {
        model: c.model, temperature: 0.4, max_tokens: MAX_TOKENS,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(state) }],
      };
      if (effort) body.reasoning_effort = effort;
      const res = await fetch(c.base + '/chat/completions', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = '';
        try { msg = (await res.text()).slice(0, 200); } catch (_) {}
        if (res.status === 400 && effort && /reasoning/i.test(msg)) effortRejected = true;
        throw new Error('HTTP ' + res.status + (msg ? ' ' + msg.replace(/\s+/g, ' ') : ''));
      }
      const j = await res.json();
      const text = replyText(j);
      rec.reply = text;
      rec.servedModel = j && j.model;
      rec.usage = j && j.usage;
      rec.finish = j && j.choices && j.choices[0] && j.choices[0].finish_reason;
      if (!text) throw new Error('empty reply' + (rec.finish ? ' (' + rec.finish + ')' : ''));
      const a = parseAction(text);
      if (!a) throw new Error('no valid action in reply');
      rec.action = a;
      st.action = a; st.at = performance.now(); st.used = false; st.errors = 0; st.ok++;
      apiStatus.ok++; apiStatus.lastOk = Date.now(); apiStatus.lastAction = a;
    } catch (e) {
      st.errors++;
      st.backoff = performance.now() + Math.min(15000, 1500 * st.errors); // CPU brain drives meanwhile
      st.lastError = e && e.name === 'AbortError' ? 'timeout' : String(e && e.message || e);
      rec.error = st.lastError;
      apiStatus.fail++; apiStatus.lastFail = Date.now(); apiStatus.lastError = st.lastError;
    } finally {
      clearTimeout(timer);
      st.inflight = false;
      rec.latencyMs = Math.round(performance.now() - t0);
      apiStatus.lastLatency = rec.latencyMs;
      apiLog.push(rec);
      if (apiLog.length > LOG_MAX) apiLog.shift();
      bump();
    }
  }

  function think(snap) {
    const cpu = fallback.think(snap); // keep the CPU brain warm: it takes over instantly on failure
    const now = performance.now();
    if (!wantsApiBrain(id)) return cpu;
    if (!st.inflight && now - st.lastReq > INTERVAL && now > st.backoff) ask(snap);
    if (!st.action || now - st.at > FRESH) return cpu;
    const it = actionIntent(st.action);
    if (it.attack || it.dodge) {
      // One strike / flip per answer (edge-triggered), and only when it can be thrown.
      if (st.used) return { ...cpu, attack: null, dodge: null };
      if ((it.dodge || it.attack === 'jump') && !(snap.self && snap.self.canFlip)) return cpu;
      if (it.attack === 'ground' && !(snap.opp && snap.opp.groundable)) return cpu;
      st.used = true;
    }
    return it;
  }

  return { kind: 'api', think, state: fallback.state, fallback, stats: st };
}

/* ---------- settings section ---------- */
export function initApiBrainUI() {
  const $ = (id) => document.getElementById(id);
  const on = $('aiOn'); const prov = $('aiProvider'); const base = $('aiBase'); const model = $('aiModel');
  const key = $('aiKey'); const clear = $('aiClear'); const b1 = $('aiBrainP1'); const b2 = $('aiBrainP2'); const note = $('aiNote');
  if (!on) return;
  const paint = () => {
    const c = aiConfig();
    on.checked = c.on;
    prov.value = c.provider;
    base.value = ls.get(K.base) || '';
    base.placeholder = AI_PROVIDERS[c.provider].base || 'https://your-endpoint/v1';
    model.value = ls.get(K.model) || '';
    model.placeholder = AI_PROVIDERS[c.provider].model || 'model name';
    key.value = c.key ? '••••••••' : '';
    b1.value = c.brain.p1; b2.value = c.brain.p2;
    note.textContent = c.key ? 'Key saved in this browser only.' : 'No key saved. The CPU brain fights until you add one.';
  };
  on.addEventListener('change', () => { ls.set(K.on, on.checked ? '1' : '0'); paint(); });
  prov.addEventListener('change', () => { ls.set(K.provider, prov.value); paint(); });
  base.addEventListener('change', () => { if (base.value.trim()) ls.set(K.base, base.value.trim()); else ls.del(K.base); paint(); });
  model.addEventListener('change', () => { if (model.value.trim()) ls.set(K.model, model.value.trim()); else ls.del(K.model); paint(); });
  key.addEventListener('focus', () => { if (key.value === '••••••••') key.value = ''; });
  key.addEventListener('change', () => { const v = key.value.trim(); if (v && v !== '••••••••') ls.set(K.key, v); paint(); });
  clear.addEventListener('click', () => { ls.del(K.key); paint(); });
  b1.addEventListener('change', () => { ls.set(K.p1, b1.value); });
  b2.addEventListener('change', () => { ls.set(K.p2, b2.value); });
  // Typing in these fields must not drive the robot or toggle the camera.
  for (const el of [base, model, key]) el.addEventListener('keydown', (e) => e.stopPropagation());
  // Status line + log download (built here so the settings markup stays as it is).
  const stat = document.createElement('p');
  stat.className = 'hint';
  stat.id = 'aiStatus';
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.id = 'aiLog';
  dl.textContent = 'Download AI log';
  dl.addEventListener('click', downloadApiLog);
  note.after(stat, dl);
  // Small HUD badge while an API brain is fighting.
  const hud = document.createElement('div');
  hud.id = 'aiHud';
  hud.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);font:600 11px/1.3 system-ui,sans-serif;'
    + 'padding:3px 8px;border-radius:6px;background:rgba(0,0,0,.55);color:#cfe;pointer-events:none;z-index:30;display:none;max-width:60vw;'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  document.body.appendChild(hud);
  const show = () => {
    const txt = apiStatusText();
    const failing = apiStatus.lastFail > apiStatus.lastOk;
    stat.textContent = (wantsApiBrain('p1') || wantsApiBrain('p2') ? txt : 'API brain not in use.') + ' Log: ' + apiLog.length + ' calls.';
    hud.textContent = txt;
    hud.style.color = failing ? '#ffb4a8' : '#cfe';
    hud.style.display = (apiStatus.ok || apiStatus.fail) && (wantsApiBrain('p1') || wantsApiBrain('p2')) ? 'block' : 'none';
  };
  onApiStatus(show);
  on.addEventListener('change', show);
  paint();
  show();
}

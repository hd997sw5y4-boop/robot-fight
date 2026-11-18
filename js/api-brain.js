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

export const AI_ACTIONS = ['approach', 'retreat', 'circle_left', 'circle_right', 'punch', 'kick', 'block', 'ground', 'wait'];

export const AI_PROVIDERS = {
  xai: { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-3-mini' },
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
  + 'kick within strikeRange.kick; ground only works when opp.groundable is true; block when the opponent attacks.';

function compact(s) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const side = (x) => x && ({
    health: Math.round(x.health), state: x.state, attacking: !!x.attacking, blocking: !!x.blocking,
    down: !!x.down, edge: r2(x.edge || 0), parts: x.parts && Object.fromEntries(Object.entries(x.parts).map(([k, v]) => [k, r2(v)])),
    canPunch: x.canPunch, canKick: x.canKick, groundable: x.groundable,
  });
  return { dist: r2(s.dist || 0), strikeRange: s.strikeRange && { punch: r2(s.strikeRange.punch), kick: r2(s.strikeRange.kick) }, self: side(s.self), opp: side(s.opp) };
}

function parseAction(text) {
  if (!text) return null;
  let a = null;
  try { const j = JSON.parse(text.trim().replace(/^```(json)?|```$/g, '')); a = j && j.action; } catch (_) {}
  if (!a) { const m = String(text).toLowerCase().match(new RegExp('\\b(' + AI_ACTIONS.join('|') + ')\\b')); a = m && m[1]; }
  a = a && String(a).toLowerCase().trim();
  return AI_ACTIONS.includes(a) ? a : null;
}

function actionIntent(a) {
  const it = { move: 0, strafe: 0, attack: null, block: false, run: false };
  if (a === 'approach') it.move = 1;
  else if (a === 'retreat') it.move = -1;
  else if (a === 'circle_left') it.strafe = -1;
  else if (a === 'circle_right') it.strafe = 1;
  else if (a === 'punch' || a === 'kick' || a === 'ground') it.attack = a;
  else if (a === 'block') it.block = true;
  return it;
}

export function createApiBrain(fallback, id) {
  const st = { action: null, at: 0, used: false, inflight: false, lastReq: 0, backoff: 0, errors: 0, ok: 0 };
  const INTERVAL = 700;   // ms between requests
  const FRESH = 1400;     // ms an answer steers the robot
  const TIMEOUT = 6000;   // ms before a request counts as failed

  async function ask(snap) {
    const c = aiConfig();
    st.inflight = true;
    st.lastReq = performance.now();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const res = await fetch(c.base + '/chat/completions', {
        method: 'POST',
        signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.key },
        body: JSON.stringify({
          model: c.model, temperature: 0.4, max_tokens: 400,
          messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: JSON.stringify(compact(snap)) }],
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const a = parseAction(j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
      if (!a) throw new Error('invalid reply');
      st.action = a; st.at = performance.now(); st.used = false; st.errors = 0; st.ok++;
    } catch (e) {
      st.errors++;
      st.backoff = performance.now() + Math.min(15000, 1500 * st.errors); // CPU brain drives meanwhile
      st.lastError = String(e && e.message || e);
    } finally {
      clearTimeout(timer);
      st.inflight = false;
    }
  }

  function think(snap) {
    const cpu = fallback.think(snap); // keep the CPU brain warm: it takes over instantly on failure
    const now = performance.now();
    if (!wantsApiBrain(id)) return cpu;
    if (!st.inflight && now - st.lastReq > INTERVAL && now > st.backoff) ask(snap);
    if (!st.action || now - st.at > FRESH) return cpu;
    const it = actionIntent(st.action);
    if (it.attack) {
      // One strike per answer (edge-triggered), and only when it can be thrown.
      if (st.used) return { ...cpu, attack: null };
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
  paint();
}

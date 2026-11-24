'use strict';
/*
 * Optional "AI API Brain" (Settings > AI API Brain, and AI Tournament). Plugs into the
 * brain seam: think(snapshot) -> intent. A few times a second (throttled) it sends a
 * compact state JSON to an OpenAI-compatible chat-completions endpoint (xAI Grok, OpenAI,
 * or any base URL) and asks for ONE action. The reply steers the robot until the next one.
 * On timeout, error, invalid JSON or a rate limit the last valid action is kept; if there
 * is none yet, the robot holds a neutral guard. A rejected key (401/403) stops further
 * calls and holds guard. The CPU brain is never used for an API side.
 *
 * API keys stay only in this browser's localStorage. They are never written to the fight
 * log or exports, never put in a URL, never console.logged, and are sent only to that
 * entrant's chosen endpoint as Authorization: Bearer.
 */

import { memoryKey, isLearningOn, promptNotes, defaultLearningOn, setDefaultLearningOn, clearMemory } from './api-learn.js';

// Named strikes (in reach when self.moves[name] is true) and robot moves (energy, self.specials).
export const AI_MOVES = ['uppercut', 'elbow', 'spin_backfist', 'knee', 'sweep_kick', 'flying_kick'];
export const AI_ROBOT_MOVES = ['shoulder_charge', 'ground_slam', 'overheat'];
export const AI_ACTIONS = ['approach', 'retreat', 'circle_left', 'circle_right', 'punch', 'kick', 'flip_front', 'block', 'ground', 'wait', 'dash_forward', 'dash_back', ...AI_MOVES, ...AI_ROBOT_MOVES];
export const AI_TARGETS = ['head', 'torso', 'armL', 'armR', 'legL', 'legR'];

export const AI_PROVIDERS = {
  // grok-4.3 with reasoning off is xAI's fast current model (grok-3-mini and the old fast slugs
  // now redirect to reasoning models, which spend a token budget thinking and may reply empty).
  xai: { label: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-4.3', effort: 'none', cors: 'ok' },
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', cors: 'limited' },
  custom: { label: 'Other OpenAI-compatible', base: '', model: '', cors: 'unknown' },
};

// Same budget and throttle for every API brain (Settings and tournament).
export const AI_BUDGET = { interval: 700, fresh: 1400, timeout: 6000, maxTokens: 400, maxCalls: 90 };

export const SYSTEM = 'You control one heavy humanoid robot in a 3D fighting game. Each message is the current '
  + 'state as JSON (distances in metres, health 0-100, parts 0-1 health, 0 means torn off). Reply with JSON '
  + '{"action":"<one of the Allowed actions>","plan":"<up to 12 words>","target":"<optional one of: '
  + AI_TARGETS.join(', ') + '>"} and nothing else. inRange.punch / inRange.kick are true when that strike can land now. '
  + 'dash_forward and dash_back are specials that spend shared energy (see specials / energy in the state). '
  + 'Named strikes: uppercut, elbow and knee (close, heavy), spin_backfist (strong, slow), sweep_kick (low, often knocks down), flying_kick (from just outside kick range). '
  + 'Robot moves on energy: shoulder_charge (rush in from mid range), ground_slam (shockwave around you, hits a standing opponent nearby), overheat (needs a full bar; big burst all around, then no energy for a while). '
  + 'legal is the only set of actions that work at this distance — do not pick approach when it is omitted. '
  + 'If the message says you are IN RANGE, attack, block or reposition; do not close the gap. '
  + 'If it says you are TOO CLOSE, retreat or circle is available — it is your choice, not a requirement. '
  + 'If you are AT THE CAGE, escape lists the directions that leave the wall; retreat peels along or off the fence, it does not walk through it. '
  + 'ground only works when opp.groundable is true; flip_front needs self.canFlip.';

const K = {
  on: 'rf_ai_on', provider: 'rf_ai_provider', base: 'rf_ai_base', model: 'rf_ai_model',
  key: 'rf_ai_key', p1: 'rf_ai_brain_p1', p2: 'rf_ai_brain_p2',
};
const ls = {
  get(k, d = '') { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

export function chatUrl(base) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return '';
  if (/\/chat\/completions$/i.test(b)) return b;
  return b + '/chat/completions';
}

export function resolveProvider(cfg) {
  const provider = (cfg && AI_PROVIDERS[cfg.provider]) ? cfg.provider : (AI_PROVIDERS[cfg && cfg.provider] ? cfg.provider : 'custom');
  const def = AI_PROVIDERS[provider] || AI_PROVIDERS.custom;
  const base = String((cfg && cfg.base) || def.base || '').replace(/\/+$/, '');
  const model = String((cfg && cfg.model) || def.model || '').trim();
  return { provider, base, model, label: def.label, cors: def.cors };
}

/** Strip secrets from any string that might be logged, exported, or shown. */
export function scrubSecret(text, key) {
  let s = String(text == null ? '' : text);
  if (key) {
    const k = String(key);
    if (k.length >= 4) s = s.split(k).join('***');
  }
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer ***');
  s = s.replace(/\b(sk|xai|xai-key)-[A-Za-z0-9_\-]{8,}\b/g, (m) => m.slice(0, 3) + '…');
  return s;
}

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

const tourneyKey = (id) => 'rf_ai_tourney_key_' + id;
export function loadEntrantKey(id) { return id ? ls.get(tourneyKey(id), '') : ''; }
export function saveEntrantKey(id, key) {
  if (!id) return;
  const v = String(key || '').trim();
  if (!v || v === '••••••••') return;
  ls.set(tourneyKey(id), v);
}
export function clearEntrantKey(id) { if (id) ls.del(tourneyKey(id)); }

/** Config used for this fighter: a tournament entrant, or the Settings API brain. */
export function fighterApiCfg(f) {
  const custom = f && f.config && f.config.apiBrain;
  if (custom && (custom.entrantId || custom.base || custom.model)) {
    const r = resolveProvider(custom);
    const key = custom.entrantId ? loadEntrantKey(custom.entrantId) : '';
    const name = (f.config && f.config.name) || '';
    return { ...r, key, on: true, name };
  }
  return { ...aiConfig(), name: (f && f.config && f.config.name) || (f && f.id) || '' };
}

export function wantsApiBrain(id, f) {
  if (f && f.config && f.config.apiBrain) {
    const c = fighterApiCfg(f);
    return !!(c.key && c.base && c.model);
  }
  const c = aiConfig();
  return c.on && !!c.key && !!c.base && !!c.model && c.brain[id] === 'api';
}

export function apiLabel(cfg) {
  const r = resolveProvider(cfg || {});
  const bits = ['API', r.label || r.provider, r.model].filter(Boolean);
  return bits.join(' · ');
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** Range flags and legal actions for the current distance. Used in the prompt and the in-range guard. */
export function rangeInfo(s) {
  const dist = r2(s && s.dist);
  const punch = r2(s && s.strikeRange && s.strikeRange.punch);
  const kick = r2(s && s.strikeRange && s.strikeRange.kick);
  const self = (s && s.self) || {};
  const opp = (s && s.opp) || {};
  const inRange = { punch: !!(punch && dist <= punch + 0.02), kick: !!(kick && dist <= kick + 0.02) };
  const any = inRange.punch || inRange.kick;
  const legal = [];
  if (!any) legal.push('approach');
  legal.push('retreat', 'circle_left', 'circle_right', 'wait');
  if (self.canBlock !== false) legal.push('block');
  if (self.canPunch !== false && inRange.punch) legal.push('punch');
  if (self.canKick !== false && inRange.kick) legal.push('kick');
  if (self.canFlip) {
    legal.push('flip_front');
  }
  if (opp.groundable) legal.push('ground');
  const sp = self.specials || {};
  if (sp.dash_forward) legal.push('dash_forward');
  if (sp.dash_back) legal.push('dash_back');
  const mv = self.moves || {};
  for (const m of AI_MOVES) if (mv[m]) legal.push(m);
  for (const m of AI_ROBOT_MOVES) if (sp[m]) legal.push(m);
  return { dist, inRange, legal, strikeRange: { punch, kick }, energy: self.energy };
}

function compact(s) {
  const side = (x) => x && ({
    health: Math.round(x.health), state: x.state, attacking: !!x.attacking, blocking: !!x.blocking,
    down: !!x.down, edge: r2(x.edge || 0), parts: x.parts && Object.fromEntries(Object.entries(x.parts).map(([k, v]) => [k, r2(v)])),
    canPunch: x.canPunch, canKick: x.canKick, groundable: x.groundable, canFlip: x.canFlip, heavy: x.heavy,
  });
  const info = rangeInfo(s);
  const self = side(s.self) || {};
  if (s.self) {
    self.atWall = !!s.self.atWall;
    self.edge = r2(s.self.edge || 0);
  }
  return {
    dist: info.dist,
    strikeRange: info.strikeRange,
    inRange: info.inRange,
    tooClose: !!s.tooClose,
    atWall: !!(s.self && s.self.atWall),
    escape: s.escape || null,
    legal: info.legal,
    self,
    opp: side(s.opp),
  };
}

function inStrikeRange(snap) {
  const info = rangeInfo(snap || {});
  return !!(info.inRange.punch || info.inRange.kick);
}

function userPrompt(state, snap, recent) {
  const info = rangeInfo(snap || state || {});
  const lines = [];
  if (info.inRange.punch || info.inRange.kick) {
    const bits = [info.inRange.punch ? 'punch' : '', info.inRange.kick ? 'kick' : ''].filter(Boolean).join(' and ');
    lines.push('You are IN RANGE (' + bits + '): attack, block or reposition.');
  } else {
    lines.push('You are out of range. Close the gap before you strike.');
  }
  if (snap && snap.tooClose) lines.push('You are TOO CLOSE: retreat and circle are available if you want space.');
  if (snap && snap.self && snap.self.atWall) {
    const esc = snap.escape || {};
    const dirs = ['offWall', 'retreat', 'circle_left', 'circle_right'].filter((k) => esc[k]);
    lines.push('You are AT THE CAGE. You can step off toward the center and circle along the wall. Escape: ' + (dirs.join(', ') || 'offWall') + '.');
  }
  lines.push('Allowed actions: ' + info.legal.join(', ') + '.');
  if (recent && recent.length) lines.push('Your last actions: ' + recent.join('; ') + '.');
  lines.push(JSON.stringify(state));
  return lines.join('\n');
}

// Reply text from any OpenAI-compatible shape, including reasoning models that leave content empty.
function replyText(j) {
  const ch = j && j.choices && j.choices[0];
  const m = ch && (ch.message || ch.delta) || {};
  const parts = [];
  const take = (c) => {
    if (!c) return;
    if (typeof c === 'string') parts.push(c);
    else if (Array.isArray(c)) c.forEach((p) => parts.push(typeof p === 'string' ? p : (p && (p.text || p.content || p.output_text)) || ''));
  };
  take(m.content);
  take(m.reasoning_content);
  take(m.reasoning);
  take(ch && ch.text);
  if (j && j.output_text) take(j.output_text);
  if (m.refusal) take(m.refusal);
  return parts.join('\n').trim();
}

const norm = (v) => String(v || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
export function parseAction(text) {
  const p = parseReply(text);
  return p && p.action;
}
export function parseReply(text) {
  if (!text) return null;
  const t = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  let action = null, plan = '', target = '';
  const objs = t.match(/\{[^{}]*\}/g) || [];
  for (const o of objs) {
    try {
      const j = JSON.parse(o);
      const a = norm(j.action || j.move || j.Action);
      if (AI_ACTIONS.includes(a)) action = a;
      if (j.plan || j.reason || j.thought) plan = String(j.plan || j.reason || j.thought).slice(0, 160);
      const tg = norm(j.target || j.aim || '');
      if (AI_TARGETS.includes(tg)) target = tg;
      if (action) break;
    } catch (_) {}
  }
  if (!action) {
    const kv = t.match(/action["'\s]*[:=]\s*["']?([a-z _-]+)/i);
    if (kv && AI_ACTIONS.includes(norm(kv[1]))) action = norm(kv[1]);
  }
  if (!action) {
    const re = new RegExp('\\b(' + AI_ACTIONS.map((a) => a.replace('_', '[\\s_-]?')).join('|') + ')\\b', 'gi');
    const all = t.match(re);
    action = all ? norm(all[all.length - 1]).replace(/^circle(left|right)$/, 'circle_$1') : null;
    if (action && !AI_ACTIONS.includes(action)) action = null;
  }
  if (!action) return null;
  return { action, plan, target };
}

/* ---------- shared status + call log (never stores keys) ---------- */
export const apiStatus = { ok: 0, fail: 0, lastOk: 0, lastFail: 0, lastError: '', lastLatency: 0, lastAction: '', lastKind: '' };
const apiLog = [];
const LOG_MAX = 5000;
const listeners = new Set();
const decisionListeners = new Set();
function bump() { for (const fn of listeners) { try { fn(apiStatus); } catch (_) {} } }
export function onApiStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onApiDecision(fn) { decisionListeners.add(fn); return () => decisionListeners.delete(fn); }
function emitDecision(rec) {
  for (const fn of decisionListeners) { try { fn(rec); } catch (_) {} }
}
export function apiStatusText() {
  if (!apiStatus.ok && !apiStatus.fail) return 'API: waiting for the first reply';
  const failing = apiStatus.lastFail > apiStatus.lastOk;
  if (failing) {
    if (apiStatus.lastKind === 'key_rejected') return 'API key rejected, holding guard';
    if (apiStatus.lastKind === 'cors') return 'API CORS/network error, holding last action';
    return 'API no answer (' + (apiStatus.lastKind || 'error') + '), holding last action'
      + (apiStatus.lastError ? ': ' + apiStatus.lastError : '');
  }
  return 'API: OK (' + apiStatus.lastLatency + ' ms, ' + apiStatus.ok + ' replies' + (apiStatus.fail ? ', ' + apiStatus.fail + ' failed' : '') + ')';
}

const lastById = { p1: null, p2: null };
function rememberSide(id, rec) {
  if (!id) return;
  lastById[id] = rec;
}

export function apiSideStatus(id) { return lastById[id] || null; }

function sideStatusLine(id, label) {
  const rec = lastById[id];
  if (!rec) return label + ': —';
  const act = rec.action || rec.heldAction || '—';
  if (rec.kind === 'key_rejected') return label + ': Key rejected';
  if (rec.kind && rec.kind !== 'ok') {
    const why = rec.kind === 'timeout' ? 'no answer (timeout)' : ('no answer (' + rec.kind + ')');
    return label + ': ' + act + ' · ' + why;
  }
  return label + ': ' + act + (rec.target ? ' → ' + rec.target : '');
}
export function downloadApiLog() {
  const blob = new Blob([apiLog.map((r) => JSON.stringify(r)).join('\n') + (apiLog.length ? '\n' : '')], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'android-arena-ai-log-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
export function apiLogSize() { return apiLog.length; }

let effortRejected = false;
let useMaxCompletion = false;
function effortFor(c) {
  if (effortRejected) return null;
  const p = AI_PROVIDERS[c.provider];
  if (/^grok-4\.20|^grok-build/.test(c.model)) return null;
  if (/^grok-4\.[5-9]/.test(c.model)) return 'low';
  if (/^(o\d|gpt-5)/.test(c.model)) return 'low';
  if (c.provider === 'xai' || /^grok/.test(c.model)) return 'none';
  return p && p.model === c.model && p.effort ? p.effort : null;
}

function classify(status, body, err, key) {
  const msg = scrubSecret((body || (err && err.message) || String(err || '')), key);
  const low = msg.toLowerCase();
  if (err && (err.name === 'AbortError' || low === 'timeout' || /aborted|timeout/i.test(low))) {
    return { kind: 'timeout', error: 'timeout' };
  }
  if (status === 401 || status === 403 || /incorrect api key|invalid_api_key|invalid api key|unauthorized|forbidden|key rejected/i.test(low)) {
    return { kind: 'key_rejected', error: 'key rejected' };
  }
  if (status === 429 || /rate.?limit|too many requests/i.test(low)) {
    return { kind: 'rate_limit', error: 'rate limited (429)' };
  }
  if (!status && err && /failed to fetch|networkerror|load failed|cors|blocked by cors/i.test(low)) {
    return { kind: 'cors', error: 'CORS or network error' };
  }
  if (/empty reply|no valid action|invalid json/i.test(low)) {
    return { kind: 'invalid', error: msg || 'invalid reply' };
  }
  return { kind: 'error', error: msg || 'error' };
}

function retryAfterMs(res) {
  if (!res) return 0;
  const h = res.headers && res.headers.get && res.headers.get('Retry-After');
  if (!h) return 0;
  const n = +h;
  if (Number.isFinite(n) && n >= 0) return Math.min(60, n) * 1000;
  const when = Date.parse(h);
  if (Number.isFinite(when)) return Math.max(0, Math.min(60000, when - Date.now()));
  return 0;
}

/**
 * One OpenAI-compatible /chat/completions call. The key is only sent as
 * Authorization: Bearer to cfg.base; it is never logged or returned.
 */
export async function requestCompletion(cfg, opts = {}) {
  const r = resolveProvider(cfg);
  const key = cfg && cfg.key;
  const url = chatUrl(r.base);
  if (!url || !key || !r.model) {
    return { ok: false, kind: 'error', error: !key ? 'no key' : 'missing endpoint or model', latency: 0, status: 0 };
  }
  const timeout = opts.timeout || AI_BUDGET.timeout;
  const ctl = opts.signal || new AbortController();
  const timer = setTimeout(() => { try { ctl.abort(); } catch (_) {} }, timeout);
  const t0 = performance.now();
  const messages = opts.messages || [{ role: 'user', content: opts.prompt || 'Reply with OK.' }];
  const effort = opts.effort !== undefined ? opts.effort : effortFor({ ...r, provider: r.provider });
  const body = { model: r.model, temperature: opts.temperature == null ? 0.4 : opts.temperature, messages };
  const tok = opts.max_tokens || AI_BUDGET.maxTokens;
  if (useMaxCompletion) body.max_completion_tokens = tok;
  else body.max_tokens = tok;
  if (effort) body.reasoning_effort = effort;
  let status = 0;
  let raw = '';
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctl.signal || ctl,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
    });
    status = res.status;
    try { raw = await res.text(); } catch (_) { raw = ''; }
    const latency = Math.round(performance.now() - t0);
    if (!res.ok) {
      if (status === 400 && effort && /reasoning/i.test(raw)) effortRejected = true;
      if (status === 400 && !useMaxCompletion && /max_completion_tokens/i.test(raw)) {
        useMaxCompletion = true;
        if (timer) clearTimeout(timer);
        return requestCompletion(cfg, opts);
      }
      const cls = classify(status, raw, null, key);
      return { ok: false, status, latency, retryAfter: retryAfterMs(res), ...cls };
    }
    let json = null;
    try { json = raw ? JSON.parse(raw) : null; } catch (_) {
      return { ok: false, status, latency, kind: 'invalid', error: 'invalid JSON' };
    }
    const text = replyText(json);
    return { ok: true, status, latency, text, json, finish: json && json.choices && json.choices[0] && json.choices[0].finish_reason, servedModel: json && json.model };
  } catch (e) {
    const latency = Math.round(performance.now() - t0);
    const cls = classify(status, '', e, key);
    return { ok: false, status, latency, ...cls };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One tiny call to verify a key. Never logs the key. */
export async function testApiKey(cfg) {
  const r = resolveProvider(cfg);
  if (!cfg || !cfg.key) return { ok: false, kind: 'error', error: 'No key entered' };
  if (!r.base || !r.model) return { ok: false, kind: 'error', error: 'Missing endpoint or model' };
  const out = await requestCompletion({ ...r, key: cfg.key }, {
    messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
    max_tokens: 8,
    temperature: 0,
    timeout: 8000,
    effort: null,
  });
  if (out.ok) return { ok: true, kind: 'ok', error: '', latency: out.latency, model: out.servedModel || r.model, cors: r.cors };
  return { ok: false, kind: out.kind, error: out.error, latency: out.latency, cors: r.cors, status: out.status };
}

export function corsNote(provider) {
  if (provider === 'xai') return 'xAI allows browser calls (CORS *). A bad key comes back as “key rejected”.';
  if (provider === 'openai') return 'OpenAI allows this site in preflight, but a 401 (bad key) may omit CORS headers, so a rejected key can look like a CORS error.';
  return 'Custom endpoints may block browser CORS. If the test says CORS, the key never left this browser except to that URL.';
}

function actionIntent(a) {
  const it = { move: 0, strafe: 0, attack: null, block: false, run: false };
  if (a === 'approach') it.move = 1;
  else if (a === 'retreat') it.move = -1;
  else if (a === 'circle_left') it.strafe = -1;
  else if (a === 'circle_right') it.strafe = 1;
  else if (a === 'punch' || a === 'kick' || a === 'ground') it.attack = a;
  else if (a === 'dash_forward') it.attack = 'dash_forward';
  else if (a === 'dash_back') it.attack = 'dash_back';
  else if (AI_MOVES.includes(a) || AI_ROBOT_MOVES.includes(a)) it.attack = a;
  else if (a === 'flip_front') it.dodge = 'front';
  else if (a === 'block') it.block = true;
  return it;
}

function emptyStats() {
  return { calls: 0, errors: 0, timeouts: 0, invalid: 0, keyRejected: 0, rateLimited: 0, heldLastMs: 0, heldLastCount: 0, noAnswer: 0, latencySum: 0, latencyN: 0, lastAction: '', lastPlan: '', lastTarget: '', lastError: '', lastKind: '', lastLatency: 0, targets: {}, styles: {} };
}

export function apiStatsSnapshot(brain) {
  const s = (brain && brain.apiStats) || emptyStats();
  return {
    calls: s.calls,
    errors: s.errors,
    timeouts: s.timeouts,
    invalidReplies: s.invalid,
    keyRejected: s.keyRejected,
    rateLimited: s.rateLimited,
    avgLatency: s.latencyN ? Math.round(s.latencySum / s.latencyN) : null,
    heldLastMs: Math.round(s.heldLastMs || 0),
    heldLastCount: s.heldLastCount || 0,
    noAnswer: s.noAnswer || 0,
  };
}

function guardIntent() {
  return actionIntent('block');
}

export function createApiBrain(id, getCfg) {
  const st = { action: null, plan: '', target: '', at: 0, used: false, inflight: false, lastReq: 0, backoff: 0, lastKind: '', cfg: null, keyRejected: false, holding: false, recent: [], frozen: false, gen: 0, ctl: null };
  const stats = emptyStats();
  const INTERVAL = AI_BUDGET.interval;
  const MAX_CALLS = AI_BUDGET.maxCalls;

  function cfgNow() {
    if (typeof getCfg === 'function') return getCfg();
    return aiConfig();
  }

  async function ask(snap) {
    if (st.frozen) return;
    const c = cfgNow();
    st.cfg = { provider: c.provider, base: c.base, model: c.model };
    st.inflight = true;
    st.lastReq = performance.now();
    st.ctl = new AbortController();
    const gen = st.gen;
    stats.calls += 1;
    const state = compact(snap);
    const rec = { t: new Date().toISOString(), robot: id, provider: c.provider, model: c.model, state, reply: null, action: null, plan: null, target: null, latencyMs: 0, error: null, kind: null };
    const learnKey = memoryKey(c.name || id, c.provider, c.model);
    const notes = isLearningOn(learnKey) ? promptNotes(learnKey) : '';
    const sys = notes ? (SYSTEM + '\n\nYour notes from past fights: ' + notes) : SYSTEM;
    const out = await requestCompletion(c, {
      messages: [{ role: 'system', content: sys }, { role: 'user', content: userPrompt(state, snap, st.recent) }],
      signal: st.ctl,
    });
    if (gen !== st.gen || st.frozen) { st.inflight = false; st.ctl = null; return; }
    rec.latencyMs = out.latency || 0;
    rec.kind = out.ok ? 'ok' : out.kind;
    if (out.ok) {
      rec.reply = (out.text || '').slice(0, 500);
      rec.servedModel = out.servedModel;
      rec.finish = out.finish;
      const parsed = parseReply(out.text);
      if (!out.text) {
        rec.kind = 'invalid';
        rec.error = 'empty reply' + (out.finish ? ' (' + out.finish + ')' : '');
        stats.invalid += 1;
        stats.errors += 1;
        st.lastKind = 'invalid';
        stats.noAnswer += 1;
        st.recent = (st.recent || []).concat(['no answer (empty)']).slice(-5);
        apiStatus.fail++; apiStatus.lastFail = Date.now(); apiStatus.lastError = rec.error; apiStatus.lastKind = 'invalid';
      } else if (!parsed) {
        rec.kind = 'invalid';
        rec.error = 'no valid action in reply';
        stats.invalid += 1;
        stats.errors += 1;
        st.lastKind = 'invalid';
        stats.noAnswer += 1;
        st.recent = (st.recent || []).concat(['no answer (invalid)']).slice(-5);
        apiStatus.fail++; apiStatus.lastFail = Date.now(); apiStatus.lastError = rec.error; apiStatus.lastKind = 'invalid';
      } else {
        rec.action = parsed.action;
        rec.plan = parsed.plan || null;
        rec.target = parsed.target || null;
        st.action = parsed.action;
        st.plan = parsed.plan || '';
        st.target = parsed.target || '';
        st.at = performance.now();
        st.used = false;
        st.lastKind = 'ok';
        stats.lastAction = parsed.action;
        stats.lastPlan = st.plan;
        stats.lastTarget = st.target;
        const already = inStrikeRange(snap) && parsed.action === 'approach';
        st.recent = (st.recent || []).concat([parsed.action + (already ? ' (already in range)' : '')]).slice(-5);
        stats.latencySum += rec.latencyMs;
        stats.latencyN += 1;
        if (parsed.target) stats.targets[parsed.target] = (stats.targets[parsed.target] || 0) + 1;
        const style = (parsed.action === 'block' || parsed.action === 'retreat' || parsed.action === 'wait') ? 'defensive'
          : (parsed.action === 'punch' || parsed.action === 'kick' || parsed.action === 'approach') ? 'aggressive' : 'balanced';
        stats.styles[style] = (stats.styles[style] || 0) + 1;
        apiStatus.ok++; apiStatus.lastOk = Date.now(); apiStatus.lastAction = parsed.action; apiStatus.lastKind = 'ok';
      }
    } else {
      rec.error = out.error;
      st.lastKind = out.kind;
      stats.errors += 1;
      if (out.kind === 'timeout') stats.timeouts += 1;
      else if (out.kind === 'invalid') stats.invalid += 1;
      else if (out.kind === 'key_rejected') stats.keyRejected += 1;
      else if (out.kind === 'rate_limit') stats.rateLimited += 1;
      stats.noAnswer += 1;
      st.recent = (st.recent || []).concat(['no answer (' + (out.kind || 'error') + ')']).slice(-5);
      if (out.kind === 'key_rejected') {
        st.keyRejected = true;
        st.action = null;
        st.holding = false;
        st.backoff = Infinity;
      } else {
        const wait = out.kind === 'rate_limit' ? Math.max(2000, out.retryAfter || 4000)
          : Math.min(15000, 1500 * Math.max(1, stats.errors));
        st.backoff = performance.now() + wait;
      }
      apiStatus.fail++; apiStatus.lastFail = Date.now(); apiStatus.lastError = out.error; apiStatus.lastKind = out.kind;
    }
    st.inflight = false;
    stats.lastError = rec.error || '';
    stats.lastKind = rec.kind;
    stats.lastLatency = rec.latencyMs;
    apiStatus.lastLatency = rec.latencyMs;
    apiLog.push(rec);
    if (apiLog.length > LOG_MAX) apiLog.shift();
    bump();
    const ev = { id, action: rec.action, plan: rec.plan, target: rec.target, error: rec.error, kind: rec.kind, latency: rec.latencyMs, provider: c.provider, model: c.model };
    if (!rec.action && st.action) ev.heldAction = st.action;
    rememberSide(id, ev);
    emitDecision(ev);
  }

  function freeze() {
    st.frozen = true;
    st.gen += 1;
    st.action = null;
    st.used = false;
    st.holding = false;
    st.inflight = false;
    if (st.ctl) { try { st.ctl.abort(); } catch (_) {} st.ctl = null; }
  }
  function thaw() {
    st.frozen = false;
    st.action = null;
    st.used = false;
    st.holding = false;
  }

  function think(snap) {
    const now = performance.now();
    const dtMs = (snap.dt || 0) * 1000;
    if (st.frozen) return actionIntent('wait');
    if (st.keyRejected) return guardIntent();
    const c = cfgNow();
    const canCall = !!(c && c.key && c.base && c.model);
    if (canCall && !st.inflight && stats.calls < MAX_CALLS && now - st.lastReq > INTERVAL && now > st.backoff) ask(snap);
    if (st.action) {
      const holding = (st.lastKind && st.lastKind !== 'ok') || !canCall || stats.calls >= MAX_CALLS && st.lastKind !== 'ok';
      if (holding) {
        stats.heldLastMs += dtMs;
        if (!st.holding) {
          stats.heldLastCount += 1;
          st.holding = true;
          const ev = { id, action: st.action, held: true, heldAction: st.action, heldReason: st.lastKind || 'no_answer', kind: st.lastKind || 'no_answer' };
          rememberSide(id, ev);
          emitDecision(ev);
        }
      } else st.holding = false;
      // In-range approach is still the AI's choice (logged raw), but it does not walk in further.
      if (st.action === 'approach' && inStrikeRange(snap)) return actionIntent('wait');
      const it = actionIntent(st.action);
      if (it.attack || it.dodge) {
        if (st.used) return guardIntent();
        if ((it.dodge || it.attack === 'jump') && !(snap.self && snap.self.canFlip)) return guardIntent();
        if (it.attack === 'ground' && !(snap.opp && snap.opp.groundable)) return guardIntent();
        st.used = true;
      }
      return it;
    }
    st.holding = false;
    return guardIntent();
  }

  return { kind: 'api', think, freeze, thaw, state: st, stats: st, apiStats: stats };
}

/* ---------- settings section ---------- */
export function initApiBrainUI() {
  const $ = (id) => document.getElementById(id);
  const on = $('aiOn'); const prov = $('aiProvider'); const base = $('aiBase'); const model = $('aiModel');
  const key = $('aiKey'); const clear = $('aiClear'); const b2 = $('aiBrainP2'); const note = $('aiNote');
  if (!on) return;
  let testBtn = $('aiTestKey');
  let testOut = $('aiTestOut');
  if (!testBtn && key && key.parentNode) {
    testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.id = 'aiTestKey';
    testBtn.textContent = 'Test key';
    key.parentNode.appendChild(testBtn);
  }
  if (!testOut && note) {
    testOut = document.createElement('p');
    testOut.className = 'hint';
    testOut.id = 'aiTestOut';
    note.after(testOut);
  }
  const typedKey = () => {
    const v = key.value.trim();
    if (v && v !== '••••••••') return v;
    return ls.get(K.key);
  };
  const paint = () => {
    const c = aiConfig();
    on.checked = c.on;
    prov.value = c.provider;
    base.value = ls.get(K.base) || '';
    base.placeholder = AI_PROVIDERS[c.provider].base || 'https://your-endpoint/v1';
    model.value = ls.get(K.model) || '';
    model.placeholder = AI_PROVIDERS[c.provider].model || 'model name';
    key.value = c.key ? '••••••••' : '';
    b2.value = c.brain.p2;
    const saved = c.key ? 'Key saved in this browser only. ' : 'No key saved. An API side holds guard until you add one. ';
    note.textContent = saved + corsNote(c.provider);
  };
  on.addEventListener('change', () => { ls.set(K.on, on.checked ? '1' : '0'); paint(); });
  prov.addEventListener('change', () => { ls.set(K.provider, prov.value); paint(); });
  base.addEventListener('change', () => { if (base.value.trim()) ls.set(K.base, base.value.trim()); else ls.del(K.base); paint(); });
  model.addEventListener('change', () => { if (model.value.trim()) ls.set(K.model, model.value.trim()); else ls.del(K.model); paint(); });
  key.addEventListener('change', () => { const v = key.value.trim(); if (v && v !== '••••••••') ls.set(K.key, v); paint(); });
  clear.addEventListener('click', () => { ls.del(K.key); if (testOut) testOut.textContent = ''; paint(); });
  b2.addEventListener('change', () => { ls.set(K.p2, b2.value); });
  const learn = $('aiLearn');
  if (learn) {
    learn.checked = defaultLearningOn();
    learn.addEventListener('change', () => setDefaultLearningOn(learn.checked));
  }
  const resetMem = $('aiResetMem');
  if (resetMem) {
    resetMem.addEventListener('click', () => {
      if (!confirm('Clear all AI fight notes stored in this browser?')) return;
      clearMemory();
      if (testOut) testOut.textContent = 'AI memory cleared.';
    });
  }
  for (const el of [base, model, key]) el.addEventListener('keydown', (e) => e.stopPropagation());
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      const c = aiConfig();
      const k = typedKey();
      if (k && k !== '••••••••') ls.set(K.key, k);
      if (testOut) testOut.textContent = 'Testing key…';
      const out = await testApiKey({ provider: c.provider, base: c.base, model: c.model, key: k });
      if (!testOut) return;
      if (out.ok) testOut.textContent = 'OK · ' + (out.model || c.model) + ' · ' + out.latency + ' ms';
      else if (out.kind === 'key_rejected') testOut.textContent = 'Key rejected.';
      else if (out.kind === 'cors') testOut.textContent = 'CORS or network error. ' + corsNote(c.provider);
      else testOut.textContent = (out.error || 'Test failed') + (out.kind === 'timeout' ? '' : '');
    });
  }
  const stat = document.createElement('p');
  stat.className = 'hint';
  stat.id = 'aiStatus';
  const dl = document.createElement('button');
  dl.type = 'button';
  dl.id = 'aiLog';
  dl.textContent = 'Download AI log';
  dl.addEventListener('click', downloadApiLog);
  (testOut || note).after(stat, dl);
  const hud = document.createElement('div');
  hud.id = 'aiHud';
  hud.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);font:600 11px/1.3 system-ui,sans-serif;'
    + 'padding:3px 10px;border-radius:6px;background:rgba(0,0,0,.55);color:#cfe;pointer-events:none;z-index:30;display:none;max-width:80vw;'
    + 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  document.body.appendChild(hud);
  const sides = document.createElement('div');
  sides.id = 'aiSideHud';
  sides.innerHTML = '<div data-side="p1"></div><div data-side="p2"></div>';
  sides.style.cssText = 'position:fixed;top:58px;left:0;right:0;display:none;pointer-events:none;z-index:30;'
    + 'font:700 12px/1.3 system-ui,sans-serif;color:#e8eef8;text-shadow:0 1px 2px #000;';
  const s1 = sides.querySelector('[data-side="p1"]');
  const s2 = sides.querySelector('[data-side="p2"]');
  s1.style.cssText = 'position:absolute;left:16px;max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  s2.style.cssText = 'position:absolute;right:16px;max-width:42vw;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  document.body.appendChild(sides);
  const show = () => {
    const txt = apiStatusText();
    const failing = apiStatus.lastFail > apiStatus.lastOk;
    const p1On = !!(lastById.p1 || wantsApiBrain('p1'));
    const p2On = !!(lastById.p2 || wantsApiBrain('p2'));
    const any = p1On || p2On || apiStatus.ok || apiStatus.fail;
    stat.textContent = (any ? txt : 'API brain not in use.') + ' Log: ' + apiLog.length + ' calls.';
    hud.style.color = failing ? '#ffb4a8' : '#cfe';
    hud.style.display = any ? 'block' : 'none';
    const left = p1On ? sideStatusLine('p1', 'P1') : '';
    const right = p2On ? sideStatusLine('p2', 'P2') : '';
    s1.textContent = left;
    s2.textContent = right;
    hud.textContent = [left, right].filter(Boolean).join('   ·   ') || txt;
    sides.style.display = (left || right) ? 'block' : 'none';
    if (lastById.p1 && lastById.p1.kind && lastById.p1.kind !== 'ok') s1.style.color = '#ffb4a8';
    else s1.style.color = '#e8eef8';
    if (lastById.p2 && lastById.p2.kind && lastById.p2.kind !== 'ok') s2.style.color = '#ffb4a8';
    else s2.style.color = '#e8eef8';
  };
  onApiStatus(show);
  onApiDecision(show);
  on.addEventListener('change', show);
  paint();
  show();
}

if (typeof window !== 'undefined') {
  window.RFApiBrain = {
    testApiKey, AI_PROVIDERS, AI_BUDGET, chatUrl, scrubSecret, corsNote,
    fighterApiCfg, apiStatsSnapshot, apiLabel, loadEntrantKey, saveEntrantKey, clearEntrantKey,
    onApiDecision, wantsApiBrain, rangeInfo, apiSideStatus,
  };
}

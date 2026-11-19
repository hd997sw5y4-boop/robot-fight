'use strict';
/* Compact, local learning notes for API fighters. Keyed by name + provider + model.
   Stored only in this browser. Never holds API keys. The CPU brain is not involved. */

const MEM_KEY = 'rf_ai_mem_v1';
const ON_KEY = 'rf_ai_learn_on'; // global default (Settings), '1' / '0'
const ON_MAP = 'rf_ai_mem_on_v1'; // per-entrant overrides
const MAX_FIGHTS = 5;
const PROMPT_CAP = 600;
const SECRET_VAL = /\b(sk|xai|xai-key)-[A-Za-z0-9_\-]{8,}\b|Bearer\s+\S+/gi;

function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }

function scrub(s) { return String(s || '').replace(SECRET_VAL, '***'); }

export function memoryKey(name, provider, model) {
  const n = String(name || 'entrant').trim().slice(0, 40) || 'entrant';
  const p = String(provider || '').trim().toLowerCase();
  const m = String(model || '').trim();
  return [n, p, m].filter(Boolean).join(' · ');
}

function loadMem() {
  try { return JSON.parse(lsGet(MEM_KEY, '{}')) || {}; } catch (_) { return {}; }
}
function saveMem(obj) { lsSet(MEM_KEY, JSON.stringify(obj)); }

function loadOnMap() {
  try { return JSON.parse(lsGet(ON_MAP, '{}')) || {}; } catch (_) { return {}; }
}

export function defaultLearningOn() { return lsGet(ON_KEY, '1') !== '0'; }
export function setDefaultLearningOn(on) { lsSet(ON_KEY, on ? '1' : '0'); }

export function isLearningOn(key) {
  if (key) {
    const map = loadOnMap();
    if (Object.prototype.hasOwnProperty.call(map, key)) return !!map[key];
  }
  return defaultLearningOn();
}

export function setLearningOn(key, on) {
  if (!key) { setDefaultLearningOn(on); return; }
  const map = loadOnMap();
  map[key] = !!on;
  lsSet(ON_MAP, JSON.stringify(map));
}

export function loadFights(key) {
  const mem = loadMem();
  const rec = mem[key];
  return rec && Array.isArray(rec.fights) ? rec.fights.slice() : [];
}

export function recordFight(key, text) {
  if (!key) return;
  const clean = scrub(text).trim();
  if (!clean) return;
  const mem = loadMem();
  const rec = mem[key] && typeof mem[key] === 'object' ? mem[key] : { fights: [] };
  rec.fights = (rec.fights || []).concat([{ t: Date.now(), text: clean }]).slice(-MAX_FIGHTS);
  mem[key] = rec;
  saveMem(mem);
}

export function clearMemory(key) {
  if (key) {
    const mem = loadMem();
    delete mem[key];
    saveMem(mem);
    return;
  }
  lsDel(MEM_KEY);
}

/** Notes to prepend in the prompt, capped at ~600 characters. */
export function promptNotes(key) {
  if (!key || !isLearningOn(key)) return '';
  const fights = loadFights(key);
  if (!fights.length) return '';
  const parts = fights.map((f, i) => `${i + 1}. ${scrub(f.text).replace(/\s+/g, ' ').trim()}`);
  let out = parts.join(' ');
  while (out.length > PROMPT_CAP && parts.length > 1) {
    parts.shift();
    out = parts.join(' ');
  }
  if (out.length > PROMPT_CAP) out = out.slice(0, PROMPT_CAP - 1).replace(/\s+\S*$/, '') + '…';
  return out;
}

function pct(n, d) { return d ? Math.round((100 * n) / d) : 0; }

function moveLine(name, rec) {
  const land = rec.land || 0, miss = rec.miss || 0, block = rec.block || 0;
  const n = land + miss + block;
  if (!n) return '';
  const dmg = rec.damage ? ` ${Math.round(rec.damage)} dmg` : '';
  return `${name} ${n}: ${pct(land, n)}% land, ${pct(block, n)}% block, ${pct(miss, n)}% miss${dmg}`;
}

function lessons(info) {
  const out = [];
  const moves = info.moves || [];
  for (const m of moves) {
    if (m.n < 4 || out.length >= 4) continue;
    if (m.block / m.n >= 0.5) out.push(`${m.name} blocked ${pct(m.block, m.n)}%: mix or throw it less`);
    else if (m.miss / m.n >= 0.5) out.push(`${m.name} missed ${pct(m.miss, m.n)}%: close in before you throw it`);
    else if (m.land / m.n >= 0.55) out.push(`${m.name} landed ${pct(m.land, m.n)}%: favor it at mid range`);
  }
  if (info.wallStuck >= 2) out.push(`Stuck or cornered ${info.wallStuck}x: circle off the cage before you strike`);
  if ((info.heldLast || 0) + (info.noAnswer || 0) >= 3) {
    out.push(`No new plan ${info.noAnswer || 0}x, held last ${info.heldLast || 0}x: keep moving, don’t freeze`);
  }
  if (info.taken > info.dealt + 8) out.push('Took more damage than you dealt: block more and pick cleaner shots');
  else if (info.dealt > info.taken + 8 && info.outcome === 'won') out.push('Your landing shots worked: keep the moves that scored');
  if (info.outcome === 'lost' && /ko|tko/i.test(info.method || '')) out.push('Lost by KO: protect the head and don’t trade blindly');
  if (info.outcome === 'lost' && /decision|time/i.test(info.method || '')) out.push('Lost on time: press more in the last stretch');
  if (info.outcome === 'lost' && /ring/i.test(info.method || '')) out.push('Lost by ring-out: stay off the fence and circle back to center');
  if (!out.length) out.push('Mix punches and kicks, and step in before you strike');
  if (out.length === 1) out.push('After a miss, guard or circle instead of throwing the same move again');
  return out.slice(0, 4);
}

function methodLabel(method, outcome) {
  const m = String(method || '');
  if (/ring/i.test(m)) return 'ring-out';
  if (/tko/i.test(m)) return 'TKO';
  if (/ko/i.test(m)) return 'KO';
  if (/decision|time/i.test(m)) return 'time';
  if (outcome === 'draw') return 'draw';
  return m || 'decision';
}

/** Compact post-fight note plus 2–4 short lessons, from the fight log record. */
export function buildFightNote(side, fight) {
  const other = side === 'p1' ? 'p2' : 'p1';
  const movesIn = (fight && fight.moves && fight.moves[side]) || {};
  const moves = Object.entries(movesIn).map(([name, rec]) => {
    const land = rec.land || 0, miss = rec.miss || 0, block = rec.block || 0;
    return { name, land, miss, block, damage: rec.damage || 0, n: land + miss + block };
  }).filter((m) => m.n > 0).sort((a, b) => b.n - a.n);
  const dealt = moves.reduce((s, m) => s + m.damage, 0);
  const taken = Object.values((fight && fight.moves && fight.moves[other]) || {}).reduce((s, rec) => s + (rec.damage || 0), 0);
  const evs = (fight && fight.qevents) || [];
  const wallStuck = evs.filter((e) => e && e.k === 'wallStuck' && e.id === side).length;
  const flags = ((fight && fight.cpuFlags) || []).filter((f) => f.side === side && f.kind === 'cpuStuck').length;
  const stuck = wallStuck + flags;
  const api = fight && fight.apiStats && fight.apiStats[side];
  const heldLast = (api && (api.heldLastCount || 0)) || 0;
  const noAnswer = (api && (api.noAnswer || 0)) || 0;
  const winner = fight && fight.winner;
  const outcome = winner === 'draw' || winner == null ? 'draw' : (winner === side ? 'won' : 'lost');
  const method = methodLabel(fight && fight.method, outcome);
  const vs = (fight && fight.sides && fight.sides[other] && (fight.sides[other].label || fight.sides[other].name)) || 'opp';
  const moveTxt = moves.slice(0, 4).map((m) => moveLine(m.name, m)).filter(Boolean).join('; ');
  const hold = (heldLast || noAnswer) ? ` Held last ${heldLast}, no-answer ${noAnswer}.` : '';
  const stuckTxt = stuck ? ` Stuck/cornered ${stuck}x.` : '';
  const head = `${outcome} ${method} vs ${scrub(vs)}. Dealt ${Math.round(dealt)}, took ${Math.round(taken)}.${stuckTxt}${hold}`;
  const body = moveTxt ? ` ${moveTxt}.` : '';
  const tips = lessons({ moves, dealt, taken, wallStuck: stuck, heldLast, noAnswer, outcome, method });
  return `${head}${body} Lessons: ${tips.join('. ')}.`;
}

export function rememberApiFights(fight, p1, p2) {
  if (!fight) return;
  for (const [side, f] of [['p1', p1], ['p2', p2]]) {
    const snap = fight.learning && fight.learning[side];
    const custom = f && f.config && f.config.apiBrain;
    const isApi = !!(custom || (f && f.brain && f.brain.kind === 'api') || (fight.sides && fight.sides[side] && fight.sides[side].api));
    if (!isApi && !snap) continue;
    const name = (f && f.config && f.config.name) || (f && f.id) || (fight.sides && fight.sides[side] && fight.sides[side].name) || side;
    const provider = (custom && custom.provider) || (fight.sides && fight.sides[side] && fight.sides[side].api && fight.sides[side].api.provider) || '';
    const model = (custom && custom.model) || (fight.sides && fight.sides[side] && fight.sides[side].api && fight.sides[side].api.model) || '';
    const memKey = (snap && snap.memKey) || memoryKey(name, provider, model);
    const on = snap ? !!snap.on : isLearningOn(memKey);
    if (!on || !memKey) continue;
    recordFight(memKey, buildFightNote(side, fight));
  }
}

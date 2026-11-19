'use strict';
/* Fight data log: every fight is recorded in localStorage (rotated, size-capped).
   Download / copy / clear from Settings. Desktop-first.
   Keys / Authorization headers are never stored or exported. */
import { getSettings } from './settings.js';
import { ARENA, SIZE } from './config.js';

const KEY = 'rf_fight_log_v1';
const MAX_BYTES = 420000;
const MAX_FIGHTS = 18;
const MAX_EVENTS = 400;
const MAX_PATH = 480;       // ~96 s at 5 Hz, then downsample
const MAX_QEVENTS = 280;
const PATH_HZ = 5;

let current = null;
let hookInstalled = false;
const pendingConsole = [];

function nowIso() { return new Date().toISOString(); }

function deviceInfo() {
  const info = {
    ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    platform: typeof navigator !== 'undefined' ? navigator.platform : '',
    language: typeof navigator !== 'undefined' ? navigator.language : '',
    dpr: typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1,
    screen: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    gfx: '',
  };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      info.gfx = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '') : String(gl.getParameter(gl.RENDERER) || '');
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    }
  } catch (_) {}
  return info;
}

function settingsSnapshot() {
  const s = getSettings() || {};
  return {
    damage: s.damage || 'medium',
    camera: s.cam || 'arena',
    match: s.match || 3,
    difficulty: s.cpu || 'normal',
    gfx: s.gfx,
    hdri: !!s.hdri,
    round: s.round,
    loop: !!s.loopCpu,
  };
}

function sideLabel(f, cfg, fallback) {
  if (cfg && cfg.controller) return cfg.controller;
  if (f && f.config && f.config.apiBrain) {
    const a = f.config.apiBrain;
    return ['API', a.provider, a.model].filter(Boolean).join(' · ');
  }
  if (f && f.brain && (f.brain.kind === 'api' || f.brain.kind === 'remote')) return 'API';
  if (f && f.isCpu) return 'CPU';
  if (fallback) return fallback;
  return 'Player';
}

const SECRET_KEY = /^(key|api_key|apikey|authorization|auth|secret|token|access_token)$/i;
const SECRET_VAL = /\b(sk|xai|xai-key)-[A-Za-z0-9_\-]{8,}\b|Bearer\s+\S+/gi;

export function sanitizeLog(value, seen) {
  if (value == null) return value;
  if (typeof value === 'string') return value.replace(SECRET_VAL, '***');
  if (typeof value !== 'object') return value;
  const memo = seen || new WeakSet();
  if (memo.has(value)) return '[cycle]';
  memo.add(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeLog(v, memo));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k.charAt(0) === '_' && k !== '_t0') continue;
    if (SECRET_KEY.test(k)) continue;
    out[k] = sanitizeLog(v, memo);
  }
  return out;
}

function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { fights: [], version: 1 };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.fights)) return { fights: [], version: 1 };
    return data;
  } catch (_) { return { fights: [], version: 1 }; }
}

function saveAll(data) {
  data = sanitizeLog(data) || { fights: [], version: 1 };
  let fights = (data.fights || []).slice(-MAX_FIGHTS);
  const pack = (list) => {
    for (const f of list) shrinkFight(f);
    return JSON.stringify({ version: 1, fights: list });
  };
  let out = pack(fights);
  while (out.length > MAX_BYTES && fights.length) {
    const last = fights[fights.length - 1];
    if (last && last.path && last.path.length > 80) {
      last.path = last.path.filter((_, i) => i % 2 === 0);
      out = pack(fights);
      continue;
    }
    if (fights.length === 1) break;
    fights = fights.slice(1);
    out = pack(fights);
  }
  try { localStorage.setItem(KEY, out); } catch (_) {
    try {
      fights = fights.slice(Math.max(0, fights.length - 4));
      localStorage.setItem(KEY, JSON.stringify({ version: 1, fights: sanitizeLog(fights) }));
    } catch (__) {}
  }
}

function shrinkFight(f) {
  if (!f) return;
  if (f.path && f.path.length > MAX_PATH) {
    const step = Math.ceil(f.path.length / MAX_PATH);
    f.path = f.path.filter((_, i) => i % step === 0);
  }
  if (f.qevents && f.qevents.length > MAX_QEVENTS) f.qevents = f.qevents.slice(-MAX_QEVENTS);
}

function installConsoleHook() {
  if (hookInstalled || typeof console === 'undefined') return;
  hookInstalled = true;
  const wrap = (level, orig) => function (...args) {
    try {
      const msg = args.map((a) => {
        if (a == null) return String(a);
        if (typeof a === 'string') return a;
        if (a && a.message) return a.message;
        try { return String(a); } catch (_) { return '[unprintable]'; }
      }).join(' ');
      const rec = { t: nowIso(), level, msg: String(msg).slice(0, 400).replace(SECRET_VAL, '***') };
      if (current) {
        current.console = current.console || [];
        if (current.console.length < 80) current.console.push(rec);
      } else if (pendingConsole.length < 40) pendingConsole.push(rec);
    } catch (_) {}
    return orig.apply(console, args);
  };
  console.warn = wrap('warn', console.warn.bind(console));
  console.error = wrap('error', console.error.bind(console));
}

installConsoleHook();

function emptyMoves() { return {}; }

function moveRec(moves, name) {
  const k = name || 'unknown';
  if (!moves[k]) moves[k] = { land: 0, miss: 0, block: 0, damage: 0 };
  return moves[k];
}

function emptyQuality() {
  return {
    yawSnap: 0, visPop: 0, matPop: 0, shadowFlick: 0, boneJump: 0,
    spike: 0, noFade: 0, weight0: 0, footSlide: 0, camSnap: 0, camClip: 0,
    outOfCage: 0, throughCage: 0, belowMat: 0, wallStuck: 0, bodyDrift: 0,
    debrisOut: 0, debrisUnder: 0, fall: 0, getup: 0,
  };
}

export function startFight({ p1, p2, mode, labels } = {}) {
  installConsoleHook();
  current = {
    id: `f-${Date.now().toString(36)}`,
    startedAt: nowIso(),
    mode: mode || 'watch',
    settings: settingsSnapshot(),
    device: deviceInfo(),
    sides: {
      p1: { label: (labels && labels.p1) || sideLabel(p1, null, 'Player'), name: (p1 && p1.config && p1.config.name) || 'P1' },
      p2: { label: (labels && labels.p2) || sideLabel(p2, null, 'CPU'), name: (p2 && p2.config && p2.config.name) || 'P2' },
    },
    fps: { n: 0, sum: 0, min: 99, max: 0, drops: 0, below30: 0, last: 0 },
    console: pendingConsole.splice(0, pendingConsole.length),
    glitches: [],
    qevents: [],
    path: [],
    quality: emptyQuality(),
    latencies: [],
    moves: { p1: emptyMoves(), p2: emptyMoves() },
    attacks: { p1: 0, p2: 0 },
    lastClip: { p1: null, p2: null },
    spam: { p1: 0, p2: 0 },
    lastActAt: { p1: 0, p2: 0 },
    cpuFlags: [],
    rounds: [],
    apiStats: null,
    winner: null,
    method: null,
    endedAt: null,
    summary: null,
  };
  current._t0 = performance.now();
  current._pathAt = 0;
  current._prev = { p1: null, p2: null, cam: null, vis: { p1: 0, p2: 0 }, mats: { p1: 0, p2: 0 }, shadow: null, work: [] };
  current._stuck = { p1: 0, p2: 0 };
  current._press = null;
  return current;
}

export function activeFight() { return current; }

export function logFps(fps) {
  if (!current || !(fps > 0) || !Number.isFinite(fps)) return;
  const s = current.fps;
  s.n += 1; s.sum += fps; s.last = fps;
  if (fps < s.min) s.min = fps;
  if (fps > s.max) s.max = fps;
  if (fps < 30) s.below30 += 1;
  if (fps < 20) s.drops += 1;
}

export function logGlitch(kind, data) {
  if (!current) return;
  if (current.glitches.length >= MAX_EVENTS) return;
  const last = current.glitches[current.glitches.length - 1];
  const t = +((performance.now() - current._t0) / 1000).toFixed(2);
  if (last && last.kind === kind && last.id === (data && data.id) && t - last.t < 0.25) {
    last.n = (last.n || 1) + 1;
    return;
  }
  current.glitches.push(sanitizeLog({ kind, t, n: 1, ...(data || {}) }));
}

function qpush(kind, data) {
  if (!current) return;
  current.quality[kind] = (current.quality[kind] || 0) + 1;
  if (current.qevents.length >= MAX_QEVENTS) return;
  const t = +((performance.now() - current._t0) / 1000).toFixed(2);
  const last = current.qevents[current.qevents.length - 1];
  if (last && last.k === kind && last.id === (data && data.id) && t - last.t < 0.3) {
    last.n = (last.n || 1) + 1;
    return;
  }
  current.qevents.push(sanitizeLog({ k: kind, t, n: 1, ...(data || {}) }));
}

export function noteFrameWork(tag) {
  if (!current) return;
  const w = current._prev && current._prev.work;
  if (w && w.length < 8) w.push(String(tag).slice(0, 24));
}

export function logFall(id, pos) {
  if (!current) return;
  qpush('fall', { id, x: r2(pos && pos.x), z: r2(pos && pos.z) });
}
export function logGetUp(id, pos) {
  if (!current) return;
  qpush('getup', { id, x: r2(pos && pos.x), z: r2(pos && pos.z) });
}

export function logAnimSwitch(id, from, to, fade) {
  if (!current) return;
  if (fade != null && fade < 0.05) qpush('noFade', { id, from, to, fade: +(+fade).toFixed(2) });
}

export function logInputPress(side, kind) {
  if (!current) return;
  current._press = { side, kind, at: performance.now() };
}
export function logInputAction(side, kind) {
  if (!current || !current._press) return;
  if (current._press.side !== side) return;
  const ms = Math.round(performance.now() - current._press.at);
  current._press = null;
  if (ms >= 0 && ms < 2000) {
    current.latencies.push(ms);
    if (current.latencies.length > 80) current.latencies.shift();
    if (ms > 180) qpush('inputLag', { id: side, kind, ms });
  }
}

export function logStrike(side, clip, result, damage) {
  if (!current || (side !== 'p1' && side !== 'p2')) return;
  const rec = moveRec(current.moves[side], clip || 'unknown');
  if (result === 'land') rec.land += 1;
  else if (result === 'block') rec.block += 1;
  else rec.miss += 1;
  if (damage) rec.damage += +(+damage).toFixed(2);
  current.attacks[side] += 1;
  if (current.lastClip[side] === clip) current.spam[side] += 1;
  else current.spam[side] = 1;
  current.lastClip[side] = clip;
  current.lastActAt[side] = performance.now();
  if (current.spam[side] === 8) {
    current.cpuFlags.push({ t: +((performance.now() - current._t0) / 1000).toFixed(2), kind: 'cpuSpam', side, clip, n: 8 });
  }
}

export function logCpuIdle(side, inRange, canThrow = true) {
  if (!current) return;
  current.lastEligibleAt = current.lastEligibleAt || { p1: 0, p2: 0 };
  const now = performance.now();
  if (!inRange || !canThrow) {
    current.lastEligibleAt[side] = 0;
    return;
  }
  if (!current.lastEligibleAt[side]) current.lastEligibleAt[side] = now;
  const last = Math.max(current.lastActAt[side] || 0, current.lastEligibleAt[side]);
  if (now - last > 8000) {
    const t = +((now - current._t0) / 1000).toFixed(2);
    const already = current.cpuFlags.some((f) => f.kind === 'cpuStuck' && f.side === side && t - f.t < 8);
    if (!already) current.cpuFlags.push({ t, kind: 'cpuStuck', side });
    current.lastActAt[side] = now;
    current.lastEligibleAt[side] = now;
  }
}

export function logRound(round) {
  if (!current || !round) return;
  current.rounds.push(round);
}

export function setFightApiStats(stats) {
  if (current) current.apiStats = sanitizeLog(stats);
}

function r2(v) { return v == null || !Number.isFinite(+v) ? 0 : +(+v).toFixed(2); }
function r1(v) { return v == null || !Number.isFinite(+v) ? 0 : +(+v).toFixed(1); }

export function wallDist(x, z) {
  const a = ARENA.apothem || 6.1;
  const ax = a - Math.abs(x);
  const az = a - Math.abs(z);
  const diag = a * Math.SQRT2 - (Math.abs(x) + Math.abs(z));
  return Math.min(ax, az, diag);
}

function angDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function countVis(f) {
  let n = 0, mats = 0;
  if (!f || !f.model) return { n, mats };
  const seen = new Set();
  f.model.traverse((o) => {
    if (o.isMesh && o.visible) {
      n += 1;
      const m = o.material;
      if (m) {
        const id = m.uuid || m;
        if (!seen.has(id)) { seen.add(id); mats += 1; }
      }
    }
  });
  return { n, mats };
}

/**
 * Per-frame quality + 5 Hz placement sample.
 * pose: { x, z, y, yaw, hips, head, wall, state, clip, wx (weight of current), footX, footZ, capX, capZ }
 */
export function stepFightQuality(env) {
  if (!current || !env || env.phase !== 'fight') return;
  const now = performance.now();
  const t = +((now - current._t0) / 1000).toFixed(2);
  const q = current.quality;
  const prev = current._prev || (current._prev = {});
  const matY = env.matY || 0;

  if (env.work && env.work.length) {
    for (const w of env.work) noteFrameWork(w);
  }

  // Frame spikes (wall-clock). Context: clips, camera, draws, anything flagged this frame.
  if (env.wallDt > 0.055 || (env.fps > 0 && env.fps < 18)) {
    const work = (prev.work || []).slice();
    qpush('spike', {
      dt: r2(env.wallDt * 1000),
      fps: r1(env.fps),
      cam: env.camMode,
      clips: [env.p1 && env.p1.clip, env.p2 && env.p2.clip],
      draws: env.draws || 0,
      tris: env.tris || 0,
      work: work.length ? work : undefined,
    });
  }
  prev.work = [];

  for (const side of ['p1', 'p2']) {
    const s = env[side];
    if (!s) continue;
    const p = prev[side];
    const w = s.wall;
    if (w < -0.04) qpush('outOfCage', { id: side, w: r2(w), x: r2(s.x), z: r2(s.z) });
    if (s.y < matY - 0.06 || s.hips < matY - 0.08 || s.head < matY - 0.08) {
      qpush('belowMat', { id: side, y: r2(Math.min(s.y, s.hips, s.head)) });
    }
    if (p && p.wall >= 0.02 && w < -0.02) qpush('throughCage', { id: side, w: r2(w) });
    if (w < 0.14 && Math.hypot(s.x - (p && p.x || s.x), s.z - (p && p.z || s.z)) < 0.012) {
      current._stuck[side] = (current._stuck[side] || 0) + (env.dt || 0);
      if (current._stuck[side] > 1.4) { qpush('wallStuck', { id: side, w: r2(w) }); current._stuck[side] = 0; }
    } else current._stuck[side] = 0;
    if (s.capX != null && Math.hypot(s.x - s.capX, s.z - s.capZ) > 0.38 * (SIZE || 1)) {
      qpush('bodyDrift', { id: side, d: r2(Math.hypot(s.x - s.capX, s.z - s.capZ)) });
    }
    if (p) {
      const yaw = Math.abs(angDelta(s.yaw, p.yaw));
      if (yaw > 0.45 && s.state !== 'getup' && s.state !== 'ko') qpush('yawSnap', { id: side, deg: r1(yaw * 57.3) });
      const bone = Math.max(Math.abs(s.hips - p.hips), Math.abs(s.head - p.head), Math.hypot(s.x - p.x, s.z - p.z));
      if (bone > 0.55 && env.dt > 0 && bone / env.dt > 12) qpush('boneJump', { id: side, d: r2(bone) });
      if (s.footX != null && p.footX != null && s.state !== 'down' && s.state !== 'ko' && s.state !== 'dodge' && s.state !== 'kick') {
        const root = Math.hypot(s.x - p.x, s.z - p.z);
        const foot = Math.hypot(s.footX - p.footX, s.footZ - p.footZ);
        if (root > 0.004 && Math.abs(foot - root) > 0.11) qpush('footSlide', { id: side, d: r2(Math.abs(foot - root)) });
      }
    }
    if (s.wx != null && s.wx < 0.04 && (s.state === 'punch' || s.state === 'kick' || s.state === 'dodge')) {
      qpush('weight0', { id: side, clip: s.clip, st: s.state });
    }
    if (s.vis != null) {
      if (p && p.vis != null && Math.abs(s.vis - p.vis) >= 2) qpush('visPop', { id: side, from: p.vis, to: s.vis });
      if (p && p.mats != null && s.mats != null && Math.abs(s.mats - p.mats) >= 2) qpush('matPop', { id: side, from: p.mats, to: s.mats });
    }
    prev[side] = s;
  }

  if (env.debris) {
    for (const d of env.debris) {
      if (d.under) qpush('debrisUnder', { y: r2(d.y) });
      if (d.out) qpush('debrisOut', { x: r2(d.x), z: r2(d.z) });
    }
  }

  if (env.cam) {
    const c = env.cam;
    const pc = prev.cam;
    if (pc && Math.hypot(c.x - pc.x, c.y - pc.y, c.z - pc.z) > 1.6) {
      qpush('camSnap', { d: r2(Math.hypot(c.x - pc.x, c.y - pc.y, c.z - pc.z)), mode: env.camMode });
    }
    if (c.wall < 0.18 || c.y < matY + 0.05) qpush('camClip', { w: r2(c.wall), y: r2(c.y), mode: env.camMode });
    prev.cam = c;
  }
  if (prev.shadow != null && env.shadowOn != null && prev.shadow !== env.shadowOn) qpush('shadowFlick', {});
  if (env.shadowOn != null) prev.shadow = env.shadowOn;

  // Compact 5 Hz path: [t, x1,z1,yaw1,hips1,head1,wall1, x2,z2,yaw2,hips2,head2,wall2, gap]
  if (now - (current._pathAt || 0) >= 1000 / PATH_HZ) {
    current._pathAt = now;
    const a = env.p1, b = env.p2;
    if (a && b) {
      current.path.push([
        t,
        r2(a.x), r2(a.z), r2(a.yaw), r2(a.hips), r2(a.head), r2(a.wall),
        r2(b.x), r2(b.z), r2(b.yaw), r2(b.hips), r2(b.head), r2(b.wall),
        r2(env.gap),
      ]);
      if (current.path.length > MAX_PATH * 2) {
        current.path = current.path.filter((_, i) => i % 2 === 0);
      }
    }
  }
}

function buildSummary(fight) {
  const q = fight.quality || {};
  const top = Object.entries(q)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, n]) => ({ k, n }));
  const lat = fight.latencies || [];
  const avgLag = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null;
  const pathN = (fight.path || []).length;
  const g = {};
  for (const ev of fight.glitches || []) g[ev.kind] = (g[ev.kind] || 0) + (ev.n || 1);
  const glitchTop = Object.entries(g).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => ({ k, n }));
  return {
    top,
    glitches: glitchTop,
    fps: fight.fps ? { mean: fight.fps.mean, min: fight.fps.min, drops: fight.fps.dropsBelow20 } : null,
    pathSamples: pathN,
    inputLatencyMs: avgLag,
    cpuStuck: (fight.cpuFlags || []).filter((f) => f.kind === 'cpuStuck').length,
    api: fight.apiStats || undefined,
  };
}

export function endFight({ winner, method, p1, p2, labels, apiStats } = {}) {
  if (!current) return null;
  if (p1) current.sides.p1.label = (labels && labels.p1) || sideLabel(p1, null, current.sides.p1.label);
  if (p2) current.sides.p2.label = (labels && labels.p2) || sideLabel(p2, null, current.sides.p2.label);
  if (p1 && p1.config && p1.config.apiBrain) current.sides.p1.api = { provider: p1.config.apiBrain.provider, model: p1.config.apiBrain.model };
  if (p2 && p2.config && p2.config.apiBrain) current.sides.p2.api = { provider: p2.config.apiBrain.provider, model: p2.config.apiBrain.model };
  if (apiStats) current.apiStats = sanitizeLog(apiStats);
  current.endedAt = nowIso();
  current.durationS = +((performance.now() - current._t0) / 1000).toFixed(2);
  current.winner = winner || null;
  current.method = method || null;
  const s = current.fps;
  current.fps = {
    samples: s.n,
    mean: s.n ? +(s.sum / s.n).toFixed(1) : null,
    min: s.n ? +s.min.toFixed(1) : null,
    max: s.n ? +s.max.toFixed(1) : null,
    dropsBelow20: s.drops,
    below30: s.below30,
  };
  current.summary = buildSummary(current);
  delete current._prev;
  delete current._pathAt;
  delete current._stuck;
  delete current._press;
  delete current.lastEligibleAt;
  const all = loadAll();
  all.fights.push(sanitizeLog(current));
  saveAll(all);
  const done = current;
  current = null;
  return done;
}

export function getLog() { return sanitizeLog(loadAll()); }

export function downloadLog() {
  const data = sanitizeLog(loadAll());
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = URL.createObjectURL(blob);
  a.download = `robot-fight-log-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  return data.fights.length;
}

export async function copyLog() {
  const text = JSON.stringify(sanitizeLog(loadAll()), null, 2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

export function clearLog() {
  current = null;
  try { localStorage.removeItem(KEY); } catch (_) {}
}

if (typeof window !== 'undefined') {
  window.RFFightLog = { startFight, endFight, logFps, logGlitch, logStrike, logRound, getLog, downloadLog, copyLog, clearLog, sanitizeLog, noteFrameWork };
}

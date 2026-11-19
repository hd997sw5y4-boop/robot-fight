'use strict';
/* Fight data log: every fight is recorded in localStorage (rotated, size-capped).
   Download / copy / clear from Settings. Desktop-first. */
import { getSettings } from './settings.js';

const KEY = 'rf_fight_log_v1';
const MAX_BYTES = 420000;
const MAX_FIGHTS = 18;
const MAX_EVENTS = 400;

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
  if (f && f.brain && (f.brain.kind === 'api' || f.brain.kind === 'remote')) return 'API';
  if (f && f.isCpu) return 'CPU';
  if (fallback) return fallback;
  return 'Player';
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
  let fights = (data.fights || []).slice(-MAX_FIGHTS);
  let out = JSON.stringify({ version: 1, fights });
  while (out.length > MAX_BYTES && fights.length > 1) {
    fights = fights.slice(1);
    out = JSON.stringify({ version: 1, fights });
  }
  try { localStorage.setItem(KEY, out); } catch (_) {
    // Quota: drop older fights and retry once.
    try {
      fights = fights.slice(Math.max(0, fights.length - 4));
      localStorage.setItem(KEY, JSON.stringify({ version: 1, fights }));
    } catch (__) {}
  }
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
      const rec = { t: nowIso(), level, msg: msg.slice(0, 400) };
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

function emptyMoves() {
  return {};
}

function moveRec(moves, name) {
  const k = name || 'unknown';
  if (!moves[k]) moves[k] = { land: 0, miss: 0, block: 0, damage: 0 };
  return moves[k];
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
    moves: { p1: emptyMoves(), p2: emptyMoves() },
    attacks: { p1: 0, p2: 0 },
    lastClip: { p1: null, p2: null },
    spam: { p1: 0, p2: 0 },
    lastActAt: { p1: 0, p2: 0 },
    cpuFlags: [],
    rounds: [],
    winner: null,
    method: null,
    endedAt: null,
  };
  current._t0 = performance.now();
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
  current.glitches.push({ kind, t, n: 1, ...(data || {}) });
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

export function logCpuIdle(side, inRange) {
  if (!current) return;
  const last = current.lastActAt[side] || current._t0;
  if (inRange && performance.now() - last > 8000) {
    const t = +((performance.now() - current._t0) / 1000).toFixed(2);
    const already = current.cpuFlags.some((f) => f.kind === 'cpuStuck' && f.side === side && t - f.t < 8);
    if (!already) current.cpuFlags.push({ t, kind: 'cpuStuck', side });
    current.lastActAt[side] = performance.now();
  }
}

export function logRound(round) {
  if (!current || !round) return;
  current.rounds.push(round);
}

export function endFight({ winner, method, p1, p2, labels } = {}) {
  if (!current) return null;
  if (p1) current.sides.p1.label = (labels && labels.p1) || sideLabel(p1, null, current.sides.p1.label);
  if (p2) current.sides.p2.label = (labels && labels.p2) || sideLabel(p2, null, current.sides.p2.label);
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
  const all = loadAll();
  all.fights.push(current);
  saveAll(all);
  const done = current;
  current = null;
  return done;
}

export function getLog() { return loadAll(); }

export function downloadLog() {
  const data = loadAll();
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
  const text = JSON.stringify(loadAll(), null, 2);
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
  window.RFFightLog = { startFight, endFight, logFps, logGlitch, logStrike, logRound, getLog, downloadLog, copyLog, clearLog };
}

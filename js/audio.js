'use strict';
/* Sample playback + master / SFX / crowd buses.
   Squared volume taper is from WW3D addons/master-volume.js.
   Real clips replace the temporary oscillator/noise bus when loaded. */

const BASE = './sounds/';
const BANK = {
  tick: ['ui_tick.ogg'],
  click: ['ui_click.ogg', 'ui_click_2.ogg'],
  confirm: ['ui_confirm.ogg'],
  close: ['ui_close.ogg'],
  servo: ['servo_00.ogg', 'servo_01.ogg', 'servo_02.ogg', 'servo_03.ogg', 'servo_04.ogg'],
  metalL: ['hit_metal_l_000.ogg', 'hit_metal_l_001.ogg', 'hit_metal_l_003.ogg'],
  metalM: ['hit_metal_m_000.ogg', 'hit_metal_m_002.ogg', 'hit_metal_m_004.ogg'],
  metalH: ['hit_metal_h_000.ogg', 'hit_metal_h_001.ogg', 'hit_metal_h_003.ogg'],
  punchM: ['hit_punch_m_000.ogg', 'hit_punch_m_002.ogg', 'hit_punch_m_004.ogg'],
  punchH: ['hit_punch_h_000.ogg', 'hit_punch_h_002.ogg', 'hit_punch_h_004.ogg'],
  block: ['block_000.ogg', 'block_002.ogg', 'block_004.ogg'],
  field: ['field_000.ogg', 'field_002.ogg', 'field_004.ogg'],
  step: ['step_000.ogg', 'step_001.ogg', 'step_002.ogg', 'step_003.ogg', 'step_004.ogg'],
  fall: ['fall_000.ogg', 'fall_002.ogg', 'fall_004.ogg'],
  tear: ['tear_000.ogg', 'tear_002.ogg', 'tear_004.ogg', 'tear_mine_000.ogg', 'tear_mine_003.ogg'],
  bounce: ['bounce_000.ogg', 'bounce_002.ogg', 'bounce_004.ogg'],
  spark: ['spark_0.ogg'],
  cage: ['cage_000.ogg', 'cage_002.ogg', 'cage_tin_001.ogg', 'cage_tin_003.ogg'],
  bell: ['bell_000.ogg', 'bell_001.ogg', 'bell_002.ogg'],
  crowdHit: ['crowd_short.ogg', 'crowd_stadium_short.ogg'],
  crowdBig: ['crowd_whistle.ogg', 'crowd_stadium.ogg'],
  crowdKo: ['crowd_win.ogg', 'crowd_whistle.ogg'],
};

let ctx = null;
let master = null;
let sfx = null;
let crowd = null;
let masterLevel = 1;
let sfxLevel = 1;
let crowdLevel = 0.7;
const buffers = new Map();
let loaded = false;
let loading = null;
let crowdSrc = null;
let crowdGate = null;
let buzzSrc = null;
let buzzGain = null;
let buzzLevel = 0;
const lastAt = new Map();

const clamp = (x) => Math.max(0, Math.min(1, Math.round(x * 100) / 100));
const taper = (v) => v * v;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const jitter = (amt) => 1 - amt + Math.random() * amt * 2;

function applyGains() {
  if (!master || !sfx || !crowd) return;
  const t = ctx.currentTime;
  const set = (node, v) => {
    try { node.gain.setTargetAtTime(v, t, 0.02); } catch (_) { node.gain.value = v; }
  };
  set(master, taper(masterLevel));
  set(sfx, taper(sfxLevel));
  set(crowd, taper(crowdLevel));
}

async function loadAll() {
  if (loaded) return;
  if (loading) return loading;
  if (!ctx) return;
  const files = new Set(['crowd_loop.ogg', 'buzz_loop.ogg']);
  for (const list of Object.values(BANK)) for (const f of list) files.add(f);
  loading = Promise.all([...files].map(async (name) => {
    try {
      const res = await fetch(BASE + name);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw.slice(0));
      buffers.set(name, buf);
    } catch (_) {}
  })).then(() => { loaded = true; loading = null; ensureCrowd(); applyBuzz(); });
  return loading;
}

function makeCtx() {
  const ACX = window.AudioContext || window.webkitAudioContext;
  if (!ACX || ctx) return;
  ctx = new ACX();
  master = ctx.createGain();
  sfx = ctx.createGain();
  crowd = ctx.createGain();
  sfx.connect(master);
  crowd.connect(master);
  master.connect(ctx.destination);
  applyGains();
}

export function unlockAudio() {
  makeCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  loadAll();
  ensureCrowd();
}

export function setVolumes(masterV, sfxV, crowdV) {
  masterLevel = clamp(masterV);
  sfxLevel = clamp(sfxV);
  if (crowdV != null && isFinite(+crowdV)) crowdLevel = clamp(crowdV);
  applyGains();
  if (crowdLevel <= 0) stopCrowd();
  else ensureCrowd();
}

function ready() {
  return !!(ctx && masterLevel > 0);
}

function playBuf(buf, opts = {}) {
  if (!ready() || !buf) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const bus = opts.bus || sfx;
  if (bus === sfx && sfxLevel <= 0) return;
  if (bus === crowd && crowdLevel <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = opts.rate || 1;
  const g = ctx.createGain();
  const vol = opts.vol == null ? 1 : opts.vol;
  const t = ctx.currentTime + (opts.delay || 0);
  g.gain.setValueAtTime(Math.max(0.0001, vol), t);
  src.connect(g);
  g.connect(bus);
  src.start(t);
}

function playGroup(name, opts = {}) {
  const list = BANK[name];
  if (!list) return false;
  const files = list.filter((f) => buffers.has(f));
  if (!files.length) return false;
  const rateVar = opts.rateVar == null ? 0.08 : opts.rateVar;
  const volVar = opts.volVar == null ? 0.12 : opts.volVar;
  playBuf(buffers.get(pick(files)), {
    bus: opts.bus,
    delay: opts.delay,
    vol: (opts.vol == null ? 1 : opts.vol) * jitter(volVar),
    rate: (opts.rate || 1) * jitter(rateVar),
  });
  return true;
}

function limited(key, ms) {
  const n = performance.now();
  if (n - (lastAt.get(key) || 0) < ms) return false;
  lastAt.set(key, n);
  return true;
}

// Tiny coded fallback used only before clips finish loading.
function tone(freq, dur, start, type, startGain) {
  if (!ctx || !sfx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(startGain, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(sfx);
  o.start(start);
  o.stop(start + dur + 0.02);
}

export function playHit(opts = {}) {
  unlockAudio();
  if (!ready() || sfxLevel <= 0) return;
  const blocked = !!opts.blocked;
  const heavy = !!opts.heavy;
  const kick = !!opts.kick;
  if (blocked) {
    if (!playGroup('block', { vol: 0.95, rateVar: 0.1 })) return;
    playGroup('field', { vol: 0.32, rateVar: 0.08 });
    playGroup('metalL', { vol: 0.4, rate: 1.12, rateVar: 0.08 });
    return;
  }
  const metal = heavy ? 'metalH' : (kick ? 'metalM' : 'metalL');
  const punch = heavy || kick ? 'punchH' : 'punchM';
  playGroup(metal, { vol: 1, rate: kick ? 0.92 : 1, rateVar: 0.1 });
  playGroup(punch, { vol: heavy ? 0.72 : 0.5, delay: 0.012, rateVar: 0.08 });
  if (limited('spark', 40)) playGroup('spark', { vol: heavy ? 0.55 : 0.32, rateVar: 0.14 });
  if (heavy && limited('crowdHit', 420)) {
    playGroup(Math.random() < 0.55 ? 'crowdBig' : 'crowdHit', { bus: crowd, vol: 0.78, rateVar: 0.03, volVar: 0.08 });
  }
}

export function playSfx(kind, opts = {}) {
  unlockAudio();
  if (!ready()) return;
  if (kind === 'hit') { playHit({ blocked: false, heavy: !!opts.heavy, kick: !!opts.kick }); return; }
  if (kind === 'block') { playHit({ blocked: true }); return; }
  if (kind === 'whoosh' || kind === 'servo') {
    if (!limited('servo', opts.limit || 90)) return;
    if (!playGroup('servo', { vol: opts.vol == null ? 0.55 : opts.vol, rate: opts.rate || 1, rateVar: 0.1 })) {
      if (ctx && sfxLevel > 0) {
        const t = ctx.currentTime;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(180, t);
        o.frequency.exponentialRampToValueAtTime(90, t + 0.12);
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(sfx); o.start(t); o.stop(t + 0.14);
      }
    }
    return;
  }
  if (kind === 'step') {
    if (!limited('step', 70)) return;
    playGroup('step', { vol: opts.vol == null ? 0.55 : opts.vol, rateVar: 0.08 });
    return;
  }
  if (kind === 'cage') {
    if (!limited(opts.id ? 'cage:' + opts.id : 'cage', opts.limit || 90)) return;
    playGroup('cage', { vol: opts.vol == null ? 0.7 : opts.vol, rate: opts.rate || 1, rateVar: 0.1 });
    return;
  }
  if (kind === 'bounce' || kind === 'clank') {
    if (!limited(opts.id ? 'bounce:' + opts.id : 'bounce', opts.limit || 50)) return;
    playGroup('bounce', { vol: opts.vol == null ? 0.7 : opts.vol, rateVar: 0.14, rate: opts.rate || 1 });
    return;
  }
  if (kind === 'tear') {
    playGroup('tear', { vol: 1, rateVar: 0.08 });
    playGroup('metalH', { vol: 0.55, delay: 0.04 });
    playGroup('spark', { vol: 0.7, rateVar: 0.12 });
    return;
  }
  if (kind === 'spark') {
    if (!limited('spark', 50)) return;
    playGroup('spark', { vol: opts.vol == null ? 0.45 : opts.vol, rateVar: 0.16 });
    return;
  }
  if (kind === 'fall') {
    playGroup('fall', { vol: 1, rateVar: 0.07 });
    playGroup('punchH', { vol: 0.45, delay: 0.05 });
    return;
  }
  if (kind === 'bell') {
    playGroup('bell', { vol: opts.vol == null ? 0.9 : opts.vol, rateVar: 0.02, volVar: 0.04 });
    return;
  }
  if (kind === 'crowdHit') {
    if (!limited('crowdHit', 400)) return;
    playGroup(Math.random() < 0.5 ? 'crowdHit' : 'crowdBig', { bus: crowd, vol: opts.vol == null ? 0.75 : opts.vol, rateVar: 0.03 });
    return;
  }
  if (kind === 'ko') {
    playGroup('fall', { vol: 1, rateVar: 0.06 });
    playGroup('metalH', { vol: 0.65, delay: 0.06 });
    playGroup('bell', { vol: 0.95, rateVar: 0.02, delay: 0.04 });
    playGroup('crowdKo', { bus: crowd, vol: 0.95, rateVar: 0.025, volVar: 0.05, delay: 0.08 });
    return;
  }
  if (kind === 'tick' || kind === 'click' || kind === 'confirm' || kind === 'close') {
    const vol = kind === 'tick' ? 0.45 : 0.7;
    if (!playGroup(kind, { vol, rateVar: kind === 'tick' ? 0.04 : 0.06, volVar: 0.08 })) {
      if (sfxLevel > 0) tone(kind === 'tick' ? 880 : 520, 0.05, ctx.currentTime, 'square', 0.045);
    }
    return;
  }
}

function stopCrowd() {
  if (!crowdSrc) return;
  try { crowdSrc.stop(); } catch (_) {}
  try { crowdSrc.disconnect(); } catch (_) {}
  crowdSrc = null;
  crowdGate = null;
}

function ensureCrowd() {
  if (!ctx || !loaded || crowdLevel <= 0 || !buffers.has('crowd_loop.ogg')) return;
  if (crowdSrc) return;
  if (ctx.state === 'suspended') return;
  const src = ctx.createBufferSource();
  src.buffer = buffers.get('crowd_loop.ogg');
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = 0.45;
  src.connect(g);
  g.connect(crowd);
  try { src.start(); } catch (_) { return; }
  crowdSrc = src;
  crowdGate = g;
  src.onended = () => { if (crowdSrc === src) crowdSrc = null; };
}

function applyBuzz() {
  if (!ctx || !loaded) return;
  if (buzzLevel <= 0.04 || sfxLevel <= 0) {
    if (buzzSrc) {
      try { buzzSrc.stop(); } catch (_) {}
      try { buzzSrc.disconnect(); } catch (_) {}
      buzzSrc = null;
      buzzGain = null;
    }
    return;
  }
  if (!buffers.has('buzz_loop.ogg')) return;
  if (!buzzSrc) {
    const src = ctx.createBufferSource();
    src.buffer = buffers.get('buzz_loop.ogg');
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(g);
    g.connect(sfx);
    try { src.start(); } catch (_) { return; }
    buzzSrc = src;
    buzzGain = g;
    src.onended = () => { if (buzzSrc === src) buzzSrc = null; };
  }
  if (buzzGain) {
    try { buzzGain.gain.setTargetAtTime(0.22 * buzzLevel, ctx.currentTime, 0.08); } catch (_) { buzzGain.gain.value = 0.22 * buzzLevel; }
  }
}

export function setBuzz(level) {
  buzzLevel = Math.max(0, Math.min(1, +level || 0));
  applyBuzz();
}

export function startCrowd() {
  unlockAudio();
  ensureCrowd();
}

'use strict';
/* Sample playback + master / SFX / crowd buses, light arena convolver.
   Squared volume taper is from WW3D addons/master-volume.js. */

const BASE = './sounds/';
const BANK = {
  tick: ['ui_tick.ogg'],
  click: ['ui_click.ogg', 'ui_click_2.ogg'],
  confirm: ['ui_confirm.ogg'],
  close: ['ui_close.ogg'],
  servo: ['servo_0.ogg', 'servo_1.ogg', 'servo_2.ogg', 'servo_3.ogg', 'servo_4.ogg', 'servo_5.ogg'],
  hydro: ['hydro_0.ogg', 'hydro_1.ogg', 'hydro_2.ogg', 'hydro_3.ogg'],
  metalL: ['metal_l_0.ogg', 'metal_l_1.ogg', 'metal_l_2.ogg', 'metal_l_3.ogg', 'metal_l_4.ogg', 'metal_l_5.ogg'],
  metalM: ['metal_m_0.ogg', 'metal_m_1.ogg', 'metal_m_2.ogg', 'metal_m_3.ogg', 'metal_m_4.ogg', 'metal_m_5.ogg'],
  metalH: ['metal_h_0.ogg', 'metal_h_1.ogg', 'metal_h_2.ogg', 'metal_h_3.ogg', 'metal_h_4.ogg', 'metal_h_5.ogg', 'metal_h_6.ogg'],
  punchM: ['punch_0.ogg', 'punch_1.ogg', 'punch_2.ogg'],
  punchH: ['punch_2.ogg', 'punch_3.ogg', 'punch_4.ogg'],
  block: ['block_0.ogg', 'block_1.ogg', 'block_2.ogg', 'block_3.ogg'],
  step: ['step_01.ogg', 'step_03.ogg', 'step_05.ogg', 'step_07.ogg', 'step_09.ogg', 'step_11.ogg', 'step_14.ogg', 'step_17.ogg', 'step_20.ogg', 'step_23.ogg'],
  fall: ['crash_0.ogg', 'crash_2.ogg', 'crash_4.ogg'],
  tear: ['tear_0.ogg', 'tear_1.ogg', 'tear_2.ogg', 'tear_3.ogg', 'tear_4.ogg'],
  bounce: ['bounce_0.ogg', 'bounce_1.ogg', 'bounce_2.ogg', 'bounce_3.ogg', 'bounce_4.ogg'],
  spark: ['spark_0.ogg', 'spark_1.ogg', 'spark_2.ogg'],
  cage: ['cage_0.ogg', 'cage_1.ogg', 'cage_2.ogg'],
  crash: ['crash_0.ogg', 'crash_1.ogg', 'crash_2.ogg', 'crash_3.ogg', 'crash_4.ogg'],
  bell: ['bell_000.ogg', 'bell_001.ogg', 'bell_002.ogg'],
  crowdHit: ['crowd_short.ogg', 'crowd_stadium_short.ogg'],
  crowdBig: ['crowd_whistle.ogg', 'crowd_stadium.ogg'],
  crowdKo: ['crowd_win.ogg', 'crowd_whistle.ogg'],
};

let ctx = null;
let master = null;
let sfx = null;
let sfxDry = null;
let sfxWet = null;
let conv = null;
let crowd = null;
let humGain = null;
let masterLevel = 1;
let sfxLevel = 1;
let crowdLevel = 0.7;
const buffers = new Map();
let loaded = false;
let loading = null;
let crowdSrc = null;
let crowdGate = null;
let humSrc = null;
let buzzSrc = null;
let buzzGain = null;
let buzzLevel = 0;
const lastAt = new Map();
const lastPick = new Map();

const clamp = (x) => Math.max(0, Math.min(1, Math.round(x * 100) / 100));
const taper = (v) => v * v;
const jitter = (amt) => 1 - amt + Math.random() * amt * 2;

function pick(arr, key) {
  if (!arr || !arr.length) return null;
  const last = key != null ? lastPick.get(key) : null;
  const opts = (arr.length > 1 && last != null) ? arr.filter((x) => x !== last) : arr;
  const v = opts[Math.floor(Math.random() * opts.length)];
  if (key != null) lastPick.set(key, v);
  return v;
}

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
  const files = new Set(['crowd_loop.ogg', 'buzz_loop.ogg', 'arena_hum.ogg', 'ir_hall.ogg']);
  for (const list of Object.values(BANK)) for (const f of list) files.add(f);
  loading = Promise.all([...files].map(async (name) => {
    try {
      const res = await fetch(BASE + name);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      const buf = await ctx.decodeAudioData(raw.slice(0));
      buffers.set(name, buf);
    } catch (_) {}
  })).then(() => {
    loaded = true;
    loading = null;
    hookConvolver();
    ensureCrowd();
    ensureHum();
    applyBuzz();
  });
  return loading;
}

function hookConvolver() {
  if (!ctx || !conv) return;
  const ir = buffers.get('ir_hall.ogg');
  if (ir) conv.buffer = ir;
}

function makeCtx() {
  const ACX = window.AudioContext || window.webkitAudioContext;
  if (!ACX || ctx) return;
  ctx = new ACX();
  master = ctx.createGain();
  sfx = ctx.createGain();
  sfxDry = ctx.createGain();
  sfxWet = ctx.createGain();
  conv = ctx.createConvolver();
  conv.normalize = true;
  crowd = ctx.createGain();
  humGain = ctx.createGain();
  sfxDry.gain.value = 0.86;
  sfxWet.gain.value = 0.18;
  humGain.gain.value = 0.22;
  sfx.connect(sfxDry);
  sfxDry.connect(master);
  sfx.connect(conv);
  conv.connect(sfxWet);
  sfxWet.connect(master);
  humGain.connect(crowd);
  crowd.connect(master);
  master.connect(ctx.destination);
  hookConvolver();
  applyGains();
}

export function unlockAudio() {
  makeCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  loadAll();
  ensureCrowd();
  ensureHum();
}

export function setVolumes(masterV, sfxV, crowdV) {
  masterLevel = clamp(masterV);
  sfxLevel = clamp(sfxV);
  if (crowdV != null && isFinite(+crowdV)) crowdLevel = clamp(crowdV);
  applyGains();
  if (crowdLevel <= 0) {
    stopCrowd();
    stopHum();
  } else {
    ensureCrowd();
    ensureHum();
  }
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
  if (opts.dry && bus === sfx) g.connect(sfxDry);
  else g.connect(bus);
  src.start(t);
}

function playGroup(name, opts = {}) {
  const list = BANK[name];
  if (!list) return false;
  const files = list.filter((f) => buffers.has(f));
  if (!files.length) return false;
  const chosen = pick(files, name);
  const rateVar = opts.rateVar == null ? 0.08 : opts.rateVar;
  const volVar = opts.volVar == null ? 0.12 : opts.volVar;
  playBuf(buffers.get(chosen), {
    bus: opts.bus,
    delay: opts.delay,
    dry: opts.dry,
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
    playGroup('block', { vol: 0.95, rateVar: 0.1 });
    playGroup('metalL', { vol: 0.4, rate: 1.12, rateVar: 0.08 });
    return;
  }
  const metal = heavy ? 'metalH' : (kick ? 'metalM' : 'metalL');
  const punch = heavy || kick ? 'punchH' : 'punchM';
  playGroup(metal, { vol: 1, rate: kick ? 0.92 : 1, rateVar: 0.1 });
  playGroup(punch, { vol: heavy ? 0.7 : 0.5, delay: 0.012, rateVar: 0.08 });
  if (limited('spark', 40)) playGroup('spark', { vol: heavy ? 0.55 : 0.32, rateVar: 0.16 });
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
    const vol = opts.vol == null ? 0.55 : opts.vol;
    playGroup('servo', { vol, rate: opts.rate || 1, rateVar: 0.1 });
    if (Math.random() < 0.45 && limited('hydro', 160)) {
      playGroup('hydro', { vol: vol * 0.7, rate: (opts.rate || 1) * 0.92, rateVar: 0.08, delay: 0.02 });
    }
    return;
  }
  if (kind === 'step') {
    if (!limited('step', 70)) return;
    playGroup('step', { vol: opts.vol == null ? 0.62 : opts.vol, rateVar: 0.08 });
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
    playGroup('bounce', { vol: 0.55, delay: 0.08, rateVar: 0.14 });
    return;
  }
  if (kind === 'spark') {
    if (!limited('spark', 50)) return;
    playGroup('spark', { vol: opts.vol == null ? 0.45 : opts.vol, rateVar: 0.16 });
    return;
  }
  if (kind === 'fall') {
    playGroup('crash', { vol: 1, rateVar: 0.07 });
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
    playGroup('crash', { vol: 1, rateVar: 0.06 });
    playGroup('metalH', { vol: 0.7, delay: 0.05 });
    playGroup('fall', { vol: 0.8, delay: 0.04, rateVar: 0.06 });
    playGroup('bell', { vol: 0.95, rateVar: 0.02, delay: 0.06 });
    playGroup('crowdKo', { bus: crowd, vol: 0.95, rateVar: 0.025, volVar: 0.05, delay: 0.08 });
    return;
  }
  if (kind === 'tick' || kind === 'click' || kind === 'confirm' || kind === 'close') {
    const vol = kind === 'tick' ? 0.45 : 0.7;
    if (!playGroup(kind, { vol, rateVar: kind === 'tick' ? 0.04 : 0.06, volVar: 0.08, dry: true })) {
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

function stopHum() {
  if (!humSrc) return;
  try { humSrc.stop(); } catch (_) {}
  try { humSrc.disconnect(); } catch (_) {}
  humSrc = null;
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

function ensureHum() {
  if (!ctx || !loaded || crowdLevel <= 0 || !buffers.has('arena_hum.ogg') || !humGain) return;
  if (humSrc) return;
  if (ctx.state === 'suspended') return;
  const src = ctx.createBufferSource();
  src.buffer = buffers.get('arena_hum.ogg');
  src.loop = true;
  src.connect(humGain);
  try { src.start(); } catch (_) { return; }
  humSrc = src;
  src.onended = () => { if (humSrc === src) humSrc = null; };
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
  ensureHum();
}

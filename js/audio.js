'use strict';
/* Sample playback + master / SFX / crowd buses, light arena convolver.
   Squared volume taper is from WW3D addons/master-volume.js. */

const BASE = './sounds/';
// Announcer clips are listed in sounds/announcer/manifest.json and registered by js/announcer.js.
// They play dry on the voice bus; a light send into the arena reverb is applied here.
const announcerFiles = new Set();
const ANN_VER = 'excited-d-1';

const BANK = {
  tick: ['ui_tick.ogg'],
  click: ['ui_click.ogg', 'ui_click_2.ogg'],
  confirm: ['ui_confirm.ogg'],
  close: ['ui_close.ogg'],
  servo: ['servo_0.ogg', 'servo_1.ogg', 'servo_2.ogg', 'servo_3.ogg', 'servo_4.ogg', 'servo_5.ogg'],
  hydro: ['hydro_0.ogg', 'hydro_1.ogg', 'hydro_2.ogg', 'hydro_3.ogg'],
  // Heavy-robot layers (Kenney Impact Sounds, CC0; pitched down ~30% with a low-shelf boost).
  plateM: ['plate_m_0.ogg', 'plate_m_1.ogg', 'plate_m_2.ogg', 'plate_m_3.ogg', 'plate_m_4.ogg'],
  plateH: ['plate_h_0.ogg', 'plate_h_1.ogg', 'plate_h_2.ogg', 'plate_h_3.ogg', 'plate_h_4.ogg'],
  clank: ['clank_h_0.ogg', 'clank_h_1.ogg', 'clank_h_2.ogg', 'clank_h_3.ogg', 'clank_h_4.ogg'],
  thud: ['thud_0.ogg', 'thud_1.ogg', 'thud_2.ogg', 'thud_3.ogg', 'thud_4.ogg'],
  rattle: ['rattle_0.ogg', 'rattle_1.ogg', 'rattle_2.ogg', 'rattle_3.ogg', 'rattle_4.ogg'],
  metalM: ['metal_m_0.ogg', 'metal_m_1.ogg', 'metal_m_2.ogg', 'metal_m_3.ogg', 'metal_m_4.ogg', 'metal_m_5.ogg'],
  metalH: ['metal_h_0.ogg', 'metal_h_1.ogg', 'metal_h_2.ogg', 'metal_h_3.ogg', 'metal_h_4.ogg', 'metal_h_5.ogg', 'metal_h_6.ogg'],
  punchM: ['punch_0.ogg', 'punch_1.ogg', 'punch_2.ogg'],
  punchH: ['punch_2.ogg', 'punch_3.ogg', 'punch_4.ogg'],
  block: ['block_0.ogg', 'block_1.ogg', 'block_2.ogg', 'block_3.ogg'],
  // Servo stomps: Thimras metal steps and Kenney concrete steps, both pitched down with low end.
  stompM: ['stomp_m_01.ogg', 'stomp_m_05.ogg', 'stomp_m_09.ogg', 'stomp_m_14.ogg', 'stomp_m_20.ogg'],
  stompK: ['stomp_k_0.ogg', 'stomp_k_1.ogg', 'stomp_k_2.ogg', 'stomp_k_3.ogg', 'stomp_k_4.ogg'],
  fall: ['crash_0.ogg', 'crash_2.ogg', 'crash_4.ogg'],
  tear: ['tear_0.ogg', 'tear_1.ogg', 'tear_2.ogg', 'tear_3.ogg', 'tear_4.ogg'],
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
let voice = null;      // announcer bus
let voiceLevel = 0.9;  // Settings > Announcer (0 = off)
let voiceSrc = null;   // the one voice channel: a new line replaces the old one
let voiceUntil = 0;
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
  set(crowd, taper(crowdLevel) * (performance.now() < voiceUntil ? 0.6 : 1));
  if (voice) set(voice, taper(voiceLevel));
}

async function decodeSound(name) {
  if (!ctx || buffers.has(name)) return;
  try {
    const cache = name.startsWith('announcer/') ? '?v=' + ANN_VER : '';
    const res = await fetch(BASE + name + cache);
    if (!res.ok) return;
    const raw = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(raw.slice(0));
    buffers.set(name, buf);
  } catch (_) {}
}

export function registerSoundFiles(names) {
  const added = [];
  for (const n of names || []) {
    const name = n.startsWith('announcer/') || n.includes('/') ? n : 'announcer/' + n;
    if (!announcerFiles.has(name)) {
      announcerFiles.add(name);
      added.push(name);
    }
  }
  if (added.length && ctx && (loaded || loading)) {
    const p = Promise.all(added.map((n) => decodeSound(n)));
    if (loading) loading = loading.then(() => p);
    else loading = p.then(() => { loading = null; });
  }
}

async function loadAll() {
  if (loaded) return;
  if (loading) return loading;
  if (!ctx) return;
  const files = new Set(['crowd_loop.ogg', 'buzz_loop.ogg', 'arena_hum.ogg']);
  for (const list of Object.values(BANK)) for (const f of list) files.add(f);
  for (const f of announcerFiles) files.add(f);
  loading = Promise.all([...files].map((name) => decodeSound(name))).then(() => {
    loaded = true;
    loading = null;
    hookConvolver();
    ensureCrowd();
    ensureHum();
    applyBuzz();
  });
  return loading;
}

// Arena reverb: a generated stereo impulse (~1.6 s): a few early reflections off the stands
// and walls, then a dark exponential tail (high end rolled off as it decays) so heavy hits
// bloom in a big room without washing out.
function hookConvolver() {
  if (!ctx || !conv || conv.buffer) return;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 1.6);
  const ir = ctx.createBuffer(2, len, sr);
  const early = [0.011, 0.019, 0.027, 0.041, 0.058, 0.073];
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const k = 0.35 + 0.6 * Math.exp(-t * 2.2); // darker as it decays
      lp += ((Math.random() * 2 - 1) - lp) * k;
      d[i] = lp * Math.exp(-t * 3.4) * (t < 0.008 ? t / 0.008 : 1);
    }
    for (const e of early) {
      const at = Math.floor((e + (ch ? 0.0031 : 0)) * sr);
      if (at < len) d[at] += 0.55 * Math.exp(-e * 9) * (ch ? -1 : 1);
    }
  }
  conv.buffer = ir;
}

// Synthesized sub layer: a short sine "body" thump that drops in pitch (weight, not a click).
function subThump(opts = {}) {
  if (!ctx || !sfx || sfxLevel <= 0) return;
  const t = ctx.currentTime + (opts.delay || 0);
  const dur = opts.dur || 0.28;
  const f0 = opts.f0 || 85;
  const f1 = opts.f1 || 36;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.8);
  const v = Math.max(0.0001, (opts.vol == null ? 0.7 : opts.vol));
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(sfxDry); // sub stays dry: reverb on sub turns to mud
  o.start(t);
  o.stop(t + dur + 0.03);
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
  // Announcer: PA band (high-pass, a little presence), mostly dry plus a light send into the
  // arena reverb.
  voice = ctx.createGain();
  const vHp = ctx.createBiquadFilter();
  vHp.type = 'highpass';
  vHp.frequency.value = 140;
  const vPres = ctx.createBiquadFilter();
  vPres.type = 'peaking';
  vPres.frequency.value = 2600;
  vPres.gain.value = 3;
  const vWet = ctx.createGain();
  vWet.gain.value = 0.22;
  voice.connect(vHp);
  vHp.connect(vPres);
  vPres.connect(master);
  vPres.connect(vWet);
  sfxDry.gain.value = 0.84;
  sfxWet.gain.value = 0.26;
  humGain.gain.value = 0.22;
  sfx.connect(sfxDry);
  sfxDry.connect(master);
  sfx.connect(conv);
  vWet.connect(conv);
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

// iOS Safari only starts WebAudio inside a real user gesture (touchend / click, not
// pointerdown), and the first sound must be played from that same handler. Keep listening
// until the context is actually running, and kick it with a one-sample silent buffer.
function gestureUnlock() {
  try {
    unlockAudio();
    if (!ctx) return;
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b; s.connect(ctx.destination); s.start(0);
    if (ctx.state === 'running') for (const ev of ['touchend', 'click', 'keydown']) window.removeEventListener(ev, gestureUnlock, true);
  } catch (_) { /* ignore */ }
}
if (typeof window !== 'undefined') {
  for (const ev of ['touchend', 'click', 'keydown']) window.addEventListener(ev, gestureUnlock, true);
  // iOS suspends/"interrupts" the context when the tab is backgrounded; pick it back up.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });
}

export function setVolumes(masterV, sfxV, crowdV, voiceV) {
  masterLevel = clamp(masterV);
  sfxLevel = clamp(sfxV);
  if (voiceV != null && isFinite(+voiceV)) voiceLevel = clamp(voiceV);
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

// Human-size heavy robots: every impact is a big metal hit + a body thud + a sub thump,
// pitched low; heavy blows add a short debris rattle.
export function playHit(opts = {}) {
  unlockAudio();
  if (!ready() || sfxLevel <= 0) return;
  const blocked = !!opts.blocked;
  const heavy = !!opts.heavy;
  const kick = !!opts.kick;
  if (blocked) {
    playGroup('block', { vol: 0.9, rate: 0.74, rateVar: 0.08 });
    playGroup('plateM', { vol: 0.55, rate: 0.92, rateVar: 0.08 });
    subThump({ vol: 0.45, f0: 75, f1: 40, dur: 0.18 });
    return;
  }
  const metal = heavy ? 'metalH' : 'metalM';
  playGroup(metal, { vol: 0.95, rate: kick ? 0.68 : 0.76, rateVar: 0.08 });
  playGroup(heavy || kick ? 'plateH' : 'plateM', { vol: heavy ? 0.85 : 0.65, rateVar: 0.08, delay: 0.004 });
  playGroup('thud', { vol: heavy ? 0.9 : 0.7, rateVar: 0.06, delay: 0.008 });
  playGroup(heavy || kick ? 'punchH' : 'punchM', { vol: heavy ? 0.5 : 0.35, rate: 0.72, delay: 0.012, rateVar: 0.06 });
  subThump({ vol: heavy ? 0.95 : 0.65, f0: heavy ? 80 : 95, f1: heavy ? 32 : 42, dur: heavy ? 0.34 : 0.22 });
  if (heavy && limited('rattle', 120)) playGroup('rattle', { vol: 0.42, delay: 0.06, rateVar: 0.1 });
  if (limited('spark', 40)) playGroup('spark', { vol: heavy ? 0.45 : 0.26, rate: 0.85, rateVar: 0.14 });
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
    playGroup('servo', { vol, rate: (opts.rate || 1) * 0.78, rateVar: 0.1 });
    if (Math.random() < 0.45 && limited('hydro', 160)) {
      playGroup('hydro', { vol: vol * 0.7, rate: (opts.rate || 1) * 0.72, rateVar: 0.08, delay: 0.02 });
    }
    return;
  }
  if (kind === 'step') {
    // Weighty servo stomp: metal foot + concrete thud + sub, and now and then a servo whirr.
    if (!limited('step', 70)) return;
    const v = opts.vol == null ? 0.62 : opts.vol;
    const r = opts.rate || 1;
    playGroup('stompM', { vol: v, rate: r, rateVar: 0.06 });
    playGroup('stompK', { vol: v * 0.7, rate: r * 0.95, rateVar: 0.06, delay: 0.005 });
    subThump({ vol: v * 0.75, f0: 70, f1: 34, dur: 0.2 });
    if (Math.random() < 0.3 && limited('servo', 200)) playGroup('servo', { vol: v * 0.35, rate: 0.7, rateVar: 0.08, delay: 0.03 });
    return;
  }
  if (kind === 'cage') {
    if (!limited(opts.id ? 'cage:' + opts.id : 'cage', opts.limit || 90)) return;
    playGroup('cage', { vol: opts.vol == null ? 0.7 : opts.vol, rate: (opts.rate || 1) * 0.78, rateVar: 0.1 });
    subThump({ vol: (opts.vol == null ? 0.7 : opts.vol) * 0.5, f0: 80, f1: 40, dur: 0.16 });
    return;
  }
  if (kind === 'bounce' || kind === 'clank') {
    // Heavy part on the mat: a clank whose pitch and weight follow the part's mass
    // (opts.mass in kg; a 12 kg torso plate is lower and fuller than a 1 kg hand).
    if (!limited(opts.id ? 'bounce:' + opts.id : 'bounce', opts.limit || 50)) return;
    const vol = opts.vol == null ? 0.7 : opts.vol;
    const mass = opts.mass == null ? 4 : opts.mass;
    const heavyness = Math.max(0, Math.min(1, Math.log2(1 + mass) / 3.7)); // 0 (~0.3 kg) .. 1 (~12 kg)
    const r = (opts.rate || 1) * (1.05 - heavyness * 0.35);
    playGroup('clank', { vol, rate: r, rateVar: 0.08 });
    playGroup('plateH', { vol: vol * (0.35 + heavyness * 0.5), rate: r * 0.95, rateVar: 0.08, delay: 0.004 });
    if (heavyness > 0.35) subThump({ vol: vol * heavyness * 0.8, f0: 90 - heavyness * 30, f1: 38, dur: 0.12 + heavyness * 0.18 });
    if (vol > 0.5) playGroup('rattle', { vol: vol * 0.3, rate: r, delay: 0.05, rateVar: 0.1 });
    return;
  }
  if (kind === 'tear') {
    // Tear-off: shearing metal, a big plate impact, sub, sparks and a debris rattle.
    playGroup('tear', { vol: 1, rate: 0.74, rateVar: 0.06 });
    playGroup('metalH', { vol: 0.6, rate: 0.7, delay: 0.03 });
    playGroup('plateH', { vol: 0.75, delay: 0.035, rateVar: 0.06 });
    subThump({ vol: 0.9, f0: 75, f1: 30, dur: 0.4, delay: 0.03 });
    playGroup('spark', { vol: 0.6, rate: 0.85, rateVar: 0.12 });
    playGroup('rattle', { vol: 0.5, delay: 0.09, rateVar: 0.1 });
    return;
  }
  if (kind === 'spark') {
    if (!limited('spark', 50)) return;
    playGroup('spark', { vol: opts.vol == null ? 0.45 : opts.vol, rateVar: 0.16 });
    return;
  }
  if (kind === 'eyePop') {
    // An eye lamp blowing: bright spark crackle pitched up plus a short glassy ping and tinkle.
    playGroup('spark', { vol: 0.8, rate: 1.6, rateVar: 0.1 });
    try {
      const t0 = ctx.currentTime;
      for (let i = 0; i < 4; i++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = 2600 + Math.random() * 2600;
        const t = t0 + i * 0.035 + Math.random() * 0.02;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16 / (i + 1), t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12 + Math.random() * 0.1);
        o.connect(g); g.connect(sfx);
        o.start(t); o.stop(t + 0.3);
      }
    } catch (_) {}
    return;
  }
  if (kind === 'fall') {
    playGroup('crash', { vol: 1, rate: 0.8, rateVar: 0.07 });
    playGroup('thud', { vol: 0.9, delay: 0.02 });
    subThump({ vol: 1, f0: 70, f1: 28, dur: 0.5, delay: 0.02 });
    playGroup('rattle', { vol: 0.45, delay: 0.1 });
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
    playGroup('crash', { vol: 1, rate: 0.8, rateVar: 0.06 });
    playGroup('metalH', { vol: 0.7, rate: 0.7, delay: 0.05 });
    subThump({ vol: 1, f0: 70, f1: 26, dur: 0.6, delay: 0.04 });
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

// Play one dry announcer file on the single voice channel. Crowd/hum duck under the line.
let voiceSources = [];

export function stopVoice() {
  for (const src of voiceSources) { try { src.stop(); } catch (_) {} }
  voiceSources = [];
  voiceSrc = null;
}

export function isVoiceBusy() {
  return performance.now() < voiceUntil || !!voiceSrc;
}

export function voiceClipDuration(file) {
  const name = file.startsWith('announcer/') ? file : 'announcer/' + file;
  const buf = buffers.get(name);
  return buf ? buf.duration : 0;
}

export function playVoiceClip(file, opts = {}) {
  unlockAudio();
  if (!ctx || !voice || voiceLevel <= 0 || masterLevel <= 0) return 0;
  const name = file.startsWith('announcer/') ? file : 'announcer/' + file;
  const buf = buffers.get(name);
  if (!buf) return 0;
  if (opts.cut !== false) stopVoice();
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(voice);
  const delay = opts.delay || 0;
  src.start(ctx.currentTime + delay);
  voiceSrc = src;
  voiceSources.push(src);
  voiceUntil = performance.now() + (delay + buf.duration) * 1000 + 150;
  applyGains();
  src.onended = () => {
    const mine = voiceSrc === src;
    voiceSources = voiceSources.filter((s) => s !== src);
    if (mine) voiceSrc = null;
    setTimeout(applyGains, 160);
    // A cut (stopVoice) must not run the previous line's end hook.
    if (mine && typeof opts.onended === 'function') opts.onended();
  };
  return buf.duration;
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

// [stadium-broadcast hook] read-only access for js/arena/music.js: reuse this context and the
// master bus (so Master volume applies) and know when the announcer is talking (to duck music).
export function getAudioGraph() {
  return ctx && master ? { ctx, master, voiceActive: () => performance.now() < voiceUntil } : null;
}

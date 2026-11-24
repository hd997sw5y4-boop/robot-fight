'use strict';
/* Sample playback + master / SFX / crowd buses, light arena convolver.
   Squared volume taper is from WW3D addons/master-volume.js. */

const BASE = './sounds/';
// Announcer clips are listed in sounds/announcer/manifest.json and registered by js/announcer.js.
// They play dry on the voice bus; a light send into the arena reverb is applied here.
const announcerFiles = new Set();
const ANN_VER = 'excited-d-1';

const SLOT_DEFS = [
  { id: 'punch_0', file: 'punch_0.ogg' },
  { id: 'punch_1', file: 'punch_1.ogg' },
  { id: 'punch_2', file: 'punch_2.ogg' },
  { id: 'punch_3', file: 'punch_3.ogg' },
  { id: 'punch_4', file: 'punch_4.ogg' },
  { id: 'punch_5', file: 'punch_5.ogg' },
  { id: 'punch_6', file: 'punch_6.ogg' },
  { id: 'plate_m_0', file: 'plate_m_0.ogg' },
  { id: 'plate_m_1', file: 'plate_m_1.ogg' },
  { id: 'plate_m_2', file: 'plate_m_2.ogg' },
  { id: 'plate_m_3', file: 'plate_m_3.ogg' },
  { id: 'plate_m_4', file: 'plate_m_4.ogg' },
  { id: 'plate_h_0', file: 'plate_h_0.ogg' },
  { id: 'plate_h_1', file: 'plate_h_1.ogg' },
  { id: 'plate_h_2', file: 'plate_h_2.ogg' },
  { id: 'plate_h_3', file: 'plate_h_3.ogg' },
  { id: 'plate_h_4', file: 'plate_h_4.ogg' },
  { id: 'thud_0', file: 'thud_0.ogg' },
  { id: 'thud_1', file: 'thud_1.ogg' },
  { id: 'thud_2', file: 'thud_2.ogg' },
  { id: 'thud_3', file: 'thud_3.ogg' },
  { id: 'thud_4', file: 'thud_4.ogg' },
  { id: 'metal_m_0', file: 'metal_m_0.ogg' },
  { id: 'metal_m_1', file: 'metal_m_1.ogg' },
  { id: 'metal_m_2', file: 'metal_m_2.ogg' },
  { id: 'metal_m_3', file: 'metal_m_3.ogg' },
  { id: 'metal_m_4', file: 'metal_m_4.ogg' },
  { id: 'metal_m_5', file: 'metal_m_5.ogg' },
  { id: 'metal_h_0', file: 'metal_h_0.ogg' },
  { id: 'metal_h_1', file: 'metal_h_1.ogg' },
  { id: 'metal_h_2', file: 'metal_h_2.ogg' },
  { id: 'metal_h_3', file: 'metal_h_3.ogg' },
  { id: 'metal_h_4', file: 'metal_h_4.ogg' },
  { id: 'metal_h_5', file: 'metal_h_5.ogg' },
  { id: 'metal_h_6', file: 'metal_h_6.ogg' },
  { id: 'rattle_0', file: 'rattle_0.ogg' },
  { id: 'rattle_1', file: 'rattle_1.ogg' },
  { id: 'rattle_2', file: 'rattle_2.ogg' },
  { id: 'rattle_3', file: 'rattle_3.ogg' },
  { id: 'rattle_4', file: 'rattle_4.ogg' },
  { id: 'clank_h_0', file: 'clank_h_0.ogg' },
  { id: 'clank_h_1', file: 'clank_h_1.ogg' },
  { id: 'clank_h_2', file: 'clank_h_2.ogg' },
  { id: 'clank_h_3', file: 'clank_h_3.ogg' },
  { id: 'clank_h_4', file: 'clank_h_4.ogg' },
  { id: 'block_0', file: 'block_0.ogg' },
  { id: 'block_1', file: 'block_1.ogg' },
  { id: 'block_2', file: 'block_2.ogg' },
  { id: 'block_3', file: 'block_3.ogg' },
  { id: 'step_0', file: 'step_0.ogg' },
  { id: 'step_1', file: 'step_1.ogg' },
  { id: 'step_2', file: 'step_2.ogg' },
  { id: 'step_3', file: 'step_3.ogg' },
  { id: 'step_4', file: 'step_4.ogg' },
  { id: 'step_5', file: 'step_5.ogg' },
  { id: 'step_6', file: 'step_6.ogg' },
  { id: 'step_7', file: 'step_7.ogg' },
  { id: 'land_0', file: 'land_0.ogg' },
  { id: 'land_1', file: 'land_1.ogg' },
  { id: 'move_0', file: 'move_0.ogg' },
  { id: 'move_1', file: 'move_1.ogg' },
  { id: 'move_2', file: 'move_2.ogg' },
  { id: 'move_3', file: 'move_3.ogg' },
  { id: 'move_4', file: 'move_4.ogg' },
  { id: 'move_5', file: 'move_5.ogg' },
  { id: 'move_6', file: 'move_6.ogg' },
  { id: 'move_7', file: 'move_7.ogg' },
  { id: 'crash_0', file: 'crash_0.ogg' },
  { id: 'crash_1', file: 'crash_1.ogg' },
  { id: 'crash_2', file: 'crash_2.ogg' },
  { id: 'debris_0', file: 'debris_0.ogg' },
  { id: 'debris_1', file: 'debris_1.ogg' },
  { id: 'debris_2', file: 'debris_2.ogg' },
  { id: 'cage_0', file: 'cage_0.ogg' },
  { id: 'cage_1', file: 'cage_1.ogg' },
  { id: 'cage_2', file: 'cage_2.ogg' },
  { id: 'spark_0', file: 'spark_0.ogg' },
  { id: 'spark_1', file: 'spark_1.ogg' },
  { id: 'spark_2', file: 'spark_2.ogg' },
  { id: 'spark_3', file: 'spark_3.ogg' },
  { id: 'sparkarc_0', file: 'sparkarc_0.ogg' },
  { id: 'sparkarc_1', file: 'sparkarc_1.ogg' },
  { id: 'sparkarc_2', file: 'sparkarc_2.ogg' },
  { id: 'crowd_loop', file: 'crowd_loop.ogg' },
  { id: 'crowd_hit_0', file: 'crowd_hit_0.ogg' },
  { id: 'crowd_hit_1', file: 'crowd_hit_1.ogg' },
  { id: 'crowd_hit_2', file: 'crowd_hit_2.ogg' },
  { id: 'crowd_ko_0', file: 'crowd_ko_0.ogg' },
  { id: 'arena_hum', file: 'arena_hum.ogg' },
  { id: 'buzz_loop', file: 'buzz_loop.ogg' },
  { id: 'ui_tick', file: 'ui_tick.ogg' },
  { id: 'ui_click', file: 'ui_click.ogg' },
  { id: 'ui_click_2', file: 'ui_click_2.ogg' },
  { id: 'ui_confirm', file: 'ui_confirm.ogg' },
  { id: 'ui_close', file: 'ui_close.ogg' },
  { id: 'bell_000', file: 'bell_000.ogg' },
  { id: 'bell_001', file: 'bell_001.ogg' },
  { id: 'bell_002', file: 'bell_002.ogg' },
];

const SLOTS = Object.fromEntries(SLOT_DEFS.map((s) => [s.id, s]));

// Banks list slot ids. Playback looks up each slot's current buffer (default, remapped, or custom).
const BANK = {
  tick: ['ui_tick'],
  click: ['ui_click', 'ui_click_2'],
  confirm: ['ui_confirm'],
  close: ['ui_close'],
  move: ['move_0', 'move_1', 'move_2', 'move_3', 'move_4', 'move_5', 'move_6', 'move_7'],
  plateM: ['plate_m_0', 'plate_m_1', 'plate_m_2', 'plate_m_3', 'plate_m_4'],
  plateH: ['plate_h_0', 'plate_h_1', 'plate_h_2', 'plate_h_3', 'plate_h_4'],
  clank: ['clank_h_0', 'clank_h_1', 'clank_h_2', 'clank_h_3', 'clank_h_4'],
  thud: ['thud_0', 'thud_1', 'thud_2', 'thud_3', 'thud_4'],
  rattle: ['rattle_0', 'rattle_1', 'rattle_2', 'rattle_3', 'rattle_4'],
  metalM: ['metal_m_0', 'metal_m_1', 'metal_m_2', 'metal_m_3', 'metal_m_4', 'metal_m_5'],
  metalH: ['metal_h_0', 'metal_h_1', 'metal_h_2', 'metal_h_3', 'metal_h_4', 'metal_h_5', 'metal_h_6'],
  punchM: ['punch_0', 'punch_1', 'punch_2', 'punch_3', 'punch_4', 'punch_5', 'punch_6'],
  punchH: ['punch_0', 'punch_1', 'punch_2', 'punch_3', 'punch_4', 'punch_5', 'punch_6'],
  block: ['block_0', 'block_1', 'block_2', 'block_3'],
  step: ['step_0', 'step_1', 'step_2', 'step_3', 'step_4', 'step_5', 'step_6', 'step_7'],
  land: ['land_0', 'land_1'],
  fall: ['crash_0', 'crash_1', 'crash_2'],
  crash: ['crash_0', 'crash_1', 'crash_2'],
  debris: ['debris_0', 'debris_1', 'debris_2'],
  spark: ['spark_0', 'spark_1', 'spark_2', 'spark_3'],
  sparkArc: ['sparkarc_0', 'sparkarc_1', 'sparkarc_2'],
  cage: ['cage_0', 'cage_1', 'cage_2'],
  bell: ['bell_000', 'bell_001', 'bell_002'],
  crowdHit: ['crowd_hit_0', 'crowd_hit_1', 'crowd_hit_2'],
  crowdBig: ['crowd_hit_1', 'crowd_hit_2'],
  crowdKo: ['crowd_ko_0'],
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
let crowdDuckUntil = 0;
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

// Sound picks saved on this device (made with the old Sound Lab screen): read-only here, so a
// swapped hit / footstep / crowd sound keeps playing in fights.
const LS_SLOTS = 'rf_sound_lab_v1';
const DB_NAME = 'rf-sound-lab';
const DB_STORE = 'files';
let assignments = {};
const customBuffers = new Map();
const customDecoding = new Map();

function loadAssignments() {
  try {
    const raw = localStorage.getItem(LS_SLOTS);
    assignments = raw ? (JSON.parse(raw) || {}) : {};
  } catch (_) { assignments = {}; }
}
loadAssignments();

function defaultFile(id) {
  return (SLOTS[id] && SLOTS[id].file) || null;
}

function assignmentOf(id) {
  const a = assignments[id];
  if (!a || !a.type) return { type: 'default' };
  return a;
}

function slotBuffer(id) {
  const a = assignmentOf(id);
  if (a.type === 'custom') return customBuffers.get(a.id) || null;
  const file = (a.type === 'bundled' && a.file) ? a.file : defaultFile(id);
  return file ? buffers.get(file) || null : null;
}

function openSlotDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
}

async function idbGet(id) {
  const db = await openSlotDb();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(id);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } finally { try { db.close(); } catch (_) {} }
}

async function decodeArrayBuffer(raw) {
  if (!ctx) makeCtx();
  if (!ctx) throw new Error('Audio is not ready');
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return await ctx.decodeAudioData(raw.slice(0));
}

async function decodeCustomId(cid) {
  if (customBuffers.has(cid)) return customBuffers.get(cid);
  if (customDecoding.has(cid)) return customDecoding.get(cid);
  const p = (async () => {
    const rec = await idbGet(cid);
    if (!rec || !rec.blob) throw new Error('Saved file is missing');
    const raw = await rec.blob.arrayBuffer();
    const buf = await decodeArrayBuffer(raw);
    customBuffers.set(cid, buf);
    return buf;
  })();
  customDecoding.set(cid, p);
  try { return await p; }
  finally { customDecoding.delete(cid); }
}

async function ensureSlotBuffer(id) {
  const buf = slotBuffer(id);
  if (buf) return buf;
  const a = assignmentOf(id);
  if (a.type === 'custom' && a.id) {
    try { return await decodeCustomId(a.id); }
    catch (_) { return null; }
  }
  const file = (a.type === 'bundled' && a.file) ? a.file : defaultFile(id);
  if (file) {
    await decodeSound(file);
    return buffers.get(file) || null;
  }
  return null;
}


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
  const ducked = performance.now() < crowdDuckUntil ? 0.42 : 1;
  set(crowd, taper(crowdLevel) * (performance.now() < voiceUntil ? 0.6 : 1) * ducked);
  if (voice) set(voice, taper(voiceLevel));
}

// Safari / iOS WebKit historically cannot decode Vorbis (.ogg). Prefer a sibling
// .mp3 when present, but still store the buffer under the original .ogg BANK key.
function mp3Sibling(name) {
  // Only request a .mp3 sibling when one was actually encoded, so ogg-only
  // banks (UI, Kenney layers, announcer) do not 404 in the console.
  if (!name || !name.endsWith('.ogg')) return null;
  const stem = name.slice(0, -4);
  if (/^(move_|punch_|block_|step_|land_|crash_|debris_|spark|crowd_hit_|crowd_ko_|crowd_loop$)/.test(stem)) {
    return stem + '.mp3';
  }
  return null;
}

function preferMp3() {
  try {
    const ua = navigator.userAgent || '';
    if (/iP(hone|ad|od)/i.test(ua)) return true;
    const isSafari = /Safari/i.test(ua) && !/Chrome|Chromium|Android|CriOS|FxiOS|EdgiOS|Edg/i.test(ua);
    if (isSafari) return true;
    const a = document.createElement('audio');
    const ogg = a.canPlayType('audio/ogg; codecs="vorbis"');
    const mp3 = a.canPlayType('audio/mpeg');
    if ((!ogg || ogg === 'no') && mp3 && mp3 !== 'no') return true;
  } catch (_) {}
  return false;
}

async function fetchDecode(path) {
  const res = await fetch(path);
  if (!res.ok) return null;
  const raw = await res.arrayBuffer();
  try {
    return await ctx.decodeAudioData(raw.slice(0));
  } catch (_) {
    return null;
  }
}

async function decodeSound(name) {
  if (!ctx || buffers.has(name)) return;
  try {
    const cache = name.startsWith('announcer/') ? '?v=' + ANN_VER : '';
    const mp3Name = mp3Sibling(name);
    const order = (mp3Name && preferMp3()) ? [mp3Name, name] : (mp3Name ? [name, mp3Name] : [name]);
    let buf = null;
    for (const file of order) {
      buf = await fetchDecode(BASE + file + cache);
      if (buf) break;
    }
    if (buf) buffers.set(name, buf);
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
  const files = new Set();
  for (const s of SLOT_DEFS) files.add(s.file);
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
  // Gentle bus compressor so stacked metal layers don't clip the output.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 8;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.003;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);
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
  const ready = [];
  for (const id of list) {
    const buf = slotBuffer(id);
    if (buf) ready.push(id);
    else ensureSlotBuffer(id);
  }
  if (!ready.length) return false;
  const chosen = pick(ready, name);
  const rateVar = opts.rateVar == null ? 0.08 : opts.rateVar;
  const volVar = opts.volVar == null ? 0.12 : opts.volVar;
  playBuf(slotBuffer(chosen), {
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
  const hard = opts.hard != null ? Math.max(0, Math.min(1, opts.hard)) : (heavy ? 0.75 : 0.25);
  const impact = 0.8 + hard * 0.45;
  if (blocked) {
    playGroup('block', { vol: 0.95, rate: 0.74, rateVar: 0.08 });
    playGroup('plateM', { vol: 0.62, rate: 0.92, rateVar: 0.08 });
    playGroup('metalM', { vol: 0.4, rate: 0.88, rateVar: 0.08, delay: 0.006 });
    subThump({ vol: 0.52, f0: 75, f1: 40, dur: 0.18 });
    return;
  }
  const metal = heavy ? 'metalH' : 'metalM';
  playGroup(metal, { vol: Math.min(0.9, 0.72 * impact + (heavy ? 0.1 : 0)), rate: kick ? 0.68 : 0.76, rateVar: 0.08 });
  playGroup(heavy || kick ? 'plateH' : 'plateM', { vol: (heavy ? 0.74 : 0.58) * impact, rateVar: 0.08, delay: 0.004 });
  playGroup('thud', { vol: (heavy ? 0.78 : 0.62) * impact, rateVar: 0.06, delay: 0.008 });
  playGroup(heavy || kick ? 'punchH' : 'punchM', {
    vol: (heavy ? 0.68 : 0.46) * impact,
    rate: (heavy || kick) ? 0.62 : 0.82,
    delay: 0.012,
    rateVar: 0.06,
  });
  subThump({ vol: heavy ? 0.82 : 0.5 + hard * 0.28, f0: heavy ? 76 : 95, f1: heavy ? 30 : 42, dur: heavy ? 0.38 : 0.22 });
  if ((heavy || hard > 0.55) && limited('rattle', 120)) playGroup('rattle', { vol: 0.42 + hard * 0.12, delay: 0.06, rateVar: 0.1 });
  if (limited('spark', 40)) {
    playGroup('spark', { vol: heavy ? 0.5 : 0.26 + hard * 0.12, rate: 0.85, rateVar: 0.14 });
    if (heavy && Math.random() < 0.45) playGroup('sparkArc', { vol: 0.32, rate: 0.9, rateVar: 0.12, delay: 0.02 });
  }
  if (heavy && limited('crowdHit', 420)) {
    playGroup(Math.random() < 0.55 ? 'crowdBig' : 'crowdHit', { bus: crowd, vol: 0.72, rateVar: 0.03, volVar: 0.08 });
  }
  if (heavy) duckCrowd(110);
}

// Pull the crowd bed down for a heavy connect so the impact cuts through. Real-time, not sim-time.
export function duckCrowd(ms = 100) {
  crowdDuckUntil = Math.max(crowdDuckUntil, performance.now() + ms);
  applyGains();
  const wait = ms + 30;
  setTimeout(() => { if (performance.now() >= crowdDuckUntil - 5) applyGains(); }, wait);
}

export function playSfx(kind, opts = {}) {
  unlockAudio();
  if (!ready()) return;
  if (kind === 'hit') { playHit({ blocked: false, heavy: !!opts.heavy, kick: !!opts.kick }); return; }
  if (kind === 'block') { playHit({ blocked: true }); return; }
  if (kind === 'whoosh' || kind === 'servo') {
    if (!limited('move', opts.limit || 90)) return;
    const vol = opts.vol == null ? 0.55 : opts.vol;
    // Pitch and level follow the caller’s move/attack speed; no hydraulic overlay.
    playGroup('move', { vol, rate: opts.rate || 1, rateVar: 0.08 });
    return;
  }
  if (kind === 'step') {
    // Mech foot plants synced to foot contacts, plus a light thud/sub for weight.
    // Heavy / landing plants use the bigger robot-footstep layer.
    if (!limited('step', 80)) return;
    const v = opts.vol == null ? 0.4 : opts.vol;
    const r = opts.rate || 1;
    const heavy = !!(opts.heavy || opts.land || v >= 0.7);
    if (heavy) {
      playGroup('land', { vol: Math.min(1, v * 1.15), rate: r * 0.9, rateVar: 0.08 });
      subThump({ vol: v * 0.7, f0: 70, f1: 30, dur: 0.22 });
    } else {
      playGroup('step', { vol: v, rate: r, rateVar: 0.08 });
      if (Math.random() < 0.4) playGroup('thud', { vol: v * 0.32, rate: r * 0.86, rateVar: 0.1, delay: 0.006 });
      subThump({ vol: v * 0.38, f0: 78, f1: 36, dur: 0.14 });
    }
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
    if (vol >= 0.65 && ((opts.rate || 1) <= 0.7 || heavyness > 0.55)) {
      playGroup('land', { vol: vol * 0.7, rate: r * 0.9, rateVar: 0.08, delay: 0.01 });
    }
    if (vol > 0.5) playGroup('rattle', { vol: vol * 0.3, rate: r, delay: 0.05, rateVar: 0.1 });
    return;
  }
  if (kind === 'tear') {
    // Tear-off: iron smash, debris tail, plate impact, sub, sparks and a rattle.
    playGroup('crash', { vol: 0.95, rate: 0.74, rateVar: 0.06 });
    playGroup('debris', { vol: 0.7, delay: 0.08, rateVar: 0.08 });
    playGroup('metalH', { vol: 0.6, rate: 0.7, delay: 0.03 });
    playGroup('plateH', { vol: 0.75, delay: 0.035, rateVar: 0.06 });
    subThump({ vol: 0.9, f0: 75, f1: 30, dur: 0.4, delay: 0.03 });
    playGroup('spark', { vol: 0.6, rate: 0.85, rateVar: 0.12 });
    if (Math.random() < 0.5) playGroup('sparkArc', { vol: 0.35, rate: 0.9, rateVar: 0.12, delay: 0.03 });
    playGroup('rattle', { vol: 0.5, delay: 0.09, rateVar: 0.1 });
    return;
  }
  if (kind === 'spark') {
    if (!limited('spark', 50)) return;
    playGroup('spark', { vol: opts.vol == null ? 0.45 : opts.vol, rateVar: 0.16 });
    if (Math.random() < 0.3) playGroup('sparkArc', { vol: (opts.vol == null ? 0.45 : opts.vol) * 0.55, rateVar: 0.14, delay: 0.02 });
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
    playGroup('debris', { vol: 0.65, delay: 0.1, rateVar: 0.08 });
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
    playGroup('debris', { vol: 0.7, delay: 0.08, rateVar: 0.08 });
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
  const buf = slotBuffer('crowd_loop');
  if (!buf) { if (loaded) ensureSlotBuffer('crowd_loop').then((b) => { if (b) ensureCrowd(); }); }
  if (!ctx || !loaded || crowdLevel <= 0 || !buf) return;
  if (crowdSrc) return;
  if (ctx.state === 'suspended') return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const g = ctx.createGain();
  g.gain.value = 0.2;
  src.connect(g);
  g.connect(crowd);
  try { src.start(); } catch (_) { return; }
  crowdSrc = src;
  crowdGate = g;
  src.onended = () => { if (crowdSrc === src) crowdSrc = null; };
}

function ensureHum() {
  const buf = slotBuffer('arena_hum');
  if (!buf) { if (loaded) ensureSlotBuffer('arena_hum').then((b) => { if (b) ensureHum(); }); }
  if (!ctx || !loaded || crowdLevel <= 0 || !buf || !humGain) return;
  if (humSrc) return;
  if (ctx.state === 'suspended') return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
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
  const buzzBuf = slotBuffer('buzz_loop');
  if (!buzzBuf) { ensureSlotBuffer('buzz_loop').then((b) => { if (b) applyBuzz(); }); return; }
  if (!buzzSrc) {
    const src = ctx.createBufferSource();
    src.buffer = buzzBuf;
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

export function getAudioGraph() {
  return ctx && master ? { ctx, master, voiceActive: () => performance.now() < voiceUntil } : null;
}

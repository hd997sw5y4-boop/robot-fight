'use strict';
/* Compact master + SFX bus. Squared volume taper is from WW3D addons/master-volume.js.
   No AudioNode.prototype patching, no YouTube/monitor hooks. */

let ctx = null;
let master = null;
let sfx = null;
let masterLevel = 1;
let sfxLevel = 1;

const clamp = (x) => Math.max(0, Math.min(1, Math.round(x * 100) / 100));
const taper = (v) => v * v;

function applyGains() {
  if (!master || !sfx) return;
  const t = ctx.currentTime;
  try {
    master.gain.setTargetAtTime(taper(masterLevel), t, 0.02);
    sfx.gain.setTargetAtTime(taper(sfxLevel), t, 0.02);
  } catch (_) {
    master.gain.value = taper(masterLevel);
    sfx.gain.value = taper(sfxLevel);
  }
}

export function unlockAudio() {
  const ACX = window.AudioContext || window.webkitAudioContext;
  if (!ACX) return;
  if (!ctx) {
    ctx = new ACX();
    master = ctx.createGain();
    sfx = ctx.createGain();
    sfx.connect(master);
    master.connect(ctx.destination);
    applyGains();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

export function setVolumes(masterV, sfxV) {
  masterLevel = clamp(masterV);
  sfxLevel = clamp(sfxV);
  applyGains();
}

function noiseBurst(dur, start, startGain, endGain, cutoff) {
  if (!ctx || !sfx) return;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = cutoff;
  filter.Q.value = 0.7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(startGain, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, endGain), start + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(sfx);
  src.start(start);
  src.stop(start + dur + 0.02);
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

export function playSfx(kind) {
  if (!ctx || masterLevel <= 0 || sfxLevel <= 0) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  const t = ctx.currentTime;
  if (kind === 'tick') {
    tone(880, 0.04, t, 'square', 0.04);
    return;
  }
  if (kind === 'click') {
    tone(520, 0.06, t, 'square', 0.05);
    return;
  }
  if (kind === 'whoosh') {
    noiseBurst(0.12, t, 0.08, 0.0001, 900);
    return;
  }
  if (kind === 'hit') {
    noiseBurst(0.14, t, 0.22, 0.0001, 1400);
    tone(180, 0.1, t, 'square', 0.12);
    return;
  }
  if (kind === 'block') {
    tone(240, 0.08, t, 'triangle', 0.1);
    noiseBurst(0.08, t, 0.08, 0.0001, 2000);
    return;
  }
  if (kind === 'ko') {
    tone(160, 0.35, t, 'sawtooth', 0.14);
    tone(90, 0.4, t + 0.05, 'sine', 0.12);
  }
}

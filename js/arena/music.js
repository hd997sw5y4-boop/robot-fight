'use strict';
/* [stadium-broadcast] Quiet background music (CC0, see CREDITS/LICENSES.md).
   Menu/intro: "Cathedral in the forest" (ambient). Fights: "Tense Future Loop", mixed low and
   ducked further while the announcer talks. Routed into the game's own AudioContext master
   bus (Master volume applies). Starts only after a user gesture. Music volume slider is
   injected into Settings > Sound and saved as localStorage rf_music. */
import { getAudioGraph, unlockAudio } from '../audio.js';
import { isSettingsOpen } from '../settings.js';

const KEY = 'rf_music';
const DEFAULT = 0.6;
const TRACKS = {
  menu: { url: './sounds/music/menu_cathedral.ogg', level: 0.3 },
  fight: { url: './sounds/music/fight_tense_future.ogg', level: 0.16 },
};
const VOICE_DUCK = 0.55;

let ctx = null;
let level = readLevel();
let graph = null;
let bus = null;
const chans = {};
let started = false;
let mode = 'menu';

function readLevel() {
  try {
    const v = parseFloat(localStorage.getItem(KEY));
    if (isFinite(v)) return Math.max(0, Math.min(1, v));
  } catch (_) { /* ignore */ }
  return DEFAULT;
}

function taper(v) { return v * v; }

function ensureGraph() {
  if (bus) return true;
  graph = getAudioGraph();
  if (!graph) return false;
  const ac = graph.ctx;
  bus = ac.createGain();
  bus.gain.value = taper(level);
  bus.connect(graph.master);
  for (const [k, t] of Object.entries(TRACKS)) {
    const el = new Audio();
    el.src = t.url;
    el.loop = true;
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const src = ac.createMediaElementSource(el);
    const g = ac.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(bus);
    chans[k] = { el, g, playing: false };
  }
  return true;
}

function start() {
  if (started) return;
  unlockAudio();
  if (!ensureGraph()) return;
  started = true;
  apply(true);
}

function play(ch) {
  if (ch.playing) return;
  ch.playing = true;
  const p = ch.el.play();
  if (p && p.catch) p.catch(() => { ch.playing = false; });
}

function apply(snap) {
  if (!bus) return;
  const t = graph.ctx.currentTime;
  const tc = snap ? 0.05 : 1.4; // smooth duck / crossfade
  const voice = graph.voiceActive && graph.voiceActive() ? VOICE_DUCK : 1;
  bus.gain.setTargetAtTime(taper(level), t, 0.05);
  for (const [k, ch] of Object.entries(chans)) {
    const on = k === mode && level > 0;
    const target = on ? TRACKS[k].level * voice : 0;
    if (on) play(ch);
    ch.g.gain.setTargetAtTime(target, t, tc);
    // Pause the silent track once it has faded out (saves decode work).
    if (!on && ch.playing && ch.g.gain.value < 0.002) { ch.el.pause(); ch.playing = false; }
  }
}

function injectSlider() {
  if (document.getElementById('setMusic')) return;
  const crowd = document.getElementById('setCrowd');
  const anchor = crowd && crowd.closest('label');
  if (!anchor) return;
  const label = document.createElement('label');
  label.append('Music ');
  const b = document.createElement('b');
  b.id = 'setMusicV';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = 'setMusic';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.setAttribute('aria-label', 'Music volume (0 turns it off)');
  const paint = () => { input.value = String(level); b.textContent = Math.round(level * 100) + '%'; };
  const set = (v) => {
    level = Math.max(0, Math.min(1, +v || 0));
    try { localStorage.setItem(KEY, String(level)); } catch (_) { /* ignore */ }
    paint();
    if (!started) start();
    apply(false);
  };
  input.addEventListener('input', () => set(input.value));
  input.addEventListener('dblclick', () => set(DEFAULT));
  label.append(b, input);
  paint();
  anchor.after(label);
}

/** Called from initStadium (ctx.getMatch). */
export function initMusic(c) {
  ctx = c;
  injectSlider();
  const gesture = () => {
    // The game's own listener creates the AudioContext on the same gesture; retry next tick.
    start();
    if (!started) setTimeout(start, 0);
    if (started) {
      window.removeEventListener('pointerdown', gesture, true);
      window.removeEventListener('keydown', gesture, true);
    }
  };
  window.addEventListener('pointerdown', gesture, true);
  window.addEventListener('keydown', gesture, true);
  window.__rfMusic = () => ({ started, mode, level, menu: chans.menu && +chans.menu.g.gain.value.toFixed(3), fight: chans.fight && +chans.fight.g.gain.value.toFixed(3) });
}

let acc = 0;
/** Called every frame from updateStadium. Re-targets gains a few times a second. */
export function updateMusic(dt) {
  if (!started) return;
  acc += dt > 0 ? dt : 0.016;
  if (acc < 0.2) return;
  acc = 0;
  const m = ctx && ctx.getMatch ? ctx.getMatch() : null;
  const shell = window.RFShell && window.RFShell.state;
  const inMenu = shell && ['title', 'main', 'credits', 'select', 'arcade', 'training'].includes(shell.screen) && !(m && m.phase === 'fight' && !m.over);
  const fighting = m && m.phase === 'fight' && !m.over && !isSettingsOpen() && !(shell && shell.paused) && !inMenu;
  mode = fighting ? 'fight' : 'menu';
  apply(false);
}

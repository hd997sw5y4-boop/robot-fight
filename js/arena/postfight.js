'use strict';
/* [postfight] What happens after a KO / the end of a match.
   1) Hold: the results box waits ~4 s while the camera blends smoothly from whatever view was
      live (crowd seat, 1st person, fighting cam...) into a slow orbit of the winner over the
      fallen robot. In VR the camera is never moved; only the UI waits.
   2) Replays: the 3-4 biggest moments of the match (the KO blow plus the best knockdowns, torn
      parts and big hits, from the broadcast.js moment archive) play full-screen in slow motion,
      each from a different broadcast angle, with a REPLAY tag and a Skip button
      (Space / Enter / Esc). Skipped in VR.
   3) Results: only then does the shell's 'matchEnd' fire (results box, Auto Rematch countdown).
      The box is made compact and moved to the bottom-right by one marked CSS override below.
   Read-only: fighters are posed from recorded transforms only for the render, then restored. */
import * as THREE from 'three';
import { SIZE } from '../config.js';
import {
  getMoments, clearMoments, flushMoments, setFeedHold, applyClipPose, restoreClipPose, shotFraming,
} from './broadcast.js';
import { xrPresenting } from './broadcast.js';

const CFG = {
  hold: 4.0,          // s from the KO (or match end) before replays / results
  decisionHold: 1.6,  // no KO (decision / draw): short hold
  slowMo: 0.5,
  maxClips: 4,
  orbitSpeed: 0.14,
};
const SKIP_KEYS = /^(Space|Enter|NumpadEnter|Escape)$/;
const SWALLOW_KEYS = /^(KeyR|KeyP|Backspace)$/;
const SHOT_ORDER = ['ringside', 'closeVictim', 'wide', 'overhead'];

let ctx = null;
let S = null;
let ui = null;
const st = {
  phase: 'idle',      // idle | hold | replay | results
  overSeen: false, overWall: 0,
  release: null, holdUntil: 0,
  clips: [], idx: 0, t: 0, len: 0, shot: 'wide', seed: 0,
  cam: { on: false, from: new THREE.Vector3(), fromQ: new THREE.Quaternion(), t: 0, blend: 1.2, ang0: 0 },
  center: new THREE.Vector3(), centerInit: false,
  posed: null,
};
let lastWall = 0;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _look = new THREE.Vector3();

function wall() { return performance.now() / 1000; }
function paused() { return !!(S && S.state && S.state.paused) || !!(S && S.settingsOpen && S.settingsOpen()); }
function smooth(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }

// ---------------------------------------------------------------- UI

function makeUi() {
  const style = document.createElement('style');
  style.id = 'rfPostfightCss';
  style.textContent = `
#rfPostfight { position: fixed; inset: 0; z-index: 30; pointer-events: none; opacity: 0; transition: opacity .25s; }
#rfPostfight.on { opacity: 1; }
#rfPostfight .pf-bar { position: absolute; left: 0; right: 0; height: 9vh; background: #000; }
#rfPostfight .pf-bar.t { top: 0; } #rfPostfight .pf-bar.b { bottom: 0; }
#rfPostfight .pf-tag { position: absolute; top: calc(9vh + 18px); left: 26px; display: flex; align-items: center; gap: 10px;
  font: 900 26px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .12em; color: #fff; }
#rfPostfight .pf-tag b { background: #d61c30; padding: 8px 14px; border-radius: 4px; }
#rfPostfight .pf-tag small { font: 700 14px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; color: #d7e2f2; text-transform: uppercase; }
#rfPostfight .pf-skip { position: absolute; right: 26px; bottom: calc(9vh + 18px); pointer-events: auto; cursor: pointer;
  font: 700 15px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .06em; color: #e9f3ff; padding: 10px 16px;
  background: rgba(10,16,28,.82); border: 1px solid rgba(56,214,255,.65); border-radius: 8px; }
#rfPostfight .pf-skip kbd { font: 600 11px/1 ui-monospace, monospace; margin-left: 8px; padding: 3px 5px; border-radius: 4px; background: rgba(255,255,255,.12); }
/* [postfight hook] compact results box at the bottom-right so the robots stay visible. One override
   of the shell's results screen (layout only; Game Builder 2's restyle of the card itself still applies). */
#rfs .rfs-screen[data-screen="results"] { align-items: flex-end; justify-content: flex-end; background: none; -webkit-backdrop-filter: none; backdrop-filter: none; transform: scale(.72); transform-origin: 100% 100%; pointer-events: none; }
#rfs .rfs-screen[data-screen="results"].on > * { pointer-events: auto; max-height: calc(100vh / .72 - 40px); overflow: auto; }
`;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'rfPostfight';
  el.innerHTML = '<div class="pf-bar t"></div><div class="pf-bar b"></div><div class="pf-tag"><b>REPLAY</b><small></small></div><button type="button" class="pf-skip">Skip replays<kbd>Space</kbd></button>';
  document.body.appendChild(el);
  el.querySelector('.pf-skip').addEventListener('click', (e) => { e.preventDefault(); skip(); });
  return { el, label: el.querySelector('.pf-tag small') };
}

// ---------------------------------------------------------------- sequence

const LABEL = { ko: 'Knockout blow', detach: 'Part torn off', knockdown: 'Knockdown', hit: 'Big hit' };

function begin(release) {
  st.release = release;
  flushMoments();
  const t = wall();
  const ko = st.overSeen;
  st.holdUntil = ko ? Math.max(t, st.overWall + CFG.hold) : t + CFG.decisionHold;
  st.phase = 'hold';
}

function pickClips() {
  const all = getMoments();
  if (!all.length) return [];
  const ko = all.find((m) => m.type === 'ko');
  const rest = all.filter((m) => m !== ko).sort((a, b) => b.score - a.score);
  const pick = (ko ? [ko] : []).concat(rest).slice(0, CFG.maxClips);
  return pick.sort((a, b) => a.at - b.at); // chronological: the KO plays last
}

function startReplays() {
  st.clips = xrPresenting() ? [] : pickClips();
  st.idx = -1;
  if (!st.clips.length) { finish(); return; }
  st.phase = 'replay';
  setFeedHold(true);
  nextClip();
  ui.el.classList.add('on');
}

function nextClip() {
  st.idx++;
  if (st.idx >= st.clips.length) { finish(); return; }
  const c = st.clips[st.idx];
  st.t = 0;
  st.len = c.times[c.times.length - 1] - c.times[0];
  // A different angle every clip (and never the same twice in a row).
  const name = SHOT_ORDER[(st.idx + (st.clips.length > 1 ? 0 : 1)) % SHOT_ORDER.length];
  st.shot = name === 'closeVictim' ? (c.victim === 'p1' ? 'closeP1' : 'closeP2') : name;
  st.seed = Math.random() * 6.28;
  ui.label.textContent = `${st.idx + 1} / ${st.clips.length} · ${LABEL[c.type] || 'Highlight'}`;
}

function skip() {
  if (st.phase === 'replay' || st.phase === 'hold') finish();
}

function finish() {
  if (st.posed) { restoreClipPose(st.posed); st.posed = null; }
  ui.el.classList.remove('on');
  setFeedHold(false);
  // Back to the orbit, blending from the replay camera.
  if (st.cam.on) restartBlend(1.2);
  const r = st.release;
  st.release = null;
  st.phase = 'results';
  if (r) r();
}

function abort() {
  if (st.posed) { restoreClipPose(st.posed); st.posed = null; }
  ui.el.classList.remove('on');
  setFeedHold(false);
  st.release = null;
  st.phase = 'idle';
}

// ---------------------------------------------------------------- camera

function restartBlend(dur) {
  const cam = ctx.camera;
  st.cam.from.copy(cam.position);
  st.cam.fromQ.copy(cam.quaternion);
  st.cam.t = 0;
  st.cam.blend = dur;
  st.cam.ang0 = Math.atan2(cam.position.x - st.center.x, cam.position.z - st.center.z);
}

function orbit(dt, fighters, match) {
  const cam = ctx.camera;
  const [p1, p2] = fighters;
  const win = match.winner === 'p2' ? p2 : p1;
  const lose = win === p1 ? p2 : p1;
  // Center between the winner and the fallen robot, smoothed (the loser may still be sliding).
  _p.set((win.root.position.x + lose.root.position.x) / 2, 0, (win.root.position.z + lose.root.position.z) / 2);
  if (!st.centerInit) { st.center.copy(_p); st.centerInit = true; } else st.center.lerp(_p, 1 - Math.pow(0.2, dt));
  if (!st.cam.on) {
    st.cam.on = true;
    const d = cam.position.distanceTo(st.center);
    restartBlend(Math.max(1.1, Math.min(2.4, d / 7)));
  }
  st.cam.t += dt;
  const r = 7.4 * SIZE;
  const ang = st.cam.ang0 + st.cam.t * CFG.orbitSpeed;
  _p.set(st.center.x + Math.sin(ang) * r, 2.9 * SIZE + Math.sin(st.cam.t * 0.2) * 0.25, st.center.z + Math.cos(ang) * r);
  // Look slightly toward the winner so it reads as standing over the loser.
  _look.set(st.center.x * 0.6 + win.root.position.x * 0.4, 1.05 * SIZE, st.center.z * 0.6 + win.root.position.z * 0.4);
  _m.lookAt(_p, _look, cam.up);
  _q.setFromRotationMatrix(_m);
  const w = smooth(st.cam.t / st.cam.blend);
  cam.position.lerpVectors(st.cam.from, _p, w);
  cam.quaternion.slerpQuaternions(st.cam.fromQ, _q, w);
}

/** [postfight hook] target: top of game.js updateCamera. True while this module drives the camera. */
export function postfightCamera() {
  if (!ctx || xrPresenting()) return false; // VR: never move the camera
  const m = ctx.getMatch && ctx.getMatch();
  return !!(m && m.over) || st.phase === 'replay'; // pose is captured untouched on the first over-frame
}

// ---------------------------------------------------------------- per-frame (from game.js)

export function updatePostfight() {
  if (!ctx) return;
  const t = wall();
  const dt = lastWall ? Math.min(0.1, t - lastWall) : 0;
  lastWall = t;
  const match = ctx.getMatch && ctx.getMatch();
  const fighters = ctx.getFighters ? ctx.getFighters() : [];
  if (!match || !fighters[0] || !fighters[1]) return;

  if (match.over && !st.overSeen) { st.overSeen = true; st.overWall = t; st.centerInit = false; }
  if (!match.over && st.overSeen) {
    // New round / rematch / menu: hand the camera back.
    st.overSeen = false;
    st.cam.on = false;
    if (st.phase === 'results') st.phase = 'idle';
  }
  // Leaving to a menu mid-sequence cancels it (no results to show).
  if ((st.phase === 'hold' || st.phase === 'replay') && S && S.match && S.match.phase !== 'match-end') abort();

  const pdt = paused() ? 0 : dt;
  if (st.phase === 'hold') {
    if (pdt === 0) st.holdUntil += dt;
    else if (t >= st.holdUntil) startReplays();
  }

  if (st.phase === 'replay') {
    // Cap the replay clock so a hitch can't skip a large chunk of the clip (stutter / jump).
    st.t += Math.min(pdt, 1 / 30) * CFG.slowMo;
    if (st.t >= st.len) nextClip();
  }
  if (st.phase === 'replay') {
    const clip = st.clips[st.idx];
    const [a, b] = applyClipPose(clip, st.t);
    st.posed = clip;
    // Restore the live pose right after the main render.
    ctx.scene.onAfterRender = () => {
      ctx.scene.onAfterRender = () => {};
      if (st.posed) { restoreClipPose(st.posed); st.posed = null; }
    };
    const f = shotFraming(st.shot, a, b, st.t, st.seed, clip.victim);
    const cam = ctx.camera;
    if (st._repIdx !== st.idx) {
      st._repIdx = st.idx;
      st._repBlend = 0;
      if (!st._repP) { st._repP = cam.position.clone(); st._repL = f.look.clone(); }
    }
    st._repBlend = Math.min(1, (st._repBlend || 0) + Math.max(dt, 1 / 120) / 0.22);
    const k = st._repBlend * st._repBlend * (3 - 2 * st._repBlend);
    if (!st._repP) st._repP = cam.position.clone();
    if (!st._repL) st._repL = f.look.clone();
    st._repP.lerp(f.pos, k);
    st._repL.lerp(f.look, k);
    cam.position.copy(st._repP);
    cam.lookAt(st._repL);
    if (Math.abs(cam.fov - f.fov) > 0.01) {
      cam.fov += (f.fov - cam.fov) * k;
      cam.updateProjectionMatrix();
    }
    return;
  }
  if (match.over && !xrPresenting()) orbit(dt, fighters, match);
  else st.cam.on = false;
}

// ---------------------------------------------------------------- init

function hookShell() {
  S = window.RFShell;
  if (!S || S.__postfightWrapped) return;
  S.__postfightWrapped = true;
  // Delay the existing results hook: 'matchEnd' fires only after the hold + replays.
  const emit = S.emit;
  S.emit = function (name, ...args) {
    if (name === 'roundBegin' && args[0] === 1) clearMoments();
    if (name === 'matchEnd' && !(S.match && S.match.cfg && S.match.cfg.mode === 'training')) {
      begin(() => emit.call(S, name, ...args));
      return;
    }
    return emit.call(S, name, ...args);
  };
  // Keys while the replays play: Space / Enter / Esc skip; restart / pause keys are swallowed.
  const baseKey = S.fightKey;
  S.fightKey = (e) => {
    if (st.phase === 'replay' || st.phase === 'hold') {
      if (SKIP_KEYS.test(e.code)) { if (!e.repeat && st.phase === 'replay') skip(); return st.phase !== 'hold' || e.code !== 'Escape' ? true : (baseKey ? baseKey(e) : false); }
      if (SWALLOW_KEYS.test(e.code)) return true;
    }
    return baseKey ? baseKey(e) : false;
  };
}

/** Called from game.js after the arena is built (ctx: scene, camera, getFighters, getMatch). */
export function initPostfight(c) {
  ctx = c;
  ui = makeUi();
  hookShell();
  window.__rfPostfight = {
    state: () => ({ phase: st.phase, clips: st.clips.length, idx: st.idx, shot: st.shot, cam: st.cam.on, t: +st.t.toFixed(2) }),
    skip,
  };
}

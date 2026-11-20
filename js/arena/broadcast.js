'use strict';
/* Broadcast director: auto-cuts between wide / ringside / overhead / fighter close-ups
   for the main-camera Broadcast view (C key), with a close-up cut on big hits, knockdowns,
   torn-off parts and the KO. No jumbotron / screen feed is rendered. (The post-fight replay
   recorder that lived here was removed; last commit with it: cde65e8.) */
import * as THREE from 'three';
import { SIZE, ARENA } from '../config.js';
import { isSettingsOpen } from '../settings.js';

const CFG = {
  bigHit: 12,         // health lost in one frame that counts as a big hit
};

export function xrPresenting() {
  return !!(ctx && ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.isPresenting);
}

const SHOTS = ['wide', 'ringside', 'overhead', 'closeP1', 'closeP2'];
const SHOT_LEN = { wide: [4.5, 7], ringside: [3.2, 5.2], overhead: [2.6, 4], closeP1: [2.2, 3.6], closeP2: [2.2, 3.6] };

let ctx = null;
let lastWall = 0;

// Director state
const live = { shot: 'wide', t: 0, len: 5, seed: Math.random() * 6.28, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, snap: true };
let mainOn = false;  // main camera is in 'broadcast' view this frame (set by broadcastMain)
let mainAt = 0;

// Event watch
const watch = { p1: null, p2: null, over: false };

// ---------------------------------------------------------------- director framing
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _side = new THREE.Vector3();
const _tp = new THREE.Vector3();
const _tl = new THREE.Vector3();

function pickShot(not, weights) {
  const opts = SHOTS.filter((s) => s !== not && !(Array.isArray(not) && not.includes(s)));
  const w = opts.map((s) => (weights && weights[s]) || 1);
  let r = Math.random() * w.reduce((x, y) => x + y, 0);
  for (let i = 0; i < opts.length; i++) { r -= w[i]; if (r <= 0) return opts[i]; }
  return opts[0];
}

// Shot framing from fighter root positions a, b (world). Writes _tp (camera) and _tl (look).
function matTopY() { return ARENA.matTop || 0; }

function frameShot(shot, a, b, t, seed, victim) {
  _mid.addVectors(a, b).multiplyScalar(0.5);
  _dir.subVectors(b, a).setY(0);
  const dist = Math.max(0.5, _dir.length());
  _dir.divideScalar(dist);
  _side.set(-_dir.z, 0, _dir.x);
  if (Math.sin(seed) < 0) _side.negate();
  const mt = matTopY();
  let fov = 38;
  switch (shot) {
    case 'wide': {
      const ang = seed + t * 0.035;
      const r = 12.5 + dist * 0.3;
      _tp.set(_mid.x + Math.sin(ang) * r, mt + 6.2, _mid.z + Math.cos(ang) * r);
      _tl.set(_mid.x, mt + 1.55 * SIZE, _mid.z);
      fov = 40;
      break;
    }
    case 'ringside': {
      // Raised off the apron and pulled back so the larger robots' heads stay in frame.
      const r = 8.8 + dist * 0.5;
      _tp.copy(_mid).addScaledVector(_side, r).addScaledVector(_dir, Math.sin(t * 0.25 + seed) * 1.2);
      _tp.y = mt + 2.15 * SIZE;
      _tl.set(_mid.x, mt + 1.55 * SIZE, _mid.z); // chest, with headroom so P1 is not cropped
      fov = 38;
      break;
    }
    case 'overhead': {
      const ang = seed + t * 0.08;
      _tp.set(_mid.x + Math.sin(ang) * 1.2, mt + 11.5, _mid.z + Math.cos(ang) * 1.2);
      _tl.set(_mid.x, mt + 0.4, _mid.z);
      fov = 44;
      break;
    }
    default: { // close-ups: over the opponent's shoulder onto the subject's head and torso
      const subjectIsP1 = victim ? victim === 'p1' : shot === 'closeP1';
      const s = subjectIsP1 ? a : b;
      const o = subjectIsP1 ? b : a;
      _b.subVectors(o, s).setY(0).normalize();
      // Pull back and sit near head height so heads are never cropped at the new scale.
      _tp.copy(o).addScaledVector(_b, 3.05).addScaledVector(_side, 2.15 + Math.sin(t * 0.3) * 0.2);
      _tp.y = mt + 2.4 * SIZE;
      _tl.set(s.x, mt + 1.55 * SIZE, s.z); // chest-to-head, pulled back so P1 heads stay in frame
      fov = 36;
    }
  }
  return fov;
}

function fighterPositions(fighters) {
  const [p1, p2] = fighters;
  _a.copy(p1.root.position);
  _b.copy(p2.root.position);
  return [_a.clone(), _b.clone()];
}

// ---------------------------------------------------------------- events

function snapshotState(f) {
  let det = 0;
  if (f.parts) for (const k in f.parts) if (f.parts[k] && f.parts[k].detached) det++;
  return { health: f.health, state: f.state, det };
}

function detectEvents(fighters, match) {
  const [p1, p2] = fighters;
  const s1 = snapshotState(p1);
  const s2 = snapshotState(p2);
  const evs = [];
  const check = (id, prev, cur) => {
    if (!prev) return;
    if (cur.health > prev.health + 30) return; // new round / rematch
    if (cur.state === 'ko' && prev.state !== 'ko') evs.push(['ko', id]);
    else if (cur.det > prev.det) evs.push(['detach', id]);
    else if (cur.state === 'down' && prev.state !== 'down') evs.push(['knockdown', id]);
    else if (prev.health - cur.health >= CFG.bigHit) evs.push(['hit', id]);
  };
  check('p1', watch.p1, s1);
  check('p2', watch.p2, s2);
  if (match && match.over && !watch.over && !evs.some((e) => e[0] === 'ko')) {
    evs.push(['ko', p1.health <= p2.health ? 'p1' : 'p2']);
  }
  watch.p1 = s1;
  watch.p2 = s2;
  watch.over = !!(match && match.over);
  for (const [type, victim] of evs) {
    // Main-screen Broadcast view: cut to a close-up of whoever just took the big moment.
    if (mainOn && !match?.over) { live.shot = victim === 'p1' ? 'closeP1' : 'closeP2'; live.t = 0; live.len = type === 'hit' ? 1.6 : 2.4; live.snap = true; }
  }
}

function stepLive(dt, fighters) {
  live.t += dt;
  const match = ctx.getMatch ? ctx.getMatch() : null;
  if (live.t >= live.len) {
    // KO aftermath favors close-ups; intros favor wide.
    const weights = match && match.over ? { closeP1: 2, closeP2: 2, wide: 1.5 } : match && match.phase !== 'fight' ? { wide: 3, overhead: 1 } : { wide: 1.2, ringside: 1.3 };
    live.shot = pickShot(live.shot, weights);
    const [lo, hi] = SHOT_LEN[live.shot];
    live.len = lo + Math.random() * (hi - lo);
    live.t = 0;
    live.seed = Math.random() * 6.28;
    live.snap = true;
  }
  const [a, b] = fighterPositions(fighters);
  live.fov = frameShot(live.shot, a, b, live.t, live.seed, null);
  if (live.snap) { live.pos.copy(_tp); live.look.copy(_tl); live.snap = false; } else {
    const k = 1 - Math.pow(0.08, dt);
    live.pos.lerp(_tp, k);
    live.look.lerp(_tl, k * 1.4 > 1 ? 1 : k * 1.4);
  }
}

// ---------------------------------------------------------------- hooks

export function initBroadcast(c) {
  ctx = c;
  if (c.renderer && c.renderer.xr) {
    c.renderer.xr.enabled = true;
    try { c.renderer.xr.setReferenceSpaceType('local'); } catch (_) {}
  }
  window.__rfBroadcast = {
    state: () => ({ shot: live.shot }),
    cut: (shot) => { if (SHOTS.includes(shot)) { live.shot = shot; live.t = 0; live.len = 99; live.snap = true; } },
  };
}

/** Main camera 'broadcast' view: the TV director's live shot (auto cuts, close-ups on
 *  big hits) drives the full-screen camera. Returns false until the director has a shot. */
export function broadcastMain(camera) {
  const wall = performance.now() / 1000;
  const first = wall - mainAt > 0.25;
  mainAt = wall;
  if (!ctx || first) { live.snap = true; if (!ctx) return false; }
  if (!live.pos.lengthSq()) return false;
  camera.position.copy(live.pos);
  camera.lookAt(live.look);
  if (camera.fov !== live.fov) { camera.fov = live.fov; camera.updateProjectionMatrix(); }
  return true;
}

/** Called every frame from the game loop. Uses wall time, so pauses don't freeze cuts. */
export function updateBroadcast() {
  if (!ctx) return;
  const wall = performance.now() / 1000;
  const dt = lastWall ? Math.min(0.1, wall - lastWall) : 0;
  lastWall = wall;
  const fighters = ctx.getFighters ? ctx.getFighters() : [];
  mainOn = wall - mainAt < 0.25 && !!(fighters[0] && fighters[1]);
  if (!fighters[0] || !fighters[1]) return;
  if (watch.f1 !== fighters[0] || watch.f2 !== fighters[1]) { watch.f1 = fighters[0]; watch.f2 = fighters[1]; watch.p1 = watch.p2 = null; }

  // Events only while the game clock runs.
  const paused = isSettingsOpen() || !!(window.RFShell && window.RFShell.state && window.RFShell.state.paused);
  if (!paused && dt > 0) detectEvents(fighters, ctx.getMatch ? ctx.getMatch() : null);
  // Always keep the director warm so Broadcast view has a shot as soon as it is selected.
  stepLive(dt, fighters);
}

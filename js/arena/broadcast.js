'use strict';
/* Broadcast director: auto-cuts between wide / ringside / overhead / fighter close-ups
   for the main-camera Broadcast view (C key). A ring buffer of fighter node transforms
   records big hits, knockdowns, torn-off parts and the KO for the post-fight replay
   package. No jumbotron / screen feed is rendered. */
import * as THREE from 'three';
import { SIZE, ARENA } from '../config.js';
import { isSettingsOpen } from '../settings.js';

const CFG = {
  recordHz: 30,
  bufferSec: 6,
  slowMo: 0.4,
  bigHit: 12,         // health lost in one frame that counts as a big hit
};

export function xrPresenting() {
  return !!(ctx && ctx.renderer && ctx.renderer.xr && ctx.renderer.xr.isPresenting);
}

const SHOTS = ['wide', 'ringside', 'overhead', 'closeP1', 'closeP2'];
const SHOT_LEN = { wide: [4.5, 7], ringside: [3.2, 5.2], overhead: [2.6, 4], closeP1: [2.2, 3.6], closeP2: [2.2, 3.6] };
const PRIORITY = { hit: 1, knockdown: 2, detach: 3, ko: 4 };

let ctx = null;
let lastRecord = 0;
let now = 0;
let lastWall = 0;

// Director state
const live = { shot: 'wide', t: 0, len: 5, seed: Math.random() * 6.28, pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, snap: true };
let replay = null;   // { type, start, end, t, shot, victim, seed }
let mainOn = false;  // main camera is in 'broadcast' view this frame (set by broadcastMain)
let mainAt = 0;
let pending = null;  // { type, at, playAt, victim, liveShot }
let lastReplayEnd = -99;

// Event watch
const watch = { p1: null, p2: null, over: false };

// ---------------------------------------------------------------- recording

class FighterTrack {
  constructor(f) {
    this.f = f;
    this.nodes = [];
    this.parents = [];
    f.root.traverse((o) => { this.nodes.push(o); this.parents.push(o.parent); });
    this.cap = Math.ceil(CFG.bufferSec * CFG.recordHz) + 4;
    const n = this.nodes.length;
    this.tr = new Float32Array(this.cap * n * 10);
    this.vis = new Uint8Array(this.cap * n);
    this.scratch = new Float32Array(n * 10);
    this.scratchVis = new Uint8Array(n);
  }
  valid() {
    // Rebuilt fighters (new match) or new nodes: start over.
    let count = 0;
    this.f.root.traverse(() => { count++; });
    return count <= this.nodes.length + 2 && this.nodes[0] === this.f.root;
  }
  write(buf, vis, base) {
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const o = this.nodes[i];
      const k = (base * n + i) * 10;
      buf[k] = o.position.x; buf[k + 1] = o.position.y; buf[k + 2] = o.position.z;
      buf[k + 3] = o.quaternion.x; buf[k + 4] = o.quaternion.y; buf[k + 5] = o.quaternion.z; buf[k + 6] = o.quaternion.w;
      buf[k + 7] = o.scale.x; buf[k + 8] = o.scale.y; buf[k + 9] = o.scale.z;
      // First-person view hides P1's head for the main camera only; the feed records it visible.
      const v = o.userData && o.userData.fpWasVisible != null ? o.userData.fpWasVisible : o.visible;
      vis[base * n + i] = v ? 1 : 0;
    }
  }
  record(slot) { this.write(this.tr, this.vis, slot); }
  save() { this.write(this.scratch, this.scratchVis, 0); }
  restore() { this.apply(this.scratch, this.scratchVis, 0, 0, 0); }
  apply(buf, vis, a, b, t) {
    const n = this.nodes.length;
    for (let i = 0; i < n; i++) {
      const o = this.nodes[i];
      if (o.parent !== this.parents[i]) continue; // torn-off parts now live in debris pivots
      const ka = (a * n + i) * 10;
      const kb = (b * n + i) * 10;
      o.position.set(lerp(buf[ka], buf[kb], t), lerp(buf[ka + 1], buf[kb + 1], t), lerp(buf[ka + 2], buf[kb + 2], t));
      _qa.set(buf[ka + 3], buf[ka + 4], buf[ka + 5], buf[ka + 6]);
      _qb.set(buf[kb + 3], buf[kb + 4], buf[kb + 5], buf[kb + 6]);
      o.quaternion.slerpQuaternions(_qa, _qb, t);
      o.scale.set(lerp(buf[ka + 7], buf[kb + 7], t), lerp(buf[ka + 8], buf[kb + 8], t), lerp(buf[ka + 9], buf[kb + 9], t));
      o.visible = !!vis[(t < 0.5 ? a : b) * n + i];
    }
  }
}
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const lerp = (a, b, t) => a + (b - a) * t;

const rec = {
  times: null, head: 0, count: 0, tracks: [], debris: [], baseline: null,
  reset(fighters) {
    this.tracks = fighters.map((f) => new FighterTrack(f));
    const cap = this.tracks[0].cap;
    this.times = new Float64Array(cap);
    this.debris = new Array(cap).fill(null);
    this.head = 0;
    this.count = 0;
  },
  push(t) {
    const cap = this.times.length;
    const slot = this.head;
    this.times[slot] = t;
    for (const tr of this.tracks) tr.record(slot);
    // Scene-level dynamic objects (torn-off parts in debris pivots): world transforms.
    const list = [];
    for (const o of ctx.scene.children) {
      if (this.baseline.has(o) || o.isLight || !o.visible || list.length >= 48 * 8) continue;
      if (o.name === 'stadiumArena' || o.name === 'crowdWatchRig' || this.tracks.some((t) => t.f.root === o)) continue;
      if (!(o.isGroup || o.isMesh) || o.isInstancedMesh) continue;
      list.push(o, o.position.x, o.position.y, o.position.z, o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w);
    }
    this.debris[slot] = list;
    this.head = (slot + 1) % cap;
    this.count = Math.min(cap, this.count + 1);
  },
  slotAt(i) { // i-th oldest
    const cap = this.times.length;
    return (this.head - this.count + i + cap * 2) % cap;
  },
  oldest() { return this.count ? this.times[this.slotAt(0)] : 0; },
  find(t) {
    // Linear scan is fine (<= 184 samples).
    let a = this.slotAt(0);
    for (let i = 1; i < this.count; i++) {
      const s = this.slotAt(i);
      if (this.times[s] > t) {
        const ta = this.times[a];
        const k = (t - ta) / Math.max(1e-6, this.times[s] - ta);
        return [a, s, Math.min(1, Math.max(0, k))];
      }
      a = s;
    }
    return [a, a, 0];
  },
};

// Debris during replay: objects that did not exist yet are parked on their first recorded pose
// (where the part tore off), so the limb still reads as attached before the tear.
const debrisSaved = new Map();
function applyDebris(a) {
  debrisSaved.clear();
  const firstPose = new Map();
  for (let i = 0; i < rec.count; i++) {
    const l = rec.debris[rec.slotAt(i)];
    if (!l) continue;
    for (let k = 0; k < l.length; k += 8) if (!firstPose.has(l[k])) firstPose.set(l[k], [l, k]);
  }
  const at = new Map();
  const la = rec.debris[a] || [];
  for (let k = 0; k < la.length; k += 8) at.set(la[k], [la, k]);
  for (const [o, ref] of firstPose) {
    const [l, k] = at.get(o) || ref;
    debrisSaved.set(o, [o.position.clone(), o.quaternion.clone()]);
    o.position.set(l[k + 1], l[k + 2], l[k + 3]);
    o.quaternion.set(l[k + 4], l[k + 5], l[k + 6], l[k + 7]);
  }
}
function restoreDebris() {
  for (const [o, [p, q]] of debrisSaved) { o.position.copy(p); o.quaternion.copy(q); }
  debrisSaved.clear();
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
    state: () => ({ shot: live.shot, replay: replay ? { type: replay.type, shot: replay.shot, t: +replay.t.toFixed(2) } : null, pending: pending && pending.type, samples: rec.count }),
    moments: () => moments.map((m) => ({ type: m.type, victim: m.victim, score: m.score, frames: m.times.length })),
    trigger: (type = 'hit', victim = 'p2') => { lastReplayEnd = -99; pending = null; replay = null; queueReplay(type, victim, 20); if (pending) pending.playAt = now + 0.05; },
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
  if (!fighters[0] || !fighters[1]) { replay = null; pending = null; return; }

  // Game time for recording/replay runs only while the game clock runs.
  const paused = isSettingsOpen() || !!(window.RFShell && window.RFShell.state && window.RFShell.state.paused);
  const gdt = paused ? 0 : dt;
  now += gdt;
  if (!rec.tracks.length || rec.tracks[0].f !== fighters[0] || rec.tracks[1].f !== fighters[1] || !rec.tracks.every((t) => t.valid())) {
    rec.reset(fighters);
    rec.baseline = new Set(ctx.scene.children);
    watch.p1 = watch.p2 = null;
  }
  const match = ctx.getMatch ? ctx.getMatch() : null;
  if (gdt > 0) {
    detectEvents(fighters, match);
    if (now - lastRecord >= 1 / CFG.recordHz) { lastRecord = now; rec.push(now); }
  }
  captureClips();
  if (feedHold) { replay = null; pending = null; }
  else {
    if (pending && now >= pending.playAt) startReplay();
    if (replay) {
      replay.t += dt;
      if (replay.start + replay.t * CFG.slowMo >= replay.end) { replay = null; lastReplayEnd = now; live.t = live.len; }
    }
  }
  // Always keep the director warm so Broadcast view has a shot as soon as it is selected.
  stepLive(dt, fighters);
}

// ---------------------------------------------------------------- [postfight] moment archive
// Each big moment is copied out of the 6 s ring buffer shortly after it happens (pre-roll +
// aftermath), scored, and kept (best few per match) for the post-fight replay package.

const SCORE = { ko: 100, detach: 60, knockdown: 50 };
const CLIP_PRE = { ko: 1.9, detach: 1.4, knockdown: 1.4, hit: 1.1 };
const CLIP_POST = { ko: 0.9, detach: 0.7, knockdown: 0.8, hit: 0.5 };
const MAX_MOMENTS = 6;
const moments = [];
const pendingClips = [];
let feedHold = false;

function noteMoment(type, victim, drop) {
  const score = SCORE[type] || Math.min(40, 10 + (drop || 0));
  pendingClips.push({ type, victim, at: now, score, captureAt: now + CLIP_POST[type] });
}

function captureClips() {
  for (let i = pendingClips.length - 1; i >= 0; i--) {
    const p = pendingClips[i];
    if (now < p.captureAt) continue;
    pendingClips.splice(i, 1);
    const t0 = p.at - CLIP_PRE[p.type];
    const idx = [];
    for (let k = 0; k < rec.count; k++) {
      const s = rec.slotAt(k);
      if (rec.times[s] >= t0 && rec.times[s] <= p.captureAt) idx.push(s);
    }
    if (idx.length < 3) continue;
    const tracks = rec.tracks.map((tr) => {
      const n = tr.nodes.length;
      const buf = new Float32Array(idx.length * n * 10);
      const vis = new Uint8Array(idx.length * n);
      idx.forEach((s, j) => {
        buf.set(tr.tr.subarray(s * n * 10, (s + 1) * n * 10), j * n * 10);
        vis.set(tr.vis.subarray(s * n, (s + 1) * n), j * n);
      });
      return { tr, buf, vis };
    });
    const clip = {
      type: p.type, victim: p.victim, score: p.score, at: p.at,
      times: idx.map((s) => rec.times[s]), debris: idx.map((s) => rec.debris[s] || []), tracks,
    };
    // One clip per moment; a KO supersedes the hit that caused it (same instant).
    let dup = false;
    for (let j = moments.length - 1; j >= 0; j--) if (Math.abs(moments[j].at - clip.at) < 0.6) {
      if (moments[j].score >= clip.score) { dup = true; break; }
      moments.splice(j, 1);
    }
    if (dup) continue;
    moments.push(clip);
    moments.sort((a, b) => b.score - a.score);
    if (moments.length > MAX_MOMENTS) moments.length = MAX_MOMENTS;
  }
}

/** Best moments of this match (KO blow first if any), newest data. */
export function getMoments() { captureClips(); return moments.slice(); }
export function clearMoments() { moments.length = 0; pendingClips.length = 0; }
/** Pause in-camera replays while the post-fight package plays. */
export function setFeedHold(on) { feedHold = !!on; }
/** Flush pending captures now (used when the match ends before a clip's aftermath elapsed). */
export function flushMoments() { for (const p of pendingClips) p.captureAt = Math.min(p.captureAt, now); captureClips(); }

const clipSaved = { active: false, hidden: [], debris: new Map() };
/** Pose the fighters (and torn-off parts) as they were at clip time t (seconds from clip start).
    Returns the two fighter root positions. Call restoreClipPose() after the render. */
export function applyClipPose(clip, t) {
  const tt = clip.times[0] + t;
  let a = 0;
  while (a < clip.times.length - 2 && clip.times[a + 1] <= tt) a++;
  const b = Math.min(clip.times.length - 1, a + 1);
  const k = Math.max(0, Math.min(1, (tt - clip.times[a]) / Math.max(1e-6, clip.times[b] - clip.times[a])));
  for (const { tr, buf, vis } of clip.tracks) { tr.save(); tr.apply(buf, vis, a, b, k); }
  // Debris known to the clip: its recorded pose (or first pose before it existed). Others: hidden.
  const known = new Map();
  for (const list of clip.debris) for (let j = 0; j < list.length; j += 8) if (!known.has(list[j])) known.set(list[j], [list, j]);
  const at = new Map();
  const la = clip.debris[k < 0.5 ? a : b];
  for (let j = 0; j < la.length; j += 8) at.set(la[j], [la, j]);
  clipSaved.debris.clear();
  for (const [o, ref] of known) {
    const [l, j] = at.get(o) || ref;
    clipSaved.debris.set(o, [o.position.clone(), o.quaternion.clone()]);
    o.position.set(l[j + 1], l[j + 2], l[j + 3]);
    o.quaternion.set(l[j + 4], l[j + 5], l[j + 6], l[j + 7]);
  }
  clipSaved.hidden.length = 0;
  for (const o of ctx.scene.children) {
    if (rec.baseline && rec.baseline.has(o)) continue;
    if (known.has(o) || o.isLight || !o.visible || !(o.isGroup || o.isMesh) || o.isInstancedMesh) continue;
    if (o.name === 'stadiumArena' || o.name === 'crowdWatchRig' || clip.tracks.some((x) => x.tr.f.root === o)) continue;
    o.visible = false;
    clipSaved.hidden.push(o);
  }
  clipSaved.active = true;
  const r = clip.tracks.map(({ tr }) => tr.f.root.position.clone());
  return r;
}

export function restoreClipPose(clip) {
  if (!clipSaved.active) return;
  for (const { tr } of clip.tracks) tr.restore();
  for (const [o, [p, q]] of clipSaved.debris) { o.position.copy(p); o.quaternion.copy(q); }
  for (const o of clipSaved.hidden) o.visible = true;
  clipSaved.debris.clear();
  clipSaved.hidden.length = 0;
  clipSaved.active = false;
}

/** Broadcast framing for a shot (wide / ringside / overhead / closeP1 / closeP2). */
export function shotFraming(shot, a, b, t, seed, victim) {
  const fov = frameShot(shot, a, b, t, seed, victim);
  return { pos: _tp.clone(), look: _tl.clone(), fov };
}
export const SHOT_NAMES = SHOTS.slice();

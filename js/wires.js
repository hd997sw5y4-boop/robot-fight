// Dangling wires at torn-off stumps (and a few on the torn-off piece).
// Each wire is a short Verlet chain pinned to its anchor (a stump bone or a debris pivot),
// rendered as a damped metal/insulation tube. Chains collide with the mat and, on Medium/High,
// with the fighters' body capsules. Stumps arc now and then: a jagged bright bolt to a wire
// tip, a spark burst and a crackle, fading out over time.
// Capped for performance: fewer wires, fewer tube sides, and no body collision on Low.
import * as THREE from 'three';
import { playSfx } from './audio.js';
import { ARENA, SIZE } from './config.js';

const SEGS = 6;
const PALETTE = [
  { color: 0x8a7055, metalness: 0.72, roughness: 0.38 }, // copper
  { color: 0x2c2d31, metalness: 0.12, roughness: 0.72 }, // black insulation
  { color: 0x6a6560, metalness: 0.55, roughness: 0.45 }, // brushed steel
  { color: 0x3d3934, metalness: 0.18, roughness: 0.68 }, // brown sheath
  { color: 0x7a7d82, metalness: 0.62, roughness: 0.40 }, // aluminium
];
const mats = PALETTE.map((p) => new THREE.MeshStandardMaterial({
  color: p.color, metalness: p.metalness, roughness: p.roughness,
  envMapIntensity: 0.85, side: THREE.FrontSide,
}));
const arcMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 1, toneMapped: false });
const LIMITS = { high: { perStump: 6, perPiece: 3, max: 48, arcs: 3, sides: 6, iters: 8 }, low: { perStump: 3, perPiece: 0, max: 16, arcs: 1, sides: 4, iters: 4 } };

let low = false;
const groups = []; // { anchor, wires: [{ pts, prev, mesh, geo, len, off, rad }], t, nextArc, piece, onSpark, scene }
const bolts = [];  // { line, t, life }
const _a = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _n1 = new THREE.Vector3();
const _n2 = new THREE.Vector3();
let obstacles = []; // { ax,ay,az, bx,by,bz, r }
let wireSave = null;

export function setWiresLow(on) { low = !!on; }
export function setWireObstacles(list) { obstacles = list || []; }

function wireCount() { return groups.reduce((n, g) => n + g.wires.length, 0); }
function lim() { return LIMITS[low ? 'low' : 'high']; }

function makeTubeGeo(sides) {
  const rings = SEGS + 1;
  const pos = new Float32Array(rings * sides * 3);
  const nrm = new Float32Array(rings * sides * 3);
  const idx = [];
  for (let i = 0; i < SEGS; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j;
      const b = i * sides + ((j + 1) % sides);
      const c = (i + 1) * sides + j;
      const d = (i + 1) * sides + ((j + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

function updateTube(geo, pts, radius, sides) {
  const pos = geo.attributes.position.array;
  const nrm = geo.attributes.normal.array;
  let px = 1, py = 0, pz = 0;
  for (let k = 0; k <= SEGS; k++) {
    const p = pts[k];
    const n = pts[k === SEGS ? k - 1 : k + 1];
    _tan.set(n.x - p.x, n.y - p.y, n.z - p.z);
    if (k === SEGS) _tan.negate();
    if (_tan.lengthSq() < 1e-10) _tan.set(0, -1, 0);
    else _tan.normalize();
    _n1.set(px, py, pz);
    _n1.addScaledVector(_tan, -_n1.dot(_tan));
    if (_n1.lengthSq() < 1e-8) {
      _n1.set(0, 1, 0);
      _n1.addScaledVector(_tan, -_n1.dot(_tan));
      if (_n1.lengthSq() < 1e-8) _n1.set(1, 0, 0);
    }
    _n1.normalize();
    _n2.copy(_tan).cross(_n1).normalize();
    px = _n1.x; py = _n1.y; pz = _n1.z;
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const nx = _n1.x * c + _n2.x * s;
      const ny = _n1.y * c + _n2.y * s;
      const nz = _n1.z * c + _n2.z * s;
      const i = (k * sides + j) * 3;
      pos[i] = p.x + nx * radius;
      pos[i + 1] = p.y + ny * radius;
      pos[i + 2] = p.z + nz * radius;
      nrm[i] = nx; nrm[i + 1] = ny; nrm[i + 2] = nz;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingSphere();
}

function flushWire(w) {
  updateTube(w.geo, w.pts, w.rad, w.sides);
}

// anchor: Object3D the wires hang from; piece = wires on the torn-off part (no arcs).
export function addWires(anchor, scene, { piece = false, onSpark = null } = {}) {
  if (!anchor || !scene) return;
  const L = lim();
  let n = piece ? L.perPiece : L.perStump;
  while (n > 0 && groups.length && wireCount() + n > L.max) removeGroup(groups[0]);
  if (n <= 0) return;
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(_a);
  const g = { anchor, wires: [], t: 0, nextArc: piece ? Infinity : 0.25 + Math.random() * 0.5, piece, onSpark, scene };
  for (let i = 0; i < n; i++) {
    const len = (0.055 + Math.random() * 0.04) * SIZE * (piece ? 0.7 : 1);
    const off = new THREE.Vector3((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03).multiplyScalar(SIZE);
    const pts = []; const prev = [];
    const dir = new THREE.Vector3(Math.random() - 0.5, -Math.random() - 0.2, Math.random() - 0.5).normalize();
    for (let k = 0; k <= SEGS; k++) {
      const p = _a.clone().add(off).addScaledVector(dir, k * len);
      pts.push(p); prev.push(p.clone());
    }
    const sides = L.sides;
    const geo = makeTubeGeo(sides);
    const mesh = new THREE.Mesh(geo, mats[i % mats.length]);
    mesh.name = 'stumpWire';
    mesh.userData.wire = true;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const rad = (0.007 + (i % 3) * 0.002) * SIZE;
    updateTube(geo, pts, rad, sides);
    scene.add(mesh);
    g.wires.push({ pts, prev, mesh, geo, len, off, rad, sides });
  }
  groups.push(g);
}

function removeGroup(g) {
  for (const w of g.wires) {
    if (w.mesh.parent) w.mesh.parent.remove(w.mesh);
    w.geo.dispose();
  }
  const i = groups.indexOf(g);
  if (i >= 0) groups.splice(i, 1);
}

// stumpsOnly: a new round repairs the robots, so wires hanging from their stumps go.
// Full clear (default) also drops wires on torn-off pieces — debris is cleared between rounds.
export function clearWires(stumpsOnly = false) {
  if (stumpsOnly) {
    for (const g of groups.slice()) if (!g.piece) removeGroup(g);
    return;
  }
  while (groups.length) removeGroup(groups[0]);
  for (const b of bolts) { if (b.line.parent) b.line.parent.remove(b.line); b.line.geometry.dispose(); }
  bolts.length = 0;
  wireSave = null;
}

function collidePoint(p) {
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    const abx = o.bx - o.ax, aby = o.by - o.ay, abz = o.bz - o.az;
    const apx = p.x - o.ax, apy = p.y - o.ay, apz = p.z - o.az;
    const denom = abx * abx + aby * aby + abz * abz;
    let t = denom > 1e-10 ? (apx * abx + apy * aby + apz * abz) / denom : 0;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = o.ax + abx * t, cy = o.ay + aby * t, cz = o.az + abz * t;
    const dx = p.x - cx, dy = p.y - cy, dz = p.z - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d < o.r && d > 1e-8) {
      const s = o.r / d;
      p.x = cx + dx * s; p.y = cy + dy * s; p.z = cz + dz * s;
    }
  }
}

function arc(g) {
  const L = lim();
  if (bolts.length >= L.arcs || !g.wires.length) return;
  const w = g.wires[Math.floor(Math.random() * g.wires.length)];
  const from = w.pts[0];
  const to = w.pts[SEGS - Math.floor(Math.random() * 2)];
  const n = 7;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const j = k === 0 || k === n - 1 ? 0 : 0.035 * SIZE;
    arr[k * 3] = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * j;
    arr[k * 3 + 1] = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * j;
    arr[k * 3 + 2] = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * j;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const line = new THREE.Line(geo, arcMat);
  line.frustumCulled = false;
  line.userData.wire = true;
  g.scene.add(line);
  bolts.push({ line, t: 0, life: 0.05 + Math.random() * 0.06 });
  if (g.onSpark) g.onSpark(to.clone());
  playSfx('spark', { vol: 0.22 + Math.random() * 0.15 });
}

export function stepWires(dt) {
  if (!(dt > 0)) return;
  const floor = (ARENA.floorY || 0) + 0.012;
  const g2 = -9.8 * dt * dt;
  const iters = lim().iters;
  const collide = !low && obstacles.length > 0;
  const damp = low ? 0.96 : 0.92;
  for (const g of groups.slice()) {
    g.t += dt;
    if (!g.anchor.parent && !g.anchor.isScene) { removeGroup(g); continue; }
    // Settled torn-off pieces: leave the last posed wires alone, no verlet or arcs.
    if (g.piece && g.anchor.userData && g.anchor.userData.resting) continue;
    g.anchor.updateWorldMatrix(true, false);
    g.anchor.getWorldPosition(_a);
    for (const w of g.wires) {
      const P = w.pts; const Q = w.prev;
      P[0].copy(_a).add(w.off); Q[0].copy(P[0]);
      for (let k = 1; k <= SEGS; k++) {
        const p = P[k]; const q = Q[k];
        const vx = (p.x - q.x) * damp; const vy = (p.y - q.y) * damp; const vz = (p.z - q.z) * damp;
        q.copy(p);
        p.x += vx; p.y += vy + g2; p.z += vz;
      }
      for (let it = 0; it < iters; it++) {
        for (let k = 1; k <= SEGS; k++) {
          const a = P[k - 1]; const b = P[k];
          const dx = b.x - a.x; const dy = b.y - a.y; const dz = b.z - a.z;
          const d = Math.hypot(dx, dy, dz) || 1e-6;
          const diff = (d - w.len) / d;
          if (k === 1) { b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff; } else {
            a.x += dx * diff * 0.5; a.y += dy * diff * 0.5; a.z += dz * diff * 0.5;
            b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5; b.z -= dz * diff * 0.5;
          }
        }
        for (let k = 1; k <= SEGS; k++) {
          if (P[k].y < floor) P[k].y = floor;
          if (collide) collidePoint(P[k]);
        }
        P[0].copy(_a).add(w.off);
      }
      flushWire(w);
    }
    // Arcs: frequent right after the tear, tapering off, done after ~20 s.
    g.nextArc -= dt;
    if (g.nextArc <= 0 && g.t < 20) {
      arc(g);
      g.nextArc = (0.35 + Math.random() * 1.4) * (1 + g.t * 0.25);
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.t += dt;
    if (b.t > b.life) { if (b.line.parent) b.line.parent.remove(b.line); b.line.geometry.dispose(); bolts.splice(i, 1); }
  }
}

function packGroups() {
  return groups.map((g) => g.wires.map((w) => {
    const arr = new Float32Array((SEGS + 1) * 3);
    for (let k = 0; k <= SEGS; k++) { arr[k * 3] = w.pts[k].x; arr[k * 3 + 1] = w.pts[k].y; arr[k * 3 + 2] = w.pts[k].z; }
    return arr;
  }));
}

function unpackInto(snap, k, other) {
  const nG = Math.min(groups.length, snap.length);
  for (let gi = 0; gi < nG; gi++) {
    const gw = groups[gi].wires;
    const sw = snap[gi] || [];
    const ow = other && other[gi];
    const nW = Math.min(gw.length, sw.length);
    for (let wi = 0; wi < nW; wi++) {
      const pts = gw[wi].pts;
      const a = sw[wi];
      const b = ow && ow[wi];
      for (let i = 0; i <= SEGS; i++) {
        const i3 = i * 3;
        if (b && k > 0) {
          pts[i].set(a[i3] + (b[i3] - a[i3]) * k, a[i3 + 1] + (b[i3 + 1] - a[i3 + 1]) * k, a[i3 + 2] + (b[i3 + 2] - a[i3 + 2]) * k);
        } else pts[i].set(a[i3], a[i3 + 1], a[i3 + 2]);
      }
      flushWire(gw[wi]);
    }
  }
}

/** Packed point snapshot for replay recording (30 Hz). */
export function snapshotWires() { return packGroups(); }

/** Pose wires as they were at a recorded sample (lerped). Call restoreWires() after the render. */
export function applyWires(a, b, k) {
  if (!wireSave) wireSave = packGroups();
  for (const bolt of bolts) if (bolt.line) bolt.line.visible = false;
  unpackInto(a || [], k, b);
}

export function restoreWires() {
  for (const bolt of bolts) if (bolt.line) bolt.line.visible = true;
  if (!wireSave) return;
  unpackInto(wireSave, 0, null);
  wireSave = null;
}

// Dangling wires and electric arcs at torn-off stumps (and a few on the torn-off piece).
// Each wire is a short verlet chain pinned to its anchor (a stump bone or a debris pivot),
// swinging under gravity, resting on the mat. Stumps arc now and then: a jagged bright
// bolt to a wire tip, a spark burst and a crackle (CC0 spark samples), fading out over time.
// Capped for performance: fewer wires and arcs on Low graphics.
import * as THREE from 'three';
import { playSfx } from './audio.js';
import { ARENA } from './config.js';

const SEGS = 6;
const COLORS = [0xb3261e, 0xd8b41c, 0x1d1f24, 0x2a5fd0, 0x2e8b3e];
const mats = COLORS.map((c) => new THREE.LineBasicMaterial({ color: c }));
const arcMat = new THREE.LineBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 1, toneMapped: false });
const LIMITS = { high: { perStump: 6, perPiece: 3, max: 48, arcs: 3 }, low: { perStump: 3, perPiece: 0, max: 16, arcs: 1 } };

let low = false;
const groups = []; // { anchor, local, wires: [{ pts, prev, line, len }], t, nextArc, arcs, onSpark }
const bolts = [];  // { line, t }
const _a = new THREE.Vector3();

export function setWiresLow(on) { low = !!on; }

function wireCount() { return groups.reduce((n, g) => n + g.wires.length, 0); }

// anchor: Object3D the wires hang from; piece = wires on the torn-off part (no arcs).
export function addWires(anchor, scene, { piece = false, onSpark = null } = {}) {
  if (!anchor || !scene) return;
  const lim = LIMITS[low ? 'low' : 'high'];
  let n = piece ? lim.perPiece : lim.perStump;
  // Over the cap: drop the oldest groups first.
  while (n > 0 && groups.length && wireCount() + n > lim.max) removeGroup(groups[0]);
  if (n <= 0) return;
  anchor.updateWorldMatrix(true, false);
  anchor.getWorldPosition(_a);
  const g = { anchor, wires: [], t: 0, nextArc: piece ? Infinity : 0.25 + Math.random() * 0.5, piece, onSpark, scene };
  for (let i = 0; i < n; i++) {
    const len = (0.06 + Math.random() * 0.05) * (piece ? 0.7 : 1);
    const off = new THREE.Vector3((Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.06);
    const pts = []; const prev = [];
    const dir = new THREE.Vector3(Math.random() - 0.5, -Math.random(), Math.random() - 0.5).normalize();
    for (let k = 0; k <= SEGS; k++) {
      const p = _a.clone().add(off).addScaledVector(dir, k * len);
      pts.push(p); prev.push(p.clone());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((SEGS + 1) * 3), 3));
    const line = new THREE.Line(geo, mats[i % mats.length]);
    line.frustumCulled = false;
    scene.add(line);
    g.wires.push({ pts, prev, line, len, off });
  }
  groups.push(g);
}

function removeGroup(g) {
  for (const w of g.wires) { w.line.parent && w.line.parent.remove(w.line); w.line.geometry.dispose(); }
  const i = groups.indexOf(g);
  if (i >= 0) groups.splice(i, 1);
}

export function clearWires() {
  while (groups.length) removeGroup(groups[0]);
  for (const b of bolts) { b.line.parent && b.line.parent.remove(b.line); b.line.geometry.dispose(); }
  bolts.length = 0;
}

function arc(g) {
  const lim = LIMITS[low ? 'low' : 'high'];
  if (bolts.length >= lim.arcs || !g.wires.length) return;
  const w = g.wires[Math.floor(Math.random() * g.wires.length)];
  const from = w.pts[0];
  const to = w.pts[SEGS - Math.floor(Math.random() * 2)];
  const n = 7;
  const arr = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const j = k === 0 || k === n - 1 ? 0 : 0.035;
    arr[k * 3] = from.x + (to.x - from.x) * t + (Math.random() - 0.5) * j;
    arr[k * 3 + 1] = from.y + (to.y - from.y) * t + (Math.random() - 0.5) * j;
    arr[k * 3 + 2] = from.z + (to.z - from.z) * t + (Math.random() - 0.5) * j;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const line = new THREE.Line(geo, arcMat);
  line.frustumCulled = false;
  g.scene.add(line);
  bolts.push({ line, t: 0, life: 0.05 + Math.random() * 0.06 });
  if (g.onSpark) g.onSpark(to.clone());
  playSfx('spark', { vol: 0.22 + Math.random() * 0.15 });
}

export function stepWires(dt) {
  if (!(dt > 0)) return;
  const floor = (ARENA.floorY || 0) + 0.012;
  const g2 = -9.8 * dt * dt;
  for (const g of groups.slice()) {
    g.t += dt;
    if (!g.anchor.parent && !g.anchor.isScene) { removeGroup(g); continue; }
    g.anchor.updateWorldMatrix(true, false);
    g.anchor.getWorldPosition(_a);
    for (const w of g.wires) {
      const P = w.pts; const Q = w.prev;
      P[0].copy(_a).add(w.off); Q[0].copy(P[0]);
      for (let k = 1; k <= SEGS; k++) {
        const p = P[k]; const q = Q[k];
        const vx = (p.x - q.x) * 0.985; const vy = (p.y - q.y) * 0.985; const vz = (p.z - q.z) * 0.985;
        q.copy(p);
        p.x += vx; p.y += vy + g2; p.z += vz;
      }
      for (let it = 0; it < 3; it++) {
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
        for (let k = 1; k <= SEGS; k++) if (P[k].y < floor) P[k].y = floor;
      }
      const arr = w.line.geometry.attributes.position.array;
      for (let k = 0; k <= SEGS; k++) { arr[k * 3] = P[k].x; arr[k * 3 + 1] = P[k].y; arr[k * 3 + 2] = P[k].z; }
      w.line.geometry.attributes.position.needsUpdate = true;
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
    if (b.t > b.life) { b.line.parent && b.line.parent.remove(b.line); b.line.geometry.dispose(); bolts.splice(i, 1); }
  }
}

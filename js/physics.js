'use strict';
/* cannon-es world: fighter capsules, cage and torn-off debris. Falls are animation clips
   (see game.js knockDown / ko); there is no ragdoll. */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ARENA, SIZE, WORLD_SCALE, CAGE_PAD } from './config.js';

const G = { ARENA: 1, FIGHTER: 2, DEBRIS: 8, DOWN: 16 };

function matY() { return ARENA.matTop || 0; }

// Gravity scales with WORLD_SCALE so hang time (and debris arcs) stay familiar.
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16.5 * WORLD_SCALE, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 20;
world.defaultContactMaterial.friction = 0.35;
world.defaultContactMaterial.restitution = 0.08;

const matFloor = new CANNON.Material('floor');
const matFighter = new CANNON.Material('fighter');
const matDebris = new CANNON.Material('debris');
const matCage = new CANNON.Material('cage');
world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matFighter, { friction: 0.28, restitution: 0.0 }));
// Torn parts bounce once or twice, then settle.
world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matDebris, { friction: 0.45, restitution: 0.34 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCage, matDebris, { friction: 0.3, restitution: 0.4 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCage, matFighter, { friction: 0.2, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(matFighter, matFighter, { friction: 0.12, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(matDebris, matDebris, { friction: 0.36, restitution: 0.4 }));
world.addContactMaterial(new CANNON.ContactMaterial(matDebris, matFighter, { friction: 0.22, restitution: 0.48 }));

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

let bounceHook = null;
const debris = [];
const fighters = new Set();

export function onPhysicsBounce(fn) { bounceHook = fn; }

export function getWorld() { return world; }

export function initArenaPhysics() {
  // Remove previous arena bodies if re-init
  const a = ARENA.apothem;
  const floor = new CANNON.Body({ mass: 0, material: matFloor, type: CANNON.Body.STATIC });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  // Plane origin is the mat top, matching the visual floor mesh top (ARENA.matTop).
  floor.position.set(0, ARENA.matTop || 0, 0);
  floor.collisionFilterGroup = G.ARENA;
  floor.collisionFilterMask = G.FIGHTER | G.DEBRIS | G.DOWN;
  floor.userData = { kind: 'floor' };
  world.addBody(floor);

  const r = a / Math.cos(Math.PI / 8);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    corners.push(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
  }
  // Visual cage is waist-to-chest (ARENA.cageHeight). Same footprint: inner face
  // flush with the mat flats (apothem). A taller invisible extension of that wall
  // keeps jump / knockback from leaving the ring — one cage, not two.
  const visH = ARENA.cageHeight || 1.48;
  const physH = Math.max(visH + 0.67, 3.4 * WORLD_SCALE);
  const halfT = 0.06;
  for (let i = 0; i < 8; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 8];
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const outward = mid.clone().setY(0).normalize();
    mid.addScaledVector(outward, halfT); // inner face at apothem a
    const wall = new CANNON.Body({ mass: 0, material: matCage, type: CANNON.Body.STATIC });
    wall.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, physH / 2, halfT)));
    wall.position.set(mid.x, matY() + physH / 2, mid.z);
    const yaw = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    wall.quaternion.setFromEuler(0, yaw, 0);
    wall.collisionFilterGroup = G.ARENA;
    wall.collisionFilterMask = G.FIGHTER | G.DEBRIS | G.DOWN;
    wall.userData = { kind: 'cage' };
    world.addBody(wall);
  }
  for (const c of corners) {
    const post = new CANNON.Body({ mass: 0, material: matCage, type: CANNON.Body.STATIC });
    post.addShape(new CANNON.Cylinder(0.11, 0.11, physH, 8));
    post.position.set(c.x, matY() + physH / 2, c.z);
    post.collisionFilterGroup = G.ARENA;
    post.collisionFilterMask = G.FIGHTER | G.DEBRIS | G.DOWN;
    post.userData = { kind: 'post' };
    world.addBody(post);
  }
}

export function attachFighter(f) {
  const body = new CANNON.Body({
    mass: 86,
    material: matFighter,
    fixedRotation: true,
    linearDamping: 0.55,
    angularDamping: 1,
    allowSleep: false,
  });
  // Body-vs-body: about 0.95 m between centres, the real width of the chest and shoulders,
  // so torsos can't pass through each other while circling.
  body.addShape(new CANNON.Sphere(0.42 * SIZE), new CANNON.Vec3(0, 0.56 * SIZE, 0)); // clear of the mat (no floor drag)
  body.addShape(new CANNON.Sphere(0.48 * SIZE), new CANNON.Vec3(0, 1.1 * SIZE, 0));
  body.addShape(new CANNON.Sphere(0.44 * SIZE), new CANNON.Vec3(0, 1.72 * SIZE, 0));
  body.position.set(f.root.position.x, matY(), f.root.position.z);
  body.collisionFilterGroup = G.FIGHTER;
  // Standing robots only touch the cage and each other: a downed body or loose parts on the
  // mat used to shove the standing robot's root around (sliding while idle).
  body.collisionFilterMask = G.ARENA | G.FIGHTER;
  body.userData = { kind: 'fighter', id: f.id };
  world.addBody(body);
  f.phys = { body };
  fighters.add(f);
  body.addEventListener('collide', (e) => {
    const other = e.body === body ? e.target : e.body;
    if (other && other.userData && other.userData.kind === 'cage') {
      const n = e.contact && e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
      if (n > 1.1 && bounceHook) bounceHook('cage', n);
    }
  });
}

export function detachFighter(f) {
  if (!f || !f.phys || !f.phys.body) return;
  try { world.removeBody(f.phys.body); } catch (_) {}
  fighters.delete(f);
  f.phys = null;
}

/** Down / KO / get-up / jump-ghost: still hit the cage and floor, but not the other robot. */
export function setFighterDowned(f, downed) {
  const body = f && f.phys && f.phys.body;
  if (!body) return;
  if (downed) {
    body.collisionFilterGroup = G.DOWN;
    body.collisionFilterMask = G.ARENA;
  } else {
    body.collisionFilterGroup = G.FIGHTER;
    body.collisionFilterMask = G.ARENA | G.FIGHTER;
  }
  body.collisionResponse = true;
}

export function clampBodyToCage(x, z, pad = CAGE_PAD) {
  const a = (ARENA.apothem || 6.1) - pad;
  let nx = Math.max(-a, Math.min(a, x));
  let nz = Math.max(-a, Math.min(a, z));
  const m = a * Math.SQRT2;
  const s = Math.abs(nx) + Math.abs(nz);
  if (s > m) { const k = m / s; nx *= k; nz *= k; }
  return [nx, nz];
}

function wallOutward(x, z) {
  const a = ARENA.apothem || 6.1;
  const ax = a - Math.abs(x);
  const az = a - Math.abs(z);
  const diag = a * Math.SQRT2 - (Math.abs(x) + Math.abs(z));
  if (ax <= az && ax <= diag) return [x >= 0 ? 1 : -1, 0];
  if (az <= diag) return [0, z >= 0 ? 1 : -1];
  const nx = x >= 0 ? 1 : -1, nz = z >= 0 ? 1 : -1;
  const len = Math.hypot(nx, nz) || 1;
  return [nx / len, nz / len];
}

function wallDist(x, z) {
  const a = ARENA.apothem || 6.1;
  return Math.min(a - Math.abs(x), a - Math.abs(z), a * Math.SQRT2 - (Math.abs(x) + Math.abs(z)));
}

/** Strip velocity that would push a body into the cage so it can slide along or step off. */
export function cageSlideVelocity(x, z, vx, vz, pad = CAGE_PAD) {
  const w = wallDist(x, z);
  if (w > pad + 0.2) return [vx, vz];
  const [nx, nz] = wallOutward(x, z);
  const outward = vx * nx + vz * nz;
  if (outward <= 0) return [vx, vz];
  const keep = w > 0.04 ? 0 : 1; // on the face, fully drop outward; slightly inside still drop
  return [vx - nx * outward * (w <= pad ? 1 : keep), vz - nz * outward * (w <= pad ? 1 : keep)];
}

export function setFighterMove(f, vx, vz) {
  const body = f.phys && f.phys.body;
  if (!body) return;
  const px = (f.root && f.root.position.x) || body.position.x;
  const pz = (f.root && f.root.position.z) || body.position.z;
  const slid = cageSlideVelocity(px, pz, vx, vz);
  vx = slid[0]; vz = slid[1];
  body.velocity.x = vx;
  body.velocity.z = vz;
  // Keep the capsule standing on the mat.
  body.velocity.y = 0;
  body.position.y = matY();
  body.wakeUp();
}

export function syncFightersFromPhysics() {
  for (const f of fighters) {
    if (!f.phys || !f.phys.body) continue;
    f.root.position.x = f.phys.body.position.x;
    f.root.position.z = f.phys.body.position.z;
    f.phys.body.position.y = matY();
    // groundFeet in game.js owns root.y (root-at-zero measurement, then lift to the mat).
  }
}

export function getFighterVelocity(f, out = new THREE.Vector3()) {
  const body = f.phys && f.phys.body;
  if (!body) return out.set(0, 0, 0);
  return out.set(body.velocity.x, body.velocity.y, body.velocity.z);
}

export function impactVelocity(atk, def, dir) {
  const a = getFighterVelocity(atk, _v);
  const b = getFighterVelocity(def, new THREE.Vector3());
  const rel = a.sub(b);
  const along = dir ? Math.max(0, rel.dot(dir)) : rel.length();
  return along;
}

export function spawnDebris({ mesh, mass, velocity, angularVelocity, ownerId, small }) {
  if (typeof window !== 'undefined' && window.RFFightLog && window.RFFightLog.noteFrameWork) window.RFFightLog.noteFrameWork('debris');
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const minH = small ? 0.012 : 0.05; // small chips get a box that fits them (no hovering)
  const hx = Math.max(minH, size.x / 2);
  const hy = Math.max(minH, size.y / 2);
  const hz = Math.max(minH, size.z / 2);
  const body = new CANNON.Body({
    mass: small ? Math.max(0.05, mass || 0.15) : Math.max(0.8, mass || 3),
    material: matDebris,
    linearDamping: 0.08,
    angularDamping: 0.1,
    allowSleep: true,
    sleepSpeedLimit: 0.22,
    sleepTimeLimit: 0.4,
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
  const pos = box.getCenter(new THREE.Vector3());
  body.position.set(pos.x, Math.max(hy + 0.03, pos.y), pos.z);
  mesh.getWorldQuaternion(_q);
  body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
  if (velocity) body.velocity.set(velocity.x, velocity.y, velocity.z);
  if (angularVelocity) body.angularVelocity.set(angularVelocity.x, angularVelocity.y, angularVelocity.z);
  else body.angularVelocity.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 14);
  body.collisionFilterGroup = G.DEBRIS;
  // Arena and other debris only — never fighters, so landed pieces cannot keep colliding.
  body.collisionFilterMask = G.ARENA | G.DEBRIS;
  body.userData = { kind: 'debris', ownerId: ownerId || null };
  world.addBody(body);
  const rec = { mesh, body, mass, settled: false, still: 0, lastClank: 0, ownerId: ownerId || null, live: 0, small: !!small, ext: Math.max(hx, hz) };
  body.addEventListener('collide', (e) => {
    if (rec.settled) return;
    const other = e.body === body ? e.target : e.body;
    const impact = e.contact && e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
    if (impact < (rec.small ? 2.2 : 0.9)) return;
    const now = performance.now();
    if (now - rec.lastClank < 70) return;
    rec.lastClank = now;
    const kind = (other && other.userData && other.userData.kind) || 'floor';
    if (bounceHook) bounceHook(kind === 'cage' || kind === 'post' || kind === 'fighter' ? kind : 'bounce', impact, rec);
  });
  debris.push(rec);
  return rec;
}

export function getPhysicsDebris() { return debris; }

export function clearPhysicsDebris() {
  for (const d of debris) {
    if (d.body && d.body.world) world.removeBody(d.body);
    d.body = null;
  }
  debris.length = 0;
}

// In-flight pieces stay in cannon. Once they slow down or have been on the mat ~1.5 s,
// the body is removed and the mesh is a cheap static prop (no shadows, no per-frame sync).
const DEBRIS_CAP = { high: { dynamic: 8, small: 12, big: 10 }, low: { dynamic: 5, small: 8, big: 8 } };
let debrisLow = false;
export function setDebrisLow(on) { debrisLow = !!on; }
export function debrisCaps() { return DEBRIS_CAP[debrisLow ? 'low' : 'high']; }

function poseMeshFromBody(d) {
  if (!d.body || !d.mesh) return;
  const floor = matY() + 0.02;
  d.mesh.position.set(d.body.position.x, Math.max(d.body.position.y, floor), d.body.position.z);
  d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
}

export function freezeDebris(d) {
  if (!d || d.frozen) return;
  d.settled = true;
  d.frozen = true;
  d.frozenAt = performance.now();
  if (d.body) {
    poseMeshFromBody(d);
    d.body.velocity.setZero();
    d.body.angularVelocity.setZero();
    if (d.body.world) world.removeBody(d.body);
    d.body = null;
  }
  const mesh = d.mesh;
  if (!mesh) return;
  mesh.userData.resting = true;
  mesh.traverse((o) => {
    if (!o.isMesh && !o.isLine) return;
    o.castShadow = false;
    if (o.isMesh) o.receiveShadow = false;
    o.matrixAutoUpdate = false;
    o.updateMatrix();
  });
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
}

export function dropDebris(d) {
  if (!d) return;
  freezeDebris(d);
  const i = debris.indexOf(d);
  if (i >= 0) debris.splice(i, 1);
}

// Nothing may stop in mid-air: a piece is only frozen as a prop when it is down on the mat;
// one that has to stop anywhere else (over the moving-piece cap, or still not at rest after
// DEBRIS_MAX_LIVE s, e.g. caught on the cage rail) shrinks away and is removed instead
// (damage.js runs the fade and disposes the mesh).
const DEBRIS_MAX_LIVE = 5;
const DEBRIS_FADE = 0.35;
function retireDebris(d) {
  const grounded = d.body && d.body.position.y < matY() + 0.2 * SIZE && d.body.velocity.length() < 1.2;
  freezeDebris(d);
  if (!grounded && d.fade == null) d.fade = DEBRIS_FADE;
}

/** Off the fight loop (menus, fighter select): nothing may hang in mid-air until the next fight. */
export function settleLooseDebris() {
  for (const d of debris.slice()) if (!d.frozen && d.body) retireDebris(d);
}

function capDebris() {
  const cap = debrisCaps();
  const moving = debris.filter((d) => !d.frozen && d.body);
  if (moving.length > cap.dynamic) {
    const extra = moving.slice().sort((a, b) => (b.live || 0) - (a.live || 0));
    for (let i = 0; i < moving.length - cap.dynamic; i++) retireDebris(extra[i]);
  }
}

function syncDebris(dt) {
  capDebris();
  const floor = matY() + 0.02;
  const nearMat = matY() + 0.62 * SIZE;
  for (const d of debris) {
    if (d.frozen || !d.body) continue;
    d.live = (d.live || 0) + dt;
    if (d.body.position.y < floor) {
      d.body.position.y = floor;
      if (d.body.velocity.y < 0) d.body.velocity.y = 0;
    }
    // Keep the whole piece inside the cage (its half-size from the inner face, not just its
    // centre), bouncing off softly. A centre that got past the wall plane (tunnelled at speed)
    // is counted once as an escape for the fight log, then brought back in.
    const pad = Math.min(0.35, Math.max(0.04, d.ext || 0.08));
    const px = d.body.position.x, pz = d.body.position.z;
    const [cx, cz] = clampBodyToCage(px, pz, pad);
    if (cx !== px || cz !== pz) {
      if (!d.escaped && wallDist(px, pz) < -0.02) { d.escaped = true; d.escapedNew = true; }
      d.body.position.x = cx;
      d.body.position.z = cz;
      const [nx, nz] = wallOutward(px, pz);
      const out = d.body.velocity.x * nx + d.body.velocity.z * nz;
      if (out > 0) { d.body.velocity.x -= nx * out * 1.35; d.body.velocity.z -= nz * out * 1.35; }
      d.body.velocity.x *= 0.6;
      d.body.velocity.z *= 0.6;
    }
    const v = d.body.velocity.length();
    const w = d.body.angularVelocity.length();
    const onMat = d.body.position.y < nearMat;
    d.onMat = onMat ? (d.onMat || 0) + dt : 0;
    const slow = v < 0.28 && w < 0.7;
    if (onMat && slow) d.still = (d.still || 0) + dt;
    else d.still = 0;
    // Rest: below a small speed for a moment, or about 1.5 s on the ground.
    if (onMat && (d.still > 0.2 || d.onMat >= 1.5)) {
      freezeDebris(d);
      continue;
    }
    if (d.live > DEBRIS_MAX_LIVE) { retireDebris(d); continue; }
    poseMeshFromBody(d);
  }
}

export function stepPhysics(dt) {
  if (dt <= 0) return;
  const steps = Math.min(4, Math.max(1, Math.round(dt / (1 / 60))));
  world.step(1 / 60, dt, steps);
  syncFightersFromPhysics();
  syncDebris(dt);
}

export function resetFighterPhysics(f, x, z) {
  if (f.phys && f.phys.body) {
    f.phys.body.position.set(x, matY(), z);
    f.phys.body.velocity.setZero();
    f.phys.body.angularVelocity.setZero();
    f.phys.body.wakeUp();
  }
}

export const PART_MASS = { head: 3.6, torso: 12, armL: 3.2, armR: 3.2, legL: 5.4, legR: 5.4 };

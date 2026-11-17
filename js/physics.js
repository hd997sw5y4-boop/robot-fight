'use strict';
/* cannon-es world: fighter capsules, cage, ragdoll, and debris. */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ARENA } from './config.js';

const G = { ARENA: 1, FIGHTER: 2, RAGDOLL: 4, DEBRIS: 8 };

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16.5, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.solver.iterations = 14;
world.defaultContactMaterial.friction = 0.35;
world.defaultContactMaterial.restitution = 0.08;

const matFloor = new CANNON.Material('floor');
const matFighter = new CANNON.Material('fighter');
const matSoft = new CANNON.Material('soft');
const matDebris = new CANNON.Material('debris');
const matCage = new CANNON.Material('cage');
world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matFighter, { friction: 0.28, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matSoft, { friction: 0.48, restitution: 0.12 }));
world.addContactMaterial(new CANNON.ContactMaterial(matFloor, matDebris, { friction: 0.38, restitution: 0.58 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCage, matDebris, { friction: 0.22, restitution: 0.68 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCage, matSoft, { friction: 0.28, restitution: 0.2 }));
world.addContactMaterial(new CANNON.ContactMaterial(matCage, matFighter, { friction: 0.2, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(matFighter, matFighter, { friction: 0.12, restitution: 0.0 }));
world.addContactMaterial(new CANNON.ContactMaterial(matDebris, matDebris, { friction: 0.36, restitution: 0.4 }));
world.addContactMaterial(new CANNON.ContactMaterial(matSoft, matFighter, { friction: 0.2, restitution: 0.05 }));
world.addContactMaterial(new CANNON.ContactMaterial(matDebris, matFighter, { friction: 0.22, restitution: 0.48 }));
world.addContactMaterial(new CANNON.ContactMaterial(matDebris, matSoft, { friction: 0.28, restitution: 0.4 }));

const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _bodyM = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _v = new THREE.Vector3();

let bounceHook = null;
const debris = [];
const fighters = new Set();

export function onPhysicsBounce(fn) { bounceHook = fn; }

export function getWorld() { return world; }

function normBone(name) {
  return String(name || '').replace(/^mixamorig[:._]*/i, '');
}

function findBone(root, pred) {
  let found = null;
  root.traverse((o) => {
    if (found) return;
    if (!o.isBone && o.type !== 'Bone') return;
    if (pred(normBone(o.name), o)) found = o;
  });
  return found;
}

export function initArenaPhysics() {
  // Remove previous arena bodies if re-init
  const a = ARENA.apothem;
  const floor = new CANNON.Body({ mass: 0, material: matFloor, type: CANNON.Body.STATIC });
  floor.addShape(new CANNON.Plane());
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  floor.collisionFilterGroup = G.ARENA;
  floor.collisionFilterMask = G.FIGHTER | G.RAGDOLL | G.DEBRIS;
  floor.userData = { kind: 'floor' };
  world.addBody(floor);

  const r = a / Math.cos(Math.PI / 8);
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    corners.push(new THREE.Vector3(Math.cos(ang) * r, 0, Math.sin(ang) * r));
  }
  for (let i = 0; i < 8; i++) {
    const A = corners[i];
    const B = corners[(i + 1) % 8];
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const dir = B.clone().sub(A);
    const len = dir.length();
    const wall = new CANNON.Body({ mass: 0, material: matCage, type: CANNON.Body.STATIC });
    wall.addShape(new CANNON.Box(new CANNON.Vec3(len / 2, 1.7, 0.09)));
    wall.position.set(mid.x, 1.7, mid.z);
    const yaw = Math.atan2(dir.x, dir.z) + Math.PI / 2;
    wall.quaternion.setFromEuler(0, yaw, 0);
    wall.collisionFilterGroup = G.ARENA;
    wall.collisionFilterMask = G.FIGHTER | G.RAGDOLL | G.DEBRIS;
    wall.userData = { kind: 'cage' };
    world.addBody(wall);
  }
  for (const c of corners) {
    const post = new CANNON.Body({ mass: 0, material: matCage, type: CANNON.Body.STATIC });
    post.addShape(new CANNON.Cylinder(0.16, 0.16, 3.2, 8));
    post.position.set(c.x, 1.6, c.z);
    post.collisionFilterGroup = G.ARENA;
    post.collisionFilterMask = G.FIGHTER | G.RAGDOLL | G.DEBRIS;
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
  body.addShape(new CANNON.Sphere(0.38), new CANNON.Vec3(0, 0.42, 0));
  body.addShape(new CANNON.Sphere(0.42), new CANNON.Vec3(0, 1.05, 0));
  body.addShape(new CANNON.Sphere(0.36), new CANNON.Vec3(0, 1.72, 0));
  body.position.set(f.root.position.x, 0, f.root.position.z);
  body.collisionFilterGroup = G.FIGHTER;
  body.collisionFilterMask = G.ARENA | G.FIGHTER | G.RAGDOLL | G.DEBRIS;
  body.userData = { kind: 'fighter', id: f.id };
  world.addBody(body);
  f.phys = { body, ragdoll: null };
  fighters.add(f);
  body.addEventListener('collide', (e) => {
    const other = e.body === body ? e.target : e.body;
    if (other && other.userData && other.userData.kind === 'cage') {
      const n = e.contact && e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
      if (n > 1.1 && bounceHook) bounceHook('cage', n);
    }
  });
}

export function setFighterMove(f, vx, vz) {
  const body = f.phys && f.phys.body;
  if (!body || (f.phys.ragdoll && f.phys.ragdoll.active)) return;
  body.velocity.x = vx;
  body.velocity.z = vz;
  // Keep the capsule standing on the mat.
  body.velocity.y = 0;
  body.position.y = 0;
  body.wakeUp();
}

export function syncFightersFromPhysics() {
  for (const f of fighters) {
    if (!f.phys || !f.phys.body) continue;
    if (f.phys.ragdoll && f.phys.ragdoll.active) {
      const hips = f.phys.ragdoll.entries.find((e) => e.id === 'hips');
      if (hips) {
        f.root.position.x = hips.body.position.x;
        f.root.position.z = hips.body.position.z;
        f.root.position.y = 0;
      }
      applyRagdoll(f);
      continue;
    }
    f.root.position.x = f.phys.body.position.x;
    f.root.position.z = f.phys.body.position.z;
    f.root.position.y = 0;
    f.phys.body.position.y = 0;
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

export function isRagdoll(f) {
  return !!(f && f.phys && f.phys.ragdoll && f.phys.ragdoll.active);
}

function limbSpec(id, bonePred, mass, radius, parent) {
  return { id, bonePred, mass, radius, parent };
}

const RAGDOLL_SPEC = [
  limbSpec('hips', (n) => n === 'Hips', 10, 0.16, null),
  limbSpec('spine', (n) => n === 'Spine2' || n === 'Spine1' || n === 'Spine', 8, 0.15, 'hips'),
  limbSpec('head', (n) => n === 'Head', 3.2, 0.13, 'spine'),
  limbSpec('armL', (n) => n === 'LeftArm', 2.4, 0.07, 'spine'),
  limbSpec('foreL', (n) => n === 'LeftForeArm', 1.8, 0.06, 'armL'),
  limbSpec('armR', (n) => n === 'RightArm', 2.4, 0.07, 'spine'),
  limbSpec('foreR', (n) => n === 'RightForeArm', 1.8, 0.06, 'armR'),
  limbSpec('upLegL', (n) => n === 'LeftUpLeg', 5.2, 0.09, 'hips'),
  limbSpec('legL', (n) => n === 'LeftLeg', 3.6, 0.075, 'upLegL'),
  limbSpec('upLegR', (n) => n === 'RightUpLeg', 5.2, 0.09, 'hips'),
  limbSpec('legR', (n) => n === 'RightLeg', 3.6, 0.075, 'upLegR'),
];

function boneLength(bone) {
  let best = 0;
  for (const ch of bone.children) {
    if (ch.isBone || ch.type === 'Bone') best = Math.max(best, ch.position.length());
  }
  return best;
}

export function enableRagdoll(f, impulse, opts = {}) {
  if (!f || !f.model) return;
  if (isRagdoll(f)) {
    // already down; add impulse and maybe extend
    const hips = f.phys.ragdoll.entries.find((e) => e.id === 'hips');
    if (hips && impulse) hips.body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y || 1.2, impulse.z), hips.body.position);
    if (opts.until != null) f.phys.ragdoll.until = opts.until;
    return;
  }
  f.model.updateWorldMatrix(true, true);
  if (f.mixer) f.mixer.timeScale = 0;
  const entries = [];
  const byId = {};
  for (const spec of RAGDOLL_SPEC) {
    const bone = findBone(f.model, spec.bonePred);
    if (!bone) continue;
    bone.updateWorldMatrix(true, false);
    bone.matrixWorld.decompose(_p, _q, _s);
    const len = Math.max(0.18, boneLength(bone) * (bone.getWorldScale(_v).y || 1) || 0.22);
    const radius = spec.radius;
    const body = new CANNON.Body({
      mass: spec.mass,
      material: matSoft,
      linearDamping: 0.18,
      angularDamping: 0.36,
      allowSleep: true,
      sleepSpeedLimit: 0.28,
    });
    if (spec.id === 'head' || spec.id === 'hips') {
      body.addShape(new CANNON.Sphere(spec.id === 'head' ? 0.15 : 0.17));
    } else if (spec.id === 'spine') {
      body.addShape(new CANNON.Box(new CANNON.Vec3(0.16, Math.max(0.12, len * 0.35), 0.12)));
    } else {
      const half = Math.max(0.1, len * 0.42);
      const cyl = new CANNON.Cylinder(radius, radius, half * 2, 6);
      // Cylinder is Y-aligned; Mixamo limbs mostly hang along bone +Y in bind, but world orientation is on the body quaternion.
      body.addShape(cyl);
    }
    body.position.set(_p.x, Math.max(0.12, _p.y), _p.z);
    body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    body.collisionFilterGroup = G.RAGDOLL;
    body.collisionFilterMask = G.ARENA | G.FIGHTER | G.RAGDOLL | G.DEBRIS;
    body.userData = { kind: 'ragdoll', id: f.id, part: spec.id };
    world.addBody(body);
    const entry = { id: spec.id, parent: spec.parent, bone, body, len };
    entries.push(entry);
    byId[spec.id] = entry;
  }
  const constraints = [];
  for (const e of entries) {
    if (!e.parent || !byId[e.parent]) continue;
    const p = byId[e.parent];
    const pWorld = new THREE.Vector3();
    const cWorld = new THREE.Vector3();
    p.bone.updateWorldMatrix(true, false);
    e.bone.updateWorldMatrix(true, false);
    // Joint at the child bone origin (shared with parent end).
    e.bone.getWorldPosition(cWorld);
    const pivotA = new CANNON.Vec3();
    const pivotB = new CANNON.Vec3();
    p.body.pointToLocalFrame(new CANNON.Vec3(cWorld.x, cWorld.y, cWorld.z), pivotA);
    e.body.pointToLocalFrame(new CANNON.Vec3(cWorld.x, cWorld.y, cWorld.z), pivotB);
    const c = new CANNON.PointToPointConstraint(p.body, pivotA, e.body, pivotB, 1e6);
    c.collideConnected = false;
    world.addConstraint(c);
    constraints.push(c);
  }
  if (f.phys && f.phys.body) {
    f.phys.body.collisionResponse = false;
    f.phys.body.velocity.setZero();
    f.phys.body.type = CANNON.Body.STATIC;
  }
  if (impulse) {
    const hips = byId.hips || entries[0];
    const spine = byId.spine || hips;
    if (hips) hips.body.applyImpulse(new CANNON.Vec3(impulse.x * 0.7, (impulse.y || 1.4) + 1.1, impulse.z * 0.7), hips.body.position);
    if (spine && spine !== hips) spine.body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y || 1.2, impulse.z), spine.body.position);
  }
  f.phys.ragdoll = {
    active: true,
    entries,
    constraints,
    until: opts.until == null ? Infinity : opts.until,
    kind: opts.kind || 'ko',
  };
}

function applyRagdoll(f) {
  const rd = f.phys && f.phys.ragdoll;
  if (!rd || !rd.active) return;
  for (const e of rd.entries) {
    const bone = e.bone;
    const parent = bone.parent;
    _bodyM.compose(
      _p.set(e.body.position.x, e.body.position.y, e.body.position.z),
      _q.set(e.body.quaternion.x, e.body.quaternion.y, e.body.quaternion.z, e.body.quaternion.w),
      _one,
    );
    if (parent) {
      parent.updateWorldMatrix(true, false);
      _inv.copy(parent.matrixWorld).invert();
      _m.multiplyMatrices(_inv, _bodyM);
      _m.decompose(bone.position, bone.quaternion, _s);
    } else {
      _bodyM.decompose(bone.position, bone.quaternion, _s);
    }
  }
}

export function disableRagdoll(f) {
  const rd = f.phys && f.phys.ragdoll;
  if (!rd || !rd.active) return;
  for (const c of rd.constraints) world.removeConstraint(c);
  for (const e of rd.entries) world.removeBody(e.body);
  rd.active = false;
  rd.entries = [];
  rd.constraints = [];
  if (f.mixer) f.mixer.timeScale = 1;
  if (f.phys && f.phys.body) {
    f.phys.body.collisionResponse = true;
    f.phys.body.type = CANNON.Body.DYNAMIC;
    f.phys.body.position.set(f.root.position.x, 0, f.root.position.z);
    f.phys.body.velocity.setZero();
    f.phys.body.wakeUp();
  }
}

export function spawnDebris({ mesh, mass, velocity, angularVelocity, ownerId }) {
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = box.getSize(new THREE.Vector3());
  const hx = Math.max(0.05, size.x / 2);
  const hy = Math.max(0.05, size.y / 2);
  const hz = Math.max(0.05, size.z / 2);
  const body = new CANNON.Body({
    mass: Math.max(0.8, mass || 3),
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
  // Brief ignore of fighters so the torn piece clears the body, then ricochet off everyone.
  body.collisionFilterMask = G.ARENA | G.RAGDOLL | G.DEBRIS;
  body.userData = { kind: 'debris', ownerId: ownerId || null };
  world.addBody(body);
  const rec = { mesh, body, settled: false, still: 0, lastClank: 0, ownerId: ownerId || null, live: 0 };
  body.addEventListener('collide', (e) => {
    if (rec.settled) return;
    const other = e.body === body ? e.target : e.body;
    const impact = e.contact && e.contact.getImpactVelocityAlongNormal ? Math.abs(e.contact.getImpactVelocityAlongNormal()) : 0;
    if (impact < 0.9) return;
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
  for (const d of debris) world.removeBody(d.body);
  debris.length = 0;
}

function syncDebris(dt) {
  for (const d of debris) {
    d.live = (d.live || 0) + dt;
    if (d.live > 0.2 && (d.body.collisionFilterMask & G.FIGHTER) === 0) {
      d.body.collisionFilterMask = G.ARENA | G.FIGHTER | G.RAGDOLL | G.DEBRIS;
    }
    if (!d.settled) {
      const v = d.body.velocity.length();
      const w = d.body.angularVelocity.length();
      const onMat = d.body.position.y < 0.62;
      if (onMat && v < 0.32 && w < 0.85) {
        d.still += dt;
        if (d.still > 0.4) {
          d.settled = true;
          d.body.velocity.setZero();
          d.body.angularVelocity.setZero();
          d.body.type = CANNON.Body.STATIC;
          d.body.sleep();
        }
      } else {
        d.still = 0;
      }
    }
    d.mesh.position.set(d.body.position.x, d.body.position.y, d.body.position.z);
    d.mesh.quaternion.set(d.body.quaternion.x, d.body.quaternion.y, d.body.quaternion.z, d.body.quaternion.w);
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
  disableRagdoll(f);
  if (f.phys && f.phys.body) {
    f.phys.body.position.set(x, 0, z);
    f.phys.body.velocity.setZero();
    f.phys.body.angularVelocity.setZero();
    f.phys.body.wakeUp();
  }
}

export const PART_MASS = { head: 3.6, torso: 12, armL: 3.2, armR: 3.2, legL: 5.4, legR: 5.4 };

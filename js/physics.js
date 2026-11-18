'use strict';
/* cannon-es world: fighter capsules, cage and torn-off debris. Falls are animation clips
   (see game.js knockDown / ko); there is no ragdoll. */
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { ARENA, SIZE } from './config.js';

const G = { ARENA: 1, FIGHTER: 2, DEBRIS: 8 };

const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -16.5, 0) });
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
  floor.collisionFilterMask = G.FIGHTER | G.DEBRIS;
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
    wall.collisionFilterMask = G.FIGHTER | G.DEBRIS;
    wall.userData = { kind: 'cage' };
    world.addBody(wall);
  }
  for (const c of corners) {
    const post = new CANNON.Body({ mass: 0, material: matCage, type: CANNON.Body.STATIC });
    post.addShape(new CANNON.Cylinder(0.16, 0.16, 3.2, 8));
    post.position.set(c.x, 1.6, c.z);
    post.collisionFilterGroup = G.ARENA;
    post.collisionFilterMask = G.FIGHTER | G.DEBRIS;
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
  body.position.set(f.root.position.x, 0, f.root.position.z);
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

export function setFighterMove(f, vx, vz) {
  const body = f.phys && f.phys.body;
  if (!body) return;
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
  body.collisionFilterMask = G.ARENA | G.DEBRIS;
  body.userData = { kind: 'debris', ownerId: ownerId || null };
  world.addBody(body);
  const rec = { mesh, body, mass, settled: false, still: 0, lastClank: 0, ownerId: ownerId || null, live: 0 };
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
      d.body.collisionFilterMask = G.ARENA | G.FIGHTER | G.DEBRIS;
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
  if (f.phys && f.phys.body) {
    f.phys.body.position.set(x, 0, z);
    f.phys.body.velocity.setZero();
    f.phys.body.angularVelocity.setZero();
    f.phys.body.wakeUp();
  }
}

export const PART_MASS = { head: 3.6, torso: 12, armL: 3.2, armR: 3.2, legL: 5.4, legR: 5.4 };

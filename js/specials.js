/* Rocket punch and thruster dash: shared energy, Mixamo clips plus VFX. */
import * as THREE from 'three';
import { SIZE, MODEL, CAGE_PAD, SPECIAL } from './config.js';

let ctx = null;
export function bindSpecials(c) { ctx = c; }

export function initSpecial(f) {
  if (!f) return;
  f.energy = SPECIAL.energyMax;
  f.energyDelay = 0;
  f.specialKind = null;
  f.special = null;
}

export function specialAvail(f) {
  const energy = f && f.energy != null ? f.energy : SPECIAL.energyMax;
  const busy = !f || !f.state || f.state === 'ko' || f.state === 'down' || f.state === 'getup' || f.state === 'hit'
    || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash' || f.state === 'rocket';
  const arm = ctx && ctx.canPunch ? ctx.canPunch(f) : true;
  return {
    energy: +energy.toFixed(1),
    energyMax: SPECIAL.energyMax,
    rocket_punch: !busy && arm && energy >= SPECIAL.rocketCost,
    dash_forward: !busy && energy >= SPECIAL.dashCost,
    dash_back: !busy && energy >= SPECIAL.dashCost,
  };
}

export function spendEnergy(f, cost) {
  f.energy = Math.max(0, (f.energy || 0) - cost);
  f.energyDelay = SPECIAL.regenDelay;
}

export function stepEnergy(f, dt) {
  if (!f || f.energy == null) return;
  if (f.energyDelay > 0) { f.energyDelay -= dt; return; }
  if (f.energy < SPECIAL.energyMax) f.energy = Math.min(SPECIAL.energyMax, f.energy + SPECIAL.regen * dt);
}

function findBone(root, re) {
  let hit = null;
  root.traverse((o) => { if (!hit && o.isBone && re.test(o.name)) hit = o; });
  return hit;
}

function wristOf(f) {
  return findBone(f.model, /righthand$/i) || findBone(f.model, /handr$/i) || findBone(f.model, /righthand/i);
}

function hideHand(f, hide) {
  const part = (f.subs && f.subs.handR) || (f.parts && f.parts.armR);
  const meshes = part ? [].concat(part.meshes || [], part.skinned || []) : [];
  for (const m of meshes) if (m) m.visible = !hide;
}

function fistMesh() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8c0cc, metalness: 0.82, roughness: 0.28, emissive: 0xff6a1a, emissiveIntensity: 0.35,
  });
  const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.07 * SIZE, 0.1 * SIZE, 4, 8), mat);
  core.rotation.z = Math.PI / 2;
  g.add(core);
  return g;
}

function makeTrail(color, low) {
  const pts = [];
  const n = low ? 6 : 14;
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const geo = new THREE.SphereGeometry(0.045 * SIZE, 6, 6);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    pts.push(m);
  }
  return { pts, geo, mat, i: 0 };
}

function pushTrail(trail, pos, parent) {
  const m = trail.pts[trail.i % trail.pts.length];
  trail.i += 1;
  if (m.parent !== parent) parent.add(m);
  m.position.copy(pos);
  m.visible = true;
  m.userData.life = 1;
}

function fadeTrail(trail, dt) {
  for (const m of trail.pts) {
    if (!m.visible) continue;
    m.userData.life -= dt * 5;
    m.scale.setScalar(Math.max(0.15, m.userData.life));
    m.material.opacity = Math.max(0, m.userData.life);
    if (m.userData.life <= 0) m.visible = false;
  }
}

function disposeTrail(trail) {
  for (const m of trail.pts) { if (m.parent) m.parent.remove(m); }
  trail.geo.dispose();
  trail.mat.dispose();
}

function jetSprite(color) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(0.07 * SIZE, 0.28 * SIZE, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = Math.PI / 2;
  return m;
}

export function clearSpecial(f) {
  if (!f || !f.special) {
    if (f) f.specialKind = null;
    return;
  }
  const s = f.special;
  if (s.fist && s.fist.parent) s.fist.parent.remove(s.fist);
  if (s.trail) disposeTrail(s.trail);
  if (s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); if (j.geometry) j.geometry.dispose(); if (j.material) j.material.dispose(); }
  hideHand(f, false);
  f.special = null;
  f.specialKind = null;
}

export function tryRocketPunch(f, other) {
  if (!ctx || !f || !other) return false;
  if (ctx.inBell && ctx.inBell()) { if (ctx.logBellBlock) ctx.logBellBlock(f.id, 'rocket_punch'); return false; }
  const av = specialAvail(f);
  if (!av.rocket_punch) return false;
  spendEnergy(f, SPECIAL.rocketCost);
  f.specialKind = 'rocket';
  const clip = (f.actions && (f.actions.RightHook || f.actions.Uppercut || f.actions[MODEL.animations.punch])) ? (f.actions.RightHook ? 'RightHook' : (f.actions.Uppercut ? 'Uppercut' : MODEL.animations.punch)) : MODEL.animations.punch;
  f.state = 'punch';
  f.stateT = 0;
  f.hitThisAttack = false;
  f.attackClip = clip;
  f.blocking = false;
  if (f.shield) f.shield.visible = false;
  ctx.setAnim(f, clip, 0.12);
  const act = f.actions && f.actions[clip];
  if (act) {
    act.timeScale = 1.25;
    if (act.getClip) act.time = Math.min(0.12, act.getClip().duration * 0.15);
  }
  const low = ctx.gfxKey === 'low';
  const fist = fistMesh();
  ctx.scene.add(fist);
  fist.visible = false;
  f.special = {
    kind: 'rocket',
    t: 0,
    phase: 'wind',
    fist,
    trail: makeTrail(0xff7a2f, low),
    hit: false,
    clip,
  };
  if (ctx.playSfx) ctx.playSfx('whoosh');
  if (ctx.logSpecial) ctx.logSpecial(f.id, 'rocket_punch', 'use');
  if (!f.isCpu && ctx.logInputAction) ctx.logInputAction(f.id, 'rocket_punch');
  return true;
}

export function tryDash(f, other, dir) {
  if (!ctx || !f || !other) return false;
  if (ctx.inBell && ctx.inBell()) { if (ctx.logBellBlock) ctx.logBellBlock(f.id, dir > 0 ? 'dash_forward' : 'dash_back'); return false; }
  const av = specialAvail(f);
  if (dir > 0 && !av.dash_forward) return false;
  if (dir < 0 && !av.dash_back) return false;
  spendEnergy(f, SPECIAL.dashCost);
  f.specialKind = 'dash';
  f.state = 'dash';
  f.stateT = 0;
  f.blocking = false;
  if (f.shield) f.shield.visible = false;
  const fwd = ctx.toward(f, other, new THREE.Vector3());
  const v = fwd.multiplyScalar(dir > 0 ? 1 : -1);
  const clip = dir > 0
    ? (f.actions && f.actions.LongStepForward ? 'LongStepForward' : null)
    : (f.actions && f.actions.StepBackward ? 'StepBackward' : null);
  if (clip) ctx.setAnim(f, clip, 0.08);
  else ctx.setAnim(f, (ctx.idleClipFor && ctx.idleClipFor(f)) || MODEL.animations.idle, 0.08);
  const jets = [jetSprite(0x66d8ff), jetSprite(0xff9a3a)];
  for (const j of jets) { j.visible = true; ctx.scene.add(j); }
  f.special = { kind: 'dash', t: 0, dir, axis: v.clone(), jets, clip };
  f.invuln = Math.max(f.invuln || 0, SPECIAL.dash.invuln);
  if (ctx.playSfx) ctx.playSfx('whoosh');
  if (ctx.logSpecial) ctx.logSpecial(f.id, dir > 0 ? 'dash_forward' : 'dash_back', 'use');
  if (!f.isCpu && ctx.logInputAction) ctx.logInputAction(f.id, dir > 0 ? 'dash_forward' : 'dash_back');
  return true;
}

function flyRocket(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.rocket;
  s.t += dt;
  const wrist = wristOf(f);
  const wp = new THREE.Vector3();
  if (wrist) wrist.getWorldPosition(wp);
  else wp.copy(f.root.position).add(new THREE.Vector3(0, 1.15 * SIZE, 0));

  if (s.phase === 'wind') {
    if (s.t >= spec.wind) {
      s.phase = 'fly';
      s.t = 0;
      hideHand(f, true);
      s.fist.visible = true;
      s.origin = wp.clone();
      const to = ctx.toward(f, other, new THREE.Vector3());
      const gap = f.root.position.distanceTo(other.root.position);
      const travel = Math.min(spec.range, Math.max(0.8 * SIZE, gap + 0.35 * SIZE));
      s.target = s.origin.clone().addScaledVector(to, travel);
      s.target.y = wp.y;
    }
    return;
  }

  const dur = s.phase === 'fly' ? spec.fly : spec.ret;
  const u = Math.min(1, s.t / dur);
  const ease = s.phase === 'ret' ? (1 - Math.pow(1 - u, 2)) : (1 - Math.pow(1 - u, 1.6));
  if (s.phase === 'fly') s.fist.position.lerpVectors(s.origin, s.target, ease);
  else {
    if (wrist) wrist.getWorldPosition(wp);
    s.fist.position.lerpVectors(s.from || s.fist.position, wp, ease);
  }
  const look = s.phase === 'fly' ? s.target : wp;
  s.fist.lookAt(look);
  pushTrail(s.trail, s.fist.position, ctx.scene);
  fadeTrail(s.trail, dt);

  if (s.phase === 'fly' && !s.hit) {
    const chest = other.root.position.clone();
    chest.y += 1.15 * SIZE;
    if (s.fist.position.distanceTo(chest) < (spec.radius + 0.42 * SIZE) || s.fist.position.distanceTo(other.root.position) < 0.7 * SIZE) {
      s.hit = true;
      const dir = ctx.toward(f, other, new THREE.Vector3());
      if (ctx.dealRocketHit) ctx.dealRocketHit(f, other, s.fist.position.clone(), dir);
      if (ctx.logSpecial) ctx.logSpecial(f.id, 'rocket_punch', other.blocking ? 'block' : 'land');
    }
  }

  if (u >= 1) {
    if (s.phase === 'fly') {
      s.phase = 'ret';
      s.t = 0;
      s.from = s.fist.position.clone();
      if (!s.hit && ctx.logSpecial) ctx.logSpecial(f.id, 'rocket_punch', 'miss');
    } else {
      hideHand(f, false);
      if (s.fist.parent) s.fist.parent.remove(s.fist);
      disposeTrail(s.trail);
      f.special = null;
      f.specialKind = null;
      if (ctx.endAttack) ctx.endAttack(f, 0.14);
      else { f.state = 'idle'; f.cooldown = 0.18; }
    }
  }
}

function flyDash(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.dash;
  s.t += dt;
  const u = Math.min(1, s.t / spec.time);
  const step = spec.dist * (dt / spec.time) * (1.15 - u * 0.3);
  const nx = f.root.position.x + s.axis.x * step;
  const nz = f.root.position.z + s.axis.z * step;
  const pos = new THREE.Vector3(nx, f.root.position.y, nz);
  if (ctx.placeInOctagon) ctx.placeInOctagon(pos, CAGE_PAD);
  f.root.position.x = pos.x;
  f.root.position.z = pos.z;
  if (f.phys && f.phys.body) {
    f.phys.body.position.x = pos.x;
    f.phys.body.position.z = pos.z;
    f.phys.body.velocity.x = s.axis.x * (spec.dist / spec.time) * (1 - u);
    f.phys.body.velocity.z = s.axis.z * (spec.dist / spec.time) * (1 - u);
  }
  // Thruster jets just behind the hips, flaring opposite the dash.
  const back = s.axis.clone().multiplyScalar(-0.28 * SIZE);
  const base = f.root.position.clone();
  base.y += 0.72 * SIZE;
  if (s.jets[0]) { s.jets[0].position.copy(base).add(back).add(new THREE.Vector3(-0.12 * SIZE, 0, 0)); s.jets[0].lookAt(base); s.jets[0].material.opacity = 0.4 + 0.5 * Math.sin(s.t * 40); }
  if (s.jets[1]) { s.jets[1].position.copy(base).add(back).add(new THREE.Vector3(0.12 * SIZE, 0, 0)); s.jets[1].lookAt(base); s.jets[1].material.opacity = 0.4 + 0.5 * Math.sin(s.t * 40 + 1); }
  if (u >= 1) {
    if (s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); if (j.geometry) j.geometry.dispose(); if (j.material) j.material.dispose(); }
    f.special = null;
    f.specialKind = null;
    f.state = 'idle';
    f.cooldown = 0.12;
    if (ctx.setAnim && ctx.idleClipFor) ctx.setAnim(f, ctx.idleClipFor(f), 0.12);
  }
}

export function stepSpecial(f, other, dt) {
  if (!f) return;
  stepEnergy(f, dt);
  if (!f.special) return;
  if (f.special.kind === 'rocket') flyRocket(f, other, dt);
  else if (f.special.kind === 'dash') flyDash(f, other, dt);
}

export function syncEnergyHud(p1, p2) {
  for (const [f, id] of [[p1, 'en1'], [p2, 'en2']]) {
    const el = document.getElementById(id);
    if (!el || !f) continue;
    const max = SPECIAL.energyMax;
    const v = Math.max(0, Math.min(1, (f.energy == null ? max : f.energy) / max));
    el.style.transform = `scaleX(${v})`;
    el.parentElement && el.parentElement.classList.toggle('empty', v < 0.02);
  }
}

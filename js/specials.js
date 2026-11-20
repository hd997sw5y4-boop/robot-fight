/* Rocket punch and thruster dash: shared energy, Mixamo clips plus VFX. */
import * as THREE from 'three';
import { SIZE, MODEL, SPECIAL } from './config.js';

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
  // A special still in flight (a rocket fist returning after the punch clip already ended) is
  // busy too: starting another one used to overwrite it and strand its fist and trail mid-air.
  const busy = !f || !f.state || !!f.special || f.state === 'ko' || f.state === 'down' || f.state === 'getup' || f.state === 'hit'
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
  for (const m of trail.pts) { if (m.parent) m.parent.remove(m); m.visible = false; }
  trail.geo.dispose();
  trail.mat.dispose();
}

function disposeFist(fist) {
  if (!fist) return;
  if (fist.parent) fist.parent.remove(fist);
  fist.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
}

function jetSprite(color) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(0.07 * SIZE, 0.28 * SIZE, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
  );
  m.rotation.x = Math.PI / 2;
  return m;
}

// One of each special-effect object, for the shader pre-warm (disposed by the caller).
export function specialWarmObjects() {
  const trail = makeTrail(0xffa040, true);
  return [jetSprite(0x66d8ff), fistMesh(), trail.pts[0]];
}

export function clearSpecial(f) {
  if (!f || !f.special) {
    if (f) f.specialKind = null;
    return;
  }
  const s = f.special;
  disposeFist(s.fist);
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
  clearSpecial(f);
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
  clearSpecial(f);
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
  s.life = (s.life || 0) + dt;
  // Knocked out of the wind-up (hit, knocked down, KO, round over): the fist never launches.
  // In flight it always finishes and comes home; a hard lifetime cleans up whatever happens.
  const owner = f.state === 'punch' || f.state === 'idle' || f.state === 'block';
  if ((s.phase === 'wind' && !owner) || s.life > spec.wind + spec.fly + spec.ret + 0.8) { clearSpecial(f); return; }
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
      clearSpecial(f);
      // Only a robot still in its punch goes back to the guard (not one hit or downed meanwhile).
      if (f.state === 'punch') {
        if (ctx.endAttack) ctx.endAttack(f, 0.14);
        else { f.state = 'idle'; f.cooldown = 0.18; }
      }
    }
  }
}

// Thruster dash: a smooth burst through the physics body (velocity, never position), so the
// cage and the other robot stop it like any step. Speed follows a bell (eases in and out) whose
// area is exactly spec.dist; the old version moved the root AND set the body velocity, so it
// travelled about twice per frame (12-16 m/s spikes) and then got clamped back: a visible jump.
function dashSpeed(spec, u) {
  return (spec.dist / spec.time) * 6 * u * (1 - u); // integral over the dash = spec.dist
}

function endDash(f, toIdle) {
  const s = f.special;
  if (s && s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); if (j.geometry) j.geometry.dispose(); if (j.material) j.material.dispose(); }
  f.special = null;
  f.specialKind = null;
  if (f.phys && f.phys.body) { f.phys.body.velocity.x = 0; f.phys.body.velocity.z = 0; }
  if (!toIdle) return;
  f.state = 'idle';
  f.cooldown = 0.12;
  if (ctx.setAnim && ctx.idleClipFor) ctx.setAnim(f, ctx.idleClipFor(f), 0.16);
}

function flyDash(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.dash;
  // Hit, knocked down or KO'd mid-dash: the reaction owns the body from here.
  if (f.state !== 'dash') { endDash(f, false); return; }
  s.t += dt;
  const u = Math.min(1, s.t / spec.time);
  // Sample the bell half a frame ahead: the velocity set now is integrated on the next step.
  const v = dashSpeed(spec, Math.min(1, (s.t + dt * 0.5) / spec.time));
  if (ctx.setFighterMove) ctx.setFighterMove(f, s.axis.x * v, s.axis.z * v);
  else if (f.phys && f.phys.body) { f.phys.body.velocity.x = s.axis.x * v; f.phys.body.velocity.z = s.axis.z * v; }
  // Thruster jets just behind the hips, flaring opposite the dash, fading with the burst.
  const flare = Math.sin(Math.PI * u);
  const back = _jetBack.copy(s.axis).multiplyScalar(-0.28 * SIZE);
  const base = _jetBase.copy(f.root.position);
  base.y += 0.72 * SIZE;
  for (let i = 0; i < 2; i++) {
    const j = s.jets[i];
    if (!j) continue;
    j.position.copy(base).add(back);
    j.position.x += (i ? 0.12 : -0.12) * SIZE;
    j.lookAt(base);
    j.material.opacity = (0.35 + 0.45 * Math.sin(s.t * 40 + i)) * (0.3 + 0.7 * flare);
  }
  if (u >= 1) endDash(f, true);
}
const _jetBack = new THREE.Vector3();
const _jetBase = new THREE.Vector3();

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

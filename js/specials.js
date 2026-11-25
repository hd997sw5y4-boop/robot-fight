/* Robot moves on one shared energy bar: thruster dash, shoulder charge, ground slam and the
   overheat super. Mixamo clips plus procedural poses and VFX. */
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
  // A special still running is busy too: starting another one would overwrite it.
  const busy = !f || !f.state || !!f.special || f.state === 'ko' || f.state === 'down' || f.state === 'getup' || f.state === 'hit'
    || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash';
  const arm = ctx && ctx.canPunch ? ctx.canPunch(f) : true;
  const legs = !(f && f.parts && (f.parts.legL.detached || f.parts.legR.detached));
  return {
    energy: +energy.toFixed(1),
    energyMax: SPECIAL.energyMax,
    dash_forward: !busy && energy >= SPECIAL.dashCost,
    dash_back: !busy && energy >= SPECIAL.dashCost,
    shoulder_charge: !busy && energy >= SPECIAL.chargeCost,
    ground_slam: !busy && arm && legs && energy >= SPECIAL.slamCost,
    overheat: !busy && energy >= SPECIAL.overheatCost - 0.01,
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
  return [jetSprite(0x66d8ff), shockRing(0xbfe8ff)];
}

export function clearSpecial(f) {
  if (!f || !f.special) {
    if (f) f.specialKind = null;
    return;
  }
  const s = f.special;
  if (s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); j.visible = false; }
  if (s.kind === 'charge' || s.kind === 'slam' || s.kind === 'overheat') resetMovePose(f);
  f.special = null;
  f.specialKind = null;
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
  // Each robot keeps its pair of jets (no per-dash material, so no shader compile per dash).
  const jets = f._jets || (f._jets = [jetSprite(0x66d8ff), jetSprite(0xff9a3a)]);
  for (const j of jets) { j.visible = true; ctx.scene.add(j); }
  f.special = { kind: 'dash', t: 0, dir, axis: v.clone(), jets, clip };
  f.invuln = Math.max(f.invuln || 0, SPECIAL.dash.invuln);
  if (ctx.playSfx) ctx.playSfx('whoosh');
  if (ctx.logSpecial) ctx.logSpecial(f.id, dir > 0 ? 'dash_forward' : 'dash_back', 'use');
  if (!f.isCpu && ctx.logInputAction) ctx.logInputAction(f.id, dir > 0 ? 'dash_forward' : 'dash_back');
  return true;
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
  if (s && s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); j.visible = false; }
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
  placeJets(f, s, Math.sin(Math.PI * u));
  if (u >= 1) endDash(f, true);
}
// Thruster jets just behind the hips, flaring opposite the travel, fading with the burst.
function placeJets(f, s, flare) {
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
}
const _jetBack = new THREE.Vector3();
const _jetBase = new THREE.Vector3();

export function stepSpecial(f, other, dt) {
  if (!f) return;
  stepEnergy(f, dt);
  stepRing(f, dt);
  if (!f.special) return;
  const k = f.special.kind;
  if (k === 'dash') flyDash(f, other, dt);
  else if (k === 'charge') flyCharge(f, other, dt);
  else if (k === 'slam') flySlam(f, other, dt);
  else if (k === 'overheat') flyOverheat(f, other, dt);
}

/* ---------- shoulder charge / ground slam / overheat ---------- */
const smooth = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };

// Flat shockwave ring on the mat (one per robot, reused: no per-use material or shader).
function shockRing(color) {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 48, 1),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 8;
  return m;
}
function startRing(f, color, radius, life, y) {
  const r = f._ring || (f._ring = shockRing(color));
  r.material.color.setHex(color);
  r.position.set(f.root.position.x, y, f.root.position.z);
  r.userData = { t: 0, life, radius };
  r.scale.setScalar(0.2 * SIZE);
  r.visible = true;
  if (r.parent !== ctx.scene) ctx.scene.add(r);
}
function stepRing(f, dt) {
  const r = f._ring;
  if (!r || !r.visible) return;
  const u = r.userData;
  u.t += dt;
  const k = Math.min(1, u.t / u.life);
  r.scale.setScalar(Math.max(0.2 * SIZE, u.radius * (1 - Math.pow(1 - k, 2.2))));
  r.material.opacity = 0.85 * (1 - k * k);
  if (k >= 1) { r.visible = false; if (r.parent) r.parent.remove(r); }
}
export function clearRing(f) {
  if (f && f._ring) { f._ring.visible = false; if (f._ring.parent) f._ring.parent.remove(f._ring); }
}

function resetMovePose(f) {
  f.specialBow = 0;
  f.specialLift = 0;
  if (ctx.endAir) ctx.endAir(f);
  if (f.phys && f.phys.body) { f.phys.body.velocity.x = 0; f.phys.body.velocity.z = 0; }
}
function startMove(f, kind, cost, clip, fade) {
  clearSpecial(f);
  spendEnergy(f, cost);
  f.specialKind = kind;
  f.state = 'dash';
  f.stateT = 0;
  f.blocking = false;
  f.hitThisAttack = false;
  f.attackClip = kind; // for the fight log
  if (f.shield) f.shield.visible = false;
  const c = clip.find((n) => f.actions && f.actions[n]);
  if (c) ctx.setAnim(f, c, fade);
  if (!f.isCpu && ctx.logInputAction) ctx.logInputAction(f.id, LOG_NAME[kind]);
  if (ctx.logSpecial) ctx.logSpecial(f.id, LOG_NAME[kind], 'use');
}
const LOG_NAME = { charge: 'shoulder_charge', slam: 'ground_slam', overheat: 'overheat' };
function endMove(f, cooldown) {
  const s = f.special;
  if (s && s.jets) for (const j of s.jets) { if (j.parent) j.parent.remove(j); j.visible = false; }
  resetMovePose(f);
  f.special = null;
  f.specialKind = null;
  if (f.state !== 'dash') return; // hit / knocked down / KO: the reaction owns the robot
  f.state = 'idle';
  f.cooldown = Math.max(f.cooldown || 0, cooldown);
  ctx.setAnim(f, ctx.idleClipFor(f), 0.22);
}
function canTake(def) {
  return def && !(def.state === 'ko' || def.state === 'down' || def.state === 'getup' || def.state === 'dodge' || def.invuln > 0);
}
function blocked(f, other, name) {
  if (!ctx || !f || !other) return true;
  if (ctx.inBell && ctx.inBell()) { if (ctx.logBellBlock) ctx.logBellBlock(f.id, name); return true; }
  return !specialAvail(f)[name];
}

// Shoulder charge: shoulder down (BodyBlock) and the thrusters on; a bell-shaped rush that hits
// on reaching the body, then a short recoil. A miss leaves a longer recovery.
export function tryCharge(f, other) {
  if (blocked(f, other, 'shoulder_charge')) return false;
  startMove(f, 'charge', SPECIAL.chargeCost, ['BodyBlock', 'CenterBlock'], 0.1);
  const jets = f._jets || (f._jets = [jetSprite(0x66d8ff), jetSprite(0xff9a3a)]);
  for (const j of jets) { j.visible = true; ctx.scene.add(j); }
  f.special = { kind: 'charge', t: 0, axis: ctx.toward(f, other, new THREE.Vector3()), jets, hit: false, hitT: 0 };
  if (ctx.playSfx) ctx.playSfx('whoosh', { rate: 0.8, vol: 0.7 });
  return true;
}
function flyCharge(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.charge;
  if (f.state !== 'dash') { endMove(f, 0); return; }
  s.t += dt;
  if (!s.hit) {
    const u = Math.min(1, s.t / spec.time);
    const v = (spec.dist / spec.time) * 6 * Math.min(1, (s.t + dt * 0.5) / spec.time) * (1 - Math.min(1, (s.t + dt * 0.5) / spec.time));
    // Keep steering at the opponent a little (they may sidestep), but it's committed.
    const to = ctx.toward(f, other, _chTo);
    s.axis.lerp(to, Math.min(1, dt * 3)).normalize();
    ctx.setFighterMove(f, s.axis.x * v, s.axis.z * v);
    f.specialBow = 0.34 * smooth(s.t / 0.1);
    placeJets(f, s, Math.sin(Math.PI * u));
    const gap = f.root.position.distanceTo(other.root.position);
    if (gap <= spec.hitGap && canTake(other)) {
      s.hit = true;
      s.hitT = s.t;
      const p = _chP.copy(f.root.position).lerp(other.root.position, 0.5);
      p.y += 1.05 * SIZE;
      const landed = ctx.dealSpecialHit(f, other, spec, p, s.axis.clone());
      if (ctx.logSpecial) ctx.logSpecial(f.id, 'shoulder_charge', landed ? (other.blocking ? 'block' : 'land') : 'miss');
    }
    if (u >= 1) {
      if (ctx.logSpecial && !s.hit) ctx.logSpecial(f.id, 'shoulder_charge', 'miss');
      endMove(f, spec.recover * 1.4);
    }
    return;
  }
  // Recoil off the body: stop, straighten up over ~0.2 s.
  ctx.setFighterMove(f, 0, 0);
  for (const j of s.jets) j.visible = false;
  f.specialBow = 0.34 * (1 - smooth((s.t - s.hitT) / 0.2));
  if (s.t - s.hitT > 0.22) endMove(f, spec.recover);
}
const _chTo = new THREE.Vector3();
const _chP = new THREE.Vector3();

// Ground slam: hop with the arms up, drive both arms down into the mat (Punching with a deep
// forward bow), and a shockwave ring runs out along the floor. Robots on their feet inside the
// ring take it (a guard soaks most of it); a robot in the air or already down doesn't.
export function trySlam(f, other) {
  if (blocked(f, other, 'ground_slam')) return false;
  startMove(f, 'slam', SPECIAL.slamCost, ['CenterBlock', 'BodyBlock'], 0.12);
  ctx.setFighterMove(f, 0, 0);
  f.airLock = 0; // airborne pose: the root stays on the mat, feet IK off
  f.special = { kind: 'slam', t: 0, phase: 'up', hit: false };
  if (ctx.playSfx) ctx.playSfx('whoosh', { rate: 0.7, vol: 0.6 });
  return true;
}
function flySlam(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.slam;
  if (f.state !== 'dash') { endMove(f, 0); return; }
  ctx.setFighterMove(f, 0, 0);
  s.t += dt;
  const air = spec.up + spec.down;
  if (s.phase === 'up' || s.phase === 'down') {
    f.specialLift = spec.hop * Math.sin(Math.PI * Math.min(1, s.t / air));
    if (s.phase === 'up') {
      f.specialBow = -0.18 * smooth(s.t / spec.up);
      if (s.t >= spec.up) {
        s.phase = 'down';
        const clip = f.actions.Punching ? 'Punching' : null;
        if (clip) {
          const act = ctx.setAnim(f, clip, 0.08);
          const st = ctx.strikeStart && ctx.strikeStart(clip);
          if (act && st != null) { act.time = st; act.timeScale = 1.4; }
        }
      }
    } else {
      f.specialBow = -0.18 + 1.08 * smooth((s.t - spec.up) / spec.down);
    }
    if (s.t >= air) {
      s.phase = 'rec';
      s.recT = 0;
      f.specialLift = 0;
      if (ctx.endAir) ctx.endAir(f);
      startRing(f, 0xbfe8ff, spec.radius, 0.45, (ctx.matTop || 0) + 0.025);
      if (ctx.addShake) ctx.addShake(0.2, 0.22);
      if (ctx.playSfx) ctx.playSfx('clank', { vol: 1, rate: 0.55 });
      if (ctx.heatLight) ctx.heatLight(f.root.position, 0xbfe8ff, 18, 0.2 * SIZE);
      const gap = f.root.position.distanceTo(other.root.position);
      const grounded = other.airLock == null && !other.specialLift;
      let landed = false;
      if (gap <= spec.radius && grounded && canTake(other)) {
        const p = _chP.copy(other.root.position);
        p.y += 0.35 * SIZE;
        landed = ctx.dealSpecialHit(f, other, spec, p, ctx.toward(f, other, new THREE.Vector3()));
      }
      if (ctx.logSpecial) ctx.logSpecial(f.id, 'ground_slam', landed ? (other.blocking ? 'block' : 'land') : 'miss');
    }
    return;
  }
  s.recT += dt;
  f.specialBow = 0.9 * (1 - smooth(s.recT / spec.recover));
  if (s.recT >= spec.recover) endMove(f, 0.25);
}

// Overheat super (full bar): hunch and vent heat (a red glow builds on the chest), then throw the
// chest open: a heat shockwave all around knocks down a robot on its feet inside it. The bar then
// stays empty while the robot cools (SPECIAL.overheat.cooldown).
export function tryOverheat(f, other) {
  if (blocked(f, other, 'overheat')) return false;
  startMove(f, 'overheat', SPECIAL.overheatCost, ['CenterBlock', 'BodyBlock'], 0.14);
  ctx.setFighterMove(f, 0, 0);
  f.energyDelay = SPECIAL.overheat.cooldown + SPECIAL.overheat.charge;
  f.special = { kind: 'overheat', t: 0, phase: 'charge', hit: false };
  if (ctx.playSfx) ctx.playSfx('servo', { vol: 0.8, rate: 0.5 });
  return true;
}
function flyOverheat(f, other, dt) {
  const s = f.special;
  const spec = SPECIAL.overheat;
  if (f.state !== 'dash') { endMove(f, 0); return; }
  ctx.setFighterMove(f, 0, 0);
  s.t += dt;
  const chest = _chP.copy(f.root.position);
  chest.y += 1.15 * SIZE;
  if (s.phase === 'charge') {
    const k = smooth(s.t / spec.charge);
    f.specialBow = 0.3 * k;
    if (ctx.heatLight) ctx.heatLight(chest, 0xff3a22, 4 + 14 * k * (0.75 + 0.25 * Math.sin(s.t * 38)), 0);
    if (s.t >= spec.charge) {
      s.phase = 'burst';
      s.bT = 0;
      startRing(f, 0xff6048, spec.radius, 0.5, (ctx.matTop || 0) + 0.03);
      if (ctx.addShake) ctx.addShake(0.26, 0.26);
      if (ctx.playSfx) ctx.playSfx('clank', { vol: 1, rate: 0.45 });
      if (ctx.heatLight) ctx.heatLight(chest, 0xff5a3a, 30, 0);
      const gap = f.root.position.distanceTo(other.root.position);
      let landed = false;
      if (gap <= spec.radius && canTake(other)) {
        const p = _ohP.copy(other.root.position);
        p.y += 1.1 * SIZE;
        landed = ctx.dealSpecialHit(f, other, spec, p, ctx.toward(f, other, new THREE.Vector3()));
      }
      if (ctx.logSpecial) ctx.logSpecial(f.id, 'overheat', landed ? (other.blocking ? 'block' : 'land') : 'miss');
    }
    return;
  }
  s.bT += dt;
  // Chest thrown open (back bow), then settle into the guard.
  const u = s.bT / spec.recover;
  f.specialBow = u < 0.25 ? 0.3 - 0.7 * smooth(u / 0.25) : -0.4 * (1 - smooth((u - 0.25) / 0.75));
  if (s.bT >= spec.recover) endMove(f, 0.3);
}
const _ohP = new THREE.Vector3();

export function syncEnergyHud(p1, p2) {
  for (const [f, id] of [[p1, 'en1'], [p2, 'en2']]) {
    const el = document.getElementById(id);
    if (!el || !f) continue;
    const max = SPECIAL.energyMax;
    const v = Math.max(0, Math.min(1, (f.energy == null ? max : f.energy) / max));
    const q = Math.round(v * 1000) / 1000;
    if (el._rfV === q) continue; // unchanged: skip the style write this frame
    el._rfV = q;
    el.style.transform = `scaleX(${q})`;
    el.parentElement && el.parentElement.classList.toggle('empty', v < 0.02);
  }
}

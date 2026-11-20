import { playSfx } from './audio.js';
import { announce } from './announcer.js';
import { spawnDebris, clearPhysicsDebris, freezeDebris, dropDebris, getPhysicsDebris, debrisCaps, PART_MASS, stepPhysics } from './physics.js';
import * as THREE from 'three';
import { DAMAGE, ARENA, SIZE } from './config.js';
import { getDamageLevel } from './settings.js';
import { IS_MOBILE } from './mobile.js';
import { addWires, clearWires, stepWires } from './wires.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _box = new THREE.Box3();
const _color = new THREE.Color();

const debrisList = [];
const sparks = [];
const smokes = [];

const SPARK_GEO = new THREE.BoxGeometry(0.03, 0.03, 0.1);

// Settings → Damage scales the existing dent / detach / debris system. Low is today's
// behavior or a touch lighter; Medium dents and bends more and sheds the odd plate; Max
// is heavy wear, frequent plates, earlier breaks, and pieces that fly farther.
const DAMAGE_FX = {
  low:    { dent: 0.9, dentMax: 1.00, bend: 0.9, dmg: 1.00, subDmg: 1.00, plateForce: 5.2, plateDmg: 12, plateChance: 0.28, guardPlate: 0,    chipMul: 0.85, heavyForce: 5.2, headGrace: 0.50, legGate: 0.20, legFinal: 0.50, midLeg: 0,    impulse: 1.00, skinMax: 10 },
  medium: { dent: 1.45, dentMax: 1.18, bend: 1.4, dmg: 1.18, subDmg: 1.25, plateForce: 3.1, plateDmg:  7, plateChance: 0.55, guardPlate: 0.16, chipMul: 1.15, heavyForce: 3.1, headGrace: 0.38, legGate: 0.30, legFinal: 0.70, midLeg: 0.18, impulse: 1.18, skinMax: 14 },
  max:    { dent: 2.45, dentMax: 1.65, bend: 2.50, dmg: 1.90, subDmg: 2.15, plateForce: 1.4, plateDmg:  3, plateChance: 0.95, guardPlate: 0.62, chipMul: 1.7, heavyForce: 1.4, headGrace: 0.08, legGate: 0.55, legFinal: 0.95, midLeg: 0.82, impulse: 2.20, skinMax: 16 },
};
export function damageFx() {
  return DAMAGE_FX[getDamageLevel()] || DAMAGE_FX.medium;
}

const SMOKE_GEO = new THREE.SphereGeometry(0.07, 6, 5);
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffe189, toneMapped: false });
const sparkMatHot = new THREE.MeshBasicMaterial({ color: 0xfff6de, toneMapped: false });

function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^mixamorig:?/, '')
    .replace(/[._\s\-:]/g, '');
}

function nameMatches(name, aliases) {
  const n = normName(name);
  if (!n || DAMAGE.skip.includes(n)) return false;
  return aliases.some((a) => n === a || n.startsWith(a) || a.startsWith(n));
}

function classifyName(name) {
  const n = normName(name);
  if (!n || DAMAGE.skip.includes(n)) return null;
  for (const id of DAMAGE.order) {
    if (id === 'torso') continue;
    if (nameMatches(name, DAMAGE.bind[id])) return id;
  }
  if (nameMatches(name, DAMAGE.bind.torso)) return 'torso';
  return null;
}

function classifyObject(obj) {
  let o = obj;
  for (let i = 0; i < 5 && o; i++, o = o.parent) {
    const id = classifyName(o.name);
    if (id) return id;
  }
  return null;
}

function ensureDeformable(mesh) {
  if (mesh.userData.deformReady) return;
  mesh.geometry = mesh.geometry.clone();
  // The packed GLB stores some vertex data interleaved; dents need plain, writable arrays.
  for (const [name, attr] of Object.entries(mesh.geometry.attributes)) {
    if (attr.isInterleavedBufferAttribute) mesh.geometry.setAttribute(name, attr.clone());
  }
  const pos = mesh.geometry.attributes.position;
  if (!mesh.geometry.attributes.color) {
    const colors = new Float32Array(pos.count * 3);
    colors.fill(1);
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  for (const m of [].concat(mesh.material)) {
    if (!m) continue;
    m.vertexColors = true;
    m.needsUpdate = true;
  }
  mesh.userData.restPos = new Float32Array(pos.array);
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  if (si && sw) {
    mesh.userData.restSkinIndex = si.array.slice();
    mesh.userData.restSkinWeight = sw.array.slice();
  }
  mesh.userData.restColor = new Float32Array(mesh.geometry.attributes.color.array);
  mesh.userData.home = {
    parent: mesh.parent,
    pos: mesh.position.clone(),
    quat: mesh.quaternion.clone(),
    scale: mesh.scale.clone(),
  };
  pos.setUsage(THREE.DynamicDrawUsage);
  mesh.geometry.attributes.color.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.deformReady = true;
}

function dominantBoneIndex(skinIndex, skinWeight, i) {
  let best = 0;
  let bestW = -1;
  for (let k = 0; k < 4; k++) {
    const w = skinWeight.getComponent(i, k);
    if (w > bestW) {
      bestW = w;
      best = skinIndex.getComponent(i, k);
    }
  }
  return best;
}

function tagSkinnedVertices(mesh, boneToPart) {
  const skinIndex = mesh.geometry.attributes.skinIndex;
  const skinWeight = mesh.geometry.attributes.skinWeight;
  if (!skinIndex || !skinWeight || !mesh.skeleton) return;
  const parts = new Uint8Array(skinIndex.count);
  const used = new Set();
  for (let i = 0; i < skinIndex.count; i++) {
    const boneIdx = dominantBoneIndex(skinIndex, skinWeight, i);
    const bone = mesh.skeleton.bones[boneIdx];
    const id = bone ? boneToPart.get(bone) || classifyObject(bone) : null;
    const code = id ? DAMAGE.order.indexOf(id) + 1 : 0;
    parts[i] = code;
    if (id) used.add(id);
  }
  mesh.userData.vertPart = parts;
  mesh.userData.vertPartsUsed = used;
}

export function prepareFighterDamage(f) {
  const model = f.model;
  model.updateWorldMatrix(true, true);

  const parts = {};
  for (const id of DAMAGE.order) {
    const spec = DAMAGE.parts[id];
    const hp = Math.round(spec.hp * ((f.stat && f.stat.toughness) || 1)); // stat profile: part toughness
    parts[id] = {
      id,
      max: hp,
      hp,
      canDetach: !!spec.detach,
      detached: false,
      bones: [],
      meshes: [],
      skinned: [],
      smokeAcc: 0,
      wear: 0,
      stump: null,
    };
  }

  const boneToPart = new Map();
  model.traverse((o) => {
    if (!o.name) return;
    if (o.isBone || o.type === 'Bone') {
      const id = classifyObject(o);
      if (id && parts[id]) {
        parts[id].bones.push(o);
        boneToPart.set(o, id);
        if (!o.userData.homeScale) o.userData.homeScale = o.scale.clone();
      }
    }
  });

  model.traverse((o) => {
    if (!o.isMesh) return;
    ensureDeformable(o);
    const id = classifyObject(o);
    if (!id || !parts[id]) return;
    if (o.isSkinnedMesh) parts[id].skinned.push(o);
    else parts[id].meshes.push(o);
  });

  // Shared skinned meshes (typical Mixamo body): register on every part they use.
  model.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    tagSkinnedVertices(o, boneToPart);
    const used = o.userData.vertPartsUsed;
    if (!used || !used.size) return;
    for (const id of used) {
      if (parts[id] && !parts[id].skinned.includes(o)) parts[id].skinned.push(o);
    }
  });

  f.parts = parts;
  f.skinMeshes = [];
  model.traverse((o) => { if (o.isSkinnedMesh) f.skinMeshes.push(o); });
  f.limpT = 0;
  f.headFlick = 0;
  prepareSubParts(f);
}

/* ---------- sub-parts: hands, finger groups, feet, toes ---------- */

function subLimb(id) {
  let cur = id;
  for (let i = 0; i < 4 && DAMAGE.sub[cur]; i++) cur = DAMAGE.sub[cur].parent;
  return cur;
}

function subIsWithin(id, ancestor) {
  for (let cur = id, i = 0; cur && i < 5; i++) {
    if (cur === ancestor) return true;
    cur = DAMAGE.sub[cur] && DAMAGE.sub[cur].parent;
  }
  return false;
}

function prepareSubParts(f) {
  const subs = {};
  const boneSub = new Map();
  for (const id of DAMAGE.subOrder) {
    const spec = DAMAGE.sub[id];
    const shp = Math.round(spec.hp * ((f.stat && f.stat.toughness) || 1));
    const sub = { id, parent: spec.parent, limb: subLimb(id), max: shp, hp: shp, detached: false, rootBones: [], stump: null, oilAcc: 0, sparkAcc: 0, lostT: 0 };
    f.model.traverse((o) => {
      if ((o.isBone || o.type === 'Bone') && spec.root.includes(normName(o.name))) sub.rootBones.push(o);
    });
    // Parents come first in subOrder, so deeper sub-parts overwrite their bones.
    for (const rb of sub.rootBones) rb.traverse((o) => { if (o.isBone || o.type === 'Bone') boneSub.set(normName(o.name), id); });
    subs[id] = sub;
  }
  f.subs = subs;
  // Per-vertex deepest sub-part code (index in subOrder + 1) on the limb meshes.
  f.model.traverse((m) => {
    if (!m.isSkinnedMesh || !m.skeleton) return;
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) return;
    // By bone name, so a mesh bound to a duplicate of the bone is tagged too.
    const codeOf = m.skeleton.bones.map((b) => { const id = boneSub.get(normName(b.name)); return id ? DAMAGE.subOrder.indexOf(id) + 1 : 0; });
    if (!codeOf.some(Boolean)) return;
    const arr = new Uint8Array(si.count);
    for (let i = 0; i < si.count; i++) arr[i] = codeOf[dominantBoneIndex(si, sw, i)] || 0;
    m.userData.vertSub = arr;
  });
}

function subWorldPos(sub, out) {
  const b = sub.rootBones[0];
  if (b) b.getWorldPosition(out);
  return out;
}

function detachSub(f, sub, dir, scene) {
  if (!sub || sub.detached) return;
  const limb = f.parts[sub.limb];
  for (const id of DAMAGE.subOrder) if (subIsWithin(id, sub.id)) {
    const s = f.subs[id];
    if (s.detached) continue;
    s.detached = true;
    s.lostT = 0;
  }
  if (!limb || limb.detached) return;
  f.model.updateWorldMatrix(true, true);
  const pieces = [];
  const codes = new Set();
  for (const id of DAMAGE.subOrder) if (subIsWithin(id, sub.id)) codes.add(DAMAGE.subOrder.indexOf(id) + 1);
  for (const mesh of f.skinMeshes || limb.skinned) {
    const vs = mesh.userData.vertSub;
    if (!vs || mesh.userData.hiddenPart) continue;
    const hidden = mesh.userData.hiddenVerts;
    const lost = (i) => codes.has(vs[i]) && !(hidden && hidden[i]);
    let any = false;
    for (let i = 0; i < vs.length && !any; i++) if (lost(i)) any = true;
    if (!any) continue;
    const baked = bakeSkinnedWorld(mesh, lost);
    if (baked) pieces.push(baked);
    hideVertices(mesh, lost);
  }
  // Fold the sub-part's bones away too, after moving any weight the kept skin still had on
  // them onto the bones that stay (otherwise wrist/forearm skin stretches after them).
  const lostBones = new Set();
  for (const rb of sub.rootBones) rb.traverse((o) => { if (o.isBone || o.type === 'Bone') lostBones.add(o); });
  releaseBones(f, lostBones);
  for (const b of sub.rootBones) b.scale.set(0.001, 0.001, 0.001);
  sub.stump = sub.rootBones[0] || null;
  const at = subWorldPos(sub, new THREE.Vector3());
  const d = dir ? dir.clone().normalize() : new THREE.Vector3(0, 0, 1);
  const pivot = attachPivot(pieces, scene);
  if (pivot) {
    const rec = spawnDebris({
      mesh: pivot,
      mass: sub.id.startsWith('hand') || sub.id.startsWith('foot') ? 1.4 : 0.8,
      velocity: new THREE.Vector3(d.x * 2.2 + (Math.random() - 0.5) * 1.6, 1.8 + Math.random() * 1.4, d.z * 2.2 + (Math.random() - 0.5) * 1.6),
      angularVelocity: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
      ownerId: f.id,
    });
    debrisList.push({ obj: pivot, phys: rec, owner: f.id, settled: false });
  }
  playSfx('tear');
  // [announcer hook] whole hands/feet only (skip fingers and toes).
  if (sub.id.startsWith('hand') || sub.id.startsWith('foot')) announce('tear', { part: sub.id, delay: 0.2 });
  emitSparks(at, d, 12);
  if ((sub.id.startsWith('hand') || sub.id.startsWith('foot')) && sub.stump) {
    addWires(sub.stump, scene, { onSpark: (p) => emitSparks(p, _v.set(0, -1, 0), 4) });
    if (pivot) addWires(pivot, scene, { piece: true });
  }
  sprayOil(at, d, sub.id.startsWith('hand') || sub.id.startsWith('foot') ? 18 : 9);
}

// Dev/test hook: break a sub-part off directly.
export function debugBreakSub(f, id, scene) {
  const dir = new THREE.Vector3(0.3, 0, 1);
  if (f.subs && f.subs[id]) detachSub(f, f.subs[id], dir, scene);
  else if (f.parts && f.parts[id]) detachPart(f, Object.assign(f.parts[id], { hp: 0 }), dir, scene);
}

export function oilStats() {
  return { drops: oilDrops.length, puddles: puddles.length, maxR: +Math.max(0, ...puddles.map((p) => p.r)).toFixed(3) };
}

// Damage a hand/foot; part of it carries into one of its finger groups / toes.
// Hands and fingers break off when emptied. Feet and toes never break off from damage: they
// only dent and bend (a worn foot slows the robot, see footMul); a foot is torn off only by
// the final leg hit (applyPartHit, opts.final).
function damageSub(f, sub, dmg, dir, scene) {
  if (!sub || sub.detached || dmg <= 0) return;
  dmg *= damageFx().subDmg;
  const breaks = sub.limb && sub.limb.startsWith('arm');
  sub.hp = Math.max(0, sub.hp - dmg);
  const kids = DAMAGE.subOrder.filter((id) => DAMAGE.sub[id].parent === sub.id && !f.subs[id].detached);
  if (kids.length) {
    const kid = f.subs[kids[Math.floor(Math.random() * kids.length)]];
    kid.hp = Math.max(0, kid.hp - dmg * 0.9);
    if (breaks && kid.hp <= 0) detachSub(f, kid, dir, scene);
  }
  if (breaks && sub.hp <= 0) detachSub(f, sub, dir, scene);
}

function sideOfBone(name) {
  const n = normName(name);
  return n.startsWith('left') ? 'L' : (n.startsWith('right') ? 'R' : null);
}

// The striking fist/foot takes wear on every connect (more when it slams into a guard).
export function applyStrikeWear(f, kind, bone, blocked, force, scene, dir) {
  if (!f.subs || !bone) return;
  const n = normName(bone.name);
  if (kind === 'punch' && !n.includes('hand')) return;
  if (kind === 'kick' && !(n.includes('foot') || n.includes('toe'))) return;
  const side = sideOfBone(bone.name);
  if (!side) return;
  const sub = f.subs[(kind === 'punch' ? 'hand' : 'foot') + side];
  const wear = 1 + (blocked ? 2.2 : 0) + Math.min(2, force * 0.15);
  damageSub(f, sub, wear, dir ? dir.clone().negate() : null, scene);
}

// Damage multiplier of the fist/foot that landed: missing fingers or a missing hand hit weaker.
export function strikeMul(f, kind, bone) {
  if (!f.subs || !bone) return 1;
  const side = sideOfBone(bone.name);
  if (!side) return 1;
  if (kind === 'punch') {
    const hand = f.subs['hand' + side];
    if (!hand || hand.detached) return 0.45;
    let lost = 0;
    for (const id of ['thumb', 'fingers', 'fingers'].map((k, i) => k + side + (i === 2 ? '2' : ''))) if (f.subs[id] && f.subs[id].detached) lost += 1;
    return (1 - 0.12 * lost) * (0.85 + 0.15 * hand.hp / hand.max);
  }
  const foot = f.subs['foot' + side];
  if (!foot || foot.detached) return 0.55;
  return (f.subs['toes' + side] && f.subs['toes' + side].detached ? 0.88 : 1) * (0.85 + 0.15 * foot.hp / foot.max);
}


export function canPunch(f) {
  const a = f.parts;
  if (!a) return true;
  return !a.armL.detached || !a.armR.detached;
}

export function canKick(f) {
  const a = f.parts;
  if (!a) return true;
  return !a.legL.detached || !a.legR.detached;
}

export function canBlock(f) {
  const a = f.parts;
  if (!a) return true;
  return !a.armL.detached || !a.armR.detached;
}

export function attackMods(f, kind) {
  const mods = { damageMul: 1, cooldownMul: 1, timeScale: 1 };
  if (!f.parts) return mods;
  if (kind === 'punch') {
    const main = f.parts[DAMAGE.punchArm] || f.parts.armR;
    const other = main === f.parts.armR ? f.parts.armL : f.parts.armR;
    const arm = main.detached ? other : main;
    if (arm.detached) return { damageMul: 0, cooldownMul: 1, timeScale: 1 };
    const dmg = 1 - arm.hp / arm.max;
    mods.damageMul = 1 - 0.7 * dmg;
    mods.cooldownMul = 1 + 0.85 * dmg;
    mods.timeScale = 1 / mods.cooldownMul;
  } else if (kind === 'kick') {
    const l = f.parts.legL;
    const r = f.parts.legR;
    const dl = l.detached ? 1 : 1 - l.hp / l.max;
    const dr = r.detached ? 1 : 1 - r.hp / r.max;
    const dmg = Math.max(dl, dr);
    mods.damageMul = 1 - 0.65 * dmg;
    mods.cooldownMul = 1 + 0.7 * dmg;
    mods.timeScale = 1 / mods.cooldownMul;
  }
  return mods;
}

export function moveSpeedMul(f) {
  if (!f.parts) return 1;
  const l = f.parts.legL;
  const r = f.parts.legR;
  if (l.detached && r.detached) return 0;
  if (l.detached || r.detached) {
    const remain = l.detached ? r : l;
    const wear = remain.detached ? 1 : 1 - remain.hp / remain.max;
    return 0.34 * (1 - 0.35 * wear);
  }
  let mul = 1;
  for (const leg of [l, r]) {
    mul *= 1 - 0.4 * (1 - leg.hp / leg.max);
  }
  return mul * footMul(f, 'L') * footMul(f, 'R');
}

function footMul(f, side) {
  const foot = f.subs && f.subs['foot' + side];
  if (!foot) return 1;
  if (foot.detached) return 0.45; // hobbling on the ankle stump
  // A crushed foot/toes (they bend, they don't come off) drags the step.
  const toes = f.subs['toes' + side];
  return (0.8 + 0.2 * foot.hp / foot.max) * (toes ? 0.9 + 0.1 * toes.hp / toes.max : 1);
}

export function blockReductionMul(f) {
  if (!f.parts) return 1;
  const l = f.parts.armL;
  const r = f.parts.armR;
  if (l.detached && r.detached) return 0;
  const dmg = ((l.detached ? 1 : 1 - l.hp / l.max) + (r.detached ? 1 : 1 - r.hp / r.max)) / 2;
  return 1 - 0.45 * dmg;
}

function partWorldPos(part, target) {
  const out = target || new THREE.Vector3();
  if (part.stump) {
    part.stump.getWorldPosition(out);
    return out;
  }
  for (const b of part.bones) {
    const n = normName(b.name);
    if (n.endsWith('end') || n.includes('pole')) continue;
    b.getWorldPosition(out);
    return out;
  }
  const mesh = part.meshes[0] || part.skinned[0];
  if (mesh) {
    mesh.getWorldPosition(out);
    return out;
  }
  return out.set(0, 1, 0);
}

function closestOnPart(part, approx) {
  let best = approx.clone();
  let bestD = Infinity;
  const meshes = part.meshes.concat(part.skinned).filter((m) => m.visible && !m.userData.hiddenPart);
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    _box.setFromObject(mesh);
    if (_box.isEmpty()) continue;
    const c = _box.clampPoint(approx, _v);
    const d = c.distanceToSquared(approx);
    if (d < bestD) {
      bestD = d;
      best.copy(c);
    }
  }
  if (bestD === Infinity) partWorldPos(part, best);
  return best;
}

export function pickHit(atk, def, kind, towardFn, contact) {
  const base = def.root.position;
  if (contact && contact.point) {
    // Real limb contact: the struck capsule's part, hit right there.
    const id = def.parts[contact.part] && !def.parts[contact.part].detached ? contact.part : 'torso';
    return { partId: id, point: contact.point.clone(), dir: towardFn(atk, def).clone() };
  }
  const aimY = kind === 'kick'
    ? base.y + 0.45 + Math.random() * 0.7
    : base.y + 1.05 + Math.random() * 1.05;
  const fwd = towardFn(atk, def);
  const approx = new THREE.Vector3(
    base.x - fwd.x * 0.12 + (Math.random() - 0.5) * 0.2,
    aimY,
    base.z - fwd.z * 0.12 + (Math.random() - 0.5) * 0.2,
  );
  let bestId = 'torso';
  let bestD = Infinity;
  for (const id of DAMAGE.order) {
    const part = def.parts[id];
    if (!part || part.detached) continue;
    const p = partWorldPos(part, _v);
    let d = p.distanceToSquared(approx);
    if (kind === 'kick' && (id === 'armL' || id === 'armR' || id === 'head')) d += 1.1;
    if (kind === 'punch' && (id === 'legL' || id === 'legR')) d += 0.7;
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  const part = def.parts[bestId];
  const point = closestOnPart(part, approx);
  return { partId: bestId, point, dir: fwd.clone() };
}

function dentMesh(mesh, worldPoint, worldDir, amount, partCode, pm = null) {
  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  const rest = mesh.userData.restPos;
  if (!pos || !rest) return;
  if (!worldPoint || !worldDir || !Number.isFinite(amount) || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldDir.x)) return;
  const vertPart = mesh.userData.vertPart;
  mesh.updateWorldMatrix(true, false);
  const localHit = mesh.worldToLocal(worldPoint.clone());
  const inv = _m.copy(mesh.matrixWorld).invert();
  const localDir = worldDir.clone().transformDirection(inv);
  if (localDir.lengthSq() < 1e-6) localDir.set(0, 0, 1);
  else localDir.normalize();
  mesh.getWorldScale(_v);
  const scale = Math.max(_v.x, 0.08);
  const fx = damageFx();
  const radius = (DAMAGE.dent.radius * (pm ? pm.radius : 1)) / scale;
  const depth = (DAMAGE.dent.depth * (pm ? pm.depth : 1) * amount * fx.dent) / scale;
  const maxDepth = (DAMAGE.dent.maxDepth * (pm ? pm.maxDepth : 1) * fx.dentMax) / scale;
  const darken = Math.min(0.92, DAMAGE.dent.colorDarken * (pm ? pm.darken : 1));
  const hidden = mesh.userData.hiddenVerts;
  for (let i = 0; i < pos.count; i++) {
    if (hidden && hidden[i]) continue;
    if (vertPart && partCode && vertPart[i] && vertPart[i] !== partCode) continue;
    const vx = pos.getX(i);
    const vy = pos.getY(i);
    const vz = pos.getZ(i);
    const d = Math.hypot(vx - localHit.x, vy - localHit.y, vz - localHit.z);
    if (d > radius) continue;
    const falloff = (1 - d / radius) ** 2;
    const rx = rest[i * 3] ?? vx;
    const ry = rest[i * 3 + 1] ?? vy;
    const rz = rest[i * 3 + 2] ?? vz;
    const already = Math.hypot(vx - rx, vy - ry, vz - rz);
    const push = Math.min(depth * falloff, Math.max(0, maxDepth - already));
    if (push <= 0 && falloff < 0.05) continue;
    pos.setXYZ(i, vx + localDir.x * push, vy + localDir.y * push, vz + localDir.z * push);
    if (col) {
      const dark = 1 - darken * falloff * Math.min(amount, 1.4);
      col.setXYZ(i, col.getX(i) * dark, col.getY(i) * dark * 0.92, col.getZ(i) * dark * 0.78);
    }
  }
  // Repair any non-finite vertex so computeBoundingSphere / computeVertexNormals never see NaN.
  for (let i = 0; i < pos.count; i++) {
    if (Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i))) continue;
    const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
    if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz)) pos.setXYZ(i, rx, ry, rz);
    else pos.setXYZ(i, 0, 0, 0);
  }
  pos.needsUpdate = true;
  if (col) col.needsUpdate = true;
  try { mesh.geometry.computeVertexNormals(); } catch (_) {}
  if (mesh.geometry.boundingSphere) mesh.geometry.boundingSphere = null;
}

function dentPart(part, worldPoint, worldDir, amount) {
  const code = DAMAGE.order.indexOf(part.id) + 1;
  const pm = (DAMAGE.dent.part && DAMAGE.dent.part[part.id]) || null;
  if (pm && pm.min) amount = Math.max(pm.min, amount);
  for (const mesh of part.meshes.concat(part.skinned)) {
    if (!mesh.visible || mesh.userData.hiddenPart) continue;
    dentMesh(mesh, worldPoint, worldDir, amount, mesh.userData.vertPart ? code : 0, pm);
  }
}

function bakeSkinnedWorld(mesh, keepVertex) {
  const src = mesh.geometry;
  const srcPos = src.attributes.position;
  const skinIndex = src.attributes.skinIndex;
  const skinWeight = src.attributes.skinWeight;
  const idx = src.index;
  mesh.updateWorldMatrix(true, true);
  if (mesh.skeleton) mesh.skeleton.update();
  const bindMatrix = mesh.bindMatrix || new THREE.Matrix4();
  const baked = [];
  const map = new Int32Array(srcPos.count).fill(-1);
  const vertex = new THREE.Vector3();
  const skinned = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const boneMat = new THREE.Matrix4();
  for (let i = 0; i < srcPos.count; i++) {
    if (keepVertex && !keepVertex(i)) continue;
    vertex.fromBufferAttribute(srcPos, i);
    if (mesh.isSkinnedMesh && skinIndex && skinWeight && mesh.skeleton) {
      vertex.applyMatrix4(bindMatrix);
      skinned.set(0, 0, 0);
      for (let j = 0; j < 4; j++) {
        const w = skinWeight.getComponent(i, j);
        if (w === 0) continue;
        const b = skinIndex.getComponent(i, j);
        const bone = mesh.skeleton.bones[b];
        if (!bone) continue;
        boneMat.multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[b]);
        tmp.copy(vertex).applyMatrix4(boneMat);
        skinned.addScaledVector(tmp, w);
      }
    } else {
      skinned.copy(vertex).applyMatrix4(mesh.matrixWorld);
    }
    map[i] = baked.length / 3;
    baked.push(skinned.x, skinned.y, skinned.z);
  }
  if (!baked.length) return null;
  const positions = new Float32Array(baked);
  let indexArr = null;
  if (idx) {
    const out = [];
    for (let i = 0; i < idx.count; i += 3) {
      const a = map[idx.getX(i)];
      const b = map[idx.getX(i + 1)];
      const c = map[idx.getX(i + 2)];
      if (a < 0 || b < 0 || c < 0) continue;
      out.push(a, b, c);
    }
    if (out.length) indexArr = out;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (indexArr) geo.setIndex(indexArr);
  geo.computeVertexNormals();
  const matSrc = [].concat(mesh.material)[0];
  const mat = matSrc ? matSrc.clone() : new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.6, roughness: 0.45 });
  mat.vertexColors = false;
  const bakedMesh = new THREE.Mesh(geo, mat);
  bakedMesh.castShadow = true;
  bakedMesh.receiveShadow = true;
  return bakedMesh;
}

// Kept vertices that were partly skinned to bones that just tore off (wrist / forearm verts
// blended with the hand bone, finger roots, ...) would follow those bones as they are folded
// away and stretch. Move that weight onto the vertex's remaining bones; if nothing remains,
// onto the nearest surviving ancestor bone.
function releaseBones(f, lostBones) {
  if (!lostBones || !lostBones.size) return;
  const names = new Set([...lostBones].map((b) => normName(b.name)));
  for (const mesh of f.skinMeshes || []) {
    const sk = mesh.skeleton;
    const si = mesh.geometry.attributes.skinIndex;
    const sw = mesh.geometry.attributes.skinWeight;
    if (!sk || !si || !sw) continue;
    const lost = sk.bones.map((b) => names.has(normName(b.name)));
    if (!lost.some(Boolean)) continue;
    const byName = new Map(sk.bones.map((b, k) => [normName(b.name), k]));
    const fallback = (bi) => {
      let b = sk.bones[bi];
      while (b && names.has(normName(b.name))) b = b.parent;
      const k = b && byName.get(normName(b.name));
      return k != null && !lost[k] ? k : null;
    };
    const hidden = mesh.userData.hiddenVerts;
    let changed = false;
    for (let i = 0; i < si.count; i++) {
      if (hidden && hidden[i]) continue;
      let lostW = 0, keepW = 0, firstLost = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w <= 0) continue;
        const b = si.getComponent(i, k);
        if (lost[b]) { lostW += w; if (firstLost < 0) firstLost = b; } else keepW += w;
      }
      if (lostW <= 0) continue;
      changed = true;
      if (keepW > 1e-4) {
        for (let k = 0; k < 4; k++) sw.setComponent(i, k, lost[si.getComponent(i, k)] ? 0 : sw.getComponent(i, k) / keepW);
      } else {
        const fb = fallback(firstLost);
        if (fb == null) continue;
        si.setComponent(i, 0, fb); sw.setComponent(i, 0, 1);
        for (let k = 1; k < 4; k++) sw.setComponent(i, k, 0);
      }
    }
    if (changed) { si.needsUpdate = true; sw.needsUpdate = true; }
  }
}

// Remove torn-off vertices from the robot for good: each one is welded onto a kept vertex of
// the same mesh, position AND skin weights, so the leftover triangles are degenerate at a
// point that is still on the robot. Nothing of the lost piece can be posed by any bone any
// more (the old "squash toward the mesh axis" left a thin copy that kept walking with the
// skeleton). A mesh with nothing left is hidden.
function hideVertices(mesh, removeVertex) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  if (!pos) return;
  const si = geo.attributes.skinIndex;
  const sw = geo.attributes.skinWeight;
  const hidden = mesh.userData.hiddenVerts || (mesh.userData.hiddenVerts = new Uint8Array(pos.count));
  const gone = new Uint8Array(pos.count);
  let keptAny = false;
  for (let i = 0; i < pos.count; i++) {
    if (hidden[i] || removeVertex(i)) gone[i] = 1;
    else keptAny = true;
  }
  if (!keptAny) {
    mesh.visible = false;
    mesh.userData.hiddenPart = true;
    return;
  }
  // Drop every triangle that touches a lost vertex. (Welding lost vertices onto one arbitrary
  // kept vertex left the triangles on the tear line spanning from the wrist to that vertex,
  // often up at the shoulder: the long elastic strips on damaged hands.) The tear stays a
  // clean open edge; the stump wires cover it.
  const idx = geo.index;
  const copy = (dst, src) => {
    pos.setXYZ(dst, pos.getX(src), pos.getY(src), pos.getZ(src));
    if (si && sw) for (let k = 0; k < 4; k++) { si.setComponent(dst, k, si.getComponent(src, k)); sw.setComponent(dst, k, sw.getComponent(src, k)); }
  };
  if (idx) {
    if (!mesh.userData.restIndex) mesh.userData.restIndex = idx.array.slice();
    const a = idx.array;
    for (let t = 0; t + 2 < a.length; t += 3) {
      if (gone[a[t]] || gone[a[t + 1]] || gone[a[t + 2]]) { a[t + 1] = a[t]; a[t + 2] = a[t]; }
    }
    idx.needsUpdate = true;
  } else {
    // Non-indexed: collapse each affected triangle onto one of its own corners.
    for (let t = 0; t + 2 < pos.count; t += 3) {
      if (gone[t] || gone[t + 1] || gone[t + 2]) { copy(t + 1, t); copy(t + 2, t); }
    }
  }
  for (let i = 0; i < pos.count; i++) if (gone[i]) hidden[i] = 1;
  pos.needsUpdate = true;
  if (si) si.needsUpdate = true;
  if (sw) sw.needsUpdate = true;
}

function attachPivot(pieces, scene) {
  if (!pieces.length) return null;
  const temp = new THREE.Group();
  scene.add(temp);
  for (const p of pieces) temp.attach(p);
  _box.setFromObject(temp);
  const center = _box.getCenter(new THREE.Vector3());
  const pivot = new THREE.Group();
  pivot.position.copy(center);
  scene.add(pivot);
  for (const p of [...temp.children]) pivot.attach(p);
  scene.remove(temp);
  return pivot;
}

function detachPart(f, part, dir, scene) {
  if (part.detached || !part.canDetach) return;
  part.detached = true;
  f.model.updateWorldMatrix(true, true);
  const pieces = [];
  const code = DAMAGE.order.indexOf(part.id) + 1;

  for (const mesh of part.meshes) {
    mesh.visible = true;
    scene.attach(mesh);
    pieces.push(mesh);
  }

  // Every skinned mesh of the robot, tagged per vertex by bone name: bake the lost piece into
  // a static debris copy, then weld those vertices away on the robot.
  for (const mesh of f.skinMeshes || part.skinned) {
    const vp = mesh.userData.vertPart;
    if (!vp || mesh.userData.hiddenPart) continue;
    const hidden = mesh.userData.hiddenVerts;
    const lost = (i) => vp[i] === code && !(hidden && hidden[i]);
    let any = false;
    for (let i = 0; i < vp.length && !any; i++) if (lost(i)) any = true;
    if (!any) continue;
    const baked = bakeSkinnedWorld(mesh, lost);
    if (baked) pieces.push(baked);
    hideVertices(mesh, lost);
  }

  // Also fold the limb bones away (stops the stump end from swinging a stray joint), after
  // releasing any kept skin weight on them.
  const foldBones = part.bones.filter((b) => { const n = normName(b.name); return !(n.includes('spine') || n.includes('hips') || n.includes('body') || n === 'torso' || n === 'abdomen'); });
  releaseBones(f, new Set(foldBones));
  for (const b of foldBones) b.scale.set(0.001, 0.001, 0.001);

  const pivot = attachPivot(pieces, scene);
  if (!pivot) return;
  const impulse = dir.clone().normalize();
  const fly = damageFx().impulse;
  const vel = new THREE.Vector3(
    (impulse.x * 3.2 + (Math.random() - 0.5) * 1.4) * fly,
    (2.4 + Math.random() * 1.3) * fly,
    (impulse.z * 3.2 + (Math.random() - 0.5) * 1.4) * fly,
  );
  const ang = new THREE.Vector3(
    (Math.random() - 0.5) * 10,
    (Math.random() - 0.5) * 12,
    (Math.random() - 0.5) * 10,
  );
  const rec = spawnDebris({
    mesh: pivot,
    mass: PART_MASS[part.id] || 3.2,
    velocity: vel,
    angularVelocity: ang,
    ownerId: f.id,
  });
  debrisList.push({ obj: pivot, phys: rec, owner: f.id, settled: false });
  playSfx('tear');
  // [announcer hook]
  if (part.id === 'head') announce('headOff', { delay: 0.12 });
  else announce('tear', { part: part.id, delay: 0.2 });
  part.stump = part.bones.find((b) => {
    const n = normName(b.name);
    return !n.endsWith('end') && !n.includes('pole');
  }) || null;
  part.lostT = 0;
  if (f.subs) for (const sub of Object.values(f.subs)) if (sub.limb === part.id) sub.detached = true;
  emitSparks(pivot.position, impulse, 22);
  const sparkAt = (p) => emitSparks(p, _v.set(0, -1, 0), 5);
  if (part.stump) addWires(part.stump, scene, { onSpark: sparkAt });
  addWires(pivot, scene, { piece: true });
  if (part.stump) sprayOil(part.stump.getWorldPosition(new THREE.Vector3()), impulse.clone().negate(), 26);
}

function emitSparks(point, dir, count = 16) {
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(SPARK_GEO, Math.random() < 0.35 ? sparkMatHot : sparkMat);
    m.position.copy(point);
    m.position.x += (Math.random() - 0.5) * 0.06;
    m.position.y += (Math.random() - 0.5) * 0.06;
    m.position.z += (Math.random() - 0.5) * 0.06;
    const vel = new THREE.Vector3(
      -dir.x + (Math.random() - 0.5) * 2.2,
      1.2 + Math.random() * 3.4,
      -dir.z + (Math.random() - 0.5) * 2.2,
    );
    // Spray outward from the impact as well as backward along the hit.
    vel.addScaledVector(dir, -1.5);
    if (vel.lengthSq() < 0.01) vel.set(0, 2, 0);
    const speed = 4.2 + Math.random() * 6;
    vel.normalize().multiplyScalar(speed);
    m.lookAt(m.position.x + vel.x, m.position.y + vel.y, m.position.z + vel.z);
    sparks.push({ m, vel, life: 0.22 + Math.random() * 0.38, age: 0 });
    m.userData.worldSpark = true;
  }
}

const smokeMat = new THREE.MeshBasicMaterial({
  color: 0x8a8f96, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false,
});
const smokeMatPool = [];
function emitSmoke(point) {
  const mat = smokeMatPool.pop() || smokeMat.clone();
  mat.opacity = 0.35;
  const m = new THREE.Mesh(SMOKE_GEO, mat);
  m.position.copy(point);
  m.position.x += (Math.random() - 0.5) * 0.08;
  m.position.z += (Math.random() - 0.5) * 0.08;
  smokes.push({
    m,
    vel: new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.35 + Math.random() * 0.35, (Math.random() - 0.5) * 0.15),
    life: 0.7 + Math.random() * 0.5,
    age: 0,
    grow: 1.6 + Math.random() * 1.2,
  });
}

/* ---------- oil: drips, sprays and glossy puddles (capped) ---------- */
const oilDrops = [];
const puddles = [];
const OIL_GEO = new THREE.SphereGeometry(0.016, 6, 4);
// ---- Small debris: real robot parts ----
// Solid hits knock pieces off the struck part (heavier hits shed more). Torn-off skin
// is triangles cut from the defender's own skinned mesh around the contact point
// (current pose, same material, UVs, paint, chrome and decals), thickened into a bent
// shell. Unique geometry, kept in a small ring; once settled the pieces are frozen
// (no physics, no shadows) and merged into one mesh per material.
function mergeGeos(list) {
  const pos = [], nor = [], uv = [], col = [], idx = [];
  let base = 0;
  for (const item of list) {
    const g = item.g || item;
    const c = item.color != null ? new THREE.Color(item.color) : null;
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv, vc = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      uv.push(t ? t.getX(i) : 0, t ? t.getY(i) : 0);
      if (c) col.push(c.r, c.g, c.b);
      else if (vc) col.push(vc.getX(i), vc.getY(i), vc.getZ(i));
      else col.push(1, 1, 1);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(i + base);
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
}

// --- torn skin pieces sampled from the robot itself ---
const _sv = new THREE.Vector3();
const _sn = new THREE.Vector3();
const _sc = new THREE.Vector3();
const SKIN_MAX = IS_MOBILE ? 6 : 12;
let skinRing = [];
function skinnedWorld(mesh, i, out, cache) {
  let v = cache.get(i);
  if (!v) { mesh.getVertexPosition(i, _sv); v = _sv.clone().applyMatrix4(mesh.matrixWorld); cache.set(i, v); }
  return out.copy(v);
}
// Cut the triangles of the robot's own skin within `radius` of `center` (current pose) into a
// thin bent shell: same material, UVs and vertex colours, so paint/chrome/decals match.
function sampleSkinPiece(f, partId, center, radius, maxTris = 160) {
  const part = f.parts && f.parts[partId];
  if (!part || part.detached) return null;
  const code = DAMAGE.order.indexOf(partId) + 1;
  let best = null;
  for (const mesh of part.skinned) {
    if (!mesh.visible || !mesh.geometry.index) continue;
    mesh.updateMatrixWorld();
    const vp = mesh.userData.vertPart;
    const pos = mesh.geometry.attributes.position;
    const cache = new Map();
    // nearest vertex of this part to the hit (stride keeps it cheap on dense meshes)
    const stride = pos.count > 12000 ? 3 : 1;
    let bi = -1, bd = radius * radius * 4;
    for (let i = 0; i < pos.count; i += stride) {
      if (vp && vp[i] !== code) continue;
      const d = skinnedWorld(mesh, i, _sc, cache).distanceToSquared(center);
      if (d < bd) { bd = d; bi = i; }
    }
    if (bi >= 0 && (!best || bd < best.d)) best = { mesh, bi, d: bd, cache };
  }
  if (!best) return null;
  const { mesh, cache } = best;
  const seed = skinnedWorld(mesh, best.bi, new THREE.Vector3(), cache);
  const geo = mesh.geometry, index = geo.index, r2 = radius * radius;
  // material group of the seed vertex
  let group = null;
  if (Array.isArray(mesh.material) && geo.groups.length) {
    for (let t = 0; t < index.count && !group; t += 3) for (let k = 0; k < 3; k++) if (index.getX(t + k) === best.bi) { group = geo.groups.find((gr) => t >= gr.start && t < gr.start + gr.count) || null; break; }
  }
  const material = Array.isArray(mesh.material) ? mesh.material[group ? group.materialIndex : 0] : mesh.material;
  const t0 = group ? group.start : 0, t1 = group ? group.start + group.count : index.count;
  const tris = [];
  const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
  for (let t = t0; t < t1 && tris.length < maxTris; t += 3) {
    const a = index.getX(t), b = index.getX(t + 1), c = index.getX(t + 2);
    // cheap reject on rest-pose vertex part tags before skinning
    const vp = mesh.userData.vertPart;
    if (vp && vp[a] !== code && vp[b] !== code && vp[c] !== code) continue;
    skinnedWorld(mesh, a, vA, cache);
    if (vA.distanceToSquared(seed) > r2) continue;
    skinnedWorld(mesh, b, vB, cache); skinnedWorld(mesh, c, vC, cache);
    if (vB.distanceToSquared(seed) > r2 || vC.distanceToSquared(seed) > r2) continue;
    tris.push([a, b, c]);
  }
  if (tris.length < 2) return null;
  const uvA = geo.attributes.uv, colA = geo.attributes.color;
  const verts = new Map(); const P = [], U = [], C = [], I = [];
  const centroid = new THREE.Vector3();
  for (const tri of tris) for (const i of tri) if (!verts.has(i)) { verts.set(i, P.length / 3); const v = skinnedWorld(mesh, i, _sc, cache); P.push(v.x, v.y, v.z); centroid.add(v); U.push(uvA ? uvA.getX(i) : 0, uvA ? uvA.getY(i) : 0); C.push(colA ? colA.getX(i) : 1, colA ? colA.getY(i) : 1, colA ? colA.getZ(i) : 1); }
  const nv = verts.size; centroid.divideScalar(nv);
  for (let k = 0; k < nv; k++) { P[k * 3] -= centroid.x; P[k * 3 + 1] -= centroid.y; P[k * 3 + 2] -= centroid.z; }
  for (const tri of tris) I.push(verts.get(tri[0]), verts.get(tri[1]), verts.get(tri[2]));
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(I); g.computeVertexNormals();
  // Thicken into a shell (inner copy pushed in along the normals, reversed winding) and
  // crumple it a little so it reads as a torn, bent panel.
  const N = g.attributes.normal;
  const th = 0.007 * SIZE;
  const P2 = P.slice(), U2 = U.slice(), C2 = C.slice(), I2 = I.slice();
  for (let k = 0; k < nv; k++) {
    const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
    const bend = (x * x + z * z) / (radius * radius) * 0.25 * radius * (0.5 + Math.random() * 0.5);
    P2[k * 3] = x - N.getX(k) * bend; P2[k * 3 + 1] = y - N.getY(k) * bend; P2[k * 3 + 2] = z - N.getZ(k) * bend;
  }
  for (let k = 0; k < nv; k++) { P2.push(P2[k * 3] - N.getX(k) * th, P2[k * 3 + 1] - N.getY(k) * th, P2[k * 3 + 2] - N.getZ(k) * th); U2.push(U[k * 2], U[k * 2 + 1]); C2.push(C[k * 3] * 0.35, C[k * 3 + 1] * 0.35, C[k * 3 + 2] * 0.35); }
  for (let t = 0; t < I.length; t += 3) I2.push(I[t] + nv, I[t + 2] + nv, I[t + 1] + nv);
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P2, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U2, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C2, 3));
  g.setIndex(I2); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.position.copy(centroid);
  m.castShadow = true;
  m.userData.skinPiece = true;
  return m;
}
function fingerBone(f, partId) {
  const part = f.parts && f.parts[partId];
  if (!part) return null;
  const list = part.bones.filter((b) => /Hand(Index|Middle|Ring|Pinky|Thumb)[12]$/.test(String(b.name).replace(/^mixamorig[:._]*/i, '')) && b.children.length);
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}
function launchPiece(f, mesh, mass, point, d, force, scene) {
  scene.add(mesh);
  const fly = damageFx().impulse;
  const sp = (1.6 + force * 0.35 + Math.random() * 1.2) * fly;
  return spawnDebris({
    mesh, small: true, mass,
    velocity: new THREE.Vector3(d.x * sp + (Math.random() - 0.5) * 2.2 * fly, (1.2 + Math.random() * 2.2) * fly, d.z * sp + (Math.random() - 0.5) * 2.2 * fly),
    angularVelocity: new THREE.Vector3((Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30, (Math.random() - 0.5) * 30),
    ownerId: f && f.id,
  });
}
function recForMesh(mesh) {
  if (!mesh) return null;
  for (const d of getPhysicsDebris()) if (d.mesh === mesh) return d;
  return null;
}
function discardMesh(mesh, scene) {
  if (!mesh) return;
  const rec = recForMesh(mesh);
  if (rec) dropDebris(rec);
  for (let i = debrisList.length - 1; i >= 0; i--) if (debrisList[i].obj === mesh) debrisList.splice(i, 1);
  if (mesh.parent) mesh.parent.remove(mesh);
  else if (scene) scene.remove(mesh);
  mesh.visible = false;
  if (mesh.geometry && !mesh.userData.deformReady && !mesh.userData.shared) mesh.geometry.dispose();
}
function keepSkinPiece(scene, mesh) {
  skinRing.push(mesh);
  const skinCap = Math.min(SKIN_MAX + 4, damageFx().skinMax);
  while (skinRing.length > skinCap) discardMesh(skinRing.shift(), scene);
}

const FADE_T = 0.35;
function startFade(d) { if (d && d.fade == null) d.fade = FADE_T; }
function cullAndFadeDebris(scene, dt) {
  const cap = debrisCaps();
  const all = getPhysicsDebris();
  const small = all.filter((d) => d.frozen && d.small).sort((a, b) => (a.frozenAt || 0) - (b.frozenAt || 0));
  const big = all.filter((d) => d.frozen && !d.small).sort((a, b) => (a.frozenAt || 0) - (b.frozenAt || 0));
  for (let i = 0; i < small.length - cap.small; i++) startFade(small[i]);
  // Torn limbs and heads stay as static props; only the overflow fades.
  for (let i = 0; i < big.length - cap.big; i++) startFade(big[i]);
  for (const d of all.slice()) {
    if (d.fade == null) continue;
    d.fade -= dt;
    const k = Math.max(0, d.fade / FADE_T);
    if (d.mesh) { d.mesh.scale.setScalar(Math.max(0.01, k)); d.mesh.updateMatrix(); }
    if (d.fade <= 0) {
      const mesh = d.mesh;
      dropDebris(d);
      discardMesh(mesh, scene);
      skinRing = skinRing.filter((m) => m !== mesh);
    }
  }
  mergeSettledSkin(scene);
}
function mergeSettledSkin(scene) {
  const pieces = skinRing.filter((m) => m.userData.resting && m.parent && !m.userData.mergedSink);
  if (pieces.length < 4) return;
  const groups = new Map();
  for (const m of pieces) {
    const key = (m.material && m.material.uuid) || 'x';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const list of groups.values()) {
    if (list.length < 3) continue;
    const geos = [];
    for (const m of list) {
      const g = m.geometry.clone();
      m.updateMatrixWorld(true);
      g.applyMatrix4(m.matrixWorld);
      geos.push({ g });
    }
    const merged = mergeGeos(geos);
    for (const item of geos) item.g.dispose();
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.userData.resting = true;
    mesh.userData.mergedSink = true;
    mesh.userData.shared = true;
    scene.add(mesh);
    for (const m of list) discardMesh(m, scene);
    skinRing = skinRing.filter((m) => !list.includes(m));
    skinRing.push(mesh);
  }
}

export function shedChips(f, partId, point, dir, force, scene, opts = {}) {
  // Low-count debris from the robot's own armour: sampled skin/plate pieces, team-tinted
  // by the model's materials. Generic PCB / wire / gear / bolt chips are no longer spawned.
  // Real limbs (head, arm, hand) come off through detachPart / detachSub, not a chip shower.
  if (!point || !scene) return 0;
  const fx = damageFx();
  if (opts.blocked && !fx.guardPlate) return 0;
  const heavy = force >= fx.heavyForce || !!opts.plate;
  let n;
  if (opts.count != null) n = opts.count;
  else if (opts.blocked) n = Math.random() < fx.guardPlate ? 1 : 0;
  else if (force < 2.2) n = Math.random() < (0.35 * fx.chipMul) ? 1 : 0;
  else if (heavy) n = 1 + (Math.random() < (0.4 * fx.chipMul) ? 1 : 0);
  else n = Math.random() < Math.min(1, fx.chipMul) ? 1 : 0;
  if (IS_MOBILE) n = Math.min(n, 1);
  n = Math.min(n, 2); // keep debris looking like real parts, not a shower
  const d = dir ? dir.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1);
  let skins = 0;
  for (let k = 0; k < n; k++) {
    const c = k
      ? point.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12 * SIZE, (Math.random() - 0.5) * 0.1 * SIZE, (Math.random() - 0.5) * 0.12 * SIZE))
      : point;
    const big = (heavy && k === 0);
    const radius = (big
      ? (0.11 + Math.random() * 0.06 + Math.min(0.05, force * 0.008))
      : (0.055 + Math.random() * 0.03)) * SIZE;
    let m = null;
    try { m = sampleSkinPiece(f, partId, c, radius, big ? 280 : 160); } catch (e) { m = null; }
    if (!m) continue;
    launchPiece(f, m, (big ? 0.35 : 0.14) * SIZE, point, d, force, scene);
    keepSkinPiece(scene, m);
    skins++;
  }
  return skins;
}
function clearChips(scene) {
  for (const m of skinRing.slice()) discardMesh(m, scene);
  skinRing = [];
}

const oilDropMat = new THREE.MeshStandardMaterial({ color: 0x0c0a07, roughness: 0.12, metalness: 0.5 });
const PUDDLE_GEO = new THREE.PlaneGeometry(2, 2);
// A few irregular, soft-edged blob masks (overlapping lobes) so puddles never read as discs.
function puddleTexture(seed) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  let r = seed * 9301 + 49297;
  const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
  for (let i = 0; i < 7; i++) {
    const a = rnd() * Math.PI * 2;
    const d = i === 0 ? 0 : 14 + rnd() * 20;
    const x = 64 + Math.cos(a) * d;
    const y = 64 + Math.sin(a) * d;
    const rad = i === 0 ? 34 : 14 + rnd() * 16;
    const grd = g.createRadialGradient(x, y, rad * 0.55, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  return t;
}
let puddleMats = null;
function getPuddleMats() {
  if (puddleMats) return puddleMats;
  puddleMats = [1, 2, 3, 4].map((seed) => new THREE.MeshStandardMaterial({
    color: 0x150e07,
    roughness: 0.03,
    metalness: 0.25,
    alphaMap: puddleTexture(seed),
    transparent: true,
    opacity: 0.86,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  }));
  return puddleMats;
}
let oilScene = null;

function emitOil(point, dir, count, speed = 0.4) {
  if (!point) return;
  const cap = (DAMAGE.oil && DAMAGE.oil.maxDrops) || 140;
  for (let i = 0; i < count && oilDrops.length < cap; i++) {
    const m = new THREE.Mesh(OIL_GEO, oilDropMat);
    m.position.copy(point);
    const v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed * 0.5, (Math.random() - 0.5) * speed);
    if (dir) v.addScaledVector(dir, speed * 0.6);
    oilDrops.push({ m, vel: v, age: 0 });
    m.userData.oilNew = true;
  }
}

// Brief pressurised spray when something tears off.
function sprayOil(point, dir, count) {
  const d = dir ? dir.clone().setY(0).normalize() : new THREE.Vector3();
  const cap = (DAMAGE.oil && DAMAGE.oil.maxDrops) || 140;
  for (let i = 0; i < count && oilDrops.length < cap; i++) {
    const m = new THREE.Mesh(OIL_GEO, oilDropMat);
    m.position.copy(point);
    const sp = 1.6 + Math.random() * 2.4;
    const v = new THREE.Vector3(
      d.x * sp * 0.7 + (Math.random() - 0.5) * 1.6,
      0.6 + Math.random() * 1.8,
      d.z * sp * 0.7 + (Math.random() - 0.5) * 1.6,
    );
    oilDrops.push({ m, vel: v, age: 0 });
    m.userData.oilNew = true;
  }
}

function landOil(x, z) {
  const maxR = (DAMAGE.oil && DAMAGE.oil.puddleMaxR) || 0.42;
  for (const p of puddles) {
    const dx = x - p.m.position.x;
    const dz = z - p.m.position.z;
    const reach = Math.max(0.09, p.target * 1.2);
    if (dx * dx + dz * dz < reach * reach) {
      p.target = Math.min(maxR, p.target + 0.016 * (0.12 / Math.max(0.06, p.target)));
      return;
    }
  }
  const cap = (DAMAGE.oil && DAMAGE.oil.maxPuddles) || 36;
  if (puddles.length >= cap) {
    const old = puddles.shift();
    if (old.m.parent) old.m.parent.remove(old.m);
  }
  const mats = getPuddleMats();
  const m = new THREE.Mesh(PUDDLE_GEO, mats[Math.floor(Math.random() * mats.length)]);
  m.rotation.x = -Math.PI / 2;
  m.rotation.z = Math.random() * Math.PI;
  m.position.set(x, (ARENA.matTop || 0) + 0.0042, z);
  m.renderOrder = 1;
  m.receiveShadow = true;
  const p = { m, r: 0.01, target: 0.05 + Math.random() * 0.03, sx: 0.75 + Math.random() * 0.5 };
  m.scale.set(p.r * p.sx, p.r, 1);
  if (oilScene) oilScene.add(m);
  puddles.push(p);
}

function stepOil(scene, dt) {
  oilScene = scene;
  const floor = (ARENA.matTop || 0) + 0.01;
  for (let i = oilDrops.length - 1; i >= 0; i--) {
    const d = oilDrops[i];
    if (d.m.userData.oilNew) { scene.add(d.m); d.m.userData.oilNew = false; }
    d.age += dt;
    d.vel.y -= 13 * dt;
    d.m.position.addScaledVector(d.vel, dt);
    // Stretch falling drops along their speed so they read as drips, not pellets.
    const sp = Math.min(3, 1 + Math.abs(d.vel.y) * 0.25);
    d.m.scale.set(1 / Math.sqrt(sp), sp, 1 / Math.sqrt(sp));
    if (d.m.position.y <= floor || d.age > 3) {
      if (d.m.position.y <= floor) landOil(d.m.position.x, d.m.position.z);
      scene.remove(d.m);
      oilDrops.splice(i, 1);
    }
  }
  for (const p of puddles) {
    if (p.r < p.target) {
      p.r = Math.min(p.target, p.r + dt * 0.08); // spreads a little after landing
      p.m.scale.set(p.r * p.sx, p.r, 1);
    }
  }
}

function clearOil(scene) {
  for (const d of oilDrops) if (d.m.parent) d.m.parent.remove(d.m);
  oilDrops.length = 0;
  for (const p of puddles) if (p.m.parent) p.m.parent.remove(p.m);
  puddles.length = 0;
  void scene;
}

function addSparkScene(scene) {
  for (const s of sparks) {
    if (s.m.userData.worldSpark && !s.m.parent) scene.add(s.m);
    s.m.userData.worldSpark = false;
  }
  for (const s of smokes) {
    if (!s.m.parent) scene.add(s.m);
  }
}

// Neon eyes (game.js addVisor): a clean head hit landing on or right by an eye can blow it.
// Spark burst + glassy pop, a short sputter (game.js stepEyes), then dark for the match.
const _ev = new THREE.Vector3();
function maybeBlowEye(f, point, dir, force) {
  if (!f.eyes || force < 2.4) return;
  let best = null, bd = Infinity;
  for (const e of f.eyes) {
    if (e.blown || !e.mesh.visible) continue;
    const d = e.mesh.getWorldPosition(_ev).distanceTo(point);
    if (d < bd) { bd = d; best = e; }
  }
  const reach = 0.17 * SIZE;
  if (!best || bd > reach) return;
  const chance = Math.min(0.9, 0.35 + (1 - bd / reach) * 0.4 + Math.max(0, force - 3) * 0.06);
  if (Math.random() > chance) return;
  blowEye(f, best, dir);
}
export function blowEye(f, e, dir) {
  if (!e || e.blown) return;
  e.blown = true;
  e.flick = 1.4;
  e.tint = e.halo.material.color.clone();
  const at = e.mesh.getWorldPosition(new THREE.Vector3());
  const d = dir ? dir.clone().normalize().negate() : new THREE.Vector3(0, 0, 1);
  emitSparks(at, d.setY(0.4).normalize(), 26);
  playSfx('eyePop');
}

export function applyPartHit(f, partId, damage, point, dir, scene, opts = {}) {
  const part = f.parts[partId];
  if (!part || part.detached) return { wrecked: false, point };
  const fx = damageFx();
  const amount = opts.blocked ? 0.45 : 1;
  const dmg = Math.max(1, Math.round(damage * amount * fx.dmg));
  const force = opts.force != null ? opts.force : (dmg / 8);
  const hpBefore = part.hp;
  part.hp = Math.max(0, part.hp - dmg);
  // The head comes off only once it is already badly beaten: Low keeps today's half-health
  // grace; Medium/Max lower that floor so the head can tear off sooner.
  if (partId === 'head' && part.hp <= 0 && hpBefore > part.max * fx.headGrace) part.hp = 1;
  part.wear = (part.wear || 0) + force;
  const dentAmt = (opts.blocked ? 0.4 : 1) * Math.min(2.6, (0.4 + force * 0.32) * (1 + Math.min(1.2, part.wear * 0.08)));
  dentPart(part, point, dir, dentAmt);
  emitSparks(point, dir, opts.blocked ? 8 : 18 + Math.min(16, Math.round(force * 3)));
  const wantPlate = !opts.blocked && (force >= fx.plateForce || dmg >= fx.plateDmg) && Math.random() < fx.plateChance;
  const wantGuard = opts.blocked && fx.guardPlate && Math.random() < fx.guardPlate;
  shedChips(f, partId, point, dir, force, scene, { blocked: opts.blocked, plate: wantPlate || wantGuard });
  if (partId === 'head' && !opts.blocked && point) maybeBlowEye(f, point, dir, force);
  addSparkScene(scene);
  let wrecked = false;
  const isLeg = partId.startsWith('leg');
  // Legs bend instead of breaking: an emptied leg stays on, bent as far as it goes. A leg (or
  // its foot) comes off only when the KO blow itself lands on a leg that was already badly
  // damaged before it (at or under 20% health), and then only about half the time. A final hit near the foot takes the foot;
  // otherwise the whole leg goes. (Tearing any emptied or KO-hit leg off made nearly every
  // match end on a leg finisher.)
  const legFinal = isLeg && !opts.blocked && opts.final && hpBefore <= part.max * fx.legGate && Math.random() < fx.legFinal;
  const legMid = isLeg && !opts.blocked && !opts.final && part.hp <= 0 && fx.midLeg > 0 && Math.random() < fx.midLeg;
  if ((legFinal || legMid) && part.canDetach && !part.detached) {
    const foot = f.subs && f.subs['foot' + partId.slice(-1)];
    if (part.hp > 0 && foot && !foot.detached && point && subWorldPos(foot, _v2).distanceTo(point) < 0.38) detachSub(f, foot, dir, scene);
    else detachPart(f, part, dir, scene);
    wrecked = true;
  } else if (!isLeg && part.hp <= 0 && part.canDetach && !part.detached) {
    detachPart(f, part, dir, scene);
    wrecked = true;
  } else if (f.subs && (partId.startsWith('arm') || isLeg)) {
    // Blows that land on (or are blocked with) the hand/foot damage it and its fingers/toes.
    const id = (partId.startsWith('arm') ? 'hand' : 'foot') + partId.slice(-1);
    const sub = f.subs[id];
    if (sub && !sub.detached && point && subWorldPos(sub, _v2).distanceTo(point) < 0.38) {
      damageSub(f, sub, dmg * (opts.blocked ? 1.2 : 0.95), dir, scene);
    }
  }
  if (!part.detached && (1 - part.hp / part.max) > 0.5) emitOil(point, dir, 2, 0.6);
  return { wrecked, point, partId };
}

export function stepDamage(scene, dt) {
  addSparkScene(scene);
  cullAndFadeDebris(scene, dt);
  stepWires(dt);
  stepOil(scene, dt);
  const floor = ARENA.floorY + 0.02;
  for (const d of debrisList) {
    if (d.phys) d.settled = !!d.phys.settled;
  }

  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.age += dt;
    s.vel.y -= 14 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    s.m.lookAt(s.m.position.x + s.vel.x, s.m.position.y + s.vel.y, s.m.position.z + s.vel.z);
    const t = 1 - s.age / s.life;
    s.m.scale.setScalar(Math.max(0.05, t));
    if (s.m.position.y < floor) {
      s.m.position.y = floor;
      s.vel.y *= -0.2;
      s.vel.x *= 0.5;
      s.vel.z *= 0.5;
    }
    if (s.age >= s.life) {
      scene.remove(s.m);
      sparks.splice(i, 1);
    }
  }

  for (let i = smokes.length - 1; i >= 0; i--) {
    const s = smokes[i];
    s.age += dt;
    s.m.position.addScaledVector(s.vel, dt);
    const t = s.age / s.life;
    const sc = 1 + t * s.grow;
    s.m.scale.setScalar(sc);
    s.m.material.opacity = 0.35 * (1 - t);
    if (s.age >= s.life) {
      scene.remove(s.m);
      if (s.m.material && s.m.material !== smokeMat) smokeMatPool.push(s.m.material);
      smokes.splice(i, 1);
    }
  }
}

function clampXZ(x, z, pad) {
  const a = (ARENA.apothem || 6.1) - pad;
  x = Math.max(-a, Math.min(a, x));
  z = Math.max(-a, Math.min(a, z));
  const m = a * Math.SQRT2;
  const s = Math.abs(x) + Math.abs(z);
  if (s > m) {
    const k = m / s;
    x *= k;
    z *= k;
  }
  return [x, z];
}

export function applyMalfunctions(f, dt) {
  if (!f.parts) return;
  const lying = f.state === 'ko' || f.state === 'down' || f.state === 'getup';
  f.limpT = (f.limpT || 0) + dt;
  const l = f.parts.legL;
  const r = f.parts.legR;
  const limp = Math.max(
    l.detached ? 1 : 1 - l.hp / l.max,
    r.detached ? 1 : 1 - r.hp / r.max,
  );
  if (!lying) {
    // Vertical bounce is handled by per-frame foot grounding so soles stay on the mat.
    // A lost foot: the robot leans onto that side (it's standing on the ankle stump) and
    // rocks hard over it with every step. Leg damage rocks while walking, not while idle.
    const footL = f.subs && f.subs.footL && f.subs.footL.detached && !l.detached;
    const footR = f.subs && f.subs.footR && f.subs.footR.detached && !r.detached;
    const lean = (footL ? -0.075 : 0) + (footR ? 0.075 : 0); // +z tips toward the robot's right
    const moving = f.state === 'walk';
    const amp = (footL || footR) ? 0.13 : 0.14 * limp * limp + 0.03 * limp; // worsens with leg damage
    const worse = footL ? -1 : (footR ? 1 : ((1 - l.hp / l.max) >= (1 - r.hp / r.max) ? -1 : 1));
    const sway = moving ? Math.abs(Math.sin(f.limpT * 5.2)) * amp * worse : 0;
    const want = lean + sway;
    f.model.rotation.z += (want - f.model.rotation.z) * Math.min(1, dt * 12);
  } else {
    // Falls are whole clips: no stance lean carried into them.
    f.model.rotation.z += (0 - f.model.rotation.z) * Math.min(1, dt * 12);
  }

  const head = f.parts.head;
  const hd = head.detached ? 0 : 1 - head.hp / head.max;
  if (hd > 0.15 && !head.detached) {
    const j = (hd - 0.15) * 0.08;
    const bone = head.bones.find((b) => normName(b.name) === 'head') || head.bones[0];
    if (bone) {
      bone.rotation.x += (Math.random() - 0.5) * j;
      bone.rotation.z += (Math.random() - 0.5) * j;
    }
    f.headFlick -= dt;
    if (f.headFlick <= 0) {
      f.headFlick = 0.04 + Math.random() * 0.1;
      const on = Math.random() < hd * 0.55;
      for (const mesh of head.meshes.concat(head.skinned)) {
        for (const m of [].concat(mesh.material)) {
          if (!m || !m.emissive) continue;
          if (on) {
            m.emissive.setHex(0xffcc66);
            m.emissiveIntensity = 0.7 + Math.random() * 0.8;
          } else {
            m.emissive.setHex(0x000000);
            m.emissiveIntensity = 0;
          }
        }
      }
    }
  }

  // Damaged arms twitch: a constant servo jitter plus random jerks, growing with damage.
  if (!lying) {
    for (const side of ['L', 'R']) {
      const arm = f.parts['arm' + side];
      if (arm.detached) continue;
      const frac = 1 - arm.hp / arm.max;
      if (frac < 0.5) continue; // malfunctions start past half damage
      const tw = f['twitch' + side] || (f['twitch' + side] = { next: 0.5, amp: 0, bones: null });
      if (!tw.bones) {
        const want = side === 'L' ? ['leftarm', 'leftforearm'] : ['rightarm', 'rightforearm'];
        tw.bones = arm.bones.filter((b) => want.includes(normName(b.name)));
      }
      tw.next -= dt;
      if (tw.next <= 0) {
        tw.next = 0.4 + Math.random() * (2.2 - frac * 1.6);
        tw.amp = 0.1 + frac * 0.35;
        tw.ax = Math.random() - 0.5;
        tw.az = Math.random() - 0.5;
      }
      tw.amp = Math.max(0, tw.amp - dt * 3.5);
      const jit = (frac - 0.5) * 0.1;
      for (const b of tw.bones) {
        b.rotation.x += (Math.random() - 0.5) * jit + tw.ax * tw.amp;
        b.rotation.z += (Math.random() - 0.5) * jit + tw.az * tw.amp;
      }
    }
  }

  // Oil: torn stumps drip hard (easing off after a few seconds), damaged parts weep.
  for (const id of DAMAGE.order) {
    const part = f.parts[id];
    let rate = 0;
    if (part.detached) {
      if (part.stump) {
        part.lostT = (part.lostT || 0) + dt;
        rate = part.lostT < 5 ? 7 : 2.2;
        part.stump.getWorldPosition(_v2);
      }
    } else {
      const frac = 1 - part.hp / part.max;
      if (frac > 0.5) { rate = (frac - 0.5) * 4; partWorldPos(part, _v2); }
      // Damaged joints sputter sparks.
      if (frac > 0.55) {
        part.sparkAcc = (part.sparkAcc || 0) + dt * (frac - 0.4) * 2.2 * Math.random() * 2;
        if (part.sparkAcc > 1) {
          part.sparkAcc = 0;
          emitSparks(partWorldPos(part, _v3), _v.set(Math.random() - 0.5, -0.3, Math.random() - 0.5).normalize(), 3 + Math.floor(Math.random() * 4));
        }
      }
    }
    if (rate > 0) {
      part.oilAcc = (part.oilAcc || 0) + dt * rate;
      while (part.oilAcc > 1) { part.oilAcc -= 1; emitOil(_v2, null, 1, 0.25); }
    }
  }
  if (f.subs) {
    for (const sub of Object.values(f.subs)) {
      if (!sub.detached || !sub.stump || f.parts[sub.limb].detached) continue;
      sub.lostT += dt;
      sub.oilAcc += dt * (sub.lostT < 4 ? 3.5 : 1);
      sub.sparkAcc += dt * Math.random() * 1.2;
      if (sub.oilAcc > 1 || sub.sparkAcc > 1) sub.stump.getWorldPosition(_v2);
      while (sub.oilAcc > 1) { sub.oilAcc -= 1; emitOil(_v2, null, 1, 0.2); }
      if (sub.sparkAcc > 1) { sub.sparkAcc = 0; emitSparks(_v2, _v.set(0, -1, 0), 2); }
    }
  }

  for (const id of DAMAGE.order) {
    const part = f.parts[id];
    if (part.detached) {
      if (part.stump) {
        part.smokeAcc += dt * 1.6;
        while (part.smokeAcc > 0.16) {
          part.smokeAcc -= 0.16;
          part.stump.getWorldPosition(_v2);
          emitSmoke(_v2);
        }
      }
      continue;
    }
    const frac = 1 - part.hp / part.max;
    if (frac < DAMAGE.heavySmoke) continue;
    part.smokeAcc += dt * (0.6 + frac * 2.8);
    while (part.smokeAcc > 0.18) {
      part.smokeAcc -= 0.18;
      emitSmoke(partWorldPos(part, _v3));
    }
  }
}

function restoreMesh(mesh) {
  const home = mesh.userData.home;
  if (home && home.parent) {
    home.parent.add(mesh);
    mesh.position.copy(home.pos);
    mesh.quaternion.copy(home.quat);
    mesh.scale.copy(home.scale);
  }
  mesh.visible = true;
  mesh.userData.hiddenPart = false;
  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  if (pos && mesh.userData.restPos) {
    pos.array.set(mesh.userData.restPos);
    pos.needsUpdate = true;
  }
  if (col && mesh.userData.restColor) {
    col.array.set(mesh.userData.restColor);
    col.needsUpdate = true;
  }
  const si = mesh.geometry.attributes.skinIndex;
  const sw = mesh.geometry.attributes.skinWeight;
  if (si && mesh.userData.restSkinIndex) { si.array.set(mesh.userData.restSkinIndex); si.needsUpdate = true; }
  if (sw && mesh.userData.restSkinWeight) { sw.array.set(mesh.userData.restSkinWeight); sw.needsUpdate = true; }
  if (mesh.userData.hiddenVerts) mesh.userData.hiddenVerts.fill(0);
  if (mesh.geometry.index && mesh.userData.restIndex) { mesh.geometry.index.array.set(mesh.userData.restIndex); mesh.geometry.index.needsUpdate = true; }
  if (pos) mesh.geometry.computeVertexNormals();
  for (const m of [].concat(mesh.material)) {
    if (!m || !m.emissive) continue;
    m.emissive.setHex(0x000000);
    m.emissiveIntensity = 0;
  }
}

// Debris is frozen once it settles (no physics, no per-frame stepping). Oldest small pieces
// over the cap fade out. Everything is cleared between rounds (and at a new match).
export function clearAllDebris(scene, keepPieces = false) {
  if (keepPieces) {
    clearWires(true);
    for (const s of sparks) scene.remove(s.m);
    sparks.length = 0;
    return;
  }
  clearPhysicsDebris();
  clearChips(scene);
  clearWires();
  for (const d of debrisList) {
    d.obj.traverse((o) => {
      if (o.isMesh && o.geometry && !o.userData.deformReady && !o.userData.shared) {
        o.geometry.dispose();
      }
    });
    scene.remove(d.obj);
  }
  debrisList.length = 0;
  for (const s of sparks) scene.remove(s.m);
  sparks.length = 0;
  for (const s of smokes) {
    scene.remove(s.m);
    if (s.m.material) s.m.material.dispose();
  }
  smokes.length = 0;
  clearOil(scene);
}

export function resetFighterDamage(f, scene) {
  if (!f.parts) return;
  for (const id of DAMAGE.order) {
    const part = f.parts[id];
    part.hp = part.max;
    part.detached = false;
    part.smokeAcc = 0;
    part.wear = 0;
    part.stump = null;
    for (const mesh of part.meshes) restoreMesh(mesh);
    for (const b of part.bones) {
      if (b.userData.homeScale) b.scale.copy(b.userData.homeScale);
      else b.scale.set(1, 1, 1);
    }
  }
  if (f.subs) {
    for (const sub of Object.values(f.subs)) {
      sub.hp = sub.max;
      sub.detached = false;
      sub.stump = null;
      sub.oilAcc = 0;
      sub.sparkAcc = 0;
      sub.lostT = 0;
      for (const b of sub.rootBones) {
        if (b.userData.homeScale) b.scale.copy(b.userData.homeScale);
        else b.scale.set(1, 1, 1);
      }
    }
  }
  for (const id of DAMAGE.order) {
    const part = f.parts[id];
    part.oilAcc = 0;
    part.sparkAcc = 0;
    part.lostT = 0;
  }
  for (const mesh of f.skinMeshes || []) restoreMesh(mesh);
  f.model.rotation.z = 0;
  f.model.position.y = f.baseY;
}

export function syncPartHud(f, el) {
  if (!f || !f.parts || !el) return;
  const nodes = el.querySelectorAll('[data-part]');
  nodes.forEach((n) => {
    const key = n.dataset.part;
    const sub = f.subs && f.subs[key];
    if (sub) {
      // Hand / foot pip: worn when hurt or missing fingers/toes, dark when gone.
      const kids = DAMAGE.subOrder.filter((id) => DAMAGE.sub[id].parent === key);
      const lost = kids.filter((id) => f.subs[id].detached).length;
      n.classList.remove('hurt', 'wreck');
      if (sub.detached) n.classList.add('wreck');
      else if (lost || sub.hp < sub.max * 0.7) n.classList.add('hurt');
      const what = key.startsWith('hand') ? 'fingers' : 'toes';
      n.title = `${DAMAGE.sub[key].label}: ${sub.detached ? 'gone' : `${Math.round(sub.hp)}/${sub.max}${lost ? `, ${lost} ${what} lost` : ''}`}`;
      return;
    }
    const part = f.parts[key];
    if (!part) return;
    n.classList.remove('hurt', 'wreck');
    if (part.detached || part.hp <= 0) n.classList.add('wreck');
    else if (part.hp < part.max * 0.7) n.classList.add('hurt');
    n.title = `${DAMAGE.parts[part.id].label}: ${part.detached ? 'gone' : `${Math.round(part.hp)}/${part.max}`}`;
  });
}

export function stepDebrisSeconds(scene, seconds) {
  const step = 1 / 60;
  let t = 0;
  while (t < seconds) {
    stepDamage(scene, step);
    t += step;
  }
}

export function previewDamage(p2, scene, towardCam) {
  const dir = towardCam.clone().normalize();
  const base = p2.root.position;
  const hits = [
    { id: 'torso', dmg: 16, off: new THREE.Vector3(-0.05, 1.35, 0.2) },
    { id: 'torso', dmg: 14, off: new THREE.Vector3(0.12, 1.15, 0.18) },
    { id: 'torso', dmg: 12, off: new THREE.Vector3(-0.1, 1.5, 0.1) },
    { id: 'head', dmg: 14, off: new THREE.Vector3(0.02, 2.05, 0.16) },
    { id: 'legR', dmg: 16, off: new THREE.Vector3(0.12, 0.7, 0.14) },
    { id: 'armL', dmg: 14, off: new THREE.Vector3(-0.35, 1.45, 0.15) },
    { id: 'armL', dmg: 20, off: new THREE.Vector3(-0.4, 1.35, 0.2) },
  ];
  let last = new THREE.Vector3(base.x, 1.4, base.z);
  for (const h of hits) {
    const point = new THREE.Vector3(base.x + h.off.x, base.y + h.off.y, base.z + h.off.z);
    last.copy(point);
    applyPartHit(p2, h.id, h.dmg, point, dir, scene, { blocked: false });
  }
  // Send the torn-off piece forward onto the mat, in front of the fighter.
  for (const d of debrisList) {
    if (d.owner === p2.id && d.phys && d.phys.body) {
      d.phys.body.velocity.set(-0.55, 1.85, 1.25);
      d.phys.body.angularVelocity.set(2.2, -1.4, 3.1);
    }
  }
  emitSparks(last, dir, 20);
  addSparkScene(scene);
  const step = 1 / 60;
  for (let time = 0; time < 1.2; time += step) {
    stepPhysics(step);
    stepDamage(scene, step);
  }
  for (const d of debrisList) {
    if (d.owner !== p2.id) continue;
    const targetX = p2.root.position.x - 0.55;
    const targetZ = p2.root.position.z + 1.55;
    const mesh = (d.phys && d.phys.mesh) || d.obj;
    if (d.phys && d.phys.body) {
      d.phys.body.position.x += (targetX - d.phys.body.position.x) * 0.8;
      d.phys.body.position.z += (targetZ - d.phys.body.position.z) * 0.8;
      if (d.phys.body.position.y < 0.12) d.phys.body.position.y = 0.12;
      d.phys.body.velocity.setZero();
      d.phys.body.angularVelocity.setZero();
    } else if (mesh) {
      mesh.position.x += (targetX - mesh.position.x) * 0.8;
      mesh.position.z += (targetZ - mesh.position.z) * 0.8;
      if (mesh.position.y < 0.12) mesh.position.y = 0.12;
    }
    if (d.phys) { d.phys.settled = true; if (!d.phys.frozen) freezeDebris(d.phys); }
    d.settled = true;
    if (mesh) { d.obj.position.copy(mesh.position); mesh.updateMatrix(); }
  }
  const debris = debrisList.map((d) => ({
    x: d.obj.position.x, y: d.obj.position.y, z: d.obj.position.z, settled: d.settled, owner: d.owner,
  }));
  return { last, debris };
}


/** Hidden stand-ins so renderer.compile can warm sparks, oil, puddles and smoke. */
export function warmupDamage(scene) {
  if (!scene || warmupDamage._done) return;
  warmupDamage._done = true;
  getPuddleMats();
  const g = new THREE.Group();
  g.visible = false;
  g.add(new THREE.Mesh(SPARK_GEO, sparkMat));
  g.add(new THREE.Mesh(SPARK_GEO, sparkMatHot));
  g.add(new THREE.Mesh(OIL_GEO, oilDropMat));
  g.add(new THREE.Mesh(SMOKE_GEO, smokeMat));
  const puddles = getPuddleMats();
  if (puddles && puddles[0]) g.add(new THREE.Mesh(PUDDLE_GEO, puddles[0]));
  scene.add(g);
  warmupDamage._group = g;
}
export function warmupDamageCleanup(scene) {
  const g = warmupDamage._group;
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  warmupDamage._group = null;
}

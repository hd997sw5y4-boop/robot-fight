import { playSfx } from './audio.js';
import { spawnDebris, clearPhysicsDebris, PART_MASS, stepPhysics } from './physics.js';
import * as THREE from 'three';
import { DAMAGE, ARENA } from './config.js';

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
    parts[id] = {
      id,
      max: spec.hp,
      hp: spec.hp,
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
    if (!used || used.size <= 1) return;
    for (const id of used) {
      if (parts[id] && !parts[id].skinned.includes(o)) parts[id].skinned.push(o);
    }
  });

  f.parts = parts;
  f.limpT = 0;
  f.headFlick = 0;
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
  if (l.detached && r.detached) return 0.16;
  let mul = 1;
  for (const leg of [l, r]) {
    if (leg.detached) mul *= 0.58;
    else mul *= 1 - 0.4 * (1 - leg.hp / leg.max);
  }
  return mul;
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

export function pickHit(atk, def, kind, towardFn) {
  const base = def.root.position;
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

function dentMesh(mesh, worldPoint, worldDir, amount, partCode) {
  const pos = mesh.geometry.attributes.position;
  const col = mesh.geometry.attributes.color;
  const rest = mesh.userData.restPos;
  if (!pos || !rest) return;
  const vertPart = mesh.userData.vertPart;
  mesh.updateWorldMatrix(true, false);
  const localHit = mesh.worldToLocal(worldPoint.clone());
  const inv = _m.copy(mesh.matrixWorld).invert();
  const localDir = worldDir.clone().transformDirection(inv);
  if (localDir.lengthSq() < 1e-6) localDir.set(0, 0, 1);
  else localDir.normalize();
  mesh.getWorldScale(_v);
  const scale = Math.max(_v.x, 0.08);
  const radius = DAMAGE.dent.radius / scale;
  const depth = (DAMAGE.dent.depth * amount) / scale;
  const maxDepth = DAMAGE.dent.maxDepth / scale;
  for (let i = 0; i < pos.count; i++) {
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
      const dark = 1 - DAMAGE.dent.colorDarken * falloff * Math.min(amount, 1.4);
      col.setXYZ(i, col.getX(i) * dark, col.getY(i) * dark * 0.92, col.getZ(i) * dark * 0.78);
    }
  }
  pos.needsUpdate = true;
  if (col) col.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function dentPart(part, worldPoint, worldDir, amount) {
  const code = DAMAGE.order.indexOf(part.id) + 1;
  for (const mesh of part.meshes.concat(part.skinned)) {
    if (!mesh.visible || mesh.userData.hiddenPart) continue;
    dentMesh(mesh, worldPoint, worldDir, amount, mesh.userData.vertPart ? code : 0);
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

function collapseSkinnedVertices(mesh, keepVertex) {
  const pos = mesh.geometry.attributes.position;
  const rest = mesh.userData.restPos;
  if (!pos) return;
  for (let i = 0; i < pos.count; i++) {
    if (keepVertex && !keepVertex(i)) continue;
    const i3 = i * 3;
    // Collapse toward the vertex's original neighbor average is hard; pinch to origin of the part in bind space.
    // Using the rest-position centroid of collapsed verts would be nicer; pinch toward (0, restY, 0) is unstable.
    // Leave a crushed stub by lerping strongly toward rest-space hit? Just shrink to the average of remaining verts later.
    // For now, copy a nearby kept vertex if possible — actually set to rest and scale toward mesh local 0.
    const rx = rest ? rest[i3] : pos.getX(i);
    const ry = rest ? rest[i3 + 1] : pos.getY(i);
    const rz = rest ? rest[i3 + 2] : pos.getZ(i);
    pos.setXYZ(i, rx * 0.05, ry, rz * 0.05);
  }
  pos.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
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

  const shared = new Set();
  for (const mesh of part.skinned) {
    const used = mesh.userData.vertPartsUsed;
    const exclusive = !used || used.size <= 1;
    if (exclusive) {
      const baked = bakeSkinnedWorld(mesh, null);
      if (baked) pieces.push(baked);
      mesh.visible = false;
      mesh.userData.hiddenPart = true;
    } else {
      shared.add(mesh);
    }
  }
  for (const mesh of shared) {
    const keep = (i) => mesh.userData.vertPart && mesh.userData.vertPart[i] === code;
    const baked = bakeSkinnedWorld(mesh, keep);
    if (baked) pieces.push(baked);
    collapseSkinnedVertices(mesh, keep);
  }

  // Hide leftover exclusive skinned already handled; zero the limb bones as a Mixamo fallback.
  for (const b of part.bones) {
    const n = normName(b.name);
    if (n.includes('spine') || n.includes('hips') || n.includes('body') || n === 'torso' || n === 'abdomen') continue;
    b.scale.set(0.001, 0.001, 0.001);
  }

  const pivot = attachPivot(pieces, scene);
  if (!pivot) return;
  const impulse = dir.clone().normalize();
  const vel = new THREE.Vector3(
    impulse.x * 3.2 + (Math.random() - 0.5) * 1.4,
    2.4 + Math.random() * 1.3,
    impulse.z * 3.2 + (Math.random() - 0.5) * 1.4,
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
  part.stump = part.bones.find((b) => {
    const n = normName(b.name);
    return !n.endsWith('end') && !n.includes('pole');
  }) || null;
  emitSparks(pivot.position, impulse, 22);
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

function emitSmoke(point) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0x8a8f96,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    toneMapped: false,
  });
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

function addSparkScene(scene) {
  for (const s of sparks) {
    if (s.m.userData.worldSpark && !s.m.parent) scene.add(s.m);
    s.m.userData.worldSpark = false;
  }
  for (const s of smokes) {
    if (!s.m.parent) scene.add(s.m);
  }
}

export function applyPartHit(f, partId, damage, point, dir, scene, opts = {}) {
  const part = f.parts[partId];
  if (!part || part.detached) return { wrecked: false, point };
  const amount = opts.blocked ? 0.45 : 1;
  const dmg = Math.max(1, Math.round(damage * amount));
  const force = opts.force != null ? opts.force : (dmg / 8);
  part.hp = Math.max(0, part.hp - dmg);
  part.wear = (part.wear || 0) + force;
  const dentAmt = (opts.blocked ? 0.4 : 1) * Math.min(2.6, (0.4 + force * 0.32) * (1 + Math.min(1.2, part.wear * 0.08)));
  dentPart(part, point, dir, dentAmt);
  emitSparks(point, dir, opts.blocked ? 8 : 18 + Math.min(16, Math.round(force * 3)));
  addSparkScene(scene);
  let wrecked = false;
  if (part.hp <= 0 && part.canDetach && !part.detached) {
    detachPart(f, part, dir, scene);
    wrecked = true;
  }
  return { wrecked, point, partId };
}

export function stepDamage(scene, dt) {
  addSparkScene(scene);
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
      s.m.material.dispose();
      smokes.splice(i, 1);
    }
  }
}

function clampXZ(x, z, pad) {
  const a = 6.1 - pad;
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
  f.limpT = (f.limpT || 0) + dt;
  const l = f.parts.legL;
  const r = f.parts.legR;
  const limp = Math.max(
    l.detached ? 1 : 1 - l.hp / l.max,
    r.detached ? 1 : 1 - r.hp / r.max,
  );
  f.model.position.y = f.baseY + Math.abs(Math.sin(f.limpT * 10)) * 0.07 * limp;
  const sway = Math.sin(f.limpT * 7) * 0.09 * limp;
  f.model.rotation.z = sway;

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
  if (pos) mesh.geometry.computeVertexNormals();
  for (const m of [].concat(mesh.material)) {
    if (!m || !m.emissive) continue;
    m.emissive.setHex(0x000000);
    m.emissiveIntensity = 0;
  }
}

export function clearAllDebris(scene) {
  clearPhysicsDebris();
  for (const d of debrisList) {
    d.obj.traverse((o) => {
      if (o.isMesh && o.geometry && !o.userData.deformReady) {
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
    for (const mesh of part.meshes.concat(part.skinned)) restoreMesh(mesh);
    for (const b of part.bones) {
      if (b.userData.homeScale) b.scale.copy(b.userData.homeScale);
      else b.scale.set(1, 1, 1);
    }
  }
  f.model.rotation.z = 0;
  f.model.position.y = f.baseY;
}

export function syncPartHud(f, el) {
  if (!f || !f.parts || !el) return;
  const nodes = el.querySelectorAll('[data-part]');
  nodes.forEach((n) => {
    const part = f.parts[n.dataset.part];
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
    if (d.phys && d.phys.body) {
      d.phys.body.position.x += (targetX - d.phys.body.position.x) * 0.8;
      d.phys.body.position.z += (targetZ - d.phys.body.position.z) * 0.8;
      if (d.phys.body.position.y < 0.12) d.phys.body.position.y = 0.12;
      d.phys.body.velocity.setZero();
      d.phys.body.angularVelocity.setZero();
      d.phys.settled = true;
    }
    d.settled = true;
    if (d.phys && d.phys.mesh) {
      d.obj.position.copy(d.phys.mesh.position);
    }
  }
  const debris = debrisList.map((d) => ({
    x: d.obj.position.x, y: d.obj.position.y, z: d.obj.position.z, settled: d.settled, owner: d.owner,
  }));
  return { last, debris };
}

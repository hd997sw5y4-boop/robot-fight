import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODEL, ARENA, COMBAT, GFX_PRESETS, LOOP_CLIPS } from './config.js';
import { getSettings, isSettingsOpen, initSettings, updateFps } from './settings.js';
import { unlockAudio, playSfx } from './audio.js';
import {
  prepareFighterDamage,
  canPunch,
  canKick,
  canBlock,
  attackMods,
  moveSpeedMul,
  blockReductionMul,
  pickHit,
  applyPartHit,
  stepDamage,
  applyMalfunctions,
  resetFighterDamage,
  clearAllDebris,
  syncPartHud,
  previewDamage,
} from './damage.js';

const canvas = document.getElementById('c');
const keys = new Set();
const held = { punch: false, kick: false };

let gfxKey = getSettings().gfx === 'low' ? 'low' : 'high';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0c12);
scene.fog = new THREE.Fog(0x0a0c12, 16, 38);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
camera.position.set(0, 3.2, 12.5);

const hemi = new THREE.HemisphereLight(0xb9d4ff, 0x1a120c, 0.55);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xfff1dd, 2.15);
keyLight.position.set(5.5, 10, 6);
keyLight.userData.wantsShadow = true;
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 30;
keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.right = keyLight.shadow.camera.top = 12;
keyLight.shadow.bias = -0.00025;
scene.add(keyLight);

const fill = new THREE.DirectionalLight(0x7ea7ff, 0.55);
fill.position.set(-6, 4, -3);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x9ad0ff, 0.7);
rim.position.set(0, 3, -8);
scene.add(rim);

const spot = new THREE.SpotLight(0xfff6e8, 8, 16, Math.PI / 4.2, 0.6, 1.2);
spot.position.set(0, 5.9, 0);
spot.target.position.set(0, 0, 0);
spot.userData.wantsShadow = true;
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
scene.add(spot);
scene.add(spot.target);

const hitLight = new THREE.PointLight(0xffe08a, 0, 5);
scene.add(hitLight);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
scene.environmentIntensity = 0.45;

function applyGfx(key) {
  gfxKey = key === 'low' ? 'low' : 'high';
  const p = GFX_PRESETS[gfxKey];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelCap));
  renderer.toneMappingExposure = p.exposure;
  renderer.shadowMap.enabled = p.shadows;
  scene.traverse((o) => {
    if (o.isLight && o.shadow) {
      o.castShadow = !!(p.shadows && o.userData.wantsShadow);
      o.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      if (o.shadow.map) {
        o.shadow.map.dispose();
        o.shadow.map = null;
      }
    }
  });
  resize();
}

function resize() {
  const w = window.innerWidth;
  const h = Math.max(window.innerHeight, 1);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
initSettings({
  applyGfx,
  onChange(s) {
    if (s.round === 0) {
      match.roundLeft = null;
      paintRound();
    }
  },
});
window.addEventListener('pointerdown', unlockAudio, { once: true });

const texLoader = new THREE.TextureLoader();
function loadTex(url, colorSpace) {
  const t = texLoader.load(url);
  if (colorSpace) t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const metalColor = loadTex('./textures/metal_color.jpg', THREE.SRGBColorSpace);
const metalRough = loadTex('./textures/metal_rough.jpg');
const metalMetal = loadTex('./textures/metal_metalness.jpg');

function tiled(src, sx, sy) {
  const t = src.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(sx, sy);
  t.needsUpdate = true;
  return t;
}

function buildArena() {
  const group = new THREE.Group();
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x2a3038,
    metalness: 0.22,
    roughness: 0.68,
    map: tiled(metalColor, 4, 4),
    roughnessMap: tiled(metalRough, 4, 4),
    metalnessMap: tiled(metalMetal, 4, 4),
  });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ARENA.floorThickness, 8), floorMat);
  floor.position.y = -ARENA.floorThickness / 2;
  floor.rotation.y = Math.PI / 8;
  floor.receiveShadow = true;
  group.add(floor);

  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.12, 8),
    new THREE.MeshStandardMaterial({
      color: 0x8f9aa4,
      metalness: 0.9,
      roughness: 0.3,
      map: tiled(metalColor, 6, 0.4),
      roughnessMap: tiled(metalRough, 6, 0.4),
    }),
  );
  edge.position.y = 0.02;
  edge.rotation.y = Math.PI / 8;
  edge.receiveShadow = true;
  edge.castShadow = true;
  group.add(edge);

  const lineMat = new THREE.MeshStandardMaterial({
    color: 0x9fe7ff,
    emissive: 0x4bb8d8,
    emissiveIntensity: 0.7,
    metalness: 0.2,
    roughness: 0.35,
  });
  const inner = new THREE.Mesh(new THREE.RingGeometry(a - 0.18, a - 0.04, 8), lineMat);
  inner.rotation.x = -Math.PI / 2;
  inner.rotation.z = Math.PI / 8;
  inner.position.y = 0.008;
  group.add(inner);

  const center = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.68, 48), lineMat.clone());
  center.rotation.x = -Math.PI / 2;
  center.position.y = 0.008;
  group.add(center);

  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 9, r + 9, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0x12151c, metalness: 0.2, roughness: 0.9 }),
  );
  apron.position.y = -0.22;
  apron.rotation.y = Math.PI / 8;
  apron.receiveShadow = true;
  group.add(apron);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 12, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x10141c, roughness: 0.95, metalness: 0.05, side: THREE.BackSide }),
  );
  wall.position.y = 5;
  group.add(wall);

  const postMat = new THREE.MeshStandardMaterial({
    color: 0xc5ccd3,
    metalness: 1,
    roughness: 0.28,
    map: tiled(metalColor, 1, 3),
    roughnessMap: tiled(metalRough, 1, 3),
    metalnessMap: tiled(metalMetal, 1, 3),
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x9aa3ab,
    metalness: 0.95,
    roughness: 0.32,
    map: tiled(metalColor, 3, 0.4),
    roughnessMap: tiled(metalRough, 3, 0.4),
  });
  const lightMat = new THREE.MeshStandardMaterial({
    color: 0xdff6ff,
    emissive: 0x7ec8e3,
    emissiveIntensity: 1.2,
    metalness: 0.3,
    roughness: 0.25,
  });

  const postH = 3.15;
  const corners = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    corners.push(new THREE.Vector3(x, 0, z));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, postH, 16), postMat);
    post.position.set(x, postH / 2, z);
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 16), lightMat);
    cap.position.set(x, postH + 0.02, z);
    group.add(cap);
  }

  const railHeights = [0.65, 1.45, 2.25];
  const xAxis = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < 8; i++) {
    const apos = corners[i];
    const bpos = corners[(i + 1) % 8];
    const dir = new THREE.Vector3().subVectors(bpos, apos);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(apos, bpos).multiplyScalar(0.5);
    const quat = new THREE.Quaternion().setFromUnitVectors(xAxis, dir.normalize());
    for (const h of railHeights) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 8), railMat);
      rail.geometry.rotateZ(Math.PI / 2);
      rail.quaternion.copy(quat);
      rail.position.set(mid.x, h, mid.z);
      rail.castShadow = true;
      group.add(rail);
    }
  }

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff3d6, emissiveIntensity: 2, roughness: 0.3 }),
  );
  bulb.position.set(0, 5.9, 0);
  group.add(bulb);

  scene.add(group);
}

function clampToOctagon(x, z, padding) {
  const a = ARENA.apothem - padding;
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

function findClip(clips, name) {
  const lower = name.toLowerCase();
  return clips.find((c) => c.name === name) || clips.find((c) => c.name.toLowerCase() === lower);
}

function tint(root, color) {
  const c = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = [].concat(o.material);
    o.material = mats.length === 1 ? mats[0].clone() : mats.map((m) => m.clone());
    for (const m of [].concat(o.material)) {
      if (m && m.color) m.color.lerp(c, 0.38);
      if (m && m.aoMap && o.geometry && o.geometry.attributes.uv && !o.geometry.attributes.uv2) {
        o.geometry.setAttribute('uv2', o.geometry.attributes.uv);
      }
    }
    o.castShadow = true;
    o.receiveShadow = true;
  });
}


function meshBox(root) {
  const box = new THREE.Box3();
  let found = false;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh) return;
    box.expandByObject(o);
    found = true;
  });
  return found && Number.isFinite(box.min.y) ? box : null;
}

function makeFighter(gltf, color, side) {
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  const box = meshBox(model);
  const height = box ? box.getSize(new THREE.Vector3()).y : 0;
  const scale = height > 0.001 ? (MODEL.targetHeight / height) : (MODEL.scale || 1);
  model.scale.setScalar(scale);
  const box2 = meshBox(model);
  if (box2) model.position.y = -box2.min.y + MODEL.footOffset;
  tint(model, color);
  root.add(model);

  const shield = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 6),
    new THREE.MeshStandardMaterial({
      color: 0x7ec8e3,
      emissive: 0x3aa8c8,
      emissiveIntensity: 0.85,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      metalness: 0.2,
      roughness: 0.3,
    }),
  );
  shield.position.set(0, 1.05, 0.55);
  shield.visible = false;
  root.add(shield);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of gltf.animations) {
    const act = mixer.clipAction(clip);
    const loop = LOOP_CLIPS.includes(clip.name);
    act.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    if (!loop) act.clampWhenFinished = true;
    actions[clip.name] = act;
  }
  for (const [key, val] of Object.entries(MODEL.animations)) {
    if (typeof val === 'string' && actions[val]) actions[key] = actions[val];
  }
  const startIdle = MODEL.animations.idle || 'FightingIdle';
  if (actions[startIdle]) actions[startIdle].play();
  mixer.update(0);
  const box3 = meshBox(model);
  if (box3) model.position.y = -box3.min.y + MODEL.footOffset;

  const startX = side === 'p1' ? -2.15 : 2.15;
  root.position.set(startX, 0, 0);

  let hips = null;
  let spine = null;
  model.traverse((o) => {
    if (o.name === 'mixamorig:Hips') hips = o;
    if (o.name === 'mixamorig:Spine' || o.name === 'mixamorig:Spine1') spine = spine || o;
  });

  const f = {
    id: side,
    root,
    model,
    shield,
    mixer,
    actions,
    current: MODEL.animations.idle || 'FightingIdle',
    health: COMBAT.maxHealth,
    state: 'idle',
    stateT: 0,
    cooldown: 0,
    invuln: 0,
    blocking: false,
    hitThisAttack: false,
    startX,
    baseY: model.position.y,
    hips,
    spine,
    hipsBind: hips ? hips.position.clone() : null,
  };

  mixer.addEventListener('finished', () => {
    if (f.state === 'ko') return;
    if (f.health > 0 && (f.state === 'punch' || f.state === 'kick' || f.state === 'hit')) {
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.15);
    }
  });
  prepareFighterDamage(f);
  return f;
}

function resolveClip(f, name) {
  if (name && f.actions[name]) return name;
  const mapped = MODEL.animations[name];
  if (typeof mapped === 'string' && f.actions[mapped]) return mapped;
  if (Array.isArray(mapped)) {
    const found = mapped.find((n) => f.actions[n]);
    if (found) return found;
  }
  return null;
}

function setAnim(f, name, fade = 0.12) {
  const clipName = resolveClip(f, name);
  if (!clipName) return;
  const next = f.actions[clipName];
  const oneshot = ['punch', 'kick', 'hit', 'ko', 'getUp', 'GettingUp', 'KnockedOut'].includes(name)
    || (MODEL.animations.punchVariants || []).includes(clipName)
    || (MODEL.animations.kickVariants || []).includes(clipName)
    || (MODEL.animations.kickSpecial || []).includes(clipName)
    || clipName === 'KnockedOut' || clipName === 'GettingUp';
  if (f.current === clipName) {
    if (oneshot) next.reset().play();
    return;
  }
  const prev = f.actions[f.current];
  next.reset();
  next.enabled = true;
  if (prev) prev.crossFadeTo(next, fade, false);
  else next.fadeIn(fade);
  next.play();
  f.current = clipName;
}

function pickClip(list, fallback) {
  if (list && list.length) return list[Math.floor(Math.random() * list.length)];
  return fallback;
}

function hitClipFor(partId) {
  const map = MODEL.animations.hitByPart || {};
  return pickClip(map[partId] || map.torso, MODEL.animations.hit || 'Stunned');
}

function idleClipFor(f) {
  const injured = MODEL.animations.idleInjured;
  if (injured && f.actions[injured]) {
    const lowHp = f.health <= COMBAT.maxHealth * 0.4;
    const l = f.parts && f.parts.legL;
    const r = f.parts && f.parts.legR;
    const legsBad = !!(l && r && (
      l.detached || r.detached
      || ((1 - l.hp / l.max) + (1 - r.hp / r.max)) / 2 >= 0.5
    ));
    if (lowHp || legsBad) return injured;
  }
  return MODEL.animations.idle || 'FightingIdle';
}

function moveClipFor(sidestep, inout) {
  const ax = Math.abs(sidestep);
  const az = Math.abs(inout);
  if (ax >= az) return sidestep < 0 ? (MODEL.animations.strafeLeft || 'JogStrafeLeft') : (MODEL.animations.strafeRight || 'JogStrafeRight');
  return inout > 0 ? (MODEL.animations.walkForward || 'Walking') : (MODEL.animations.walkBack || 'WalkingBackwards');
}

window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.key === 'Escape') return;
  if (isSettingsOpen()) return;
  keys.add(e.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function rawInput() {
  const inp = { sidestep: 0, inout: 0, punch: false, kick: false, block: false };
  if (keys.has('a') || keys.has('arrowleft')) inp.sidestep -= 1;
  if (keys.has('d') || keys.has('arrowright')) inp.sidestep += 1;
  if (keys.has('w') || keys.has('arrowup')) inp.inout += 1;
  if (keys.has('s') || keys.has('arrowdown')) inp.inout -= 1;
  inp.punch = keys.has('j');
  inp.kick = keys.has('k');
  inp.block = keys.has('l');

  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    const dead = 0.28;
    if (Math.abs(gp.axes[0] || 0) > dead) inp.sidestep += gp.axes[0];
    if (Math.abs(gp.axes[1] || 0) > dead) inp.inout -= gp.axes[1];
    if (gp.buttons[14]?.pressed) inp.sidestep -= 1;
    if (gp.buttons[15]?.pressed) inp.sidestep += 1;
    if (gp.buttons[12]?.pressed) inp.inout += 1;
    if (gp.buttons[13]?.pressed) inp.inout -= 1;
    if (gp.buttons[0]?.pressed) inp.punch = true;
    if (gp.buttons[1]?.pressed) inp.kick = true;
    if (gp.buttons[2]?.pressed || gp.buttons[4]?.pressed || gp.buttons[5]?.pressed || gp.buttons[7]?.pressed) {
      inp.block = true;
    }
  }
  inp.sidestep = Math.max(-1, Math.min(1, inp.sidestep));
  inp.inout = Math.max(-1, Math.min(1, inp.inout));
  return inp;
}

function consumeAttacks(inp) {
  const punch = inp.punch && !held.punch;
  const kick = inp.kick && !held.kick;
  held.punch = inp.punch;
  held.kick = inp.kick;
  return { sidestep: inp.sidestep, inout: inp.inout, punch, kick, block: inp.block };
}

function toward(me, other) {
  const v = new THREE.Vector3(
    other.root.position.x - me.root.position.x,
    0,
    other.root.position.z - me.root.position.z,
  );
  if (v.lengthSq() < 1e-6) return new THREE.Vector3(me.id === 'p1' ? 1 : -1, 0, 0);
  return v.normalize();
}

function moveFighter(f, other, sidestep, inout, dt, speed) {
  const fwd = toward(f, other);
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const vel = new THREE.Vector3();
  vel.addScaledVector(right, sidestep);
  vel.addScaledVector(fwd, inout);
  if (vel.lengthSq() > 1) vel.normalize();
  const p = f.root.position;
  p.x += vel.x * speed * dt;
  p.z += vel.z * speed * dt;
  const clamped = clampToOctagon(p.x, p.z, 0.55);
  p.x = clamped[0];
  p.z = clamped[1];
}

function separate(a, b) {
  const dx = b.root.position.x - a.root.position.x;
  const dz = b.root.position.z - a.root.position.z;
  const d = Math.hypot(dx, dz);
  const min = COMBAT.separate;
  if (d < min && d > 1e-4) {
    const push = (min - d) / 2;
    const nx = dx / d;
    const nz = dz / d;
    a.root.position.x -= nx * push;
    a.root.position.z -= nz * push;
    b.root.position.x += nx * push;
    b.root.position.z += nz * push;
    const ca = clampToOctagon(a.root.position.x, a.root.position.z, 0.55);
    const cb = clampToOctagon(b.root.position.x, b.root.position.z, 0.55);
    a.root.position.x = ca[0];
    a.root.position.z = ca[1];
    b.root.position.x = cb[0];
    b.root.position.z = cb[1];
  }
}

function faceEachOther(a, b) {
  if (a.state !== 'ko') a.root.lookAt(b.root.position.x, a.root.position.y, b.root.position.z);
  if (b.state !== 'ko') b.root.lookAt(a.root.position.x, b.root.position.y, a.root.position.z);
}

function tryAttack(f, kind, clipName) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick') return;
  if (f.cooldown > 0) return;
  if (kind === 'punch' && !canPunch(f)) return;
  if (kind === 'kick' && !canKick(f)) return;
  const spec = COMBAT[kind];
  const mods = attackMods(f, kind);
  const clip = clipName || MODEL.animations[kind];
  f.state = kind;
  f.stateT = 0;
  f.hitThisAttack = false;
  f.atkMods = mods;
  f.attackClip = clip;
  f.blocking = false;
  f.shield.visible = false;
  setAnim(f, clip, 0.08);
  playSfx('whoosh');
  const action = f.actions[clip] || f.actions[kind];
  if (action) {
    action.timeScale = mods.timeScale;
    const dur = action.getClip().duration / Math.max(0.2, mods.timeScale);
    f.cooldown = Math.max(spec.cooldown, dur * 0.55) * mods.cooldownMul;
  } else {
    f.cooldown = spec.cooldown * mods.cooldownMul;
  }
}

function tryBlock(f, heldBlock) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick') {
    f.blocking = false;
    f.shield.visible = false;
    return;
  }
  heldBlock = heldBlock && canBlock(f);
  f.blocking = heldBlock;
  f.shield.visible = heldBlock;
  if (heldBlock) {
    if (f.state !== 'block') {
      f.state = 'block';
      setAnim(f, f.blockClip || MODEL.animations.block, 0.1);
    }
  } else if (f.state === 'block') f.state = 'idle';
}

function attackHits(atk, def, spec) {
  return atk.root.position.distanceTo(def.root.position) <= spec.range;
}

function applyHit(atk, def, spec, kind) {
  if (def.state === 'ko' || def.invuln > 0) return;
  const blocked = def.blocking;
  const mul = (atk.atkMods && atk.atkMods.damageMul) || 1;
  const blockMul = blocked ? (1 - COMBAT.blockReduction * blockReductionMul(def)) : 1;
  const dmg = Math.max(1, Math.round(spec.damage * mul * blockMul));
  def.health = Math.max(0, def.health - dmg);
  const hit = pickHit(atk, def, kind || 'punch', toward);
  applyPartHit(def, hit.partId, dmg, hit.point, hit.dir, scene, { blocked });
  hitLight.color.setHex(blocked ? 0x88ccff : 0xffe08a);
  hitLight.intensity = 9;
  hitLight.position.copy(hit.point);
  playSfx(blocked ? 'block' : 'hit');
  addShake(blocked ? 0.08 : 0.16 + dmg * 0.01);
  const fwd = hit.dir;
  const kb = COMBAT.knockback * (blocked ? 0.35 : 1);
  def.root.position.x += fwd.x * kb;
  def.root.position.z += fwd.z * kb;
  const c = clampToOctagon(def.root.position.x, def.root.position.z, 0.55);
  def.root.position.x = c[0];
  def.root.position.z = c[1];
  if (def.health <= 0) {
    ko(def, atk);
    return;
  }
  if (!blocked) {
    def.state = 'hit';
    def.stateT = 0;
    def.invuln = COMBAT.hitInvuln;
    def.blocking = false;
    def.shield.visible = false;
    const heavy = dmg >= 12 && def.actions[MODEL.animations.hitHeavy];
    setAnim(def, heavy ? MODEL.animations.hitHeavy : hitClipFor(hit.partId), 0.06);
  }
}

function ko(loser, winner) {
  loser.health = 0;
  loser.state = 'ko';
  loser.blocking = false;
  loser.shield.visible = false;
  setAnim(loser, 'ko', 0.12);
  match.over = true;
  match.winner = winner.id;
  document.getElementById('ko-title').textContent = winner.id === 'p1' ? 'Blue wins' : 'Red wins';
  document.getElementById('ko-sub').textContent = winner.id === 'p1' ? 'You won the fight.' : 'CPU won the fight.';
  document.getElementById('overlay').classList.remove('hidden');
  playSfx('ko');
  addShake(0.28);
}

const ai = { t: 0, sidestep: 0, inout: 0, block: false, punch: false, kick: false };

function aiProfile() {
  const d = getSettings().cpu;
  if (d === 'easy') return { think: [0.45, 0.85], react: 0.18, punch: 0.32, kick: 0.14, special: 0.05, block: 0.18 };
  if (d === 'hard') return { think: [0.10, 0.16], react: 0.62, punch: 0.55, kick: 0.28, special: 0.38, block: 0.22 };
  return { think: [0.22, 0.25], react: 0.4, punch: 0.5, kick: 0.25, special: 0.22, block: 0.13 };
}

function updateAI(cpu, player, dt) {
  ai.punch = false;
  ai.kick = false;
  ai.punchClip = null;
  ai.kickClip = null;
  ai.t -= dt;
  if (cpu.state === 'ko' || cpu.state === 'hit' || cpu.state === 'punch' || cpu.state === 'kick') {
    ai.block = false;
    return ai;
  }
  const d = cpu.root.position.distanceTo(player.root.position);
  if (ai.t <= 0) {
    const prof = aiProfile();
    ai.t = prof.think[0] + Math.random() * prof.think[1];
    ai.block = false;
    if ((player.state === 'punch' || player.state === 'kick') && d < 1.8 && Math.random() < prof.react) {
      ai.block = true;
      ai.inout = -0.25;
      ai.sidestep = 0;
    } else if (d > 1.45) {
      ai.inout = 1;
      ai.sidestep = (Math.random() - 0.5) * 0.8;
    } else if (d < 0.95) {
      ai.inout = -1;
      ai.sidestep = Math.random() < 0.5 ? 1 : -1;
    } else {
      ai.inout = 0;
      ai.sidestep = (Math.random() - 0.5) * 1.2;
      const r = Math.random();
      if (r < prof.punch) {
        ai.punch = true;
        ai.punchClip = pickClip(MODEL.animations.punchVariants, MODEL.animations.punch);
      } else if (r < prof.punch + prof.kick) {
        ai.kick = true;
        ai.kickClip = Math.random() < prof.special
          ? pickClip(MODEL.animations.kickSpecial, MODEL.animations.kick)
          : pickClip(MODEL.animations.kickVariants, MODEL.animations.kick);
      } else if (r < prof.punch + prof.kick + prof.block) {
        ai.block = true;
        ai.blockClip = pickClip(MODEL.animations.blockVariants, MODEL.animations.block);
      }
    }
  }
  return ai;
}

function stepFighter(f, other, inp, dt) {
  f.cooldown = Math.max(0, f.cooldown - dt);
  f.invuln = Math.max(0, f.invuln - dt);
  f.stateT += dt;
  if (f.state === 'ko') return;

  if (f.state === 'hit') {
    if (f.stateT > COMBAT.hitStun) {
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.12);
    }
    return;
  }

  if (f.state === 'punch' || f.state === 'kick') {
    const spec = COMBAT[f.state];
    const action = f.actions[f.attackClip] || f.actions[f.state] || f.actions[resolveClip(f, f.state)];
    const dur = action ? action.getClip().duration : 0.7;
    const a0 = (spec.activeFrac ? spec.activeFrac[0] * dur : spec.active[0]);
    const a1 = (spec.activeFrac ? spec.activeFrac[1] * dur : spec.active[1]);
    if (!f.hitThisAttack && f.stateT >= a0 && f.stateT <= a1 && attackHits(f, other, spec)) {
      f.hitThisAttack = true;
      applyHit(f, other, spec, f.state);
    }
    if (f.stateT > dur + 0.05 && f.state !== 'ko') {
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.12);
    }
    return;
  }

  f.blockClip = inp.blockClip || null;
  tryBlock(f, inp.block);
  if (inp.punch) tryAttack(f, 'punch', inp.punchClip);
  else if (inp.kick) tryAttack(f, 'kick', inp.kickClip);
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'hit' || f.state === 'ko') return;

  const speed = (f.blocking ? COMBAT.blockMoveSpeed : COMBAT.moveSpeed) * moveSpeedMul(f);
  const moving = Math.abs(inp.sidestep) + Math.abs(inp.inout) > 0.12;
  if (moving) {
    moveFighter(f, other, inp.sidestep, inp.inout, dt, speed);
    if (!f.blocking) {
      f.state = 'walk';
      const clip = moveClipFor(inp.sidestep, inp.inout);
      if (f.current !== clip) setAnim(f, clip, 0.12);
    }
  } else if (!f.blocking) {
    const idle = idleClipFor(f);
    if (f.current !== idle) setAnim(f, idle, 0.18);
    f.state = 'idle';
  }
}

function syncHud() {
  if (!p1 || !p2) return;
  document.getElementById('hp1').style.transform = `scaleX(${Math.max(0, p1.health / COMBAT.maxHealth)})`;
  document.getElementById('hp2').style.transform = `scaleX(${Math.max(0, p2.health / COMBAT.maxHealth)})`;
  syncPartHud(p1, document.getElementById('parts1'));
  syncPartHud(p2, document.getElementById('parts2'));
}

const camT = new THREE.Vector3();
const lookT = new THREE.Vector3();
let shakeAmp = 0;
function addShake(amount) {
  if (!getSettings().shake) return;
  shakeAmp = Math.min(0.45, shakeAmp + amount);
}

function updateCamera(dt) {
  const a = p1.root.position;
  const b = p2.root.position;
  lookT.set((a.x + b.x) / 2, 1.15, (a.z + b.z) / 2);
  const dist = a.distanceTo(b);
  camT.set(lookT.x, 3.15, lookT.z + 11.2 + dist * 0.35);
  camera.position.lerp(camT, dt <= 0 ? 0 : 1 - Math.pow(0.001, dt));
  camera.lookAt(lookT);
  if (shakeAmp > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeAmp;
    camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.55;
    if (dt > 0) shakeAmp = Math.max(0, shakeAmp - dt * 2.4);
  }
}

let p1;
let p2;
const match = { phase: 'intro', introT: 0, over: false, winner: null, roundLeft: null };
const clock = new THREE.Clock();

function paintRound() {
  const el = document.getElementById('round');
  if (!el) return;
  if (match.roundLeft == null) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const t = Math.max(0, Math.ceil(match.roundLeft));
  const m = Math.floor(t / 60);
  const s = String(t % 60).padStart(2, '0');
  el.textContent = m + ':' + s;
  el.classList.toggle('low', t <= 10);
  el.classList.remove('hidden');
}

function startRoundClock() {
  const r = getSettings().round;
  match.roundLeft = r > 0 ? r : null;
  paintRound();
}

function endByTime() {
  if (match.over) return;
  if (p1.health === p2.health) {
    match.over = true;
    match.winner = null;
    document.getElementById('ko-title').textContent = "Time's up";
    document.getElementById('ko-sub').textContent = 'The round ends in a draw.';
    document.getElementById('overlay').classList.remove('hidden');
    playSfx('ko');
    return;
  }
  if (p1.health > p2.health) {
    ko(p2, p1);
    document.getElementById('ko-sub').textContent = 'Time ran out. You had more health.';
  } else {
    ko(p1, p2);
    document.getElementById('ko-sub').textContent = 'Time ran out. CPU had more health.';
  }
}

function stepRound(dt) {
  if (match.roundLeft == null || match.over || match.phase !== 'fight') return;
  match.roundLeft -= dt;
  if (match.roundLeft <= 0) {
    match.roundLeft = 0;
    endByTime();
  }
  paintRound();
}

function poseAfterMixer(f) {
  // Keep the game's movement in charge: pin hips X/Z, leave Y for clip bounce.
  if (f.hips && f.hipsBind) {
    f.hips.position.x = f.hipsBind.x;
    f.hips.position.z = f.hipsBind.z;
  }
  f.model.position.y = f.baseY;
}

function resetMatch() {
  for (const f of [p1, p2]) {
    f.health = COMBAT.maxHealth;
    f.state = 'idle';
    f.stateT = 0;
    f.cooldown = 0;
    f.invuln = 0;
    f.blocking = false;
    f.hitThisAttack = false;
    f.shield.visible = false;
    f.root.position.set(f.startX, 0, 0);
    f.root.scale.set(1, 1, 1);
    f.atkMods = null;
    resetFighterDamage(f, scene);
    setAnim(f, MODEL.animations.getUp || 'idle', 0.08);
    f.state = 'getup';
  }
  clearAllDebris(scene);
  document.getElementById('overlay').classList.add('hidden');
  match.over = false;
  match.winner = null;
  match.phase = 'getup';
  match.getupT = 0;
  match.camLock = false;
  match.roundLeft = null;
  paintRound();
  const banner = document.getElementById('banner');
  banner.style.opacity = '';
  banner.classList.remove('show');
  faceEachOther(p1, p2);
  syncHud();
}

function tick() {
  const rawDt = Math.min(0.05, clock.getDelta());
  updateFps(rawDt);
  const dt = isSettingsOpen() ? 0 : rawDt;
  if (match.phase === 'getup') {
    match.getupT = (match.getupT || 0) + dt;
    const getup = (p1.actions.GettingUp || p1.actions.getUp);
    const dur = getup ? getup.getClip().duration : 2.3;
    if (match.getupT > dur * 0.95) {
      match.phase = 'intro';
      match.introT = 0;
      setAnim(p1, idleClipFor(p1), 0.2);
      setAnim(p2, idleClipFor(p2), 0.2);
      p1.state = 'idle';
      p2.state = 'idle';
      document.getElementById('banner').classList.add('show');
    }
  } else if (match.phase === 'intro') {
    match.introT += dt;
    if (match.introT > 1.05) {
      match.phase = 'fight';
      document.getElementById('banner').classList.remove('show');
      startRoundClock();
    }
  }
  if (match.phase === 'fight' && !match.over) stepRound(dt);
  const canAct = match.phase === 'fight' && !match.over && !isSettingsOpen();
  const pin = canAct ? consumeAttacks(rawInput()) : consumeAttacks({ sidestep: 0, inout: 0, punch: false, kick: false, block: false });
  const ain = canAct ? updateAI(p2, p1, dt) : { sidestep: 0, inout: 0, punch: false, kick: false, block: false };

  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  separate(p1, p2);
  faceEachOther(p1, p2);
  p1.mixer.update(dt);
  p2.mixer.update(dt);
  p1.root.position.y = 0;
  p2.root.position.y = 0;
  poseAfterMixer(p1);
  poseAfterMixer(p2);
  applyMalfunctions(p1, dt);
  applyMalfunctions(p2, dt);
  stepDamage(scene, dt);

  if (!match.camLock) updateCamera(dt);
  hitLight.intensity = Math.max(0, hitLight.intensity - dt * 28);
  syncHud();
  renderer.render(scene, camera);
}

function onLoad(gltf) {
  buildArena();
  p1 = makeFighter(gltf, MODEL.colors.p1, 'p1');
  p2 = makeFighter(gltf, MODEL.colors.p2, 'p2');
  scene.add(p1.root, p2.root);
  applyGfx(gfxKey);
  resize();
  faceEachOther(p1, p2);
  syncHud();
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('banner').classList.add('show');
  document.getElementById('again').addEventListener('click', resetMatch);
  window.__rfPreviewDamage = () => {
    match.phase = 'fight';
    match.introT = 99;
    match.camLock = true;
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '0';
    const towardCam = new THREE.Vector3(0.15, 0.05, 1);
    const info = previewDamage(p2, scene, towardCam);
    const look = new THREE.Vector3(p2.root.position.x - 0.15, 0.75, p2.root.position.z + 0.7);
    camera.position.set(p2.root.position.x - 0.4, 2.55, p2.root.position.z + 5.1);
    camera.lookAt(look);
    window.__rfDebug = info;
    applyMalfunctions(p1, 0);
    applyMalfunctions(p2, 0);
    stepDamage(scene, 0);
    syncHud();
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(tick);
}

const loader = new GLTFLoader();
loader.load(
  MODEL.url,
  onLoad,
  (ev) => {
    if (ev.total) document.getElementById('loadbar').style.width = `${(100 * ev.loaded) / ev.total}%`;
  },
  (err) => {
    document.querySelector('#loader .spin').textContent = 'Could not load the robot model.';
    console.error(err);
  },
);

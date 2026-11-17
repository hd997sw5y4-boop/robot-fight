import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader as RGBELoader } from 'three/addons/loaders/HDRLoader.js';
import { MODEL, ARENA, COMBAT, GFX_PRESETS, LOOP_CLIPS } from './config.js';
import { CLIP_SPEEDS } from './clip-speeds.js';
import { getSettings, isSettingsOpen, initSettings, updateFps, setFov } from './settings.js';
import { unlockAudio, playSfx, playHit, setBuzz, startCrowd } from './audio.js';
import { buildArena as buildArenaVisual, addArenaLights } from './arena.js';
import {
  initArenaPhysics,
  attachFighter,
  setFighterMove,
  stepPhysics,
  enableRagdoll,
  disableRagdoll,
  isRagdoll,
  impactVelocity,
  resetFighterPhysics,
  clearPhysicsDebris,
  onPhysicsBounce,
  isRagdollSettled,
} from './physics.js';
import {
  registerFightRuntime,
  notifyFightEnd,
  defaultFighterConfig,
  AI_PERSONALITIES,
  onFightEnd,
} from './api.js';
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

// [game-shell hook] Optional menus / rounds / ladder layer (js/shell/*.js). No-op when absent.
function shellCall(name, ...args) {
  const sh = window.RFShellHook;
  return sh && typeof sh[name] === 'function' ? sh[name](...args) : undefined;
}
// Lazy read handle for the shell (paint, stats, menu camera, pause via the clock). Getters only.
shellCall('onReady', {
  THREE,
  get camera() { return camera; },
  get clock() { return clock; },
  get match() { return match; },
  get p1() { return p1; },
  get p2() { return p2; },
});

let gfxKey = getSettings().gfx === 'low' ? 'low' : 'high';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080a10);
scene.fog = new THREE.Fog(0x080a10, 18, 42);

function clampFov(v) {
  return Math.max(45, Math.min(90, +v || 50));
}
let fovTarget = clampFov(getSettings().fov);
let fovLive = fovTarget;
const camera = new THREE.PerspectiveCamera(fovLive, 1, 0.1, 80);
camera.position.set(0, 3.2, 12.5);

function applyFov(v) {
  fovTarget = clampFov(v);
}

function stepFov(dt) {
  const k = dt <= 0 ? 0.35 : 1 - Math.pow(0.0007, dt);
  fovLive += (fovTarget - fovLive) * k;
  if (Math.abs(camera.fov - fovLive) > 0.02) {
    camera.fov = fovLive;
    camera.updateProjectionMatrix();
  }
}

window.addEventListener('wheel', (e) => {
  if (isSettingsOpen()) return;
  const el = e.target;
  if (el && el.closest && el.closest('#setp, #overlay, input, select, textarea, button, a, label')) return;
  e.preventDefault();
  const step = Math.sign(e.deltaY) * Math.min(5.5, 1.15 + Math.abs(e.deltaY) * 0.035);
  setFov(clampFov(fovTarget + step), true);
}, { passive: false });

const hitLight = new THREE.PointLight(0xffb44a, 0, 6);
hitLight.decay = 2;
hitLight.userData.baseIntensity = 0;
scene.add(hitLight);

const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
const darkBg = new THREE.Color(0x080a10);
scene.environment = roomEnv;
scene.environmentIntensity = 0.38;

let hdriEnv = null;
let hdriBg = null;
let hdriLoading = null;
let hdriEnabled = false;

function applyHdri(on) {
  hdriEnabled = !!on;
  if (hdriEnabled) {
    if (!hdriEnv) {
      loadHdri().then((ok) => { if (ok && hdriEnabled) applyHdri(true); });
      return;
    }
    scene.environment = hdriEnv;
    scene.environmentIntensity = 0.95;
    // Use the raw equirectangular HDR for the backdrop (PMREM is only for lighting).
    scene.background = hdriBg || hdriEnv;
    scene.backgroundBlurriness = 0.08;
    scene.backgroundIntensity = 0.55;
    // Put the gym's window wall behind the fighters.
    if (scene.backgroundRotation) scene.backgroundRotation.set(0, 0.15, 0);
    scene.fog = null;
    scene.traverse((o) => { if (o.userData && o.userData.voidWall) o.visible = false; });
  } else {
    scene.environment = roomEnv;
    scene.environmentIntensity = 0.38;
    scene.background = darkBg;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    scene.fog = new THREE.Fog(0x080a10, 18, 42);
    scene.traverse((o) => { if (o.userData && o.userData.voidWall) o.visible = true; });
  }
}

function loadHdri() {
  if (hdriEnv) return Promise.resolve(true);
  if (hdriLoading) return hdriLoading;
  hdriLoading = new Promise((resolve) => {
    new RGBELoader().load(
      ARENA.hdriUrl || './hdris/industrial_pipe_and_valve_01_2k.hdr',
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        hdriBg = tex;
        hdriEnv = pmrem.fromEquirectangular(tex).texture;
        hdriLoading = null;
        resolve(true);
      },
      undefined,
      (err) => {
        console.warn('HDRI failed to load', err);
        hdriLoading = null;
        resolve(false);
      },
    );
  });
  return hdriLoading;
}

// Preload so the Settings toggle (and comparison shots) can switch instantly.
loadHdri().then((ok) => {
  if (ok && (getSettings().hdri || ARENA.hdri)) applyHdri(true);
});

let lightMul = Math.max(0.5, Math.min(2, getSettings().light || 1));
const litLights = [];

function applyGfx(key) {
  gfxKey = key === 'low' ? 'low' : 'high';
  const p = GFX_PRESETS[gfxKey];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixelCap));
  renderer.toneMappingExposure = p.exposure * lightMul;
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
  applyLightIntensities();
  resize();
}

function applyLight(v) {
  lightMul = Math.max(0.5, Math.min(2, +v || 1));
  const p = GFX_PRESETS[gfxKey];
  renderer.toneMappingExposure = p.exposure * lightMul;
  applyLightIntensities();
}

function applyLightIntensities() {
  for (const l of litLights) {
    const base = l.userData && l.userData.baseIntensity;
    if (base != null) l.intensity = base * lightMul;
  }
}

function trackLight(l) {
  if (!l) return l;
  if (l.userData.baseIntensity == null) l.userData.baseIntensity = l.intensity;
  if (!litLights.includes(l)) litLights.push(l);
  return l;
}

let fighterRims = [];
const _rimDir = new THREE.Vector3();
function makeFighterRim(color) {
  const l = new THREE.DirectionalLight(color, 0.55);
  l.userData.baseIntensity = 0.55;
  trackLight(l);
  scene.add(l, l.target);
  return l;
}

function updateFighterRims() {
  if (!fighterRims.length || !p1 || !p2) return;
  const pairs = [[p1, fighterRims[0]], [p2, fighterRims[1]]];
  for (const [f, light] of pairs) {
    if (!f || !light) continue;
    _rimDir.copy(camera.position).sub(f.root.position);
    _rimDir.y = 0;
    if (_rimDir.lengthSq() < 1e-4) _rimDir.set(0, 0, 1);
    else _rimDir.normalize();
    light.position.set(
      f.root.position.x - _rimDir.x * 3.4,
      f.root.position.y + 2.5,
      f.root.position.z - _rimDir.z * 3.4,
    );
    light.target.position.set(f.root.position.x, f.root.position.y + 1.15, f.root.position.z);
    light.target.updateMatrixWorld();
  }
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
  applyFov,
  applyLight,
  applyHdri,
  onChange(s) {
    applyFov(s.fov);
    applyLight(s.light);
    applyHdri(!!s.hdri || !!ARENA.hdri);
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

function placeInOctagon(pos, padding, rattle) {
  const c = clampToOctagon(pos.x, pos.z, padding);
  const hit = Math.hypot(c[0] - pos.x, c[1] - pos.z) > 0.002;
  pos.x = c[0];
  pos.z = c[1];
  if (hit && rattle) playSfx('cage');
  return hit;
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
      if (m && m.color) {
        if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
        m.color.copy(m.userData.baseColor).lerp(c, 0.42);
      }
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

function addVisor(model, color) {
  let head = null;
  model.traverse((o) => {
    if (head) return;
    if (!o.isBone && o.type !== 'Bone') return;
    const n = String(o.name || '').replace(/^mixamorig[:._]*/i, '');
    if (n === 'Head') head = o;
  });
  if (!head) return;
  const c = new THREE.Color(color);
  const vis = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 3.4, roughness: 0.22, metalness: 0.08, toneMapped: false,
    }),
  );
  vis.name = 'rfVisor';
  head.add(vis);
  head.updateWorldMatrix(true, false);
  const ws = new THREE.Vector3();
  head.getWorldScale(ws);
  vis.scale.set(0.2 / Math.max(ws.x, 1e-5), 0.05 / Math.max(ws.y, 1e-5), 0.06 / Math.max(ws.z, 1e-5));
  vis.position.set(0, 0.07 / Math.max(ws.y, 1e-5), 0.11 / Math.max(ws.z, 1e-5));
}

function retintFighter(f, color) {
  const c = new THREE.Color(color);
  f.model.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m || !m.color) continue;
      if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
      m.color.copy(m.userData.baseColor).lerp(c, 0.42);
    }
    if (o.name === 'rfVisor' && o.material) {
      o.material.color.copy(c);
      o.material.emissive.copy(c);
    }
  });
}

function applyFighterConfig(f, cfg) {
  const base = defaultFighterConfig(f.id);
  f.config = { ...base, ...cfg };
  f.config.ai = (cfg && cfg.ai) ? { ...cfg.ai } : { useSettings: true };
  if (f.config.color != null) retintFighter(f, f.config.color);
  const el = document.getElementById(f.id === 'p1' ? 'n1' : 'n2');
  if (el) el.textContent = f.config.name;
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
  addVisor(model, color);
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
    config: defaultFighterConfig(side),
    modelScale: scale,
  };
  f.config.color = color;

  mixer.addEventListener('finished', () => {
    if (f.state === 'ko' || f.state === 'down' || isRagdoll(f)) return;
    if (match.over) return;
    if (f.health > 0 && (f.state === 'punch' || f.state === 'kick' || f.state === 'hit')) {
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.15);
    }
  });
  prepareFighterDamage(f);
  cacheFeet(f);
  return f;
}

function boneKey(name) {
  return String(name || '').replace(/^mixamorig[:._]*/i, '');
}

function cacheFeet(f) {
  f.footBones = [];
  f.ikLegs = { L: {}, R: {} };
  f.groundY = 0;
  f.model.traverse((o) => {
    if (!o.isBone && o.type !== 'Bone') return;
    const n = boneKey(o.name);
    const k = n.toLowerCase();
    if (k === 'leftfoot' || k === 'lefttoebase' || k === 'lefttoe'
      || k === 'rightfoot' || k === 'righttoebase' || k === 'righttoe') {
      f.footBones.push(o);
    }
    if (n === 'LeftUpLeg') f.ikLegs.L.thigh = o;
    if (n === 'LeftLeg') f.ikLegs.L.shin = o;
    if (n === 'LeftFoot') f.ikLegs.L.foot = o;
    if (n === 'LeftToeBase') f.ikLegs.L.toe = o;
    if (n === 'RightUpLeg') f.ikLegs.R.thigh = o;
    if (n === 'RightLeg') f.ikLegs.R.shin = o;
    if (n === 'RightFoot') f.ikLegs.R.foot = o;
    if (n === 'RightToeBase') f.ikLegs.R.toe = o;
  });
}

const _footY = new THREE.Vector3();
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikT = new THREE.Vector3();
const _ikFwd = new THREE.Vector3();
const _ikKnee = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();
const _ikQ2 = new THREE.Quaternion();
const _ikM = new THREE.Matrix4();
const _ikInv = new THREE.Matrix4();
const _ikOne = new THREE.Vector3(1, 1, 1);

function matTopY() {
  return (ARENA.matTop != null) ? ARENA.matTop : 0;
}

function usableFootBones(f) {
  const out = [];
  for (const b of (f.footBones || [])) {
    const k = boneKey(b.name).toLowerCase();
    if (f.parts) {
      if (f.parts.legL && f.parts.legL.detached && k.startsWith('left')) continue;
      if (f.parts.legR && f.parts.legR.detached && k.startsWith('right')) continue;
    }
    out.push(b);
  }
  return out;
}

function lowestFootY(f) {
  const bones = usableFootBones(f);
  if (!bones.length) return null;
  f.model.updateWorldMatrix(true, true);
  let minY = Infinity;
  for (const b of bones) {
    b.getWorldPosition(_footY);
    if (_footY.y < minY) minY = _footY.y;
  }
  return Number.isFinite(minY) ? minY : null;
}

function groundFeet(f, dt) {
  if (!f || isRagdoll(f) || f.state === 'ko' || f.state === 'down') return;
  if (f.parts && f.parts.legL && f.parts.legL.detached && f.parts.legR && f.parts.legR.detached) return;
  const skipIK = f.state === 'getup' && (f.getupBlend || 0) > 0.2;
  const top = matTopY();
  // Measure the animated pose with the root at zero, so last frame's lift never feeds back
  // into this frame (that feedback ratcheted the robots up into the air).
  f.root.position.y = 0;
  let minY = lowestFootY(f);
  if (minY == null) return;
  const target = top - minY;
  f.groundY = f.groundY || 0;
  if (target > f.groundY) f.groundY = target; // lift instantly: feet never sink
  else {
    const k = 1 - Math.pow(0.0005, Math.max(dt || 0.016, 1 / 120));
    f.groundY += (target - f.groundY) * k; // settle down quickly but smoothly
  }
  f.root.position.y = f.groundY;
  f.model.updateWorldMatrix(true, true);
  // Stance IK is temporarily skipped: the two-bone solver was twisting the legs
  // and lifting planted feet 8–15 cm off the mat after the 121addd grounding change.
  if (!skipIK && ARENA.stanceIK) plantStanceIK(f, top);

  // Per-frame clamp after IK; not stored, so it can't accumulate.
  minY = lowestFootY(f);
  if (minY != null && minY < top - 0.0004) {
    f.root.position.y += (top - minY);
  }
}

function plantStanceIK(f, top) {
  if (!f.ikLegs) return;
  for (const side of ['L', 'R']) {
    if (f.parts && f.parts[side === 'L' ? 'legL' : 'legR'] && f.parts[side === 'L' ? 'legL' : 'legR'].detached) continue;
    const leg = f.ikLegs[side];
    if (!leg || !leg.thigh || !leg.shin || !leg.foot) continue;
    leg.foot.updateWorldMatrix(true, false);
    leg.foot.getWorldPosition(_ikC);
    let low = _ikC.y;
    if (leg.toe) {
      leg.toe.updateWorldMatrix(true, false);
      leg.toe.getWorldPosition(_ikT);
      low = Math.min(low, _ikT.y);
    }
    const sink = top - low;
    // Swing foot, or a huge hover: leave the clip alone. Only nudge a nearly planted foot.
    if (sink < -0.06 || sink > 0.10) continue;
    const qThigh = leg.thigh.quaternion.clone();
    const qShin = leg.shin.quaternion.clone();
    const qFoot = leg.foot.quaternion.clone();
    const before = _ikC.clone();
    _ikT.copy(_ikC);
    _ikT.y += sink;
    twoBoneIK(leg.thigh, leg.shin, leg.foot, _ikT);
    leg.foot.updateWorldMatrix(true, false);
    leg.foot.getWorldPosition(_ikC);
    // If the solver missed the target or yanked the ankle, restore the clip pose.
    if (_ikC.distanceTo(_ikT) > 0.04 || _ikC.distanceTo(before) > 0.12) {
      leg.thigh.quaternion.copy(qThigh);
      leg.shin.quaternion.copy(qShin);
      leg.foot.quaternion.copy(qFoot);
      leg.thigh.updateMatrix();
      leg.shin.updateMatrix();
      leg.foot.updateMatrix();
      leg.thigh.updateWorldMatrix(true, true);
    }
  }
}

function twoBoneIK(thigh, shin, foot, target) {
  thigh.updateWorldMatrix(true, false);
  shin.updateWorldMatrix(true, false);
  foot.updateWorldMatrix(true, false);
  thigh.getWorldPosition(_ikA);
  shin.getWorldPosition(_ikB);
  foot.getWorldPosition(_ikC);
  const l1 = Math.max(0.05, _ikA.distanceTo(_ikB));
  const l2 = Math.max(0.05, _ikB.distanceTo(_ikC));
  const toT = target.clone().sub(_ikA);
  let dist = toT.length();
  const maxD = l1 + l2 - 0.002;
  if (dist < 0.02) return;
  if (dist > maxD) {
    toT.multiplyScalar(maxD / dist);
    dist = maxD;
    target = _ikA.clone().add(toT);
  }
  const minD = Math.abs(l1 - l2) + 0.002;
  if (dist < minD) {
    toT.multiplyScalar(minD / dist);
    dist = minD;
    target = _ikA.clone().add(toT);
  }
  const axis = _ikFwd.copy(_ikB).sub(_ikA).cross(_ikC.clone().sub(_ikA));
  if (axis.lengthSq() < 1e-8) {
    axis.set(0, 0, 1).applyQuaternion(thigh.getWorldQuaternion(_ikQ));
  }
  axis.normalize();
  const cosA = Math.max(-1, Math.min(1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const ang = Math.acos(cosA);
  _ikKnee.copy(toT).normalize();
  const rot = _ikQ2.setFromAxisAngle(axis, ang);
  _ikKnee.applyQuaternion(rot).multiplyScalar(l1).add(_ikA);

  alignBoneToward(thigh, _ikA, _ikKnee, shin);
  shin.updateWorldMatrix(true, false);
  shin.getWorldPosition(_ikB);
  alignBoneToward(shin, _ikB, target, foot);
}

function alignBoneToward(bone, origin, toward, child) {
  const parent = bone.parent;
  child.updateWorldMatrix(true, false);
  child.getWorldPosition(_footY);
  const cur = _footY.clone().sub(origin);
  const want = toward.clone().sub(origin);
  if (cur.lengthSq() < 1e-10 || want.lengthSq() < 1e-10) return;
  cur.normalize();
  want.normalize();
  _ikQ.setFromUnitVectors(cur, want);
  const worldQ = bone.getWorldQuaternion(_ikQ2);
  worldQ.premultiply(_ikQ);
  if (parent) {
    parent.updateWorldMatrix(true, false);
    const parentQ = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQ);
    bone.quaternion.copy(parentQ.invert().multiply(worldQ));
  } else {
    bone.quaternion.copy(worldQ);
  }
  bone.updateMatrix();
  bone.updateWorldMatrix(true, false);
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

function setAnim(f, name, fade = 0.2) {
  const clipName = resolveClip(f, name);
  if (!clipName) return;
  const next = f.actions[clipName];
  const oneshot = ['punch', 'kick', 'hit', 'ko', 'getUp', 'getup', 'GettingUp', 'KnockedOut'].includes(name)
    || (MODEL.animations.punchVariants || []).includes(clipName)
    || (MODEL.animations.punchRight || []).includes(clipName)
    || (MODEL.animations.punchLeft || []).includes(clipName)
    || (MODEL.animations.kickVariants || []).includes(clipName)
    || (MODEL.animations.kickSpecial || []).includes(clipName)
    || (MODEL.animations.flipSpecial || []).includes(clipName)
    || (MODEL.animations.blockVariants || []).includes(clipName)
    || (MODEL.animations.victoryVariants || []).includes(clipName)
    || clipName === MODEL.animations.victory
    || clipName === 'KnockedOut' || clipName === 'GettingUp';
  const fadeT = Math.max(0.15, Math.min(0.3, fade));
  if (f.current === clipName) {
    // Don't hard-reset a playing clip — that pops mid-pose. Let it finish or keep looping.
    return next;
  }
  const prev = f.actions[f.current];
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.timeScale = 0.9 + Math.random() * 0.2;
  if (prev && prev !== next) prev.crossFadeTo(next, fadeT, true);
  else next.fadeIn(fadeT);
  next.play();
  f.current = clipName;
  f.locoActive = !oneshot && isLocoClip(clipName);
  if (oneshot) fadeLocoOut(f, fadeT);
  return next;
}

function fadeLocoOut(f, fade) {
  if (!f._loco) return;
  for (const key of LOCO_KEYS) {
    const act = f._loco[key];
    if (act && act.isRunning()) {
      act.fadeOut(Math.max(0.15, fade || 0.2));
      if (f._locoW) f._locoW[key] = 0;
    }
  }
}

function isLocoClip(name) {
  const a = MODEL.animations;
  return name === a.idle || name === 'Idle' || name === a.idleInjured
    || name === a.walkForward || name === a.walkBack
    || name === a.strafeLeft || name === a.strafeRight
    || (a.idleVariants || []).includes(name);
}

function availableClips(f, list) {
  return (list || []).filter((n) => n && f && f.actions[n]);
}

function pickClip(list, fallback, avoid, fighter, weights) {
  let pool = list ? list.slice() : [];
  if (fighter) pool = pool.filter((n) => fighter.actions[n]);
  const filtered = avoid ? pool.filter((n) => n !== avoid) : pool;
  const use = filtered.length ? filtered : (pool.length ? pool : (fallback ? [fallback] : []));
  if (!use.length) return fallback;
  if (weights && use.length > 1) {
    let total = 0;
    const w = use.map((n) => {
      const v = (typeof weights === 'function' ? weights(n) : (weights[n] || 1));
      total += v;
      return v;
    });
    let r = Math.random() * total;
    for (let i = 0; i < use.length; i++) {
      r -= w[i];
      if (r <= 0) return use[i];
    }
  }
  return use[Math.floor(Math.random() * use.length)] || fallback;
}

function punchClipsFor(f) {
  const right = MODEL.animations.punchRight || MODEL.animations.punchVariants || [];
  const left = MODEL.animations.punchLeft || [];
  const a = f.parts;
  let list = [];
  if (!a || !a.armR.detached) list = list.concat(right);
  if (!a || !a.armL.detached) list = list.concat(left);
  const have = availableClips(f, [...new Set(list)]);
  if (have.length) return have;
  if (a && a.armR.detached && !left.length) return [];
  if (a && a.armL.detached && a.armR.detached) return [];
  return availableClips(f, MODEL.animations.punchVariants);
}

function pickPunch(f) {
  const clip = pickClip(punchClipsFor(f), MODEL.animations.punch, f.lastPunch, f);
  f.lastPunch = clip;
  return clip;
}

function pickKick(f, allowFlip) {
  const special = availableClips(f, MODEL.animations.flipSpecial || MODEL.animations.kickSpecial);
  const basic = availableClips(f, MODEL.animations.kickVariants);
  const useSpecial = allowFlip && special.length && Math.random() < 0.14;
  const clip = pickClip(useSpecial ? special : basic, MODEL.animations.kick, f.lastKick, f);
  f.lastKick = clip;
  return clip;
}

const _side = new THREE.Vector3();
const _toAtk = new THREE.Vector3();
function pickBlock(f, other) {
  const have = availableClips(f, MODEL.animations.blockVariants);
  let prefer = have.slice();
  if (other && have.length) {
    const low = other.state === 'kick';
    _toAtk.set(other.root.position.x - f.root.position.x, 0, other.root.position.z - f.root.position.z);
    _side.set(1, 0, 0).applyQuaternion(f.root.quaternion);
    const side = _toAtk.dot(_side);
    if (low) prefer = have.filter((n) => /body|center/i.test(n));
    else if (side > 0.12) prefer = have.filter((n) => /right/i.test(n));
    else if (side < -0.12) prefer = have.filter((n) => /left/i.test(n));
    else prefer = have.filter((n) => /center/i.test(n));
    if (!prefer.length) prefer = have;
  }
  const clip = pickClip(prefer, MODEL.animations.block, f.lastBlock, f);
  f.lastBlock = clip;
  return clip;
}

function pickHitClip(f, partId) {
  const map = MODEL.animations.hitByPart || {};
  const extra = ['Stunned', 'StumbleBackwards', 'HitToBody', 'BigStomachHit', 'HeadHit', 'HitOnSideOfHead', 'HitOnLegs'];
  const list = availableClips(f, (map[partId] || map.torso || []).concat(extra));
  const clip = pickClip(list, MODEL.animations.hit || 'Stunned', f.lastHit, f, (n) => {
    if ((map[partId] || []).includes(n)) return 3;
    if (n === 'StumbleBackwards') return 0.6;
    return 1;
  });
  f.lastHit = clip;
  return clip;
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
  const idles = availableClips(f, MODEL.animations.idleVariants || [MODEL.animations.idle || 'FightingIdle']);
  return pickClip(idles, MODEL.animations.idle || 'FightingIdle', f.lastIdle, f);
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
  if (match && match.over && (e.key === 'Enter' || e.key === 'r' || e.key === 'R')) {
    e.preventDefault();
    if (!e.repeat) resetMatch();
    return;
  }
  keys.add(e.key.toLowerCase());
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(e.key.toLowerCase())) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function rawInput() {
  const shellInp = shellCall('input', 'p1'); // [game-shell hook] versus keys / menu idle
  if (shellInp) return shellInp;
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

function clipWorldSpeed(f, name) {
  const local = CLIP_SPEEDS[name];
  if (!local) return 0;
  return local * (f.modelScale || (f.model && f.model.scale.x) || 1);
}

function locoMoveSpeeds(f, blocking) {
  const limp = moveSpeedMul(f);
  const blockMul = blocking ? (COMBAT.blockMoveSpeed / Math.max(0.2, COMBAT.moveSpeed)) : 1;
  const mul = limp * blockMul;
  const strafe = 0.5 * (clipWorldSpeed(f, 'JogStrafeLeft') + clipWorldSpeed(f, 'JogStrafeRight'));
  return {
    fwd: (clipWorldSpeed(f, 'Walking') || COMBAT.moveSpeed * 0.35) * mul,
    back: (clipWorldSpeed(f, 'WalkingBackwards') || COMBAT.moveSpeed * 0.3) * mul,
    strafe: (strafe || COMBAT.moveSpeed * 0.7) * mul,
  };
}

function moveFighter(f, other, sidestep, inout, dt, speeds) {
  const fwd = toward(f, other);
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const along = inout >= 0 ? speeds.fwd : speeds.back;
  const vel = new THREE.Vector3();
  vel.addScaledVector(right, sidestep * speeds.strafe);
  vel.addScaledVector(fwd, inout * along);
  setFighterMove(f, vel.x, vel.z);
  return Math.hypot(vel.x, vel.z);
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
    placeInOctagon(a.root.position, 0.55, true);
    placeInOctagon(b.root.position, 0.55, true);
  }
}

function faceEachOther(a, b) {
  if (a.state !== 'ko' && a.state !== 'down' && !isRagdoll(a)) a.root.lookAt(b.root.position.x, a.root.position.y, b.root.position.z);
  if (b.state !== 'ko' && b.state !== 'down' && !isRagdoll(b)) b.root.lookAt(a.root.position.x, b.root.position.y, a.root.position.z);
}

function tryAttack(f, kind, clipName) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick') return;
  if (f.cooldown > 0) return;
  if (kind === 'punch' && !canPunch(f)) return;
  if (kind === 'kick' && !canKick(f)) return;
  const spec = COMBAT[kind];
  const mods = attackMods(f, kind);
  if (kind === 'punch' && !punchClipsFor(f).length) return;
  const clip = clipName
    || (kind === 'punch' ? pickPunch(f) : pickKick(f, true))
    || MODEL.animations[kind];
  f.state = kind;
  f.stateT = 0;
  f.hitThisAttack = false;
  f.atkMods = mods;
  f.attackClip = clip;
  f.blocking = false;
  f.shield.visible = false;
  setAnim(f, clip, 0.16);
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
      const other = f === p1 ? p2 : p1;
      const clip = f.blockClip || pickBlock(f, other);
      setAnim(f, clip, 0.16);
    }
  } else if (f.state === 'block') f.state = 'idle';
}

function attackHits(atk, def, spec) {
  return atk.root.position.distanceTo(def.root.position) <= spec.range;
}

const LOC_MUL = { head: 1.35, torso: 1, armL: 0.8, armR: 0.8, legL: 0.85, legR: 0.85 };

function applyHit(atk, def, spec, kind) {
  if (def.state === 'ko' || def.state === 'down' || def.invuln > 0) return;
  const blocked = def.blocking;
  const hit = pickHit(atk, def, kind || 'punch', toward);
  const mul = (atk.atkMods && atk.atkMods.damageMul) || 1;
  const blockMul = blocked ? (1 - COMBAT.blockReduction * blockReductionMul(def)) : 1;
  const loc = LOC_MUL[hit.partId] || 1;
  const closing = impactVelocity(atk, def, hit.dir);
  const swing = (kind === 'kick' ? 3.4 : 2.4) * mul;
  const force = (closing + swing) * (blocked ? 0.45 : 1);
  const dmg = Math.max(1, Math.round(spec.damage * mul * blockMul * loc * (0.5 + 0.55 * (force / 5))));
  def.health = Math.max(0, def.health - dmg);
  applyPartHit(def, hit.partId, dmg, hit.point, hit.dir, scene, { blocked, force });
  hitLight.color.setHex(blocked ? 0x88ccff : 0xffc060);
  hitLight.intensity = 12 + Math.min(8, force);
  hitLight.position.copy(hit.point);
  playHit({ blocked, heavy: dmg >= 12 || force >= 5, kick: kind === 'kick' });
  const heavy = force >= 5.1 || dmg >= 12;
  addShake(blocked ? 0.035 : (heavy ? 0.11 + force * 0.012 : 0.045 + dmg * 0.004 + force * 0.006));
  if (!blocked && heavy) triggerHitStop(0.09);
  else if (!blocked) triggerHitStop(0.04);
  const fwd = hit.dir;
  const kb = COMBAT.knockback * (blocked ? 0.35 : 1) * (0.8 + force * 0.08);
  if (def.phys && def.phys.body && !isRagdoll(def)) {
    def.phys.body.velocity.x += fwd.x * kb * 3.6;
    def.phys.body.velocity.z += fwd.z * kb * 3.6;
  } else {
    def.root.position.x += fwd.x * kb;
    def.root.position.z += fwd.z * kb;
    placeInOctagon(def.root.position, 0.55, true);
  }
  if (def.health <= 0 || isCatastrophic(def)) {
    ko(def, atk, { dir: fwd, force });
    return;
  }
  if (!blocked) {
    def.blocking = false;
    def.shield.visible = false;
    def.invuln = COMBAT.hitInvuln;
    if (heavy) {
      def.state = 'down';
      def.stateT = 0;
      enableRagdoll(def, { x: fwd.x * (4 + force), y: 2.2 + force * 0.15, z: fwd.z * (4 + force) }, { kind: 'down', until: performance.now() + 850 });
    } else {
      def.state = 'hit';
      def.stateT = 0;
      setAnim(def, pickHitClip(def, hit.partId), 0.16);
    }
  }
}

function isCatastrophic(f) {
  if (!f || !f.parts) return false;
  if (f.parts.head && f.parts.head.detached) return true;
  if (f.parts.legL && f.parts.legL.detached && f.parts.legR && f.parts.legR.detached) return true;
  return false;
}

function playVictory(f) {
  if (!f) return;
  const names = []
    .concat(MODEL.animations.victoryVariants || [])
    .concat(MODEL.animations.victory || []);
  const clip = pickClip(names, names[0], f.lastVictory, f);
  if (clip) {
    f.lastVictory = clip;
    setAnim(f, clip, 0.22);
  }
}

function ko(loser, winner, info) {
  loser.health = 0;
  loser.state = 'ko';
  loser.blocking = false;
  loser.shield.visible = false;
  const dir = (info && info.dir) || new THREE.Vector3(winner.root.position.x - loser.root.position.x, 0, winner.root.position.z - loser.root.position.z).normalize();
  const force = (info && info.force) || 6;
  enableRagdoll(loser, { x: dir.x * (5 + force), y: 3.1, z: dir.z * (5 + force) }, { kind: 'ko', until: Infinity });
  if (winner && winner.state !== 'ko' && winner.state !== 'down' && !isRagdoll(winner)) {
    playVictory(winner);
  }
  match.over = true;
  match.winner = winner ? winner.id : null;
  match.koT = 0;
  match.orbitT = 0;
  match.overlayAt = performance.now() + 1600;
  const title = document.getElementById('ko-title');
  const sub = document.getElementById('ko-sub');
  if (title) title.textContent = winner && winner.id === 'p1' ? 'Blue wins' : 'Red wins';
  if (sub) {
    if (info && info.reason === 'head') sub.textContent = winner && winner.id === 'p1' ? "You took the opponent's head." : 'Your head was torn off.';
    else if (info && info.reason === 'legs') sub.textContent = 'Both legs gone. The fighter collapsed.';
    else sub.textContent = winner && winner.id === 'p1' ? 'You won the fight.' : 'CPU won the fight.';
  }
  playSfx('ko');
  addShake(0.16);
  notifyFightEnd({
    winner: match.winner,
    reason: 'ko',
    p1: { health: p1.health, config: p1.config },
    p2: { health: p2.health, config: p2.config },
  });
}

function showKoOverlay() {
  const el = document.getElementById('overlay');
  if (el) el.classList.remove('hidden');
  match.overlayAt = 0;
}

const ai = { t: 0, sidestep: 0, inout: 0, block: false, punch: false, kick: false };

function aiProfile() {
  const custom = p2 && p2.config && p2.config.ai;
  const fromSettings = getSettings().cpu || 'normal';
  // A shell-provided think table (arcade opponents, explicit personalities) wins.
  // Default / unspecialized configs follow the Settings CPU difficulty.
  if (custom && custom.think && custom.useSettings !== true) return custom;
  return { ...(AI_PERSONALITIES[fromSettings] || AI_PERSONALITIES.normal) };
}

function updateAI(cpu, player, dt) {
  const shellAi = shellCall('input', 'p2'); // [game-shell hook] versus P2 / training dummy / menu idle
  if (shellAi) return shellAi;
  ai.punch = false;
  ai.kick = false;
  ai.punchClip = null;
  ai.kickClip = null;
  ai.t -= dt;
  if (cpu.state === 'ko' || cpu.state === 'down' || isRagdoll(cpu) || cpu.state === 'hit' || cpu.state === 'punch' || cpu.state === 'kick') {
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
      ai.blockClip = pickBlock(cpu, player);
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
      if (r < prof.punch && punchClipsFor(cpu).length) {
        ai.punch = true;
        ai.punchClip = pickPunch(cpu);
      } else if (r < prof.punch + prof.kick && canKick(cpu)) {
        ai.kick = true;
        ai.kickClip = pickKick(cpu, true);
      } else if (r < prof.punch + prof.kick + prof.block) {
        ai.block = true;
        ai.blockClip = pickBlock(cpu, player);
      }
    }
  }
  return ai;
}

function stepFighter(f, other, inp, dt) {
  f.cooldown = Math.max(0, f.cooldown - dt);
  f.invuln = Math.max(0, f.invuln - dt);
  f.stateT += dt;
  if (f.state === 'ko' || f.state === 'down' || isRagdoll(f)) return;
  if (f.state === 'getup') {
    setFighterMove(f, 0, 0);
    const action = f.actions.GettingUp || f.actions[resolveClip(f, 'getUp')];
    const dur = action ? action.getClip().duration / Math.max(0.2, action.timeScale || 1) : 2.0;
    if (f.stateT > dur * 0.95) {
      f.state = 'idle';
      f.getupSnap = null;
      f.getupBlend = 0;
      setAnim(f, idleClipFor(f), 0.22);
    }
    return;
  }
  if (match.over) {
    setFighterMove(f, 0, 0);
    return;
  }

  if (maybeKneeDrop(f, dt)) return;

  if (f.state === 'hit') {
    if (f.stateT > COMBAT.hitStun) {
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.16);
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
      setAnim(f, idleClipFor(f), 0.16);
    }
    return;
  }

  f.blockClip = inp.blockClip || null;
  tryBlock(f, inp.block);
  if (inp.punch) tryAttack(f, 'punch', inp.punchClip);
  else if (inp.kick) tryAttack(f, 'kick', inp.kickClip);
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'hit' || f.state === 'ko') return;

  const speeds = locoMoveSpeeds(f, f.blocking);
  const moving = Math.abs(inp.sidestep) + Math.abs(inp.inout) > 0.12;
  if (moving) {
    const actual = moveFighter(f, other, inp.sidestep, inp.inout, dt, speeds);
    f.servoT = (f.servoT || 0) + dt;
    if (f.servoT > 0.72) {
      f.servoT = 0;
      playSfx('servo', { vol: 0.28, rate: 1.05, limit: 200 });
    }
    if (!f.blocking) {
      f.state = 'walk';
      updateLoco(f, inp.sidestep, inp.inout, dt, actual, speeds);
    }
  } else {
    setFighterMove(f, 0, 0);
    if (!f.blocking) {
      f.state = 'idle';
      updateLoco(f, 0, 0, dt, 0, null);
    }
  }
}

const LOCO_KEYS = ['idle', 'idleB', 'injured', 'walkFwd', 'walkBack', 'strafeL', 'strafeR'];

function locoActions(f) {
  if (f._loco) return f._loco;
  const a = MODEL.animations;
  const idles = availableClips(f, a.idleVariants || [a.idle]);
  const idleA = idles[0] || a.idle || 'FightingIdle';
  const idleB = idles.find((n) => n !== idleA) || idleA;
  f._loco = {
    idle: f.actions[idleA],
    idleB: f.actions[idleB],
    injured: f.actions[a.idleInjured],
    walkFwd: f.actions[a.walkForward || 'Walking'],
    walkBack: f.actions[a.walkBack || 'WalkingBackwards'],
    strafeL: f.actions[a.strafeLeft || 'JogStrafeLeft'],
    strafeR: f.actions[a.strafeRight || 'JogStrafeRight'],
  };
  f._locoW = { idle: 1, idleB: 0, injured: 0, walkFwd: 0, walkBack: 0, strafeL: 0, strafeR: 0 };
  return f._loco;
}

function updateLoco(f, sidestep, inout, dt, actualSpeed, moveSpeeds) {
  const acts = locoActions(f);
  const injured = idleClipFor(f) === MODEL.animations.idleInjured;
  const speed = Math.min(1, Math.hypot(sidestep, inout));
  const target = { idle: 0, idleB: 0, injured: 0, walkFwd: 0, walkBack: 0, strafeL: 0, strafeR: 0 };
  if (speed < 0.12) {
    if (injured && acts.injured) target.injured = 1;
    else {
      target.idle = 0.72;
      target.idleB = acts.idleB && acts.idleB !== acts.idle ? 0.28 : 0;
      if (!acts.idleB || acts.idleB === acts.idle) target.idle = 1;
    }
  } else {
    const ax = sidestep;
    const az = inout;
    if (az > 0) target.walkFwd = az;
    else if (az < 0) target.walkBack = -az;
    if (ax < 0) target.strafeL = -ax;
    else if (ax > 0) target.strafeR = ax;
    let s = 0;
    for (const k of LOCO_KEYS) s += target[k];
    if (s > 0) for (const k of LOCO_KEYS) target[k] /= s;
  }
  const k = 1 - Math.pow(0.012, Math.max(dt, 1 / 120));
  f._locoW = f._locoW || { idle: 1, idleB: 0, injured: 0, walkFwd: 0, walkBack: 0, strafeL: 0, strafeR: 0 };
  let top = 'idle';
  let topW = -1;
  for (const key of LOCO_KEYS) {
    const act = acts[key];
    f._locoW[key] += (target[key] - f._locoW[key]) * k;
    const w = f._locoW[key];
    if (!act) continue;
    if (w > 0.01) {
      if (!act.isRunning()) {
        act.reset().play();
        act.timeScale = 0.95 + Math.random() * 0.1;
      }
      act.enabled = true;
      act.setEffectiveWeight(w);
    } else if (act.isRunning()) {
      act.setEffectiveWeight(0);
      if (w < 0.002) act.stop();
    }
    if (w > topW) { topW = w; top = key; }
  }
  const nameOf = {
    idle: (acts.idle && acts.idle.getClip().name) || MODEL.animations.idle,
    idleB: (acts.idleB && acts.idleB.getClip().name) || MODEL.animations.idle,
    injured: MODEL.animations.idleInjured,
    walkFwd: MODEL.animations.walkForward || 'Walking',
    walkBack: MODEL.animations.walkBack || 'WalkingBackwards',
    strafeL: MODEL.animations.strafeLeft || 'JogStrafeLeft',
    strafeR: MODEL.animations.strafeRight || 'JogStrafeRight',
  };
  f.current = nameOf[top] || f.current;
  f.locoActive = true;

  if (speed >= 0.12 && actualSpeed != null) {
    const clipFor = { walkFwd: 'Walking', walkBack: 'WalkingBackwards', strafeL: 'JogStrafeLeft', strafeR: 'JogStrafeRight' };
    let expected = 0;
    for (const key of ['walkFwd', 'walkBack', 'strafeL', 'strafeR']) {
      const w = f._locoW[key] || 0;
      if (w <= 0.01) continue;
      expected += w * clipWorldSpeed(f, clipFor[key]);
    }
    const ts = expected > 1e-4 ? Math.max(0.7, Math.min(1.25, actualSpeed / expected)) : 1;
    for (const key of ['walkFwd', 'walkBack', 'strafeL', 'strafeR']) {
      const act = acts[key];
      if (act && act.isRunning()) act.timeScale = ts;
    }
  }
}

function stepFootSounds(f, dt) {
  if (!f || isRagdoll(f) || f.state === 'ko' || f.state === 'down' || f.state === 'getup') return;
  if (f.state !== 'walk') return;
  const top = matTopY();
  f._footSfx = f._footSfx || { L: { y: top, t: 0 }, R: { y: top, t: 0 } };
  for (const side of ['L', 'R']) {
    const leg = f.ikLegs && f.ikLegs[side];
    const bone = (leg && (leg.toe || leg.foot)) || null;
    if (!bone) continue;
    bone.getWorldPosition(_footY);
    const y = _footY.y;
    const rec = f._footSfx[side];
    rec.t = (rec.t || 0) + dt;
    const wasUp = rec.y > top + 0.045;
    const nowDown = y <= top + 0.038;
    if (wasUp && nowDown && rec.t > 0.16) {
      rec.t = 0;
      playSfx('step', { vol: 0.48, rate: 0.94 + Math.random() * 0.12 });
    }
    rec.y = y;
  }
}

function maybeKneeDrop(f, dt) {
  const l = f.parts && f.parts.legL;
  const r = f.parts && f.parts.legR;
  const one = !!(l && r && ((l.detached && !r.detached) || (!l.detached && r.detached)));
  if (!one) return false;
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'hit' || f.state === 'ko' || f.state === 'down') return false;
  f.kneeAcc = (f.kneeAcc || 0) + dt;
  if (f.kneeAcc < 0.9 + (f.kneeNext || 0)) return false;
  f.kneeAcc = 0;
  f.kneeNext = 0.45 + Math.random() * 1.15;
  f.state = 'hit';
  f.stateT = 0;
  f.blocking = false;
  f.shield.visible = false;
  setFighterMove(f, 0, 0);
  const clip = (f.actions.HitOnLegs && 'HitOnLegs')
    || (f.actions.InjuredStumbleIdle && 'InjuredStumbleIdle')
    || 'hit';
  setAnim(f, clip, 0.14);
  playSfx('servo', { vol: 0.38, rate: 0.82 });
  return true;
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

let hitStopLeft = 0;
function triggerHitStop(sec) {
  hitStopLeft = Math.max(hitStopLeft, sec);
}

function updateCamera(dt) {
  const a = p1.root.position;
  const b = p2.root.position;
  const midY = match.over ? 0.85 : 1.15;
  lookT.set((a.x + b.x) / 2, midY, (a.z + b.z) / 2);
  if (match.over) {
    match.orbitT = (match.orbitT || 0) + dt;
    const radius = 8.2;
    const ang = match.orbitT * 0.22;
    const y = 3.55 + Math.sin(match.orbitT * 0.18) * 0.3;
    camT.set(lookT.x + Math.sin(ang) * radius, y, lookT.z + Math.cos(ang) * radius);
    camera.position.lerp(camT, dt <= 0 ? 0 : 1 - Math.pow(0.015, dt));
    camera.lookAt(lookT);
    return;
  }
  const dist = a.distanceTo(b);
  camT.set(lookT.x, 3.45, lookT.z + 8.6 + dist * 0.3);
  camera.position.lerp(camT, dt <= 0 ? 0 : 1 - Math.pow(0.001, dt));
  camera.lookAt(lookT);
  if (shakeAmp > 0) {
    camera.position.x += (Math.random() - 0.5) * shakeAmp;
    camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.5;
    if (dt > 0) shakeAmp = Math.max(0, shakeAmp - dt * 3.2);
  }
}

let p1;
let p2;
const match = { phase: 'intro', introT: 0, over: false, winner: null, roundLeft: null, roundIndex: 1, roundTimeOverride: null };
const clock = new THREE.Clock();

function paintRound() {
  const label = document.getElementById('roundLabel');
  if (label) label.textContent = 'ROUND ' + (match.roundIndex || 1);
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
  const r = match.roundTimeOverride != null ? match.roundTimeOverride : getSettings().round;
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
    notifyFightEnd({ winner: null, reason: 'draw', p1: { health: p1.health, config: p1.config }, p2: { health: p2.health, config: p2.config } });
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

function beginGetUp(f) {
  if (!f || f.state === 'getup') return;
  const snap = [];
  f.model.updateWorldMatrix(true, true);
  f.model.traverse((o) => {
    if (!o.isBone && o.type !== 'Bone') return;
    snap.push({ bone: o, pos: o.position.clone(), quat: o.quaternion.clone() });
  });
  const x = f.root.position.x;
  const z = f.root.position.z;
  disableRagdoll(f);
  f.root.position.set(x, 0, z);
  if (f.phys && f.phys.body) {
    f.phys.body.position.set(x, 0, z);
    f.phys.body.velocity.setZero();
  }
  f.state = 'getup';
  f.stateT = 0;
  f.getupBlend = 1;
  f.getupSnap = snap;
  f.groundY = 0;
  const clip = f.actions.GettingUp ? 'GettingUp' : (MODEL.animations.getUp || 'GettingUp');
  setAnim(f, clip, 0.18);
  if (f.mixer) f.mixer.timeScale = 1;
}

function applyGetupBlend(f, dt) {
  if (!f.getupSnap) return;
  f.getupBlend = Math.max(0, (f.getupBlend || 0) - dt / 0.4);
  const w = f.getupBlend;
  if (w <= 0) {
    f.getupSnap = null;
    return;
  }
  // w=1 at start (full ragdoll pose), w=0 is the Getting Up clip.
  const tAnim = 1 - w;
  for (const s of f.getupSnap) {
    s.bone.position.lerpVectors(s.pos, s.bone.position, tAnim);
    s.bone.quaternion.slerpQuaternions(s.quat, s.bone.quaternion, tAnim);
  }
}

function poseAfterMixer(f) {
  if (isRagdoll(f)) return;
  // Keep the game's movement in charge: pin hips X/Z, leave Y for clip bounce.
  if (f.hips && f.hipsBind) {
    f.hips.position.x = f.hipsBind.x;
    f.hips.position.z = f.hipsBind.z;
  }
  f.model.position.y = f.baseY;
}

function resetMatch() {
  for (const f of [p1, p2]) {
    disableRagdoll(f);
    if (f.mixer) f.mixer.timeScale = 1;
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
    f.groundY = 0;
    f.getupSnap = null;
    f.getupBlend = 0;
    resetFighterPhysics(f, f.startX, 0);
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
  match.koT = 0;
  match.orbitT = 0;
  match.overlayAt = 0;
  hitStopLeft = 0;
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
  stepFov(rawDt);
  let dt = isSettingsOpen() ? 0 : rawDt;
  if (dt > 0 && hitStopLeft > 0 && !match.over) {
    hitStopLeft = Math.max(0, hitStopLeft - rawDt);
    dt = rawDt * 0.16;
  }
  if (match.over && match.overlayAt && performance.now() >= match.overlayAt) showKoOverlay();
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
      playSfx('bell');
      startCrowd();
    }
  }
  if (match.phase === 'fight' && !match.over) stepRound(dt);
  const canAct = match.phase === 'fight' && !match.over && !isSettingsOpen();
  const pin = canAct ? consumeAttacks(rawInput()) : consumeAttacks({ sidestep: 0, inout: 0, punch: false, kick: false, block: false });
  const ain = canAct ? updateAI(p2, p1, dt) : { sidestep: 0, inout: 0, punch: false, kick: false, block: false };

  for (const f of [p1, p2]) {
    if (!f || f.state !== 'down' || !isRagdoll(f)) continue;
    const stayDown = f.health <= 0 || isCatastrophic(f);
    if (stayDown) continue;
    const timeUp = !f.phys.ragdoll.until || f.phys.ragdoll.until < performance.now();
    const settled = isRagdollSettled(f);
    if ((settled && (timeUp || f.stateT > 0.45)) || f.stateT > 1.7) beginGetUp(f);
  }
  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  stepPhysics(dt);
  if (!isRagdoll(p1) && !isRagdoll(p2)) separate(p1, p2);
  if (!isRagdoll(p1) && !isRagdoll(p2)) faceEachOther(p1, p2);
  for (const f of [p1, p2]) {
    if (isRagdoll(f)) continue;
    f.mixer.update(dt);
    applyGetupBlend(f, dt);
    f.root.position.y = 0;
    poseAfterMixer(f);
    applyMalfunctions(f, dt);
    groundFeet(f, dt);
    stepFootSounds(f, dt);
  }
  if (isRagdoll(p1)) applyMalfunctions(p1, dt);
  if (isRagdoll(p2)) applyMalfunctions(p2, dt);
  stepDamage(scene, dt);
  if (!match.over && match.phase === 'fight') {
    if (isCatastrophic(p1) && p1.state !== 'ko') ko(p1, p2, { reason: p1.parts.head && p1.parts.head.detached ? 'head' : 'legs' });
    else if (isCatastrophic(p2) && p2.state !== 'ko') ko(p2, p1, { reason: p2.parts.head && p2.parts.head.detached ? 'head' : 'legs' });
  }

  if (!match.camLock) updateCamera(dt);
  updateFighterRims();
  hitLight.intensity = Math.max(0, hitLight.intensity - dt * 28);
  setBuzz(isSettingsOpen() ? 0 : buzzFromFighters());
  syncHud();
  renderer.render(scene, camera);
}

function buzzFromFighters() {
  let b = 0;
  for (const f of [p1, p2]) {
    if (!f || !f.parts) continue;
    for (const part of Object.values(f.parts)) {
      if (!part || part.detached || !part.max) continue;
      const t = 1 - part.hp / part.max;
      if (t > 0.35) b = Math.max(b, (t - 0.35) / 0.65);
    }
  }
  return b;
}

function startFightFromShell(opts) {
  opts = opts || {};
  if (opts.p1) applyFighterConfig(p1, opts.p1);
  if (opts.p2) applyFighterConfig(p2, opts.p2);
  if (opts.round != null) match.roundIndex = opts.round;
  if (opts.roundTime != null) match.roundTimeOverride = opts.roundTime;
  if (opts.onEnd) onFightEnd(opts.onEnd);
  resetMatch();
  if (opts.skipIntro) {
    match.phase = 'fight';
    match.introT = 99;
    p1.state = 'idle';
    p2.state = 'idle';
    setAnim(p1, idleClipFor(p1), 0.1);
    setAnim(p2, idleClipFor(p2), 0.1);
    document.getElementById('banner').classList.remove('show');
    startRoundClock();
    startCrowd();
  }
  paintRound();
  return getFightState();
}

function getFightState() {
  if (!p1 || !p2) return { ready: false };
  return {
    ready: true,
    phase: match.phase,
    over: match.over,
    winner: match.winner,
    roundIndex: match.roundIndex,
    roundLeft: match.roundLeft,
    p1: { health: p1.health, state: p1.state, config: p1.config },
    p2: { health: p2.health, state: p2.state, config: p2.config },
  };
}

function onLoad(gltf) {
  const built = buildArenaVisual(scene, { tiled, metalColor, metalRough, metalMetal });
  const lightRig = addArenaLights(scene, built.fixturePos);
  if (lightRig) {
    trackLight(lightRig.hemi);
    trackLight(lightRig.fill);
    trackLight(lightRig.fill2);
    trackLight(lightRig.rim);
    trackLight(lightRig.rimL);
    trackLight(lightRig.rimR);
    for (const s of (lightRig.spots || [])) trackLight(s);
  }
  fighterRims = [makeFighterRim(0xc8e0ff), makeFighterRim(0xffd4b8)];
  applyLight(getSettings().light);
  initArenaPhysics();
  p1 = makeFighter(gltf, MODEL.colors.p1, 'p1');
  p2 = makeFighter(gltf, MODEL.colors.p2, 'p2');
  applyFighterConfig(p1, defaultFighterConfig('p1'));
  applyFighterConfig(p2, defaultFighterConfig('p2'));
  attachFighter(p1);
  attachFighter(p2);
  onPhysicsBounce((kind, impact, rec) => {
    const vol = Math.min(1, 0.25 + impact / 6.5);
    const rate = 0.88 + Math.min(0.3, impact / 18);
    const id = rec && rec.body ? rec.body.id : undefined;
    if (kind === 'cage' || kind === 'post') playSfx('cage', { vol, rate, id });
    else playSfx('bounce', { vol, rate, id });
  });
  registerFightRuntime({
    startFight: startFightFromShell,
    endFight(reason) {
      if (match.over) return getFightState();
      if (reason === 'draw' || (p1.health === p2.health)) endByTime();
      else if (p1.health >= p2.health) ko(p2, p1);
      else ko(p1, p2);
      return getFightState();
    },
    getState: getFightState,
    setFighterConfig(id, cfg) {
      const f = id === 'p2' ? p2 : p1;
      if (!f) return null;
      applyFighterConfig(f, cfg);
      return f.config;
    },
  });
  scene.add(p1.root, p2.root);
  applyGfx(gfxKey);
  resize();
  faceEachOther(p1, p2);
  paintRound();
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
  window.__rfSetHdri = (on) => applyHdri(!!on);
  window.__rfHdriReady = () => !!hdriEnv;
  window.__rfPrepHdriShot = () => {
    startFightFromShell({ skipIntro: true });
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '0';
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('fps').classList.add('hidden');
    const hud = document.getElementById('hud');
    if (hud) hud.style.visibility = 'hidden';
    const bottom = document.getElementById('bottom');
    if (bottom) bottom.style.visibility = 'hidden';
    const rfs = document.getElementById('rfs');
    if (rfs) rfs.style.display = 'none';
    document.body.classList.remove('rfs-on');
    delete window.__rfDebug;
    match.camLock = true;
    camera.fov = 50;
    camera.updateProjectionMatrix();
    camera.position.set(0, 2.85, 11.0);
    camera.lookAt(0, 1.25, 0);
  };
  window.__rfSkipToFight = () => {
    startFightFromShell({ skipIntro: true });
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '';
    document.getElementById('overlay').classList.add('hidden');
    match.camLock = false;
    delete window.__rfDebug;
  };
  window.__rfPrepKoShot = () => {
    startFightFromShell({ skipIntro: true });
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '0';
    match.camLock = false;
    delete window.__rfDebug;
    const towardCam = new THREE.Vector3(0.15, 0.08, 1);
    previewDamage(p2, scene, towardCam);
    p2.health = 0;
    ko(p2, p1, { dir: towardCam, force: 7.5 });
    match.overlayAt = performance.now() + 900;
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('fps').classList.add('hidden');
  };

  window.__rfMeasureFeet = () => {
    const top = matTopY();
    const out = { matTop: top };
    for (const f of [p1, p2]) {
      f.model.updateWorldMatrix(true, true);
      const bones = {};
      let minY = Infinity;
      for (const b of (f.footBones || [])) {
        const v = new THREE.Vector3();
        b.getWorldPosition(v);
        bones[b.name] = +v.y.toFixed(4);
        if (v.y < minY) minY = v.y;
      }
      out[f.id] = { rootY: +f.root.position.y.toFixed(4), groundY: +(f.groundY || 0).toFixed(4), minY: Number.isFinite(minY) ? +minY.toFixed(4) : null, bones };
    }
    return out;
  };
  window.__rfPrepFeetShot = () => {
    startFightFromShell({ skipIntro: true });
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '0';
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('fps').classList.add('hidden');
    delete window.__rfDebug;
    match.camLock = true;
    const mid = new THREE.Vector3().addVectors(p1.root.position, p2.root.position).multiplyScalar(0.5);
    camera.fov = 40;
    camera.updateProjectionMatrix();
    camera.position.set(mid.x + 0.15, 0.28, mid.z + 2.15);
    camera.lookAt(mid.x, matTopY() + 0.04, mid.z);
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

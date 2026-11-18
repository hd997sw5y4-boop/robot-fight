import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader as RGBELoader } from 'three/addons/loaders/HDRLoader.js';
import { SIZE, MODEL, ARENA, COMBAT, DAMAGE, GFX_PRESETS, LOOP_CLIPS, getFighterStats } from './config.js';
import { CLIP_SPEEDS } from './clip-speeds.js';
import { applyChrome, setChromeLow } from './chrome.js';
import { initJointLimits, applyJointLimits } from './joints.js';
import { setWiresLow } from './wires.js';
import { createApiBrain, wantsApiBrain, initApiBrainUI } from './api-brain.js';
import { getSettings, isSettingsOpen, initSettings, updateFps, cycleCameraMode, setCameraMode } from './settings.js';
import { broadcastMain } from './arena/broadcast.js';
let prevCamMode = null;
import { unlockAudio, playSfx, playHit, setBuzz, startCrowd } from './audio.js';
import { announce, announceIntroSeconds } from './announcer.js';
import { buildArena as buildArenaVisual, addArenaLights, addFloorReflection } from './arena.js';
// [stadium-arena hook] stadium scenery lives in its own module.
import { initStadium, stadiumOwnsEnv, stadiumApplyEnv, stadiumSetGfx, updateStadium } from './arena/stadium.js';
import { updateCrowdCam } from './arena/crowdcam.js'; // [stadium-broadcast hook]
import {
  initArenaPhysics,
  attachFighter,
  setFighterMove,
  stepPhysics,
  impactVelocity,
  resetFighterPhysics,
  clearPhysicsDebris,
  onPhysicsBounce,
  setDebrisLow,
} from './physics.js';
import {
  registerFightRuntime,
  notifyFightEnd,
  defaultFighterConfig,
  AI_PERSONALITIES,
  onFightEnd,
} from './api.js';
import { createPacedBrain } from './brain.js';
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
  blowEye,
  stepDamage,
  applyMalfunctions,
  resetFighterDamage,
  clearAllDebris,
  syncPartHud,
  previewDamage,
  applyStrikeWear,
  strikeMul,
  debugBreakSub,
  oilStats,
} from './damage.js';

const canvas = document.getElementById('c');
const keys = new Set();
const held = { punch: false, kick: false, ground: false, buf: null, bufT: 0 };

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
setChromeLow(gfxKey === "low");
setWiresLow(gfxKey === "low");
setDebrisLow(gfxKey === "low");

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
camera.position.set(0, 3.2 * SIZE, 12.5 * SIZE);

function applyFov(v) {
  fovTarget = clampFov(v);
}

function stepFov(dt) {
  const k = dt <= 0 ? 0.35 : 1 - Math.pow(0.0007, dt);
  fovLive += (fovTarget - fovLive) * k;
  if (camModeLive === 'broadcast') return; // the TV director sets its own lens
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
  // Wheel zooms the orbit camera in and out (FOV stays on the Settings slider).
  const f = Math.exp(Math.sign(e.deltaY) * Math.min(0.35, 0.08 + Math.abs(e.deltaY) * 0.0012));
  orbit.zoom = Math.max(0.08, Math.min(2.2, orbit.zoom * f));
}, { passive: false });

// Mouse orbit like Window Workshop 3D: drag (left or right button) to spin 360° and tilt;
// double-click to reset the view.
const orbit = { yaw: 0, pitch: 0.26, zoom: 1, drag: false };
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  orbit.drag = true;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  orbit.yaw -= e.movementX * 0.0065;
  orbit.pitch = Math.max(0.02, Math.min(1.4, orbit.pitch + e.movementY * 0.005));
});
const endDrag = (e) => { orbit.drag = false; canvas.releasePointerCapture?.(e.pointerId); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', () => { orbit.yaw = 0; orbit.pitch = 0.26; orbit.zoom = 1; });

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
let hdriEnabled = !!getSettings().hdri;

// HDRI on/off. The wanted state is remembered and the environment is (re)applied by
// syncEnvironment() whenever something it depends on appears: the HDR file finishing
// loading, the arena (with its dark void wall) being built after the robot GLB loads, a
// settings change, or a new round. Before, the HDR could finish first, hide a void wall
// that didn't exist yet, and the wall then covered the backdrop in black on every load.
function applyHdri(on) {
  hdriEnabled = !!on;
  if (hdriEnabled && !hdriEnv) loadHdri().then(() => syncEnvironment());
  syncEnvironment();
}

function syncEnvironment() {
  // [stadium-arena hook] the stadium owns background/env/fog while it is the active arena.
  if (stadiumOwnsEnv()) { stadiumApplyEnv(); return; }
  const on = hdriEnabled && !!hdriEnv;
  if (on) {
    scene.environment = hdriEnv;
    scene.environmentIntensity = 1.05;
    scene.background = hdriBg || hdriEnv;
    scene.backgroundBlurriness = 0.04;
    scene.backgroundIntensity = 0.7;
    scene.fog = null;
  } else {
    scene.environment = roomEnv;
    scene.environmentIntensity = 0.38;
    scene.background = darkBg;
    scene.backgroundBlurriness = 0;
    scene.backgroundIntensity = 1;
    if (!scene.fog) scene.fog = new THREE.Fog(0x080a10, 18, 42);
  }
  scene.traverse((o) => { if (o.userData && o.userData.voidWall) o.visible = !on; });
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

// Start fetching straight away (on by default); applied as soon as it's ready.
// [stadium-arena hook] skip the 6.7 MB HDRI download until Industrial is picked.
if (!stadiumOwnsEnv()) loadHdri().then(() => syncEnvironment());

let lightMul = Math.max(0.5, Math.min(2, getSettings().light || 1));
const litLights = [];

let floorMirror = null;
function applyGfx(key) {
  gfxKey = key === 'low' ? 'low' : 'high';
  if (floorMirror) floorMirror.visible = gfxKey !== 'low';
  setChromeLow(gfxKey === 'low');
  setWiresLow(gfxKey === 'low');
  setDebrisLow(gfxKey === 'low');
  stadiumSetGfx(gfxKey); // [stadium-arena hook]
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
    light.target.position.set(f.root.position.x, f.root.position.y + 1.15 * SIZE, f.root.position.z);
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
initApiBrainUI();
initSettings({
  applyGfx,
  applyFov,
  applyLight,
  applyHdri,
  onChange(s) {
    applyFov(s.fov);
    applyLight(s.light);
    applyHdri(!!s.hdri);
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
    for (const m of [].concat(o.material)) applyChrome(o, m, c);
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

// Neon eyes: two team-tinted emissive lamps on a dark visor band, each with an additive glow
// halo (a cheap bloom stand-in: there is no post-processing pass). Either eye can be blown out
// by a hit on that spot (damage.js blowEye) and stays dark for the rest of the match.
let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}
const eyeTint = (color) => new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.3);
function addVisor(model, color) {
  let head = null;
  model.traverse((o) => {
    if (head) return;
    if (!o.isBone && o.type !== 'Bone') return;
    const n = String(o.name || '').replace(/^mixamorig[:._]*/i, '');
    if (n === 'Head') head = o;
  });
  if (!head) return;
  head.updateWorldMatrix(true, false);
  const ws = new THREE.Vector3();
  head.getWorldScale(ws);
  const sx = 1 / Math.max(ws.x, 1e-5), sy = 1 / Math.max(ws.y, 1e-5), sz = 1 / Math.max(ws.z, 1e-5);
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x07090c, roughness: 0.12, metalness: 0.6 }),
  );
  band.name = 'rfVisorBand';
  band.scale.set(0.2 * sx, 0.05 * sy, 0.06 * sz);
  band.position.set(0, 0.07 * sy, 0.11 * sz);
  head.add(band);
  const c = eyeTint(color);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(2.2), toneMapped: false }),
    );
    eye.name = side < 0 ? 'rfEyeL' : 'rfEyeR';
    eye.scale.set(0.024 * sx, 0.016 * sy, 0.012 * sz);
    eye.position.set(side * 0.048 * sx, 0.072 * sy, 0.142 * sz);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: c, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, toneMapped: false,
    }));
    halo.name = 'rfEyeGlow';
    halo.scale.set(0.16 * sx / (0.024 * sx), 0.16 * sy / (0.016 * sy), 1); // in eye space
    halo.position.set(0, 0, 0.6);
    halo.renderOrder = 5;
    eye.add(halo);
    head.add(eye);
  }
}

function collectEyes(f) {
  f.eyes = [];
  f.model.traverse((o) => { if (o.name === 'rfEyeL' || o.name === 'rfEyeR') f.eyes.push({ mesh: o, halo: o.children[0], blown: false, flick: 0, side: o.name === 'rfEyeL' ? 'L' : 'R' }); });
}

// Restore both eyes (new match only: a blown eye stays out across rounds).
function resetEyes(f) {
  if (!f.eyes) return;
  const c = eyeTint(f.id === 'p1' ? MODEL.colors.p1 : MODEL.colors.p2);
  for (const e of f.eyes) {
    e.blown = false; e.flick = 0;
    e.mesh.material.color.copy(c).multiplyScalar(2.2);
    e.halo.material.color.copy(c); e.halo.visible = true; e.halo.material.opacity = 0.85;
  }
}

// A blown eye sputters for a moment, then stays dark.
function stepEyes(f, dt) {
  if (!f.eyes) return;
  for (const e of f.eyes) {
    if (!e.blown || e.flick <= 0) continue;
    e.flick -= dt;
    const on = e.flick > 0 && Math.random() < 0.35 * (e.flick / 1.4) + 0.05;
    const k = on ? 0.5 + Math.random() * 0.8 : 0.03;
    e.mesh.material.color.copy(e.tint).multiplyScalar(k);
    e.halo.visible = on;
    if (e.flick <= 0) { e.mesh.material.color.setRGB(0.03, 0.03, 0.035); e.halo.visible = false; }
  }
}

function retintFighter(f, color) {
  const c = new THREE.Color(color);
  f.model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === 'rfVisorBand') return;
    for (const m of [].concat(o.material)) {
      if (!m || !m.color || o.name === 'rfEyeL' || o.name === 'rfEyeR') continue;
      if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
      m.color.copy(m.userData.baseColor).lerp(c, 0.42);
    }
    // Eyes keep the team colour (blue / red) whatever the paint.
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
    new THREE.CircleGeometry(0.46 * SIZE, 6),
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
  shield.position.set(0, 1.05 * SIZE, 0.55 * SIZE);
  shield.visible = false;
  root.add(shield);

  prepFootworkClips(gltf);
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

  const startX = side === 'p1' ? -2.15 * SIZE : 2.15 * SIZE;
  root.position.set(startX, 0, 0);

  let hips = null;
  let spine = null;
  model.traverse((o) => {
    // GLTFLoader strips the ':' from 'mixamorig:Hips', so match on the bare bone name.
    if (!(o.isBone || o.type === 'Bone')) return;
    const k = boneKey(o.name);
    if (k === 'Hips' && !hips) hips = o;
    if ((k === 'Spine' || k === 'Spine1') && !spine) spine = o;
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
    if (f.state === 'ko' || f.state === 'down' || f.state === 'getup') return;
    if (match.over) return;
    if (f.health > 0 && (f.state === 'punch' || f.state === 'kick')) endAttack(f, 0.15);
    else if (f.health > 0 && f.state === 'hit') {
      f.hitPush = null;
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.15);
    }
  });
  initJointLimits(f); // rest pose, before any clip has posed the bones
  // Stat profile (js/config.js FIGHTER_PROFILES): Blue Striker / Red Bruiser by default; a shell
  // config may name another profile. f.stat holds the multipliers fight code applies.
  f.stats = getFighterStats((f.config && f.config.profile) || side);
  f.stat = f.stats.mul;
  collectEyes(f);
  prepareFighterDamage(f);
  cacheFeet(f);
  cacheBody(f);
  if (!STRIKE_T) STRIKE_T = measureStrikes(f);
  if (!AIR_T) AIR_T = measureAir(f);
  return f;
}

// Strike timing per attack clip, measured once from the clip itself: when the fist/foot is
// furthest forward (the hit), the window around it, and when the strike has retracted.
// Attacks skip the slow lead-in, hit on the measured frames and hand control back as soon as
// the strike is pulled back, instead of locking the robot for the whole (long) Mixamo clip.
let STRIKE_T = null;
// Airborne clips (jump kicks, flips), measured once: when the whole body leaves the mat and
// lands again (root at 0, the clip's own hips height), plus the standing baseline.
let AIR_T = null;
function measureAir(f) {
  const A = MODEL.animations;
  const names = [...(A.jumpKicks || []), A.dodgeBack, A.dodgeFront].filter(Boolean);
  const out = {};
  const save = f.current;
  f.mixer.stopAllAction();
  for (const name of names) {
    const act = f.actions[name];
    if (!act) continue;
    const dur = act.getClip().duration;
    act.reset(); act.setEffectiveWeight(1); act.timeScale = 1; act.play();
    const N = Math.ceil(dur * 60);
    const lows = [];
    for (let i = 0; i <= N; i++) {
      act.time = (dur * i) / N;
      f.mixer.update(0);
      f.root.position.y = 0;
      f.root.updateMatrixWorld(true);
      lows.push(lowestBodyY(f) ?? 0);
    }
    act.stop();
    const base = lows[0];
    const lift = 0.1 * SIZE;
    let i0 = lows.findIndex((y) => y > base + lift);
    let i1 = -1;
    for (let i = N; i >= 0; i--) if (lows[i] > base + lift) { i1 = i; break; }
    if (i0 < 0) { out[name] = { dur, base, air: false }; continue; }
    const t0 = (dur * i0) / N;
    const t1 = (dur * i1) / N;
    out[name] = {
      dur, base, air: true, t0, t1,
      peak: +(Math.max(...lows) - base).toFixed(3),
      start: Math.max(0, t0 - 0.35),          // keep a short crouch / take-off before leaving the mat
      end: Math.min(dur, t1 + 0.3),           // and a moment to absorb the landing
    };
  }
  // Kneeling KO: the frame where the body-shot fall is lowest (on its knees) before it rises.
  out.__kneel = {};
  const hips = f.hipsBone || (f.hipsBone = findHips(f));
  for (const name of ['LivershotKnockdown']) {
    const act = f.actions[name];
    if (!act || !hips) continue;
    const dur = act.getClip().duration;
    act.reset(); act.setEffectiveWeight(1); act.timeScale = 1; act.play();
    const N = Math.ceil(dur * 30);
    let best = Infinity, bt = 0;
    const hv = new THREE.Vector3();
    for (let i = 0; i <= N; i++) {
      const t = (dur * i) / N;
      if (t > dur * 0.75) break;
      act.time = t; f.mixer.update(0); f.root.position.y = 0; f.root.updateMatrixWorld(true);
      const y = hips.getWorldPosition(hv).y;
      if (y < best - 1e-3) { best = y; bt = t; }
    }
    act.stop();
    if (bt > 0.2) out.__kneel[name] = { at: bt, from: Math.min(0.1, bt * 0.2), hipsY: +best.toFixed(3) };
  }
  // Topple KO poses: the frozen frame used and how far the body reaches out to each side of the
  // feet (root space x). A wide pose would prop the toppled body up on an arm.
  out.__topple = {};
  const tv = new THREE.Vector3();
  const savePos = f.root.position.clone(), saveRot = f.root.rotation.y;
  for (const name of TOPPLE_POSES) {
    const act = f.actions[name];
    if (!act) continue;
    const dur = act.getClip().duration;
    const t = Math.min(0.25, dur * 0.3);
    act.reset(); act.setEffectiveWeight(1); act.timeScale = 1; act.play();
    act.time = t; f.mixer.update(0); f.root.position.set(0, 0, 0); f.root.rotation.set(0, 0, 0); f.root.updateMatrixWorld(true);
    let L = 0, R = 0;
    f.model.traverse((o) => { if (o.isBone) { const x = o.getWorldPosition(tv).x; L = Math.max(L, x); R = Math.max(R, -x); } });
    act.stop();
    out.__topple[name] = { t, left: +L.toFixed(3), right: +R.toFixed(3) };
  }
  f.root.position.copy(savePos); f.root.rotation.set(0, saveRot, 0);
  f.mixer.stopAllAction();
  f.current = null;
  setAnim(f, save || idleClipFor(f), 0.08);
  return out;
}
const TOPPLE_POSES = ['HitOnLegs', 'HeadHit', 'BigStomachHit', 'Stunned', 'HitToBody', 'HitOnSideOfHead', 'Reaction'];
const SPECIAL_STRIKES = new Set([...(MODEL.animations.kickSpecial || []), ...(MODEL.animations.flipSpecial || [])]);
const STRIKE_VMAX = 12.5 * SIZE; // m/s: fastest a fist or foot may travel
const RETRACT_SPEED = 2.4; // clip seconds per second when a landed strike is pulled back
function measureStrikes(f) {
  const A = MODEL.animations;
  const kicks = new Set([...(A.kickVariants || []), ...(A.kickSpecial || []), ...(A.flipSpecial || []), A.kick]);
  const names = new Set([...(A.punchVariants || []), ...(A.punchRight || []), ...(A.punchLeft || []), A.punch, ...kicks]);
  const out = {};
  const v = new THREE.Vector3();
  const save = f.current;
  f.mixer.stopAllAction();
  // The guard pose every strike blends in from (limb tips, root space).
  const allTips = [...new Set([...(f.strikeBones.punch || []), ...(f.strikeBones.kick || [])])];
  const idleAct = f.actions[idleClipFor(f)] || f.actions[MODEL.animations.idle];
  let guardTips = null;
  if (idleAct) {
    idleAct.reset(); idleAct.setEffectiveWeight(1); idleAct.play(); idleAct.time = 0;
    f.mixer.update(0); f.root.updateMatrixWorld(true);
    guardTips = allTips.map((b) => f.root.worldToLocal(b.getWorldPosition(new THREE.Vector3())));
    idleAct.stop();
  }
  for (const name of names) {
    const act = name && f.actions[name];
    if (!act) continue;
    const kind = kicks.has(name) ? 'kick' : 'punch';
    const bones = f.strikeBones[kind];
    if (!bones || !bones.length) continue;
    const tips = [...new Set([...(f.strikeBones.punch || []), ...(f.strikeBones.kick || [])])];
    const dur = act.getClip().duration;
    act.reset();
    act.setEffectiveWeight(1);
    act.timeScale = 1;
    act.play();
    const N = Math.max(60, Math.ceil(dur * 120)); // fine enough to catch the fastest whips
    const s = [];
    for (let i = 0; i <= N; i++) {
      act.time = (dur * i) / N;
      f.mixer.update(0);
      f.root.updateMatrixWorld(true);
      let reach = -Infinity;
      let low = Infinity;
      const ys = [];
      const zs = [];
      for (const b of bones) {
        b.getWorldPosition(v);
        f.root.worldToLocal(v);
        reach = Math.max(reach, v.z);
        low = Math.min(low, v.y);
        ys.push(v.y);
        zs.push(v.z);
      }
      let vmax = 0;
      const prevS = s[s.length - 1];
      if (prevS) {
        // Fastest strike-bone speed in clip time (m/s), from the change since the last sample.
        for (let j = 0; j < bones.length; j++) {
          bones[j].getWorldPosition(v);
          f.root.worldToLocal(v);
          const d = Math.hypot(v.z - prevS.zs[j], v.y - prevS.ys[j], v.x - prevS.xs[j]);
          vmax = Math.max(vmax, d / (dur / N));
        }
        // Every limb tip counts (a spinning sweep whips the hands too), not only the striking ones.
        for (let j = 0; j < tips.length; j++) {
          tips[j].getWorldPosition(v);
          f.root.worldToLocal(v);
          const q = prevS.tp[j];
          vmax = Math.max(vmax, Math.hypot(v.x - q.x, v.y - q.y, v.z - q.z) / (dur / N));
        }
      }
      const xs = bones.map((b) => { b.getWorldPosition(v); f.root.worldToLocal(v); return v.x; });
      const tp = tips.map((b) => f.root.worldToLocal(b.getWorldPosition(new THREE.Vector3())));
      s.push({ t: act.time, reach, low, ys, zs, xs, vmax, tp });
    }
    act.stop();
    let pk = 0;
    for (let i = 1; i < s.length; i++) if (s[i].reach > s[pk].reach) pk = i;
    const rest = s[0].reach;
    const lift = Math.max(1e-3, s[pk].reach - rest);
    let i0 = pk;
    while (i0 > 0 && s[i0 - 1].reach > rest + lift * 0.55) i0--;
    let i1 = pk;
    while (i1 < N && s[i1 + 1].reach > rest + lift * 0.55) i1++;
    const a0 = Math.max(0, s[i0].t - 0.04);
    const a1 = Math.min(dur, s[i1].t + 0.04);
    let end = Math.min(dur, a1 + 0.12);
    if (kind === 'kick') {
      // A kick hands control back once the KICKING foot is back on the mat. (Testing the lowest
      // strike bone of either leg always found the standing foot, so kicks ended with the leg
      // still in the air and the cross-fade to idle floated it down.)
      let kb = 0;
      for (let j = 0; j < bones.length; j++) {
        const isFoot = /foot|toe/i.test(bones[j].name);
        if (isFoot && (!/foot|toe/i.test(bones[kb].name) || s[pk].zs[j] > s[pk].zs[kb])) kb = j;
      }
      const floor = s[0].ys[kb] + 0.06 * SIZE;
      let i2 = i1;
      while (i2 < N && s[i2].ys[kb] > floor) i2++;
      end = Math.min(dur, Math.max(a1 + 0.1, s[i2].t));
    }
    const lead = kind === 'kick' ? 0.3 : 0.2; // clip seconds kept before the active window
    // Peak limb-tip speed over the part of the clip that is played
    const startT = Math.max(0, a0 - lead);
    let vpk = 0;
    // (to the clip's end: after the strike hands control back the clip keeps playing under
    // the fade-out, and spinning sweeps whip fastest there)
    for (const r of s) if (r.t >= startT) vpk = Math.max(vpk, r.vmax);
    // How far the limb tips are from the guard at the (skipped-to) start frame: the blend in
    // is lengthened so it never whips a hand or foot across that gap.
    let gap0 = 0;
    if (guardTips) {
      const r0 = s.reduce((b, r) => (Math.abs(r.t - startT) < Math.abs(b.t - startT) ? r : b), s[0]);
      for (let j = 0; j < allTips.length; j++) gap0 = Math.max(gap0, r0.tp[j].distanceTo(guardTips[j]));
    }
    out[name] = { kind, dur, start: startT, a0, a1, end, peak: s[pk].t, reach: +(s[pk].reach * 1).toFixed(3), vpk: +vpk.toFixed(2), gap0: +gap0.toFixed(3) };
  }
  f.mixer.stopAllAction();
  f.current = null;
  setAnim(f, save || idleClipFor(f), 0.08);
  return out;
}

function boneKey(name) {
  return String(name || '').replace(/^mixamorig[:._]*/i, '');
}

const UPPER_BODY = /(spine|neck|head|shoulder|arm|hand)/i;
// Fighters step in their guard: strip the casual arm swing from the walk clips and build an
// upper-body-only guard clip from FightingIdle to layer on top while stepping.
function prepFootworkClips(gltf) {
  if (gltf.__footworkPrepped) return;
  gltf.__footworkPrepped = true;
  const byName = Object.fromEntries(gltf.animations.map((c) => [c.name, c]));
  for (const name of ['Walking', 'WalkingBackwards']) {
    const c = byName[name];
    if (c) c.tracks = c.tracks.filter((t) => !UPPER_BODY.test(t.name.split('.')[0]));
  }
  const idle = byName[MODEL.animations.idle || 'FightingIdle'] || byName.FightingIdle;
  if (idle) {
    const tracks = idle.tracks.filter((t) => UPPER_BODY.test(t.name.split('.')[0])).map((t) => t.clone());
    gltf.animations.push(new THREE.AnimationClip('GuardUpper', idle.duration, tracks));
  }
  // One-foot gaits: after a foot is torn off, footwork uses copies of the walk/strafe clips
  // whose stump-side leg holds still (no stride on a missing foot). applyStumpLeg folds that
  // leg up on top; the good leg keeps the clip's stride and feet grounding keeps it planted,
  // so the robot hops along on one leg instead of walking normally.
  for (const [name, tag] of [['Walking', 'Fwd'], ['WalkingBackwards', 'Back'], ['JogStrafeLeft', 'StrafeL'], ['JogStrafeRight', 'StrafeR']]) {
    const c = byName[name];
    if (!c) continue;
    for (const side of ['L', 'R']) {
      const stumpLeg = new RegExp('^(mixamorig[:._]*)?' + (side === 'L' ? 'Left' : 'Right') + '(UpLeg|Leg|Foot|ToeBase)$');
      const tracks = c.tracks.map((t) => {
        if (!stumpLeg.test(t.name.split('.')[0])) return t.clone();
        const n = t.getValueSize();
        const v = Array.from(t.values.slice(0, n));
        return new t.constructor(t.name, [0, c.duration], v.concat(v));
      });
      const hop = new THREE.AnimationClip(STUMP_CLIP[tag] + side, c.duration, tracks);
      gltf.animations.push(hop);
      CLIP_SPEEDS[hop.name] = CLIP_SPEEDS[name];
    }
  }
}
const STUMP_CLIP = { Fwd: 'StumpHop', Back: 'StumpHopBack', StrafeL: 'StumpHopLeft', StrafeR: 'StumpHopRight' };

// Soft contact shadows. The chrome mat is metal, so real shadow maps barely darken it; these
// dark blobs under the body and each foot show where the robot actually touches the mat.
let _blobTex = null;
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.6)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}
function makeBlob(size, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity, toneMapped: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 2;
  m.userData.baseOpacity = opacity;
  scene.add(m);
  return m;
}
const _blobP = new THREE.Vector3();
function updateContactShadows(f) {
  if (!f || !f.model) return;
  if (!f.blobs) f.blobs = { body: makeBlob(1.25, 0.5), left: makeBlob(0.5 * SIZE, 0.9), right: makeBlob(0.5 * SIZE, 0.9) };
  const top = matTopY() + 0.005; // above the logo decal
  const hips = f.hipsBone || (f.hipsBone = findHips(f));
  (hips || f.root).getWorldPosition(_blobP);
  f.blobs.body.position.set(_blobP.x, top, _blobP.z);
  f.blobs.body.material.opacity = f.blobs.body.userData.baseOpacity * Math.max(0, 1 - Math.max(0, _blobP.y - 1.2) / 1.5);
  for (const side of ['left', 'right']) {
    const blob = f.blobs[side];
    const part = side === 'left' ? f.parts && f.parts.legL : f.parts && f.parts.legR;
    const foot = f.ikLegs && f.ikLegs[side === 'left' ? 'L' : 'R'];
    const bone = foot && (foot.toe || foot.foot);
    if (!bone || (part && part.detached)) { blob.visible = false; continue; }
    blob.visible = true;
    // Under the real sole (lowest sole vertex), not the toe/ankle bone pivot that sits ~10 cm
    // up: a planted foot gets a dark, tight contact shadow; a lifted one fades and spreads.
    const sole = soleLow(f, side);
    if (sole) { bone.getWorldPosition(_blobP); _blobP.x = (_blobP.x + sole.x) / 2; _blobP.z = (_blobP.z + sole.z) / 2; _blobP.y = sole.y; }
    else bone.getWorldPosition(_blobP);
    blob.position.set(_blobP.x, top, _blobP.z);
    const h = Math.max(0, _blobP.y - top);
    blob.material.opacity = blob.userData.baseOpacity * Math.max(0, 1 - h / 0.3);
    const sc = (0.85 + h * 2.2);
    blob.scale.set(sc, sc, 1);
  }
}
const _sl = new THREE.Vector3();
function soleLow(f, side) {
  const sv = f.soleVerts && f.soleVerts[side];
  if (!sv || !sv.length) return null;
  let best = null;
  for (const { mesh, idx } of sv) {
    if (!mesh.visible) continue;
    const hidden = mesh.userData.hiddenVerts;
    for (let k = 0; k < idx.length; k += Math.max(1, Math.floor(idx.length / 12))) {
      const i = idx[k];
      if (hidden && hidden[i]) continue;
      mesh.getVertexPosition(i, _sl);
      _sl.applyMatrix4(mesh.matrixWorld);
      if (!best || _sl.y < best.y) best = (best || new THREE.Vector3()).copy(_sl);
    }
  }
  return best;
}
function findHips(f) {
  let hips = null;
  f.model.traverse((o) => { if (!hips && (o.isBone || o.type === 'Bone') && boneKey(o.name) === 'Hips') hips = o; });
  return hips;
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
  // The foot/toe joints sit inside the mesh; the visible sole and toe tips are lower. Keep a
  // small sample of the skinned vertices driven by the foot/toe bones so grounding can put the
  // real sole on the mat.
  f.soleVerts = { left: [], right: [] };
  const footSet = new Map(f.footBones.map((b) => [b, boneKey(b.name).toLowerCase().startsWith('left') ? 'left' : 'right']));
  f.model.traverse((m) => {
    if (!m.isSkinnedMesh || !m.skeleton || !m.geometry) return;
    const si = m.geometry.attributes.skinIndex;
    const sw = m.geometry.attributes.skinWeight;
    if (!si || !sw) return;
    const sideOf = m.skeleton.bones.map((b) => footSet.get(b) || null);
    if (!sideOf.some(Boolean)) return;
    const hit = { left: [], right: [] };
    for (let i = 0; i < si.count; i++) {
      let best = -1; let bw = 0;
      for (let c = 0; c < 4; c++) {
        const w = sw.getComponent(i, c);
        if (w > bw) { bw = w; best = si.getComponent(i, c); }
      }
      const side = best >= 0 ? sideOf[best] : null;
      if (side && bw > 0.5) hit[side].push(i);
    }
    for (const side of ['left', 'right']) {
      const list = hit[side];
      const stride = Math.max(1, Math.ceil(list.length / 90));
      const idx = [];
      for (let j = 0; j < list.length; j += stride) idx.push(list[j]);
      if (idx.length) f.soleVerts[side].push({ mesh: m, idx });
    }
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
  // Real sole/toe-tip vertices (skinned) for the legs still attached.
  const sv = f.soleVerts;
  if (sv) {
    for (const side of ['left', 'right']) {
      const part = side === 'left' ? f.parts && f.parts.legL : f.parts && f.parts.legR;
      if (part && part.detached) continue;
      for (const { mesh, idx } of sv[side]) {
        if (!mesh.visible) continue;
        // updateWorldMatrix() skips SkinnedMesh's bind refresh; without it the root offset is
        // counted twice and the robots ratchet upward.
        if (mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
        const hidden = mesh.userData.hiddenVerts;
        for (const i of idx) {
          if (hidden && hidden[i]) continue; // torn-off foot / toes: not on the robot any more
          mesh.getVertexPosition(i, _footY);
          _footY.applyMatrix4(mesh.matrixWorld);
          if (_footY.y < minY) minY = _footY.y;
        }
      }
    }
  }
  return Number.isFinite(minY) ? minY : null;
}

// Whole-body skinned vertex sample (a few hundred points): used to keep a lying robot's mesh
// on the mat during knockdowns, get-ups and KO falls.
function cacheBody(f) {
  f.bodyVerts = [];
  f.model.traverse((m) => {
    if (!m.isSkinnedMesh || !m.geometry || !m.geometry.attributes.position) return;
    const n = m.geometry.attributes.position.count;
    const stride = Math.max(1, Math.ceil(n / 420));
    const idx = [];
    for (let i = 0; i < n; i += stride) idx.push(i);
    f.bodyVerts.push({ mesh: m, idx });
  });
  // Strike points (fists, forearms, feet, shins) and the spine chain for hit flinches.
  const want = {
    LeftHand: 'punch', RightHand: 'punch', LeftForeArm: 'punch', RightForeArm: 'punch',
    LeftFoot: 'kick', RightFoot: 'kick', LeftToeBase: 'kick', RightToeBase: 'kick', LeftLeg: 'kick', RightLeg: 'kick',
  };
  f.strikeBones = { punch: [], kick: [] };
  f.flinchBones = {};
  f.groundBones = [];
  f.model.traverse((o) => {
    if (!o.isBone && o.type !== 'Bone') return;
    const k = boneKey(o.name);
    if (want[k]) f.strikeBones[want[k]].push(o);
    if (['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'].includes(k)) f.flinchBones[k] = o;
    if (GROUND_BONES[k] && !f.groundBones.some((g) => g.key === k)) f.groundBones.push({ key: k, bone: o, part: GROUND_BONES[k] });
  });
}

function partCodeDetached(f, code) {
  if (!code || !f.parts) return false;
  const id = DAMAGE.order[code - 1];
  return !!(id && f.parts[id] && f.parts[id].detached);
}

function lowestBodyY(f) {
  if (!f.bodyVerts || !f.bodyVerts.length) return null;
  f.model.updateWorldMatrix(true, true);
  let minY = Infinity;
  for (const { mesh, idx } of f.bodyVerts) {
    if (!mesh.visible) continue;
    if (mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
    const vp = mesh.userData.vertPart;
    for (const i of idx) {
      if (vp && partCodeDetached(f, vp[i])) continue;
      mesh.getVertexPosition(i, _footY);
      _footY.applyMatrix4(mesh.matrixWorld);
      if (_footY.y < minY) minY = _footY.y;
    }
  }
  return Number.isFinite(minY) ? minY : null;
}

// Debug (headless checks): standing frames whose foot bones are off the mat.
const _flt = new THREE.Vector3();
function logFloat(f) {
  let m = Infinity;
  for (const b of f.footBones || []) { b.getWorldPosition(_flt); m = Math.min(m, _flt.y); }
  const err = m - matTopY();
  if (!(err > 0.03)) return;
  const log = window.__rfFloatLog || (window.__rfFloatLog = []);
  if (log.length < 400) log.push({ id: f.id, st: f.state, t: +f.stateT.toFixed(2), clip: f.current, err: +err.toFixed(3), gy: +(f.groundY || 0).toFixed(3), fy: +(lowestFootY(f) - matTopY()).toFixed(3), prev: f._prevState });
}

function logSlide(f, dt) {
  const p = f.root.position;
  const last = f._diagLast;
  f._diagLast = { x: p.x, z: p.z, st: f.state };
  if (!last || dt <= 0) return;
  const st = f.state;
  if (!(st === 'idle' || st === 'block' || st === 'punch' || st === 'kick')) return;
  const v = Math.hypot(p.x - last.x, p.z - last.z) / dt;
  if (v < (st === 'punch' || st === 'kick' ? 1 : 0.3)) return;
  const log = window.__rfSlideLog || (window.__rfSlideLog = []);
  const o = f === p1 ? p2 : p1;
  if (log.length < 400) log.push({ id: f.id, st, prev: last.st, clip: f.current, v: +v.toFixed(2), gp: !!f.guardPush, dist: +p.distanceTo(o.root.position).toFixed(2), ost: o.state, t: +f.stateT.toFixed(2) });
}

function groundFeet(f, dt) {
  if (!f) return;
  // Falling, lying, getting up or KO'd: the clip's lowest body point (back, hips, hands,
  // knees) rests on the mat; feet IK is off.
  const onBody = DOWN_STATES.has(f.state);
  const skipIK = onBody;
  const top = matTopY();
  // Measure the animated pose with the root at zero, so last frame's lift never feeds back
  // into this frame (that feedback ratcheted the robots up into the air).
  f.root.position.y = 0;
  let minY = lowestFootY(f);
  if (onBody) {
    const body = lowestBodyY(f);
    if (body != null && (minY == null || body < minY)) minY = body;
  }
  if (minY == null) return;
  const target = top - minY;
  f.groundY = f.groundY || 0;
  if (f.airLock != null) {
    // Airborne clip: the root keeps the clip's own height (its standing baseline on the mat),
    // so the jump really leaves the floor; only a part dipping below the mat lifts it.
    f.groundY = Math.max(top + f.airLock, target);
  } else if (target > f.groundY) f.groundY = target; // lift instantly: feet never sink
  else {
    // Drop back onto the mat at falling speed (at least 3 m/s) so a clip change never leaves
    // the robot hovering.
    const step = Math.max(dt || 0.016, 1 / 120);
    const k = 1 - Math.pow(0.00001, step);
    const gap = f.groundY - target;
    f.groundY -= Math.min(gap, Math.max(gap * k, 3 * step));
  }
  f.root.position.y = f.groundY;
  f.model.updateWorldMatrix(true, true);
  // Stance IK is temporarily skipped: the two-bone solver was twisting the legs
  // and lifting planted feet 8–15 cm off the mat after the 121addd grounding change.
  if (!skipIK && ARENA.stanceIK) plantStanceIK(f, top);

  // Per-frame clamp after IK; not stored, so it can't accumulate.
  minY = onBody ? Math.min(lowestFootY(f) ?? Infinity, lowestBodyY(f) ?? Infinity) : lowestFootY(f);
  if (!Number.isFinite(minY)) minY = null;
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
    || ['KnockedOut', 'GettingUp', 'KnockedDown', 'StandingReactDeathBackward', 'StumbleBackwards', 'LivershotKnockdown'].includes(clipName);
  const fadeT = Math.max(0.15, Math.min(0.4, fade));
  if (f.current === clipName && next.isRunning() && next.getEffectiveWeight() > 0.5) {
    // Don't hard-reset a playing clip — that pops mid-pose. Let it finish or keep looping.
    return next;
  }
  const prev = f.actions[f.current];
  next.reset();
  next.enabled = true;
  next.setEffectiveWeight(1);
  next.timeScale = 0.9 + Math.random() * 0.2;
  // No time warping: a warped cross-fade rescales both clips' playback by their length ratio
  // (and leaves the new clip at timeScale x 1/old), which overrode every strike's speed and
  // whipped short strikes in at several times their speed (the MeiaLuaDeFrente toe pop).
  if (prev && prev !== next) prev.crossFadeTo(next, fadeT, false);
  else next.fadeIn(fadeT);
  next.play();
  f.current = clipName;
  // [announcer hook] dodge clips exist for later use; call only when one actually starts.
  if ((MODEL.animations.dodgeVariants || []).includes(clipName)) announce('dodge', { delay: 0.05 });
  f.locoActive = !oneshot && isLocoClip(clipName);
  if (oneshot) fadeLocoOut(f, fadeT);
  return next;
}

// Safety net for the mixer: three.js fills any weight missing below 1.0 with the bind pose,
// which shrinks every motion toward a stiff T/A pose. A private copy of the fighting idle
// plays underneath at whatever weight the other full-body clips leave free (one frame of
// lag), so a cross-fade or a stopped clip can never pull the robot toward the bind pose.
function mixerActive(f, a) {
  return f.mixer._isActiveAction ? f.mixer._isActiveAction(a) : (a.isRunning() || a.paused);
}

function updateBaseLayer(f) {
  if (!f.baseAct) {
    const src = f.actions[(MODEL.animations.idleVariants || [])[0]] || f.actions.FightingIdle || f.actions[MODEL.animations.idle];
    if (!src) return;
    const clip = src.getClip().clone();
    clip.name = clip.name + '__base';
    f.baseAct = f.mixer.clipAction(clip);
    f.baseAct.loop = THREE.LoopRepeat;
    f.baseAct.play();
  }
  let sum = 0;
  const seen = new Set();
  for (const a of Object.values(f.actions)) {
    if (seen.has(a)) continue;
    seen.add(a);
    // Active = scheduled in the mixer, including a finished one-shot clamped on its last frame
    // (paused, so isRunning() is false, but it still holds the pose at full weight).
    if (a === f.actions.GuardUpper || !a.enabled || !mixerActive(f, a)) continue; // GuardUpper: upper-body layer
    sum += a.getEffectiveWeight();
  }
  // (Upper-body copies used under a walked-out pushback are layers, like GuardUpper: they are
  // not in f.actions, so they never count here.)
  const legLayer = f._legW > 0.01 && f._loco ? f._loco.walkBack : null;
  // Over-full (a one-shot started while older clips still held weight): three.js averages
  // the excess, which dilutes the clip that should own the body. Outside footwork (which
  // sweeps its own leftovers), fade every clip except the current one.
  if (sum > 1.02 && !f.locoActive) {
    const cur = f.actions[f.current];
    for (const a of seen) {
      if (a === cur || a === legLayer || a === f.actions.GuardUpper || a === f.baseAct || !mixerActive(f, a)) continue;
      if (a.getEffectiveWeight() <= 0.002) { a.stop(); continue; }
      if (!a._weightInterpolant) a.fadeOut(0.12);
    }
  }
  const w = Math.max(0, Math.min(1, 1 - sum));
  if (!f.baseAct.isRunning()) f.baseAct.play();
  f.baseAct.enabled = true;
  f.baseAct.setEffectiveWeight(w);
  f.baseW = w;
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
    || (a.idleVariants || []).includes(name)
    || /^StumpHop(Back|Left|Right)?[LR]$/.test(name || '');
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
  const jumps = MODEL.animations.jumpKicks || [];
  // No jump kicks on a broken / badly bent leg.
  const special = availableClips(f, MODEL.animations.flipSpecial || MODEL.animations.kickSpecial).filter((n) => canFlip(f) || !jumps.includes(n));
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
  const extra = ['Stunned', 'HitToBody', 'BigStomachHit', 'HeadHit', 'HitOnSideOfHead', 'HitOnLegs'];
  const list = availableClips(f, (map[partId] || map.torso || []).concat(extra));
  const clip = pickClip(list, MODEL.animations.hit || 'Stunned', f.lastHit, f, (n) => {
    if ((map[partId] || []).includes(n)) return 3;
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
    // Robots don't tire: the hobbling idle is only for mechanically wrecked legs.
    const l = f.parts && f.parts.legL;
    const r = f.parts && f.parts.legR;
    const legsBad = !!(l && r && (
      l.detached || r.detached
      || ((1 - l.hp / l.max) + (1 - r.hp / r.max)) / 2 >= 0.5
    ));
    if (legsBad) return injured;
  }
  const idles = availableClips(f, MODEL.animations.idleVariants || [MODEL.animations.idle || 'FightingIdle']);
  return pickClip(idles, MODEL.animations.idle || 'FightingIdle', f.lastIdle, f);
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
  if ((e.key === 'v' || e.key === 'V') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    cycleCameraMode(); // saved; shown in the controls overlay
    return;
  }
  // C: Broadcast view on/off (the jumbotron's TV director as the main camera).
  if ((e.key === 'c' || e.key === 'C') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const cur = getSettings().cam;
    if (cur === 'broadcast') setCameraMode(prevCamMode && prevCamMode !== 'broadcast' ? prevCamMode : 'arena');
    else { prevCamMode = cur; setCameraMode('broadcast'); }
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
  inp.ground = keys.has('i');
  inp.run = keys.has('shift');
  inp.flipBack = keys.has('o');
  inp.flipFront = keys.has('y'); // (P is pause)
  inp.jumpKick = keys.has('u');

  const gp = navigator.getGamepads?.()[0];
  if (gp) {
    const dead = 0.28;
    if (Math.abs(gp.axes[0] || 0) > dead) inp.sidestep += gp.axes[0];
    if (Math.abs(gp.axes[1] || 0) > dead) inp.inout -= gp.axes[1];
    if (gp.buttons[14]?.pressed) inp.sidestep -= 1;
    if (gp.buttons[15]?.pressed) inp.sidestep += 1;
    if (gp.buttons[12]?.pressed) inp.inout += 1;
    if (gp.buttons[13]?.pressed) inp.inout -= 1;
    if (gp.buttons[10]?.pressed || gp.buttons[6]?.pressed) inp.run = true;
    if (gp.buttons[0]?.pressed) inp.punch = true;
    if (gp.buttons[1]?.pressed) inp.kick = true;
    if (gp.buttons[3]?.pressed) inp.ground = true;
    // RB flips (back flip, or front flip while pushing toward the opponent); R3 jump kick.
    if (gp.buttons[5]?.pressed) { if (inp.inout > 0.5) inp.flipFront = true; else inp.flipBack = true; }
    if (gp.buttons[11]?.pressed) inp.jumpKick = true;
    if (gp.buttons[2]?.pressed || gp.buttons[4]?.pressed || gp.buttons[7]?.pressed) {
      inp.block = true;
    }
  }
  inp.sidestep = Math.max(-1, Math.min(1, inp.sidestep));
  inp.inout = Math.max(-1, Math.min(1, inp.inout));
  return inp;
}

// Player attacks are edge-triggered and buffered for a moment: a press made while the robot
// is still finishing a strike or recovering fires as soon as it can, instead of being lost.
function consumeAttacks(inp, dt = 0) {
  const punch = inp.punch && !held.punch;
  const kick = inp.kick && !held.kick;
  const ground = !!inp.ground && !held.ground;
  const flipBack = !!inp.flipBack && !held.flipBack;
  const flipFront = !!inp.flipFront && !held.flipFront;
  const jumpKick = !!inp.jumpKick && !held.jumpKick;
  held.punch = inp.punch;
  held.kick = inp.kick;
  held.ground = !!inp.ground;
  held.flipBack = !!inp.flipBack;
  held.flipFront = !!inp.flipFront;
  held.jumpKick = !!inp.jumpKick;
  if (flipBack) { held.buf = 'flipBack'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (flipFront) { held.buf = 'flipFront'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (jumpKick) { held.buf = 'jumpKick'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (ground) { held.buf = 'ground'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (punch) { held.buf = 'punch'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (kick) { held.buf = 'kick'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (held.buf) {
    held.bufT -= dt;
    if (held.bufT <= 0) held.buf = null;
  }
  const b = held.buf;
  return {
    sidestep: inp.sidestep, inout: inp.inout, block: inp.block, run: !!inp.run,
    punch: b === 'punch', kick: b === 'kick', ground: b === 'ground',
    flipBack: b === 'flipBack', flipFront: b === 'flipFront', jumpKick: b === 'jumpKick',
  };
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

const statOf = (f, k) => (f && f.stat && f.stat[k]) || 1;
function locoMoveSpeeds(f, blocking) {
  const limp = moveSpeedMul(f);
  const blockMul = blocking ? (COMBAT.blockMoveSpeed / Math.max(0.2, COMBAT.moveSpeed)) : 1;
  const mul = limp * blockMul * statOf(f, 'speed');
  const strafe = 0.5 * (clipWorldSpeed(f, 'JogStrafeLeft') + clipWorldSpeed(f, 'JogStrafeRight'));
  return {
    fwd: (clipWorldSpeed(f, 'Walking') || COMBAT.moveSpeed * 0.35) * mul * (COMBAT.footworkMul || 1),
    back: (clipWorldSpeed(f, 'WalkingBackwards') || COMBAT.moveSpeed * 0.3) * mul * (COMBAT.footworkMul || 1),
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

// Spacing is normally kept by footwork (stepFighter backs a robot off with its walk when it is
// inside COMBAT.separate) and by the physics capsules. This is only an emergency un-overlap for
// rare deep interpenetration, so roots are never shoved around without animation.
function separate(a, b) {
  const dx = b.root.position.x - a.root.position.x;
  const dz = b.root.position.z - a.root.position.z;
  const d = Math.hypot(dx, dz);
  const min = COMBAT.separateHard;
  if (d < min && d > 1e-4) {
    const push = (min - d) / 2;
    const nx = dx / d;
    const nz = dz / d;
    for (const [f, sgn] of [[a, -1], [b, 1]]) {
      f.root.position.x += sgn * nx * push;
      f.root.position.z += sgn * nz * push;
      placeInOctagon(f.root.position, 0.55, true);
      if (f.phys && f.phys.body) f.phys.body.position.set(f.root.position.x, 0, f.root.position.z);
    }
  }
}

// Turn toward the opponent smoothly (a hard lookAt snapped the whole body around after
// get-ups and made planted feet skate). A robot getting up keeps the clip's facing until it
// is nearly upright.
function faceToward(f, other, dt, snap) {
  if (f.state === 'ko' || f.state === 'down' || f.state === 'ground' || f.state === 'dodge') { f.yawVel = 0; f.upEase = 0.9; return; }
  let rate = 9;
  let maxRate = YAW_MAX_RATE;
  if (f.state === 'getup') {
    const act = f.actions.GettingUp;
    const prog = act ? act.time / Math.max(0.1, act.getClip().duration) : 1;
    if (prog < 0.7) { f.yawVel = 0; f.upEase = 0.9; return; }
    rate = 2.6; maxRate = 1.8;
  } else if (f.upEase > 0) {
    // Just back on its feet: keep re-facing gentle while the get-up blends into the guard
    // (no snap, no overshoot), easing up to the normal turn speed.
    f.upEase = Math.max(0, f.upEase - dt);
    const k = 1 - f.upEase / 0.9;
    rate = 2.6 + (9 - 2.6) * k; maxRate = 1.8 + (YAW_MAX_RATE - 1.8) * k;
  }
  const dx = other.root.position.x - f.root.position.x;
  const dz = other.root.position.z - f.root.position.z;
  // Bodies (nearly) on top of each other (a flip passing over, a push-out): the direction is
  // noise, so keep the last target instead of chasing it.
  if (dx * dx + dz * dz > (0.35 * SIZE) ** 2 || f.faceWant == null) f.faceWant = Math.atan2(dx, dz);
  steerYaw(f, f.faceWant, dt, rate, snap, maxRate);
}

// The one owner of a fighter's yaw: a critically damped spring toward the target heading with
// a max turn rate, a small deadzone, wrapped angles, and a kept turn direction near 180 deg (so
// it can't flip-flop left/right). Replaces the old per-frame exponential snaps, which fought
// separation/push-out and shook back and forth when the target bearing jittered.
const YAW_MAX_RATE = 7.5;   // rad/s
const YAW_DEADZONE = 0.015; // rad
function steerYaw(f, want, dt, rate = 9, snap = false, maxRate = YAW_MAX_RATE) {
  const cur = f.root.rotation.y;
  let diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
  if (snap || !(dt > 0)) {
    if (snap) { f.root.rotation.set(0, cur + diff, 0); f.yawVel = 0; }
    return;
  }
  if (Math.abs(diff) > 2.7 && f.turnSign && Math.sign(diff) !== f.turnSign) diff += f.turnSign * 2 * Math.PI; // keep turning the same way
  if (Math.abs(diff) > 0.3) f.turnSign = Math.sign(diff);
  let v = f.yawVel || 0;
  if (Math.abs(diff) < YAW_DEADZONE && Math.abs(v) < 0.2) { f.yawVel = 0; return; }
  const w = rate * 0.9;
  // Semi-implicit critically damped step (stable for any dt).
  const h = Math.min(dt, 0.05);
  v = (v + w * w * diff * h) / (1 + 2 * w * h + w * w * h * h);
  v = Math.max(-maxRate, Math.min(maxRate, v));
  let step = v * h;
  if (Math.abs(step) > Math.abs(diff)) { step = diff; v = 0; } // never overshoot
  f.yawVel = v;
  f.root.rotation.set(0, cur + step, 0);
}

function faceEachOther(a, b, dt = 0, snap = false) {
  faceToward(a, b, dt, snap);
  faceToward(b, a, dt, snap);
}

function tryAttack(f, kind, clipName, exact = false) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground') return false;
  if (f.cooldown > 0) return false;
  if (kind === 'punch' && !canPunch(f)) return false;
  if (kind === 'kick' && !canKick(f)) return false;
  const mods = attackMods(f, kind);
  if (kind === 'punch' && !punchClipsFor(f).length) return false;
  const other = f === p1 ? p2 : p1;
  const clip = exact && clipName ? clipName : fitStrikeClip(f, kind, clipName
    || (kind === 'punch' ? pickPunch(f) : pickKick(f, true))
    || MODEL.animations[kind], other);
  f.state = kind;
  f.stateT = 0;
  f.hitThisAttack = false;
  f.atkContact = false;
  f.contactT = -1;
  f.retract = false;
  f._strikePrev = null;
  f._diag = null;
  f.atkMods = mods;
  f.attackClip = clip;
  f.blocking = false;
  f.shield.visible = false;
  const st0 = STRIKE_T && STRIKE_T[clip];
  // Blend over the skipped lead-in slowly enough that no limb tip outruns ~6 m/s from the blend.
  setAnim(f, clip, Math.max(0.18, Math.min(0.4, ((st0 && st0.gap0) || 0) / (6 * SIZE))));
  setFighterMove(f, 0, 0); // no walking velocity carried into the strike
  playSfx('whoosh');
  // [announcer hook]
  const flips = MODEL.animations.flipSpecial || MODEL.animations.kickSpecial || [];
  if (kind === 'kick' && flips.includes(clip)) announce('jumpKick', { delay: 0.18 });
  const action = f.actions[clip] || f.actions[kind];
  if (action) {
    // Faster strikes: punches ~1.3x, kicks ~1.15x (damage slows them again), starting just
    // before the measured wind-up instead of from the clip's idle lead-in.
    const speed = (kind === 'punch' ? COMBAT.punchSpeed : COMBAT.kickSpeed) || 1;
    const st = STRIKE_T && STRIKE_T[action.getClip().name];
    // Some Mixamo strikes whip the fist/foot far faster than the rest (MeiaLuaDeFrente's toe
    // hits ~22 m/s in the source clip): cap playback so the tip never outruns STRIKE_VMAX,
    // otherwise the foot teleports between frames.
    const cap = st && st.vpk > 0 ? STRIKE_VMAX / st.vpk : Infinity;
    action.timeScale = Math.min(speed * mods.timeScale * statOf(f, 'speed'), cap);
    f.strikeCap = cap;
    if (st) action.time = st.start;
    // Jump kicks (also when picked as a CPU special): airborne root, travel in the air only.
    const air = AIR_T && AIR_T[clip];
    if (air && air.air && (MODEL.animations.jumpKicks || []).includes(clip)) {
      action.time = Math.min(action.time, air.start);
      // Jump kicks play at least at clip speed (a slow frame would hang ~3 s in the air).
      action.timeScale = Math.min(cap, Math.max(action.timeScale, 1.05));
      const gap = f.root.position.distanceTo(other.root.position);
      const fwd = toward(f, other);
      const want = Math.max(0, Math.min(COMBAT.jumpKickTravel, gap - COMBAT.strikeGap));
      startAir(f, clip, fwd, Math.min(want, ringRoom(f, fwd, want)));
    }
  }
  return true;
}

// Choose a strike whose measured reach fits the gap: the fist/foot should just reach the
// body surface (short elbows and uppercuts up close, jabs and long kicks from further out),
// so strikes neither whiff short nor bury themselves in the other robot's chest.
function strikeTip(name) {
  const st = STRIKE_T && STRIKE_T[name];
  if (!st) return null;
  return Math.min(1.65 * SIZE, st.reach) + COMBAT.bodyRadius;
}
function fitStrikeClip(f, kind, clip, other) {
  if (!STRIKE_T || !other) return clip;
  const gap = f.root.position.distanceTo(other.root.position);
  const lunge = gap > (COMBAT.strikeGap || 1.2) ? ((kind === 'kick' ? COMBAT.kickLunge : COMBAT.punchLunge) || 0) : 0;
  const fits = (n) => {
    const tip = strikeTip(n);
    return tip != null && tip + lunge >= gap - 0.02 && tip <= gap + 0.3;
  };
  if (clip && fits(clip)) return clip;
  const pool = kind === 'punch' ? punchClipsFor(f) : availableClips(f, MODEL.animations.kickVariants);
  const good = pool.filter(fits);
  if (good.length) return good[Math.floor(Math.random() * good.length)];
  let best = clip;
  let bd = Infinity;
  for (const n of pool) {
    const tip = strikeTip(n);
    if (tip == null) continue;
    const d = Math.abs(tip - gap - 0.05);
    if (d < bd) { bd = d; best = n; }
  }
  return best || clip;
}

// Strike timing (clip seconds) for the attack being played.
function strikeTiming(f, action) {
  const spec = COMBAT[f.state] || COMBAT.punch;
  const dur = action ? action.getClip().duration : 0.7;
  const st = action && STRIKE_T && STRIKE_T[action.getClip().name];
  if (st) return st;
  const a0 = spec.activeFrac[0] * dur;
  const a1 = spec.activeFrac[1] * dur;
  return { dur, start: 0, a0, a1, end: Math.min(dur, a1 + 0.15) };
}

function tryBlock(f, heldBlock) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground') {
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

// End an attack and start its recovery: short after a clean connect, longer after a whiff.
// The player's recovery is shorter than the CPU's (COMBAT.playerRecoverMul).
function diagMargin(f, other, kind, gap) {
  const bones = f.strikeBones[kind] || [];
  const base = other.root.position;
  const reach = COMBAT.bodyRadius + (kind === 'kick' ? COMBAT.kickShell : COMBAT.fistShell);
  let m = Infinity;
  for (const b of bones) {
    b.getWorldPosition(_bp);
    _seg.set(base.x, Math.max(base.y + 0.3, Math.min(base.y + 2.15, _bp.y)), base.z);
    m = Math.min(m, _bp.distanceTo(_seg) - reach);
  }
  const d = f._diag || (f._diag = {});
  if (!(d.m <= m)) { d.m = +m.toFixed(2); d.gap = +gap.toFixed(2); d.ost = other.state; d.blk = !!other.blocking; d.inv = other.invuln > 0; }
}

function endAttack(f, fade = 0.2) {
  if (window.__rfDiag && (f.state === 'punch' || f.state === 'kick')) {
    const log = window.__rfWhiffLog || (window.__rfWhiffLog = []);
    if (log.length < 300) log.push({ id: f.id, hit: !!f.hitThisAttack, clip: f.attackClip, ...(f._diag || { m: null }) });
    f._diag = null;
  }
  const spec = COMBAT[f.state] || COMBAT.punch;
  const base = (COMBAT.recoverByClip && COMBAT.recoverByClip[f.attackClip]) || spec.recover || 0.25;
  const who = f.isCpu ? (COMBAT.cpuRecoverMul || 1) : (COMBAT.playerRecoverMul || 1);
  const rec = base * who * (f.hitThisAttack ? 1 : (COMBAT.whiffMul || 2)) * ((f.atkMods && f.atkMods.cooldownMul) || 1);
  f.cooldown = Math.max(f.cooldown, rec / statOf(f, 'recovery'));
  f.state = 'idle';
  f.atkContact = false;
  endAir(f);
  setAnim(f, idleClipFor(f), fade);
}

/* ---------- flips: back / front flip dodges and jump kicks ---------- */
function canFlip(f) {
  if (!f.parts) return true;
  const D = COMBAT.dodge;
  for (const side of ['L', 'R']) {
    const leg = f.parts['leg' + side];
    if (!leg || leg.detached) return false;
    const foot = f.subs && f.subs['foot' + side];
    if (foot && foot.detached) return false;
    if (legDamage(f, side) > D.maxLegDamage) return false;
  }
  return true;
}
// Furthest the robot can travel along dir (up to want) and still land inside the ring.
function ringRoom(f, dir, want) {
  const m = COMBAT.dodge.ringMargin;
  const p = f.root.position;
  let ok = 0;
  for (let d = 0; d <= want + 1e-6; d += 0.05) {
    const x = p.x + dir.x * d;
    const z = p.z + dir.z * d;
    const c = clampToOctagon(x, z, m);
    if (Math.hypot(c[0] - x, c[1] - z) > 1e-3) break;
    ok = d;
  }
  return ok;
}
function endAir(f) {
  f.airLock = null;
  f.airMove = null;
  f.ghost = false;
  f.dodge = null;
}
// Travel during the airborne window only (smooth in, smooth out), so both feet leave and
// land with the root still: no slide at take-off or landing.
function stepAirMove(f, dt) {
  const m = f.airMove;
  if (!m || !m.action || dt <= 0) { setFighterMove(f, 0, 0); return; }
  const t = m.action.time;
  const u = Math.max(0, Math.min(1, (t - m.air.t0) / Math.max(0.05, m.air.t1 - m.air.t0)));
  const e = u * u * (3 - 2 * u);
  const step = m.dist * e - m.moved;
  m.moved += step;
  setFighterMove(f, (m.dir.x * step) / dt, (m.dir.z * step) / dt);
  return u > 0 && u < 1;
}
function startAir(f, clip, dir, dist) {
  const air = AIR_T && AIR_T[clip];
  const action = f.actions[clip];
  if (!air || !air.air || !action) return null;
  f.airLock = -air.base; // the clip's standing baseline sits on the mat for the whole move
  f.airMove = { action, air, dir: dir.clone(), dist, moved: 0 };
  return f.airMove;
}
function tryDodge(f, other, kind) {
  if (!(f.state === 'idle' || f.state === 'walk' || f.state === 'block')) return false;
  if (f.dodgeCD > 0 || f.guardPush || !canFlip(f) || DOWN_STATES.has(f.state)) return false;
  const A = MODEL.animations;
  const clip = kind === 'front' ? A.dodgeFront : A.dodgeBack;
  const air = AIR_T && AIR_T[clip];
  if (!air || !air.air || !f.actions[clip]) return false;
  const D = COMBAT.dodge;
  const fwd = toward(f, other);
  let dir = fwd.clone();
  let dist;
  if (kind === 'back') {
    dir.negate();
    dist = ringRoom(f, dir, D.back);
    if (dist < 0.5 * SIZE) return false; // back against the ring: no room to flip
  } else {
    const gap = f.root.position.distanceTo(other.root.position);
    const over = gap + D.frontPast;
    const room = ringRoom(f, dir, over);
    const otherUp = !DOWN_STATES.has(other.state);
    if (room >= over - 0.01 && gap < over) dist = over; // clear over / past the opponent
    else dist = Math.min(D.frontShort, room, otherUp ? Math.max(0, gap - COMBAT.separate) : D.frontShort);
    if (dist < 0.05) dist = 0; // boxed in: flips on the spot
  }
  f.state = 'dodge';
  f.stateT = 0;
  f.blocking = false;
  f.shield.visible = false;
  f.hitThisAttack = false;
  setAnim(f, clip, 0.12);
  const action = f.actions[clip];
  action.time = air.start;
  action.timeScale = 1.05;
  startAir(f, clip, dir, dist);
  f.dodge = { kind, clip };
  f.dodgeCD = D.cooldown / statOf(f, 'recovery');
  playSfx('whoosh');
  return true;
}
function stepDodge(f, other, dt) {
  const m = f.airMove;
  const action = m && m.action;
  if (!action) { f.state = 'idle'; endAir(f); setAnim(f, idleClipFor(f), 0.2); return; }
  stepAirMove(f, dt);
  const t = action.time;
  // Untouchable from just before take-off until the feet are back down; passes through bodies.
  const inAir = t >= m.air.t0 - 0.06 && t <= m.air.t1;
  if (inAir) f.invuln = Math.max(f.invuln, 0.05);
  f.ghost = t >= m.air.t0 - 0.06 && t <= m.air.t1 + 0.04;
  if (t >= m.air.end - 0.01 || !action.isRunning()) {
    setFighterMove(f, 0, 0);
    endAir(f);
    f.state = 'idle';
    f.cooldown = Math.max(f.cooldown, 0.15);
    setAnim(f, idleClipFor(f), 0.22);
  }
}
function tryJumpKick(f, other) {
  if (!canFlip(f) || f.dodgeCD > 0) return false;
  const list = availableClips(f, MODEL.animations.jumpKicks || []).filter((n) => AIR_T && AIR_T[n] && AIR_T[n].air);
  if (!list.length) return false;
  const clip = list[Math.floor(Math.random() * list.length)];
  if (!tryAttack(f, 'kick', clip, true)) return false;
  f.dodgeCD = COMBAT.dodge.cooldown * 0.6;
  return true;
}

const _seg = new THREE.Vector3();
const _bp = new THREE.Vector3();
// A strike lands when a fist/forearm (punch) or foot/shin (kick) actually reaches the
// defender's body capsule, so hits fire on visible contact, not on root distance.
// Returns the bone that made contact (or true without strike bones), else null.
// Body capsules from the defender's real skeleton (segment between two bones + radius), so
// a strike only counts when the fist/foot actually reaches a torso, head, arm or leg. The old
// test was a fat vertical cylinder around the root (radius ~0.57 m incl. shells): kicks that
// passed well wide of the thin legs still sparked and scored.
const CAPS = [
  ['Hips', 'Spine2', 0.26], ['Spine2', 'Neck', 0.27], ['Neck', 'Head', 0.12], ['Head', 'HeadTop_End', 0.15],
  ['LeftArm', 'LeftForeArm', 0.09], ['LeftForeArm', 'LeftHand', 0.08], ['RightArm', 'RightForeArm', 0.09], ['RightForeArm', 'RightHand', 0.08],
  ['LeftUpLeg', 'LeftLeg', 0.12], ['LeftLeg', 'LeftFoot', 0.09], ['RightUpLeg', 'RightLeg', 0.12], ['RightLeg', 'RightFoot', 0.09],
];
const TIP_SHELL = { punch: 0.095, kick: 0.1 }; // bone centre to fist / foot surface (base size)
function bodyCaps(f) {
  if (f._caps) return f._caps;
  const by = {};
  f.model.traverse((o) => { if (o.isBone || o.type === 'Bone') by[String(o.name).replace(/^mixamorig[:._]*/i, '')] = o; });
  const partOf = (n) => (/^(Neck|Head)/.test(n) ? 'head' : /^Left(Arm|ForeArm)/.test(n) ? 'armL' : /^Right(Arm|ForeArm)/.test(n) ? 'armR' : /^Left(UpLeg|Leg)/.test(n) ? 'legL' : /^Right(UpLeg|Leg)/.test(n) ? 'legR' : 'torso');
  f._caps = CAPS.map(([a, b, r]) => ({ a: by[a], b: by[b] || null, r: r * SIZE, head: a === 'Head', part: partOf(a) })).filter((c) => c.a && (c.b || c.head));
  return f._caps;
}
const _ca = new THREE.Vector3();
const _cb = new THREE.Vector3();
const _cq = new THREE.Vector3();
const _cp = new THREE.Vector3();
// Closest capsule to point p: { d (surface distance, <0 inside), point (on the axis) }.
function capsuleProbe(def, p, only) {
  let best = Infinity, at = null, part = 'torso';
  for (const c of bodyCaps(def)) {
    if (only && !only.includes(c.part)) continue;
    if (c.a.scale.x < 0.01) continue; // torn-off limb
    c.a.getWorldPosition(_ca);
    if (c.b) c.b.getWorldPosition(_cb); else _cb.copy(_ca).y += 0.22 * SIZE;
    _cq.subVectors(_cb, _ca);
    const t = Math.max(0, Math.min(1, _cq.dot(_cp.subVectors(p, _ca)) / Math.max(1e-6, _cq.lengthSq())));
    _cq.multiplyScalar(t).add(_ca);
    const d = p.distanceTo(_cq) - c.r;
    if (d < best) { best = d; part = c.part; at = at || new THREE.Vector3(); at.copy(_cq).addScaledVector(_cp.subVectors(p, _cq).normalize(), c.r); }
  }
  return { d: best, point: at, part };
}
function strikeContact(atk, def, kind) {
  const bones = atk.strikeBones && atk.strikeBones[kind];
  if (!bones || !bones.length) return null; // no limb, no hit
  const shell = (TIP_SHELL[kind] || 0.08) * SIZE;
  atk.model.updateWorldMatrix(true, true);
  def.model.updateWorldMatrix(true, true);
  // Swept test from the bone's previous position, so a fast strike can't step past the body
  // between two frames.
  const prev = atk._strikePrev || (atk._strikePrev = new Map());
  let hit = null;
  for (const b of bones) {
    b.getWorldPosition(_bp);
    const last = prev.get(b);
    const n = last ? 4 : 1;
    for (let i = 1; i <= n && !hit; i++) {
      const p = last ? _sw.copy(last).lerp(_bp, i / n) : _bp;
      const pr = capsuleProbe(def, p);
      if (pr.d <= shell) hit = { bone: b, point: pr.point.clone(), part: pr.part };
    }
    if (last) last.copy(_bp); else prev.set(b, _bp.clone());
    if (hit) break;
  }
  return hit;
}
const _sw = new THREE.Vector3();
const _li = new THREE.Vector3();
// Is any striking bone (fist/forearm or foot/shin) inside the other robot's body capsules?
function limbInside(atk, def, kind) {
  if (DOWN_STATES.has(def.state)) return false;
  const bones = atk.strikeBones && atk.strikeBones[kind];
  if (!bones) return false;
  for (const b of bones) {
    b.getWorldPosition(_li);
    if (capsuleProbe(def, _li).d < 0) return true;
  }
  return false;
}

// Down / get-up clips: Mixamo's arms pass through the robot's own (bulkier) thighs and knees.
// Push each elbow / hand out of the leg capsules by swinging the upper arm about the shoulder
// (applied after the mixer, before joint limits).
const _sa = new THREE.Vector3();
const _sp = new THREE.Vector3();
const _sx = new THREE.Vector3();
const _sq = new THREE.Quaternion();
const _sqp = new THREE.Quaternion();
const LEG_PARTS = ['legL', 'legR'];
function armSelfClear(f) {
  if (!(f.state === 'down' || f.state === 'getup' || f.state === 'ko')) return;
  if (!f._armBones) {
    const by = {};
    f.model.traverse((o) => { if (o.isBone || o.type === 'Bone') by[String(o.name).replace(/^mixamorig[:._]*/i, '')] = o; });
    f._armBones = ['Left', 'Right'].map((s) => ({ arm: by[s + 'Arm'], pts: [by[s + 'ForeArm'], by[s + 'Hand']] })).filter((a) => a.arm && a.pts[0] && a.pts[1]);
  }
  const margin = 0.05 * SIZE;
  f.model.updateWorldMatrix(true, true);
  for (const a of f._armBones) {
    if (a.arm.scale.x < 0.01) continue;
    for (let pass = 0; pass < 2; pass++) {
      a.arm.getWorldPosition(_sa);
      let worst = null;
      for (const b of a.pts) {
        b.getWorldPosition(_sp);
        const pr = capsuleProbe(f, _sp, LEG_PARTS);
        if (pr.point && pr.d < margin && (!worst || pr.d < worst.d)) worst = { d: pr.d, p: _sp.clone(), n: _sp.clone().sub(pr.point).add(_sx.copy(pr.point).sub(_sp).setLength(0)) };
      }
      if (!worst) break;
      // Outward direction: from the leg surface point toward the joint (or sideways if inside).
      const pr = capsuleProbe(f, worst.p, LEG_PARTS);
      const n = worst.p.clone().sub(pr.point);
      if (pr.d < 0 || n.lengthSq() < 1e-6) n.copy(worst.p).sub(f.root.position).setY(0);
      n.normalize();
      const lever = worst.p.clone().sub(_sa);
      const len = Math.max(0.1, lever.length());
      const axis = lever.cross(n);
      if (axis.lengthSq() < 1e-8) break;
      axis.normalize();
      const ang = Math.min(0.5, (margin - worst.d) / len);
      a.arm.parent.getWorldQuaternion(_sqp);
      axis.applyQuaternion(_sqp.invert());
      _sq.setFromAxisAngle(axis, ang);
      a.arm.quaternion.premultiply(_sq);
      a.arm.updateWorldMatrix(false, true);
    }
  }
}

// Procedural flinch: a damped spring that snaps the spine/neck/head away from the blow and
// back, layered on top of whatever clip is playing, so every connect visibly lands.
const FLINCH_W = {
  head: { Spine: 0.08, Spine1: 0.12, Spine2: 0.18, Neck: 0.3, Head: 0.42 },
  torso: { Spine: 0.34, Spine1: 0.3, Spine2: 0.22, Neck: 0.08, Head: 0.06 },
  arm: { Spine: 0.15, Spine1: 0.2, Spine2: 0.3, Neck: 0.1, Head: 0.1 },
  leg: { Spine: 0.3, Spine1: 0.18, Spine2: 0.1, Neck: 0.04, Head: 0.04 },
};
function startFlinch(f, dir, amp, zone) {
  if (!f || !f.flinchBones) return;
  f.flinch = { x: dir.x, z: dir.z, amp, t: 0, w: FLINCH_W[zone] || FLINCH_W.torso };
}
const _flAxis = new THREE.Vector3();
const _flQ = new THREE.Quaternion();
const _flPQ = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0);
function applyFlinch(f, dt) {
  const fl = f.flinch;
  if (!fl) return;
  fl.t += dt;
  const t = fl.t;
  const rise = 0.045;
  const env = t < rise ? Math.sin((t / rise) * Math.PI / 2) : Math.exp(-(t - rise) * 6.5) * Math.cos((t - rise) * 9);
  if (t > 0.9) { f.flinch = null; return; }
  // Axis that tips "up" toward the blow direction (world), applied per bone in parent space.
  _flAxis.set(fl.x, 0, fl.z).cross(_UP).multiplyScalar(-1);
  if (_flAxis.lengthSq() < 1e-8) return;
  _flAxis.normalize();
  for (const [name, w] of Object.entries(fl.w)) {
    const bone = f.flinchBones[name];
    if (!bone || !bone.parent) continue;
    bone.parent.getWorldQuaternion(_flPQ);
    const local = _bp.copy(_flAxis).applyQuaternion(_flPQ.invert());
    _flQ.setFromAxisAngle(local.normalize(), fl.amp * w * env);
    bone.quaternion.premultiply(_flQ);
  }
}

function hitZone(partId) {
  if (partId === 'head') return 'head';
  if (partId === 'armL' || partId === 'armR') return 'arm';
  if (partId === 'legL' || partId === 'legR') return 'leg';
  return 'torso';
}

const LOC_MUL = { head: 1.35, torso: 1, armL: 0.8, armR: 0.8, legL: 0.85, legR: 0.85 };

function applyHit(atk, def, spec, kind, strikeBone, contact) {
  if (def.state === 'ko' || def.state === 'down' || def.state === 'getup' || def.invuln > 0) return;
  const blocked = def.blocking;
  const hit = pickHit(atk, def, kind || 'punch', toward, contact); // sparks / dents at the real contact
  // Arm/leg wear (attackMods) times the fist/foot that landed: lost fingers or hand hit weaker.
  const mul = ((atk.atkMods && atk.atkMods.damageMul) || 1) * strikeMul(atk, kind || 'punch', strikeBone) * statOf(atk, 'power') / statOf(def, 'armor');
  // Comeback surge: a robot near KO and well behind hits a little harder (momentum swings).
  const surge = atk.health < 25 && def.health > atk.health * 2 ? 1.12 : 1;
  const blockMul = blocked ? (1 - COMBAT.blockReduction * blockReductionMul(def)) : 1;
  const loc = LOC_MUL[hit.partId] || 1;
  const closing = impactVelocity(atk, def, hit.dir);
  const swing = (kind === 'kick' ? 3.4 : 2.4) * mul;
  const force = (closing + swing) * (blocked ? 0.45 : 1);
  const dmg = Math.max(1, Math.round(spec.damage * mul * surge * blockMul * loc * (0.5 + 0.55 * (force / 5))));
  def.health = Math.max(0, def.health - dmg);
  applyPartHit(def, hit.partId, dmg, hit.point, hit.dir, scene, { blocked, force, final: def.health <= 0 });
  applyStrikeWear(atk, kind || 'punch', strikeBone, blocked, force, scene, hit.dir);
  hitLight.color.setHex(blocked ? 0x88ccff : 0xffc060);
  hitLight.intensity = 12 + Math.min(8, force);
  hitLight.position.copy(hit.point);
  playHit({ blocked, heavy: !blocked && (dmg >= 7 || force >= 4.2), kick: kind === 'kick' });
  // Heavy: a hard-hitting blow, a stepped-in strike, or a full kick (measured: a planted kick
  // lands at force ~3.1-3.4, a planted punch ~2.4; stepping in adds ~1).
  const heavy = !blocked && (dmg >= 7 || force >= 4.2 || (kind === 'kick' && force >= 3.3));
  // Counter hit: caught mid-swing. Longer hitstun and a sharper freeze.
  const counter = !blocked && (def.state === 'punch' || def.state === 'kick');
  const solidHit = !blocked && force >= COMBAT.stumbleForce;
  addShake(blocked ? 0.035 : (heavy ? Math.min(0.18, 0.12 + force * 0.008) : Math.min(0.08, 0.05 + force * 0.006)));
  if (!blocked) triggerHitStop(counter ? COMBAT.hitStopCounter : ((heavy || solidHit) ? COMBAT.hitStopHeavy : COMBAT.hitStopLight));
  const fwd = hit.dir;
  // Attacker feels the connect: the drive stops and the torso recoils a touch off the target.
  atk.atkContact = true;
  startFlinch(atk, fwd.clone().negate(), blocked ? 0.1 : 0.07, 'torso');
  // Defender visibly takes it: a spine/neck snap away from the blow by zone (smaller on guard).
  startFlinch(def, fwd, blocked ? 0.12 : Math.min(0.62, 0.3 + force * 0.045), blocked ? 'arm' : hitZone(hit.partId));
  // No free sliding: a blocked hit is absorbed by the guard, a light hit only rocks the robot
  // a few centimetres (hidden inside its in-place hit clip), and a solid hit becomes a real
  // stumble-back whose travel is spread over the clip's own steps (see stepFighter 'hit').
  const solid = !blocked && (force >= COMBAT.stumbleForce || heavy);
  const stumbleClip = solid && def.actions.StumbleBackwards ? 'StumbleBackwards' : null;
  if (blocked) {
    // Guard pushback: ~55% of a light hit's, stepped out with the backward walk.
    def.guardPush = { x: fwd.x, z: fwd.z, dist: COMBAT.hitRock * 0.55 * Math.min(1.4, 0.8 + force * 0.1), t0: 0, t1: 0.22, legs: true, t: 0 };
  }
  if (!(def.phys && def.phys.body)) {
    const kb = blocked ? 0 : COMBAT.hitRock * (0.8 + force * 0.08);
    def.root.position.x += fwd.x * kb;
    def.root.position.z += fwd.z * kb;
    placeInOctagon(def.root.position, 0.55, true);
  }
  if (def.health <= 0 || isCatastrophic(def)) {
    ko(def, atk, { dir: fwd, force, partId: hit.partId, kind: kind || 'punch' });
    return;
  }
  if (!blocked) {
    // A clean hit interrupts whatever the defender was doing, including its own strike.
    def.blocking = false;
    def.shield.visible = false;
    def.hitThisAttack = true;
    def.atkContact = false;
    def.invuln = COMBAT.hitInvuln;
    // Knockdowns are for big shots: a heavy counter, a heavy blow with real force, a second
    // heavy blow inside 2 s, some heavy kicks, or any heavy blow on a structurally wrecked torso.
    // Other heavy hits are a stumble-back, so fights keep moving.
    const now = performance.now() / 1000;
    const stacked = heavy && def._lastHeavy != null && now - def._lastHeavy < 2;
    if (heavy) def._lastHeavy = now;
    const knock = heavy && (counter || force >= COMBAT.knockdownForce || stacked || torsoWrecked(def)
      || (kind === 'kick' && Math.random() < (COMBAT.kickKnockChance || 0)));
    if (window.__rfDiag) { const l = window.__rfHitLog || (window.__rfHitLog = []); if (l.length < 300) l.push({ kind, part: hit.partId, force: +force.toFixed(2), dmg, heavy, counter, stacked, knock }); }
    if (knock) {
      def._lastHeavy = null;
      knockDown(def, fwd, force, hit.partId);
    } else {
      // [announcer hook] combo / heavy shot / low health (knockdowns speak for themselves).
      atk._hitCombo = (atk._lastLand != null && now - atk._lastLand < 1.15) ? (atk._hitCombo || 0) + 1 : 1;
      atk._lastLand = now;
      if (atk._hitCombo >= 3) announce('combo', { n: atk._hitCombo, delay: 0.12 });
      else if (heavy) announce('bigHit', { delay: 0.1 });
      if (def.health <= COMBAT.maxHealth * 0.25) announce('lowHp', { side: def === p1 ? 0 : 1, delay: 0.2 });
      def.state = 'hit';
      def.stateT = 0;
      const clip = stumbleClip || pickHitClip(def, hit.partId);
      setAnim(def, clip, 0.12);
      const act = def.actions[clip];
      const clipDur = act ? act.getClip().duration / Math.max(0.2, act.timeScale || 1) : COMBAT.hitStun;
      const stun = ((stumbleClip ? COMBAT.hitStunHeavy : COMBAT.hitStun) + (counter ? COMBAT.counterExtra : 0)) / statOf(def, 'recovery');
      def.hitDur = stumbleClip ? Math.max(stun, Math.min(clipDur * 0.9, 0.65)) : stun; // short, clear stun windows
      // Knockback travel is walked out: the backward walk plays under the hit clip (see 'hit').
      def.hitPush = stumbleClip
        ? { x: fwd.x, z: fwd.z, dist: COMBAT.stumbleDist * Math.min(1.25, 0.8 + force * 0.05), t0: 0.06, t1: def.hitDur * 0.85, legs: false }
        : { x: fwd.x, z: fwd.z, dist: COMBAT.hitRock * Math.min(1.4, 0.8 + force * 0.1), t0: 0.02, t1: Math.max(0.24, stun * 0.85), legs: true };
    }
  }
}

// ---- Ground attacks: stomp / ground punch on a robot that is down (not KO'd) ----
// Clips: KneeKickLead (stomp) and Punching (ground punch) with a procedural forward bow of
// the spine layered on top so the strike reaches the mat. Each lands only on real contact
// with a body part of the lying robot (bone positions of the knockdown clip's lying pose),
// dents that part, and can't keep a robot pinned: at most COMBAT.ground.perKnockdown per
// knockdown, and hits don't delay the get-up.
const GROUND_BONES = {
  Hips: 'torso', Spine2: 'torso', Head: 'head', LeftArm: 'armL', LeftForeArm: 'armL', RightArm: 'armR', RightForeArm: 'armR',
  LeftUpLeg: 'legL', LeftLeg: 'legL', RightUpLeg: 'legR', RightLeg: 'legR',
};
const _gp = new THREE.Vector3();
const _gq = new THREE.Vector3();
const _gc = new THREE.Vector3();

// Lying segments: midpoint of each bone and its child joint, in world space.
function groundTargets(def) {
  if (!isLyingDown(def) || !def.groundBones) return [];
  def.model.updateWorldMatrix(true, true);
  const out = [];
  for (const { bone, part } of def.groundBones) {
    if (def.parts && def.parts[part] && def.parts[part].detached) continue;
    bone.getWorldPosition(_gc);
    const ch = bone.children.find((c) => c.isBone || c.type === 'Bone');
    if (ch && part !== 'head') { ch.getWorldPosition(_gq); _gc.lerp(_gq, 0.5); }
    out.push({ part, x: _gc.x, y: _gc.y, z: _gc.z });
  }
  return out;
}

// On the mat after a knockdown fall (not during the fall, not during the get-up, not KO).
function isLyingDown(f) {
  return !!f && f.state === 'down' && !!f.downLying;
}

function nearestGroundTarget(f, def) {
  let best = null;
  let bd = Infinity;
  for (const t of groundTargets(def)) {
    const d = Math.hypot(t.x - f.root.position.x, t.z - f.root.position.z);
    if (d < bd) { bd = d; best = t; }
  }
  return best ? { ...best, dist: bd } : null;
}

function canGroundAttack(f, def) {
  const g = COMBAT.ground;
  if (!g || match.over || f.cooldown > 0) return false;
  if (!isLyingDown(def) || def.health <= 0) return false;
  if ((f.gKd === def.kdCount ? f.gN : 0) >= g.perKnockdown) return false;
  const t = nearestGroundTarget(f, def);
  return !!t && t.dist <= g.reach;
}

function tryGroundAttack(f, def) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground') return false;
  if (!canGroundAttack(f, def)) return false;
  const t = nearestGroundTarget(f, def);
  const stomp = t.dist <= COMBAT.ground.stompReach && canKick(f) && f.actions.KneeKickLead;
  const clip = stomp ? 'KneeKickLead' : (f.actions.Punching ? 'Punching' : pickPunch(f));
  if (!clip || (!stomp && !canPunch(f))) return false;
  if (f.gKd !== def.kdCount) { f.gKd = def.kdCount; f.gN = 0; }
  f.gN += 1;
  f.state = 'ground';
  f.stateT = 0;
  f.groundKind = stomp ? 'stomp' : 'pound';
  f.groundHit = false;
  f.attackClip = clip;
  f.blocking = false;
  f.shield.visible = false;
  f.groundAim = { x: t.x, z: t.z };
  setFighterMove(f, 0, 0);
  setAnim(f, clip, 0.1);
  const act = f.actions[clip];
  const st = act && STRIKE_T && STRIKE_T[clip];
  if (act) {
    act.timeScale = stomp ? 1.15 : 1.1;
    if (st) act.time = st.start;
  }
  playSfx('whoosh');
  return true;
}

// A robot on an ankle stump (foot torn off) or a badly bent leg (past ~65% leg damage) trips
// while walking every few seconds: a short leg-buckle (HitOnLegs), ~0.45 s, then it carries
// on limping. Mechanical, not tiredness.
function footStumble(f, dt) {
  const lostL = f.subs && f.subs.footL && f.subs.footL.detached;
  const lostR = f.subs && f.subs.footR && f.subs.footR.detached;
  const bent = f.parts ? Math.max(legDamage(f, 'L'), legDamage(f, 'R')) : 0;
  const bad = bent > 0.65;
  if (!lostL && !lostR && !bad) return false;
  if (f.state !== 'walk') return false;
  f.tripT = (f.tripT == null ? 1.5 + Math.random() * 1.5 : f.tripT) - dt;
  if (f.tripT > 0) return false;
  f.tripT = lostL || lostR ? (lostL && lostR ? 1.4 : 2.4) + Math.random() * 1.8 : 3.2 + (1 - bent) * 6 + Math.random() * 2;
  const clip = (f.actions.HitOnLegs && 'HitOnLegs') || pickHitClip(f, lostL || legDamage(f, 'L') > legDamage(f, 'R') ? 'legL' : 'legR');
  f.state = 'hit';
  f.stateT = 0;
  f.hitDur = 0.45;
  f.hitPush = null;
  setFighterMove(f, 0, 0);
  setAnim(f, clip, 0.12);
  playSfx('servo', { vol: 0.4, rate: 0.78 });
  return true;
}

function stepGroundAttack(f, def, dt) {
  setFighterMove(f, 0, 0);
  const act = f.actions[f.attackClip];
  const st = act && STRIKE_T && STRIKE_T[f.attackClip];
  const dur = act ? act.getClip().duration : 1;
  const ct = act ? act.time : f.stateT;
  const a0 = st ? st.a0 : dur * 0.3;
  const peak = st ? st.peak : dur * 0.45;
  const end = st ? Math.max(st.end, peak + 0.35) : dur * 0.85;
  // Bow envelope for the procedural layer (0..1), peaking at the strike.
  const start = st ? st.start : 0;
  const u = Math.max(0, Math.min(1, (ct - start) / Math.max(0.05, peak - start)));
  const back = Math.max(0, Math.min(1, (ct - peak) / Math.max(0.05, end - peak)));
  f.groundBow = ct <= peak ? u * u * (3 - 2 * u) : 1 - back * back * (3 - 2 * back);
  // Face the downed body.
  if (f.groundAim) {
    const want = Math.atan2(f.groundAim.x - f.root.position.x, f.groundAim.z - f.root.position.z);
    steerYaw(f, want, dt, 10);
  }
  // Contact: the stomping foot coming down (after the knee peak) or the fist at the bottom.
  if (!f.groundHit && isLyingDown(def) && ct >= (f.groundKind === 'stomp' ? peak : a0) && ct <= end) {
    const bones = f.strikeBones[f.groundKind === 'stomp' ? 'kick' : 'punch'] || [];
    f.model.updateWorldMatrix(true, true);
    const R = f.groundKind === 'stomp' ? 0.34 : 0.4;
    for (const b of bones) {
      b.getWorldPosition(_gp);
      for (const t of groundTargets(def)) {
        if (Math.hypot(_gp.x - t.x, _gp.z - t.z) > R || _gp.y > t.y + 0.42) continue;
        f.groundHit = true;
        landGroundHit(f, def, t, _gp);
        break;
      }
      if (f.groundHit) break;
    }
  }
  if (ct >= end - 0.01 || (act && !act.isRunning()) || f.stateT > 2.2) {
    f.groundBow = 0;
    f.state = 'idle';
    f.cooldown = Math.max(f.cooldown, (COMBAT.ground.recover || 0.5) * (f.groundHit ? 1 : 1.4) * (f.isCpu ? 1 : 0.8));
    setAnim(f, idleClipFor(f), 0.2);
  }
}

function landGroundHit(f, def, t, at) {
  const g = COMBAT.ground;
  const stomp = f.groundKind === 'stomp';
  const dmg = Math.round((stomp ? g.stompDamage : g.poundDamage) * ((f.atkMods && f.atkMods.damageMul) || 1) * (LOC_MUL[t.part] || 1) * statOf(f, 'power') / statOf(def, 'armor'));
  const dir = _gq.set(t.x - f.root.position.x, 0, t.z - f.root.position.z);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
  dir.normalize().add(new THREE.Vector3(0, -1.2, 0)).normalize();
  const point = new THREE.Vector3(t.x, Math.max(t.y, at.y), t.z);
  def.health = Math.max(0, def.health - dmg);
  applyPartHit(def, t.part, dmg, point, dir.clone(), scene, { blocked: false, force: stomp ? 6 : 4.5, final: def.health <= 0 });
  // Heavy metal on metal: the lying body jolts into the mat (a rigid spine/neck snap), it doesn't fly off.
  startFlinch(def, new THREE.Vector3(dir.x, 0, dir.z).normalize(), stomp ? 0.32 : 0.24, hitZone(t.part));
  hitLight.color.setHex(0xffc060);
  hitLight.intensity = 16;
  hitLight.position.copy(point);
  playHit({ heavy: true, kick: stomp });
  playSfx('clank', { vol: 0.9, rate: stomp ? 0.7 : 0.85 });
  addShake(stomp ? 0.16 : 0.12);
  triggerHitStop(COMBAT.hitStopHeavy);
  startFlinch(f, new THREE.Vector3(-dir.x, 0, -dir.z), 0.06, 'torso');
  if (def.health <= 0) ko(def, f, { dir: new THREE.Vector3(dir.x, 0, dir.z).normalize(), force: 3, partId: t.part, kind: 'ground' });
}

// Forward bow for the ground punch (and a small one for the stomp), applied after the mixer.
const _bowAxis = new THREE.Vector3();
const _bowPQ = new THREE.Quaternion();
const _bowQ = new THREE.Quaternion();
const _bowFwd = new THREE.Vector3();
function applyGroundBow(f) {
  const w = f.state === 'ground' ? (f.groundBow || 0) : 0;
  if (w <= 0.001) return;
  const amt = f.groundKind === 'stomp' ? COMBAT.ground.stompBow : COMBAT.ground.poundBow;
  _bowFwd.set(Math.sin(f.root.rotation.y), 0, Math.cos(f.root.rotation.y));
  _bowAxis.copy(_UP).cross(_bowFwd).normalize();
  const share = { Spine: 0.4, Spine1: 0.33, Spine2: 0.27 };
  for (const [name, k] of Object.entries(share)) {
    const bone = f.flinchBones && f.flinchBones[name];
    if (!bone || !bone.parent) continue;
    bone.parent.getWorldQuaternion(_bowPQ);
    const local = _bp.copy(_bowAxis).applyQuaternion(_bowPQ.invert()).normalize();
    _bowQ.setFromAxisAngle(local, amt * k * w);
    bone.quaternion.premultiply(_bowQ);
  }
}

// Structural damage (not tiredness): a torso past 70% damage folds on any heavy blow.
function torsoWrecked(f) {
  const t = f.parts && f.parts.torso;
  return !!(t && 1 - t.hp / t.max >= 0.7);
}

function isCatastrophic(f) {
  if (!f || !f.parts) return false;
  if (f.parts.head && f.parts.head.detached) return true;
  // A robot can't stand on one leg: losing a whole leg drops it for the count.
  if ((f.parts.legL && f.parts.legL.detached) || (f.parts.legR && f.parts.legR.detached)) return true;
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

// ---- Knockdowns and KO falls: Mixamo clips only (no ragdoll, no procedural fall) ----
// Robots always take blows from the front (they face each other), so the clip is chosen by
// where the blow landed: a torso/body shot folds the robot to its knees (LivershotKnockdown,
// which also contains its own recovery); anything else knocks it over backwards
// (StumbleBackwards played from its stagger into the fall), it lies there for
// COMBAT.downRest, then GettingUp (whose first frame is StumbleBackwards' last frame).
const FALL = {
  backward: { clip: 'StumbleBackwards', from: 0.35, speed: 1.25, lieAt: 0.55 },
  body: { clip: 'LivershotKnockdown', from: 0.1, speed: 1.2, lieAt: null },
};

function knockDown(def, fwd, force, partId) {
  const body = partId === 'torso' && def.actions[FALL.body.clip] && Math.random() < 0.6;
  const spec = body ? FALL.body : FALL.backward;
  if (!def.actions[spec.clip]) return;
  def.state = 'down';
  def.stateT = 0;
  def.kdCount = (def.kdCount || 0) + 1;
  def.blocking = false;
  def.shield.visible = false;
  def.downClip = spec.clip;
  def.downSpec = spec;
  def.downLying = false;
  def.downLieT = 0;
  def.landed = false;
  def.groundY = def.groundY || 0;
  // The stagger back before the fall is walked out by the clip's own steps; the root follows
  // with a short sine push (no velocity is left over afterwards).
  def.hitPush = { x: fwd.x, z: fwd.z, dist: Math.min(0.75, (body ? 0.15 : 0.4) + force * 0.03), t0: 0.03, t1: body ? 0.35 : 0.7, legs: false };
  setFighterMove(def, 0, 0);
  const act = setAnim(def, spec.clip, 0.1);
  if (act) {
    act.time = spec.from;
    act.timeScale = spec.speed;
  }
  announce('knockdown', { delay: 0.35 }); // [announcer hook]
}

function stepDown(f, dt) {
  const spec = f.downSpec || FALL.backward;
  const hp = f.hitPush;
  if (hp && f.stateT >= hp.t0 && f.stateT <= hp.t1) {
    const v = pushSpeed(hp, f.stateT);
    setFighterMove(f, hp.x * v, hp.z * v);
  } else setFighterMove(f, 0, 0);
  const act = f.actions[f.downClip];
  if (!act) { beginGetUp(f); return; }
  const dur = act.getClip().duration;
  const frac = act.time / dur;
  if (spec.lieAt == null) {
    // Kneel-and-rise clip: the robot is back on its feet when the clip ends.
    if (!f.landed && frac > 0.22) { f.landed = true; playSfx('clank', { vol: 0.7, rate: 0.62 }); addShake(0.08); }
    if (frac >= 0.97 || !act.isRunning() || f.stateT > dur / spec.speed + 0.4) {
      f.state = 'idle';
      f.hitPush = null;
      f.cooldown = Math.max(f.cooldown, 0.2);
      setAnim(f, idleClipFor(f), 0.25);
    }
    return;
  }
  if (!f.downLying && frac >= spec.lieAt) {
    f.downLying = true;
    if (!f.landed) { f.landed = true; playSfx('clank', { vol: 1, rate: 0.55 }); addShake(0.14); }
  }
  if (!f.downLying) return;
  // Lie still a beat (same every time: robots don't tire), then get up. The clock runs
  // through ground hits, so a robot can't be kept down.
  f.downLieT += dt;
  const settled = frac >= 0.78 || !act.isRunning();
  if ((settled && f.downLieT >= COMBAT.downRest / statOf(f, 'recovery')) || f.stateT > COMBAT.downMax) beginGetUp(f);
}

// KO finishes follow the final blow: where it landed, how hard, and what is left of the robot.
//   head:  snaps back and collapses backward (StandingReactDeathBackward / KnockedOut)
//   body:  folds forward onto its knees (LivershotKnockdown held at its lowest, or Defeated)
//   big kick (or any blow hard enough): knocked off its feet sideways, a rigid physics topple
//   leg already torn off: topples toward the missing leg and lies there
// Picked with some chance so the same blow doesn't always end the same way.
function koFinish(f, dir, force, info) {
  const has = (c) => !!f.actions[c];
  const pick = (list) => { const l = list.filter((x) => x.w > 0 && (!x.clip || has(x.clip))); let r = Math.random() * l.reduce((n, x) => n + x.w, 0); for (const x of l) { r -= x.w; if (r <= 0) return x; } return l[0]; };
  const legGone = f.parts && ((f.parts.legL && f.parts.legL.detached) || (f.parts.legR && f.parts.legR.detached));
  if (legGone) return { type: 'topple', clip: has('Stunned') ? 'Stunned' : null, why: 'leg' };
  const part = info.partId || 'torso';
  const bigKick = info.kind === 'kick' && force >= 4.2;
  if (part === 'head') {
    return pick([
      { type: 'clip', clip: 'StandingReactDeathBackward', w: 4, why: 'head' },
      { type: 'clip', clip: 'KnockedOut', w: 3, why: 'head' },
      { type: 'topple', clip: 'HeadHit', w: bigKick ? 3 : 0.6, why: 'head-kick' },
    ]);
  }
  if (part === 'torso') {
    return pick([
      { type: 'kneel', clip: 'LivershotKnockdown', w: bigKick ? 1.5 : 4, why: 'body' },
      { type: 'clip', clip: 'KnockedOut', w: 1.5, why: 'body' },
      { type: 'topple', clip: 'BigStomachHit', w: bigKick ? 4 : 0.8, why: 'body-kick' },
    ]);
  }
  if (part === 'legL' || part === 'legR') {
    return pick([
      { type: 'topple', clip: 'HitOnLegs', w: 4, why: 'legs' },
      { type: 'kneel', clip: 'LivershotKnockdown', w: 2, why: 'legs' },
      { type: 'clip', clip: 'KnockedOut', w: 1, why: 'legs' },
    ]);
  }
  return pick([
    { type: 'clip', clip: 'KnockedOut', w: 3, why: 'arm' },
    { type: 'clip', clip: 'StandingReactDeathBackward', w: 2, why: 'arm' },
    { type: 'topple', clip: 'Stunned', w: bigKick ? 4 : 1, why: 'arm-kick' },
  ]);
}

function koFall(f, dir, force, info = {}) {
  f.hitPush = null;
  f.guardPush = null;
  f.downLying = false;
  f.flinch = null;
  f.koTip = null;
  f.koHold = null;
  setFighterMove(f, 0, 0);
  let fin = koFinish(f, dir, force, info);
  if (fin.type === 'kneel' && !(AIR_T && AIR_T.__kneel && AIR_T.__kneel[fin.clip])) fin = { type: 'clip', clip: 'KnockedOut', why: fin.why };
  if (!fin.clip || !f.actions[fin.clip]) fin = { ...fin, clip: ['KnockedOut', 'StandingReactDeathBackward'].find((c) => f.actions[c]) || null };
  if (!fin.clip) return;
  const act = setAnim(f, fin.clip, 0.12);
  let act2 = null;
  if (fin.type === 'clip') {
    if (act) act.timeScale = fin.clip === 'KnockedOut' ? 1.15 : 1.2;
  } else if (fin.type === 'kneel') {
    // Fold to the knees and stay there: the clip is held at its lowest (kneeling) frame.
    const k = AIR_T.__kneel[fin.clip];
    if (act) { act.time = k.from; act.timeScale = 1.1; }
    f.koHold = { action: act, at: k.at };
  } else {
    // Physics topple: the robot (frozen in the reaction pose) tips over its feet like a rigid
    // body under gravity, sideways away from the blow (or toward a missing leg), and lands on
    // its side with a small bounce.
    const right = new THREE.Vector3(-Math.cos(f.root.rotation.y), 0, Math.sin(f.root.rotation.y)); // the robot's own right
    let side;
    if (fin.why === 'leg') side = f.parts.legL.detached ? -1 : 1;
    else side = (dir.dot(right) >= 0 ? 1 : -1) * (Math.abs(dir.dot(right)) < 0.25 ? (Math.random() < 0.5 ? -1 : 1) : 1);
    // Local z axis (forward): positive angle rolls the robot toward its right (-side flips).
    // The reaction pose is frozen (a rigid fall); pick one that doesn't reach far out on the
    // side it lands on, so the body lies flat instead of propping on an arm.
    const T = (AIR_T && AIR_T.__topple) || {};
    const reachOut = (c) => (T[c] ? (side > 0 ? T[c].right : T[c].left) : 9);
    if (reachOut(fin.clip) > 0.45 * SIZE) {
      const alt = Object.keys(T).filter((c) => f.actions[c]).sort((a, b) => reachOut(a) - reachOut(b))[0];
      if (alt) { fin = { ...fin, clip: alt }; act2 = setAnim(f, alt, 0.12); }
    }
    const a = act2 || act;
    if (a) { a.time = (T[fin.clip] && T[fin.clip].t) || 0.2; a.paused = true; }
    f.koTip = { side, ang: 0, vel: 0.9 + Math.min(2.2, force * 0.28), done: false, bounces: 0 };
  }
  f.koClip = fin.clip;
  f.koKind = fin.type + ':' + fin.clip + ':' + fin.why;
  f.landed = false;
}

// Gravity topple about the feet: theta'' = (g / L) sin(theta), stopped at lying flat (~86 deg).
function stepKoTip(f, dt) {
  const k = f.koTip;
  if (!k) return;
  if (!k.done && dt > 0) {
    const L = 1.15 * SIZE; // pivot to centre of mass
    k.vel += (9.8 / L) * Math.sin(Math.max(0.02, k.ang)) * dt;
    k.ang += k.vel * dt;
    const flat = 1.5;
    if (k.ang >= flat) {
      k.ang = flat;
      if (k.vel > 1.2 && k.bounces < 2) { k.vel = -k.vel * 0.22; k.bounces++; playSfx('clank', { vol: 0.9, rate: 0.6 }); addShake(0.12); }
      else { k.vel = 0; k.done = true; if (!f.landed) { f.landed = true; playSfx('clank', { vol: 1, rate: 0.55 }); addShake(0.14); } }
    }
  }
  // +z rolls the robot toward its own right (see applyMalfunctions).
  f.model.rotation.set(0, 0, k.side * k.ang);
}

function ko(loser, winner, info) {
  loser.health = 0;
  loser.state = 'ko';
  loser.blocking = false;
  loser.shield.visible = false;
  const dir = (info && info.dir) || new THREE.Vector3(winner.root.position.x - loser.root.position.x, 0, winner.root.position.z - loser.root.position.z).normalize();
  const force = (info && info.force) || 6;
  koFall(loser, dir, force, info || {});
  if (winner && winner.state !== 'ko' && winner.state !== 'down') {
    winner.state = 'idle';
    winner.blocking = false;
    winner.shield.visible = false;
    setFighterMove(winner, 0, 0);
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
    if ((info && info.reason === 'head') || (loser.parts && loser.parts.head && loser.parts.head.detached)) sub.textContent = winner && winner.id === 'p1' ? "You took the opponent's head." : 'Your head was torn off.';
    else if ((info && info.reason === 'legs') || (loser.parts && ['legL', 'legR'].some((k) => loser.parts[k] && loser.parts[k].detached))) sub.textContent = 'A leg is gone. The fighter collapsed.';
    else sub.textContent = winner && winner.id === 'p1' ? 'You won the fight.' : 'CPU won the fight.';
  }
  playSfx('ko');
  addShake(0.28);
  match.slowLeft = COMBAT.koSlowMo || 0;
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

function aiProfile(cpu) {
  const who = cpu || p2;
  const custom = who && who.config && who.config.ai;
  const fromSettings = getSettings().cpu || 'normal';
  // A shell-provided think table (arcade opponents, explicit personalities) wins.
  // Default / unspecialized configs follow the Settings CPU difficulty.
  if (custom && custom.think && custom.useSettings !== true) return custom;
  return { ...(AI_PERSONALITIES[fromSettings] || AI_PERSONALITIES.normal) };
}

function partHealth(f) {
  const out = {};
  if (!f.parts) return out;
  for (const id of DAMAGE.order) {
    const p = f.parts[id];
    if (p) out[id] = p.detached ? 0 : +(p.hp / p.max).toFixed(2);
  }
  return out;
}

const DOWN_STATES = new Set(['down', 'getup', 'ko']);
// Compact, engine-free view of the fight for a brain (see js/brain.js for the contract).
function ringEdge(f) {
  return Math.min(1, Math.hypot(f.root.position.x, f.root.position.z) / ((ARENA.apothem || 6.1) - 0.55));
}

function brainSnapshot(f, opp, dt) {
  const busy = f.state === 'ko' || f.state === 'down' || f.state === 'getup' || f.state === 'hit';
  const gt = isLyingDown(opp) ? nearestGroundTarget(f, opp) : null;
  return {
    t: performance.now() / 1000,
    dt,
    dist: +f.root.position.distanceTo(opp.root.position).toFixed(3),
    strikeRange: { punch: COMBAT.punch.reach * statOf(f, 'reach'), kick: COMBAT.kick.reach * statOf(f, 'reach') },
    self: {
      quick: statOf(f, 'speed') * statOf(f, 'recovery'), // stat profile: how fast it reads and answers
      health: f.health,
      state: f.state,
      stateT: f.stateT,
      cooldown: f.cooldown,
      canAct: !busy && f.state !== 'punch' && f.state !== 'kick' && f.state !== 'ground',
      canPunch: canPunch(f) && punchClipsFor(f).length > 0,
      canKick: canKick(f),
      canBlock: canBlock(f),
      blocking: !!f.blocking,
      edge: +ringEdge(f).toFixed(2),
      parts: partHealth(f),
      canFlip: canFlip(f) && !(f.dodgeCD > 0),
    },
    opp: {
      health: opp.health,
      state: opp.state,
      stateT: opp.stateT,
      attacking: opp.state === 'punch' || opp.state === 'kick',
      heavy: opp.state === 'kick' || (opp.state === 'punch' && /Hook|Uppercut|Combo|Elbow/.test(opp.attackClip || '')),
      blocking: !!opp.blocking,
      down: DOWN_STATES.has(opp.state),
      groundable: canGroundAttack(f, opp),
      groundDist: gt ? +gt.dist.toFixed(2) : null,
      edge: +ringEdge(opp).toFixed(2),
      parts: partHealth(opp),
    },
  };
}

// Turn a brain intent into the same input shape the keyboard produces.
function intentToInput(f, opp, intent) {
  const inp = { sidestep: 0, inout: 0, punch: false, kick: false, block: false, run: false, punchClip: null, kickClip: null, blockClip: null };
  if (!intent) return inp;
  inp.inout = Math.max(-1, Math.min(1, +intent.move || 0));
  inp.sidestep = Math.max(-1, Math.min(1, +intent.strafe || 0));
  inp.run = !!intent.run;
  if (intent.block) {
    inp.block = true;
    inp.blockClip = f._aiBlockClip || (f._aiBlockClip = pickBlock(f, opp));
  } else f._aiBlockClip = null;
  if (intent.dodge === 'back') inp.flipBack = true;
  else if (intent.dodge === 'front') inp.flipFront = true;
  if (intent.attack === 'ground') inp.ground = true;
  else if (intent.attack === 'jump') inp.jumpKick = true;
  else if (intent.attack === 'punch' && punchClipsFor(f).length) {
    inp.punch = true;
    inp.punchClip = pickPunch(f);
  } else if (intent.attack === 'kick' && canKick(f)) {
    inp.kick = true;
    inp.kickClip = pickKick(f, Math.random() < (aiProfile(f).special || 0.2));
  }
  return inp;
}

// Each CPU fighter has a brain: think(snapshot) -> intent. The paced built-in brain is the
// default; assign fighter.brain to plug in another (e.g. an outside AI) with the same contract.
function updateAI(cpu, player, dt) {
  if (cpu === p2) {
    const shellAi = shellCall('input', 'p2'); // [game-shell hook] versus P2 / training dummy / menu idle
    cpu.isCpu = !shellAi;
    if (shellAi) return shellAi;
  }
  cpu.isCpu = true;
  if (!cpu.brain) cpu.brain = createPacedBrain(() => aiProfile(cpu));
  // Settings > AI API Brain: wrap the CPU brain (it stays the fallback) or unwrap it.
  const api = wantsApiBrain(cpu.id);
  if (api && cpu.brain.kind !== 'api') cpu.brain = createApiBrain(cpu.brain, cpu.id);
  else if (!api && cpu.brain.kind === 'api') cpu.brain = cpu.brain.fallback;
  cpu._ai = cpu.brain.state || cpu._ai; // per-fighter think state (Bot vs Bot runs two)
  const intent = cpu.brain.think(brainSnapshot(cpu, player, dt));
  return intentToInput(cpu, player, intent);
}

function stepFighter(f, other, inp, dt) {
  if (f._lastSt !== f.state) { f._prevState = f._lastSt; f._lastSt = f.state; }
  f.cooldown = Math.max(0, f.cooldown - dt);
  f.invuln = Math.max(0, f.invuln - dt);
  f.stateT += dt;
  f.dodgeCD = Math.max(0, (f.dodgeCD || 0) - dt);
  // Flip / jump kick interrupted (hit, KO, round end): drop the airborne state.
  if ((f.dodge && f.state !== 'dodge') || (f.airLock != null && f.state !== 'dodge' && f.state !== 'kick')) endAir(f);
  if (f.state === 'ko') {
    setFighterMove(f, 0, 0);
    // Kneeling KO: hold the clip on its lowest frame.
    const h = f.koHold;
    if (h && h.action && !h.held && h.action.time >= h.at) {
      h.action.time = h.at; h.action.paused = true; h.held = true;
      if (!f.landed) { f.landed = true; playSfx('clank', { vol: 0.9, rate: 0.6 }); addShake(0.1); }
    }
    return;
  }
  if (f.state === 'down') { stepDown(f, dt); return; }
  if (f.state === 'getup') {
    setFighterMove(f, 0, 0);
    // Play the whole GettingUp clip (by its own playhead), then settle into the guard.
    const action = f.actions.GettingUp || f.actions[resolveClip(f, 'getUp')];
    const clipDur = action ? action.getClip().duration : 2.0;
    const done = action ? (action.time >= clipDur - 0.1 || !action.isRunning()) : f.stateT > (COMBAT.getupTime || 1.25);
    if ((done && f.stateT > 0.4) || f.stateT > (COMBAT.getupTime || 1.25) + 0.6) {
      f.state = 'idle';
      f.cooldown = Math.max(f.cooldown, 0.25);
      setAnim(f, idleClipFor(f), 0.3);
    }
    return;
  }
  if (match.over) {
    setFighterMove(f, 0, 0);
    return;
  }

  if (f.state === 'hit') {
    // Hit travel follows the reaction: a smooth sine-shaped push inside [t0, t1], zero outside,
    // so the feet are never dragged across the mat by leftover velocity.
    const hp = f.hitPush;
    if (hp && f.stateT >= hp.t0 && f.stateT <= hp.t1) {
      const v = pushSpeed(hp, f.stateT);
      setFighterMove(f, hp.x * v, hp.z * v);
      stepLegs(f, hp.legs ? v : 0, dt);
    } else {
      setFighterMove(f, 0, 0);
      stepLegs(f, 0, dt);
    }
    if (f.stateT > (f.hitDur || COMBAT.hitStun)) {
      f.hitPush = null;
      stepLegs(f, 0, 1);
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.16);
    }
    return;
  }

  if (f.state === 'dodge') { stepDodge(f, other, dt); return; }

  if (f.state === 'punch' || f.state === 'kick') {
    const spec = COMBAT[f.state];
    const action = f.actions[f.attackClip] || f.actions[f.state] || f.actions[resolveClip(f, f.state)];
    const tm = strikeTiming(f, action);
    const ct = action ? action.time : f.stateT; // clip playhead: windows stay right at any speed
    // A small step into the strike when just out of reach; it stops on contact and never
    // drives inside striking distance (that pushed fists through torsos).
    const gap = f.root.position.distanceTo(other.root.position);
    const airKick = f.airMove && f.airMove.action === action ? f.airMove : null;
    if (airKick) stepAirMove(f, dt); // jump kick: travels only while airborne, lands still
    else if (!f.atkContact && ct < tm.a0 && gap > (COMBAT.strikeGap || 1.2)) {
      const lunge = (f.state === 'kick' ? COMBAT.kickLunge : COMBAT.punchLunge) || 0;
      const fwd = toward(f, other);
      const v = lunge / Math.max(0.1, (tm.a0 - tm.start) / Math.max(0.2, action ? action.timeScale : 1));
      setFighterMove(f, fwd.x * v, fwd.z * v);
    } else setFighterMove(f, 0, 0);
    // Limb contact decides, not root distance: the swept fist/foot test runs through the whole
    // active window (the old root-distance gate let near-miss strikes skip the test and sail
    // through the body).
    const contact = !f.hitThisAttack && ct >= tm.a0 && ct <= tm.a1 ? strikeContact(f, other, f.state) : null;
    if (window.__rfDiag && ct >= tm.a0 && ct <= tm.a1) diagMargin(f, other, f.state, gap);
    if (contact) {
      f.hitThisAttack = true;
      f.contactT = f.stateT;
      applyHit(f, other, spec, f.state, contact.bone, contact);
    }
    // Solid bodies: whenever the striking limb is inside the other robot's body (any phase,
    // landed or not), the clip stops advancing there and the strike is pulled back.
    if (limbInside(f, other, f.state)) {
      if (!f.hitThisAttack && ct >= tm.a0 - 0.08 && ct <= tm.a1) {
        // Already in the body at the start of the window: that is the connect.
        f.hitThisAttack = true;
        const tip = (f.strikeBones[f.state] || []).map((b) => b.getWorldPosition(new THREE.Vector3())).map((p) => ({ p, pr: capsuleProbe(other, p) })).sort((x, y) => x.pr.d - y.pr.d)[0];
        applyHit(f, other, spec, f.state, null, tip && tip.pr.point ? { point: tip.pr.point, part: tip.pr.part } : null);
      }
      if (f.contactT < 0) f.contactT = f.stateT;
      // (A jump kick can't hang in mid-air: it lands through its follow-through instead.)
      if (action && !airKick) action.timeScale = Math.min(action.timeScale, 0.08);
    } else if (f.contactT >= 0 && action && !airKick) action.timeScale = Math.min(action.timeScale, 0.25);
    // The fist stops at the surface: after contact the strike is pulled back (blend to guard)
    // instead of playing on through the body.
    const pulled = f.contactT >= 0 && f.stateT - f.contactT > (COMBAT.contactHold || 0.1);
    // Pulled strikes retract along their own path (the clip played backwards to the guard it
    // started from), so the fist/foot comes back and the kicking foot lands where it took off.
    // Cross-fading straight from the extended pose to idle floated the leg down with the robot
    // already "standing" (feet off the mat) and popped the arm. Spins and flips can't rewind
    // naturally; they still blend out.
    const special = SPECIAL_STRIKES.has(f.attackClip);
    if (pulled && !special && action && !f.retract && ct > tm.start + 0.04) {
      f.retract = true;
      action.paused = false;
      action.timeScale = -Math.min(RETRACT_SPEED, f.strikeCap || Infinity);
    }
    const retracted = f.retract && action && (action.time <= tm.start + 0.02 || !action.isRunning());
    const done = airKick
      ? (ct >= airKick.air.end - 0.01 || (action && !action.isRunning())) // ends on its feet
      : (f.retract ? retracted : pulled) || (!f.retract && ct >= tm.end - 0.01) || (action && !action.isRunning());
    // Safety net: no strike may hold the robot longer than this (selftest saw a 3 s kick lock).
    const overdue = f.stateT > (airKick ? 2.8 : 2.2);
    // The player can cancel the retraction into movement, guard or the next strike.
    const wantsOut = !f.isCpu && !airKick && ct > tm.a1 && (inp.block || inp.punch || inp.kick
      || Math.abs(inp.sidestep) + Math.abs(inp.inout) > 0.3);
    if ((done || wantsOut || overdue) && (f.state === 'punch' || f.state === 'kick')) {
      f.retract = false;
      endAttack(f, pulled ? 0.16 : 0.2);
      if (!wantsOut) return;
      if (inp.punch || inp.kick) f.cooldown = Math.min(f.cooldown, 0.06);
    } else return;
  }

  if (f.state === 'ground') {
    stepGroundAttack(f, other, dt);
    return;
  }

  if (footStumble(f, dt)) return;
  f.blockClip = inp.blockClip || null;
  tryBlock(f, inp.block);
  if (f.guardPush) {
    // Blockstun: the guard soaks the blow and is stepped back a little; no other action.
    const gp = f.guardPush;
    gp.t += dt;
    const v = pushSpeed(gp, gp.t);
    setFighterMove(f, gp.x * v, gp.z * v);
    stepLegs(f, v, dt);
    if (gp.t > gp.t1 + COMBAT.blockStunTail) { f.guardPush = null; stepLegs(f, 0, 1); }
    return;
  }
  if (inp.ground && tryGroundAttack(f, other)) return;
  if (inp.flipBack && tryDodge(f, other, 'back')) return;
  if (inp.flipFront && tryDodge(f, other, 'front')) return;
  if (inp.jumpKick && tryJumpKick(f, other)) return;
  if (inp.punch) tryAttack(f, 'punch', inp.punchClip);
  else if (inp.kick) tryAttack(f, 'kick', inp.kickClip);
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'hit' || f.state === 'ko') return;

  const speeds = locoMoveSpeeds(f, f.blocking);
  if (inp.run && !f.blocking) { // Shift / L3 / LT: faster forward and back
    speeds.fwd *= COMBAT.runMul || 1.8;
    speeds.back *= COMBAT.runBackMul || 1.5;
  }
  // Spacing through footwork, never by shoving the root: don't walk into the other robot, and
  // when inside the soft spacing, step back with the backward walk (matched to the speed).
  // The player is never pushed back against their input; they just can't walk into the body.
  let inout = inp.inout;
  let sidestep = inp.sidestep;
  const gap = f.root.position.distanceTo(other.root.position);
  const otherDown = DOWN_STATES.has(other.state);
  const sep = otherDown ? (COMBAT.separateDown || 0.75) : (COMBAT.separate || 1.05);
  if (gap < sep + 0.05 && inout > 0) inout = 0;
  if (f.isCpu && gap < sep && !otherDown) inout = Math.min(inout, -Math.min(1, 0.35 + (sep - gap) / 0.15));
  // Guarding: no sideways skating in the full-body block clip; stepping back is walked out
  // with the backward-walk layer.
  if (f.blocking) {
    sidestep = 0;
    inout = Math.min(0, inout);
  }
  inp = { ...inp, inout, sidestep };
  const moving = Math.abs(inp.sidestep) + Math.abs(inp.inout) > 0.12;
  if (moving) {
    // The body travels only as fast as the legs are walking: velocity follows the footwork
    // blend weight (last frame's), so a step starting from the guard accelerates with the gait
    // instead of gliding at full speed while the idle pose still owns the legs.
    if (!f.blocking) {
      const lw = f._locoW || {};
      const gait = Math.max(0.2, Math.min(1, (lw.walkFwd || 0) + (lw.walkBack || 0) + (lw.strafeL || 0) + (lw.strafeR || 0)));
      speeds.fwd *= gait; speeds.back *= gait; speeds.strafe *= gait;
    }
    const actual = moveFighter(f, other, inp.sidestep, inp.inout, dt, speeds);
    f.servoT = (f.servoT || 0) + dt;
    if (f.servoT > 0.72) {
      f.servoT = 0;
      playSfx('servo', { vol: 0.28, rate: 1.05, limit: 200 });
    }
    if (!f.blocking) {
      f.state = 'walk';
      updateLoco(f, inp.sidestep, inp.inout, dt, actual, speeds);
    } else stepLegs(f, actual, dt);
  } else {
    setFighterMove(f, 0, 0);
    if (f.blocking) stepLegs(f, 0, dt);
    if (!f.blocking) {
      f.state = 'idle';
      updateLoco(f, 0, 0, dt, 0, null);
    }
  }
}

const LOCO_KEYS = ['idle', 'idleB', 'injured', 'walkFwd', 'walkBack', 'strafeL', 'strafeR'];

// Sine-shaped push speed inside [t0, t1] (zero outside) so travel starts and ends at rest.
function pushSpeed(hp, t) {
  const span = Math.max(0.05, hp.t1 - hp.t0);
  const u = (t - hp.t0) / span;
  if (u < 0 || u > 1) return 0;
  return (hp.dist / span) * (Math.PI / 2) * Math.sin(Math.PI * u);
}

// Walk a knockback / guard pushback out with the (lower-body) backward walk layered under the
// current clip, its playback matched to the travel speed so the feet don't skate.
// The legs walk, the upper body keeps the current clip: the full-body clip (block, hit
// reaction) hands its legs to the walk by trading weight with an upper-body-only copy of
// itself that plays in sync. (Before, the walk was simply added on top at up to 1.4 weight:
// the mixer averaged it against the full-body clip, and the base layer faded it as an
// over-full extra, so the robot slid back on near-still legs.)
function upperAction(f, name) {
  f._upper = f._upper || {};
  if (name in f._upper) return f._upper[name];
  const src = f.actions[name];
  let act = null;
  if (src) {
    const clip = src.getClip().clone();
    clip.name = name + '__upper';
    clip.tracks = clip.tracks.filter((t) => UPPER_BODY.test(t.name.split('.')[0]));
    if (clip.tracks.length) {
      act = f.mixer.clipAction(clip);
      act.loop = src.loop;
      act.clampWhenFinished = src.clampWhenFinished;
    }
  }
  f._upper[name] = act;
  return act;
}
function stepLegs(f, speed, dt) {
  const act = locoActions(f).walkBack;
  if (!act) return;
  const clipV = clipWorldSpeed(f, 'WalkingBackwards') || 0.6;
  const target = speed > 0.03 ? Math.min(1, 0.5 + speed / clipV * 0.5) : 0;
  f._legW = (f._legW || 0) + (target - (f._legW || 0)) * Math.min(1, dt * 18);
  const cur = f.actions[f.current];
  const isLocoCur = cur && (cur === act || isLocoClip(f.current));
  const up = cur && !isLocoCur ? upperAction(f, f.current) : null;
  if (f._legUpper && f._legUpper !== up) { f._legUpper.stop(); f._legUpper = null; }
  if (f._legW > 0.01) {
    const lw = Math.min(1, f._legW);
    if (!act.isRunning()) act.reset().play();
    act.enabled = true;
    act.setEffectiveWeight(lw);
    act.timeScale = Math.max(0.6, Math.min(2.6, speed / clipV));
    if (f._locoW) f._locoW.walkBack = lw;
    if (up) {
      if (!up.isRunning()) up.reset().play();
      up.enabled = true;
      up.time = cur.time;
      up.timeScale = cur.timeScale;
      up.paused = cur.paused;
      const fade = cur.weight > 1e-3 ? cur.getEffectiveWeight() / cur.weight : 1;
      cur.weight = 1 - lw;
      up.setEffectiveWeight(lw * fade);
      f._legUpper = up;
      f._legCur = cur;
    }
  } else {
    if (act.isRunning() && f.state !== 'walk') {
      act.setEffectiveWeight(0);
      act.stop();
      if (f._locoW) f._locoW.walkBack = 0;
    }
    f._legW = 0;
    if (f._legUpper) { f._legUpper.stop(); f._legUpper = null; }
    if (f._legCur) { if (f._legCur.weight < 1 && f._legCur.weight > 0) f._legCur.weight = 1; f._legCur = null; }
  }
}

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

// Foot torn off (leg still on): which side hops. Both feet gone keeps the bent-knee shuffle.
function stumpSide(f) {
  const lost = (s) => !!(f.subs && f.subs['foot' + s] && f.subs['foot' + s].detached && !(f.parts['leg' + s] && f.parts['leg' + s].detached));
  const L = lost('L'); const R = lost('R');
  return L === R ? null : (L ? 'L' : 'R');
}

function updateLoco(f, sidestep, inout, dt, actualSpeed, moveSpeeds) {
  if (f._legUpper) { f._legUpper.stop(); f._legUpper = null; } // pushback layer is over once footwork runs
  let acts = locoActions(f);
  const stump = stumpSide(f);
  const hopName = { walkFwd: 'StumpHop', walkBack: 'StumpHopBack', strafeL: 'StumpHopLeft', strafeR: 'StumpHopRight' };
  if (stump) {
    acts = { ...acts };
    for (const key in hopName) { const h = f.actions[hopName[key] + stump]; if (h) acts[key] = h; }
  }
  if ((f._locoStump || null) !== stump) {
    // Gait changed (foot just torn off, or a new round): stop the old footwork actions; the
    // new ones start at the current blend weights.
    const prev = f._locoActs || locoActions(f);
    for (const key in hopName) if (prev[key] && prev[key] !== acts[key] && prev[key].isRunning()) prev[key].stop();
    f._locoStump = stump;
  }
  f._locoActs = acts;
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
  const k = 1 - Math.pow(0.0008, Math.max(dt, 1 / 120)); // snappy footwork blends
  f._locoW = f._locoW || { idle: 1, idleB: 0, injured: 0, walkFwd: 0, walkBack: 0, strafeL: 0, strafeR: 0 };
  let top = 'idle';
  let topW = -1;
  for (const key of LOCO_KEYS) f._locoW[key] += (target[key] - f._locoW[key]) * k;
  // Several keys can share one action (with a single idle variant, idle and idleB are the
  // same FightingIdle action). Weights are summed per action and applied once: applying them
  // per key let idleB's zero weight stop the idle action every frame, leaving the robot in
  // the bind pose (shrunken, barely moving) whenever it stood still.
  const perAct = new Map();
  for (const key of LOCO_KEYS) {
    const act = acts[key];
    if (!act) continue;
    perAct.set(act, (perAct.get(act) || 0) + f._locoW[key]);
  }
  for (const key of LOCO_KEYS) {
    const act = acts[key];
    const w = act ? Math.min(1, perAct.get(act) || 0) : f._locoW[key];
    if (!act) continue;
    if (LOCO_KEYS.indexOf(key) !== LOCO_KEYS.findIndex((k2) => acts[k2] === act)) { if (w > topW) { topW = w; top = key; } continue; }
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
  // Footwork owns the body now: fade out every other clip still in the mixer. A finished
  // one-shot (block, strike, hit) is clamped on its last frame at full weight; nothing faded
  // it once footwork took over, so blocks piled up at weight 1 each. three.js averages
  // weights above 1, so every new strike or step was diluted (to a third late in a fight):
  // the "movements shrink over time" bug.
  const locoSet = new Set([...Object.values(acts), ...Object.values(locoActions(f))]);
  const seenA = new Set();
  for (const a of Object.values(f.actions)) {
    if (seenA.has(a)) continue;
    seenA.add(a);
    if (locoSet.has(a) || a === f.actions.GuardUpper || a === f.baseAct || !mixerActive(f, a)) continue;
    if (a.getEffectiveWeight() <= 0.002) { a.stop(); continue; }
    if (!a._weightInterpolant) a.fadeOut(0.2);
  }
  // Walking clips have their arms stripped; hold the fighting guard on the upper body instead.
  const guard = f.actions.GuardUpper;
  if (guard) {
    const gw = (f._locoW.walkFwd || 0) + (f._locoW.walkBack || 0);
    if (gw > 0.01) {
      if (!guard.isRunning()) guard.reset().play();
      guard.enabled = true;
      guard.setEffectiveWeight(Math.min(1, gw));
    } else if (guard.isRunning()) {
      guard.setEffectiveWeight(0);
      if (gw < 0.002) guard.stop();
    }
  }
  const nameOf = {
    idle: (acts.idle && acts.idle.getClip().name) || MODEL.animations.idle,
    idleB: (acts.idleB && acts.idleB.getClip().name) || MODEL.animations.idle,
    injured: MODEL.animations.idleInjured,
    walkFwd: (acts.walkFwd && acts.walkFwd.getClip().name) || 'Walking',
    walkBack: (acts.walkBack && acts.walkBack.getClip().name) || 'WalkingBackwards',
    strafeL: (acts.strafeL && acts.strafeL.getClip().name) || 'JogStrafeLeft',
    strafeR: (acts.strafeR && acts.strafeR.getClip().name) || 'JogStrafeRight',
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
    const ts = expected > 1e-4 ? Math.max(0.6, Math.min(2.6, actualSpeed / expected)) : 1;
    f._gaitDbg = { cmd: speed, actual: actualSpeed, expected, ts };
    for (const key of ['walkFwd', 'walkBack', 'strafeL', 'strafeR']) {
      const act = acts[key];
      if (act && act.isRunning()) act.timeScale = ts;
    }
  }
}

function stepFootSounds(f, dt) {
  if (!f || f.state === 'ko' || f.state === 'down' || f.state === 'getup') return;
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
    const wasUp = rec.y > top + 0.045 * SIZE;
    const nowDown = y <= top + 0.038 * SIZE;
    if (wasUp && nowDown && rec.t > 0.16) {
      rec.t = 0;
      playSfx('step', { vol: 0.48, rate: 0.94 + Math.random() * 0.12 });
    }
    rec.y = y;
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

let hitStopLeft = 0;
function triggerHitStop(sec) {
  hitStopLeft = Math.max(hitStopLeft, sec);
}

// ---- Camera views (Settings > Camera view, or V to cycle) ----
// arena: the original orbit camera (default). fighting: side-on at chest height, auto-zoom
// to fit both robots (updateFightingCamera). third: behind and over P1's right shoulder,
// following it and framing the opponent. first: from P1's visor (its own fists come into
// view when it strikes), P1's head meshes hidden from the camera, mechanical shake on hits and
// a head-damage wobble. With P1's head gone, first person falls back to third person.
const _cvA = new THREE.Vector3();
const _cvB = new THREE.Vector3();
const _cvF = new THREE.Vector3();
const _cvR = new THREE.Vector3();
let camModeLive = null;

function cameraMode() {
  let m = getSettings().cam || 'arena';
  if (m === 'first' && p1.parts && p1.parts.head && p1.parts.head.detached) m = 'third';
  return m;
}

function headOnlyMeshes(f) {
  if (f._headOnly) return f._headOnly;
  const out = [];
  const head = f.parts && f.parts.head;
  if (head) for (const m of head.meshes) out.push(m);
  for (const m of f.skinMeshes || []) {
    const used = m.userData.vertPartsUsed;
    if (used && used.size === 1 && used.has('head')) out.push(m);
  }
  f._headOnly = out;
  return out;
}

// P1's head meshes are hidden only while the 1st-person view renders.
function setFirstPersonHide(on) {
  if (!p1) return;
  for (const m of headOnlyMeshes(p1)) {
    if (on) { if (m.userData.fpWasVisible == null) { m.userData.fpWasVisible = m.visible; m.visible = false; } }
    else if (m.userData.fpWasVisible != null) { m.visible = m.userData.fpWasVisible; m.userData.fpWasVisible = null; }
  }
}

// Classic fighting-game view: side-on at chest height, perpendicular to the line between the
// robots, zooming to fit both. The side normal is smoothed and keeps its sign (whichever side
// the camera is already on), so circling swings the camera around smoothly and never flips.
const _fcN = new THREE.Vector3();
const _fcT = new THREE.Vector3();
let fightCamDist = 0;
function updateFightingCamera(dt) {
  const a = p1.root.position;
  const b = p2.root.position;
  _cvF.set(b.x - a.x, 0, b.z - a.z);
  const dist = Math.max(0.3, _cvF.length());
  _cvF.divideScalar(dist);
  _fcT.set(-_cvF.z, 0, _cvF.x);
  const snap = dt <= 0 || _fcN.lengthSq() < 0.5;
  if (snap) {
    // Start on the side nearest the current camera.
    _cvA.set(camera.position.x - (a.x + b.x) / 2, 0, camera.position.z - (a.z + b.z) / 2);
    if (_cvA.dot(_fcT) < 0) _fcT.negate();
    _fcN.copy(_fcT);
  } else {
    if (_fcT.dot(_fcN) < 0) _fcT.negate();
    // Ease the side axis (time-based), capped turn rate so fast spins don't whip the view.
    const want = Math.atan2(_fcT.x, _fcT.z);
    const cur = Math.atan2(_fcN.x, _fcN.z);
    let d = want - cur;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const step = Math.sign(d) * Math.min(Math.abs(d) * (1 - Math.pow(0.02, dt)), 2.2 * dt);
    _fcN.set(Math.sin(cur + step), 0, Math.cos(cur + step));
  }
  // Fit both robots (plus a margin for limbs) in the horizontal field of view.
  const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const span = dist / 2 + 1.25 * SIZE;
  const want = Math.max(3.4 * SIZE, Math.min(13 * SIZE, Math.max(span / Math.tan(hHalf), 2.1 * SIZE / Math.tan(vHalf))));
  fightCamDist = snap || !fightCamDist ? want : fightCamDist + (want - fightCamDist) * (1 - Math.pow(0.05, dt));
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  camT.set(mx + _fcN.x * fightCamDist, 1.4 * SIZE + fightCamDist * 0.04, mz + _fcN.z * fightCamDist);
  _cvB.set(mx, 1.3 * SIZE, mz); // a little above the chest: the fighters sit under the round titles
  if (snap) { camera.position.copy(camT); lookT.copy(_cvB); } else {
    camera.position.lerp(camT, 1 - Math.pow(0.002, dt));
    lookT.lerp(_cvB, 1 - Math.pow(0.0005, dt));
  }
  camera.lookAt(lookT);
  if (shakeAmp > 0) {
    camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.4;
    camera.position.addScaledVector(_cvF, (Math.random() - 0.5) * shakeAmp * 0.8);
    if (dt > 0) shakeAmp = Math.max(0, shakeAmp - dt * 3.2);
  }
}

function updateFollowCamera(dt, mode) {
  const a = p1.root.position;
  const b = p2.root.position;
  _cvF.set(b.x - a.x, 0, b.z - a.z);
  const dist = Math.max(0.3, _cvF.length());
  _cvF.divideScalar(dist);
  _cvR.set(-_cvF.z, 0, _cvF.x); // P1's right when facing the opponent (+Z facing -> -X)
  const k = dt <= 0 ? 1 : 1 - Math.pow(mode === 'first' ? 1e-7 : 0.0008, dt);
  if (mode === 'third') {
    const back = 2.25 * SIZE + dist * 0.28;
    camT.set(a.x - _cvF.x * back + _cvR.x * 0.62 * SIZE, 1.95 * SIZE + dist * 0.05, a.z - _cvF.z * back + _cvR.z * 0.62 * SIZE);
    placeInOctagon(camT, -1.5, false);
    lookT.set(a.x + _cvF.x * dist * 0.62, 1.12 * SIZE, a.z + _cvF.z * dist * 0.62);
    camera.position.lerp(camT, k);
    camera.lookAt(lookT);
  } else {
    // Eye just in front of the visor (so no head geometry sits between it and the scene),
    // riding the head bone so the view moves with the body; aimed at the opponent's chest.
    const head = p1.flinchBones && p1.flinchBones.Head;
    p1.model.updateWorldMatrix(true, true);
    if (head) head.getWorldPosition(_cvA); else _cvA.set(a.x, 1.65 * SIZE, a.z);
    _cvA.addScaledVector(_cvF, 0.2 * SIZE);
    _cvA.y += 0.05 * SIZE;
    camera.position.lerp(_cvA, k);
    _cvB.set(b.x, (p2.state === 'down' || p2.state === 'ko') ? 0.35 * SIZE : 1.2 * SIZE, b.z);
    lookT.lerp(_cvB, dt <= 0 ? 1 : 1 - Math.pow(0.002, dt));
    camera.lookAt(lookT);
  }
  // Head damage (cracked optics) wobbles the view, much more from inside the head.
  const hp = p1.parts && p1.parts.head;
  const hd = hp && !hp.detached ? 1 - hp.hp / hp.max : 0;
  const t = performance.now() / 1000;
  if (hd > 0.3) {
    const w = (hd - 0.3) * (mode === 'first' ? 0.1 : 0.05);
    camera.rotateZ(Math.sin(t * 1.3) * w + (Math.random() - 0.5) * w * 0.3);
    camera.rotateX(Math.sin(t * 2.1 + 1) * w * 0.4);
  }
  if (shakeAmp > 0) {
    // Mechanical shake: a hard rotational jolt (1st person) or a positional one (3rd).
    if (mode === 'first') {
      camera.rotateX((Math.random() - 0.5) * shakeAmp * 0.9);
      camera.rotateY((Math.random() - 0.5) * shakeAmp * 0.6);
      camera.rotateZ((Math.random() - 0.5) * shakeAmp * 0.7);
    } else {
      camera.position.x += (Math.random() - 0.5) * shakeAmp * 0.8;
      camera.position.y += (Math.random() - 0.5) * shakeAmp * 0.4;
    }
    if (dt > 0) shakeAmp = Math.max(0, shakeAmp - dt * 3.2);
  }
}

// Round / fight / KO titles sit above the robots' heads in every view: each frame a title is
// showing, project both head tops to the screen and move the title block (CSS variables read
// by style.css) so its bottom clears the higher head, scaling it down if there's no room
// under the HUD.
const _ttV = new THREE.Vector3();
let _ttLast = '';
function placeTitles() {
  const els = document.querySelectorAll('.rfs-call.on, #banner.show');
  if (!els.length || !p1 || !p2) return;
  const h = renderer.domElement.clientHeight || window.innerHeight;
  let headTop = Infinity;
  const fp = cameraMode() === 'first' && !match.over;
  for (const f of [p1, p2]) {
    if (fp && f === p1) continue; // your own head is behind the camera
    const head = f.parts && f.parts.head && !f.parts.head.detached && f.flinchBones && f.flinchBones.Head;
    if (head) { head.getWorldPosition(_ttV); _ttV.y += 0.32 * SIZE; } else { f.root.getWorldPosition(_ttV); _ttV.y += 2.2 * SIZE; }
    _ttV.project(camera);
    if (_ttV.z > 1 || _ttV.z < -1) continue;
    headTop = Math.min(headTop, (1 - _ttV.y) / 2 * h);
  }
  const hud = document.getElementById('top');
  const minTop = (hud ? hud.getBoundingClientRect().bottom : 60) + 8;
  let top = Math.max(minTop, Math.min(h * 0.15, 150));
  let scale = 1;
  if (Number.isFinite(headTop)) {
    let tall = 0;
    for (const el of els) {
      const inner = el.id === 'banner' ? el.firstElementChild : el;
      if (inner) tall = Math.max(tall, inner.offsetHeight || 0);
    }
    const room = headTop - 14 - minTop; // space between the HUD and the head tops
    if (tall > 0 && room < tall) scale = Math.max(0.45, room / tall);
    top = Math.max(minTop, Math.min(top, headTop - 14 - tall * scale));
  }
  const key = Math.round(top) + '|' + scale.toFixed(2);
  if (key === _ttLast) return;
  _ttLast = key;
  document.documentElement.style.setProperty('--rf-title-top', Math.round(top) + 'px');
  document.documentElement.style.setProperty('--rf-title-scale', scale.toFixed(2));
}

function updateCamera(dt) {
  // [stadium-broadcast hook] crowd-watch seat (V-cycle 'crowd') and VR own the camera when active.
  if (updateCrowdCam(camera, dt)) { setFirstPersonHide(false); camModeLive = 'crowd'; return; }
  const want = cameraMode();
  // Broadcast keeps directing through the KO (close-ups, cuts); other views go to the arena.
  const mode = match.over && want !== 'broadcast' ? 'arena' : want;
  if (mode !== camModeLive) {
    camModeLive = mode;
    camera.near = mode === 'first' ? 0.04 : 0.1;
    camera.updateProjectionMatrix();
    dt = 0; // snap to the new view
  }
  setFirstPersonHide(mode === 'first');
  if (mode === 'broadcast' && broadcastMain(camera)) return;
  if (mode === 'fighting') { updateFightingCamera(dt); return; }
  if (mode !== 'arena') { updateFollowCamera(dt, mode); return; }
  const a = p1.root.position;
  const b = p2.root.position;
  // Over: aim above the bodies so the fighters sit in the lower frame, under the title.
  const midY = (match.over ? 1.55 : 1.15) * SIZE;
  lookT.set((a.x + b.x) / 2, midY, (a.z + b.z) / 2);
  if (match.over) {
    match.orbitT = (match.orbitT || 0) + dt;
    const radius = 8.2 * SIZE;
    const ang = match.orbitT * 0.22;
    const y = 3.7 * SIZE + Math.sin(match.orbitT * 0.18) * 0.3;
    camT.set(lookT.x + Math.sin(ang) * radius, y, lookT.z + Math.cos(ang) * radius);
    camera.position.lerp(camT, dt <= 0 ? 0 : 1 - Math.pow(0.015, dt));
    camera.lookAt(lookT);
    return;
  }
  const dist = a.distanceTo(b);
  const r = Math.max(0.7, Math.hypot(2.3 * SIZE, 8.6 * SIZE + dist * 0.3) * orbit.zoom);
  // Zoomed in close, aim a little lower so the feet and mat stay in frame.
  lookT.y = midY - (1 - Math.min(1, orbit.zoom)) * 0.45 * SIZE;
  const cp = Math.cos(orbit.pitch);
  camT.set(
    lookT.x + Math.sin(orbit.yaw) * cp * r,
    Math.max(0.08, lookT.y + Math.sin(orbit.pitch) * r),
    lookT.z + Math.cos(orbit.yaw) * cp * r,
  );
  camera.position.lerp(camT, dt <= 0 ? 1 : 1 - Math.pow(orbit.drag ? 1e-6 : 0.001, dt));
  camera.lookAt(lookT);
  // A human player's damaged head (optics) makes the view drift and wobble.
  const head = p1.parts && p1.parts.head;
  const hd = head && !head.detached ? 1 - head.hp / head.max : 0;
  if (hd > 0.5 && !shellCall('cpuControls', 'p1')) {
    const t = performance.now() / 1000;
    const a = (hd - 0.5) * 0.12;
    camera.position.x += Math.sin(t * 1.7) * a;
    camera.position.y += Math.sin(t * 2.3 + 1) * a * 0.5;
    camera.rotation.z += Math.sin(t * 1.3) * a * 0.15;
  }
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

const _guM = new THREE.Matrix4();

// Get-up: the knockdown fall (StumbleBackwards) ends lying on the back in exactly the pose
// GettingUp starts from (measured with __rfClipPose), so a short cross-fade is seamless and
// no bone is ever posed by physics.
function beginGetUp(f) {
  if (!f || f.state === 'getup') return;
  if (f.phys && f.phys.body) f.phys.body.velocity.setZero();
  f.state = 'getup';
  f.stateT = 0;
  f.downLying = false;
  f.flinch = null;
  if (f.mixer) f.mixer.timeScale = 1;
  const clip = f.actions.GettingUp ? 'GettingUp' : (MODEL.animations.getUp || 'GettingUp');
  const act = setAnim(f, clip, 0.25);
  // The whole clip, paced to COMBAT.getupTime.
  if (act) act.timeScale = act.getClip().duration / Math.max(0.6, COMBAT.getupTime || 1.25) * statOf(f, 'recovery');
  announce('getup', { delay: 0.2 }); // [announcer hook]
}

const _hpA = new THREE.Vector3();
const _hpB = new THREE.Vector3();
// Diagnostics: how far each post-mixer stage turns the foot bones (deg), and the largest
// frame-to-frame foot turn straight out of the mixer.
function diagFootStage(f, stage) {
  const d = f._footDiag || (f._footDiag = { q: {}, prev: {}, max: [0, 0, 0, 0, 0], mixJump: 0 });
  for (const side of ['L', 'R']) {
    const b = f.ikLegs && f.ikLegs[side] && f.ikLegs[side].foot;
    if (!b) continue;
    if (stage === 0) {
      const p = d.prev[side];
      if (p) d.mixJump = Math.max(d.mixJump, p.angleTo(b.quaternion) * 57.3);
      d.prev[side] = b.quaternion.clone();
      d.q[side] = b.quaternion.clone();
    } else if (d.q[side]) {
      d.max[stage] = Math.max(d.max[stage], d.q[side].angleTo(b.quaternion) * 57.3);
      d.q[side] = b.quaternion.clone();
    }
  }
}

function poseAfterMixer(f, dt = 1 / 60) {
  // Keep the game's movement in charge: pin hips X/Z, leave Y for clip bounce. During punches
  // and kicks the pin eases off so the clip's lunge, hip turn and weight shift come through,
  // and eases back once the strike connects (the body doesn't keep driving through).
  if (f.hips && f.hipsBind) {
    const attacking = (f.state === 'punch' || f.state === 'kick') && !f.atkContact;
    const k = 1 - Math.pow(attacking ? 0.01 : 0.002, Math.max(dt, 1 / 120)); // free the hips over ~0.2 s, not in one frame
    f.hipFree = (f.hipFree || 0) + ((attacking ? 1 : 0) - (f.hipFree || 0)) * k;
    const w = 1 - f.hipFree;
    f.hips.position.x += (f.hipsBind.x - f.hips.position.x) * w;
    f.hips.position.z += (f.hipsBind.z - f.hips.position.z) * w;
    // Never let the freed hips carry the body into the opponent.
    const opp = f === p1 ? p2 : p1;
    if (f.hipFree > 0.01 && opp && f.hips.parent) {
      const parent = f.hips.parent;
      parent.updateWorldMatrix(true, false);
      _hpA.copy(f.hipsBind).applyMatrix4(parent.matrixWorld);
      _hpB.copy(f.hips.position).applyMatrix4(parent.matrixWorld);
      const fwd = toward(f, opp);
      const along = (_hpB.x - _hpA.x) * fwd.x + (_hpB.z - _hpA.z) * fwd.z;
      const room = Math.max(0, f.root.position.distanceTo(opp.root.position) - (COMBAT.separateHard || 0.8) - 0.15);
      if (along > room) {
        _hpB.x -= fwd.x * (along - room);
        _hpB.z -= fwd.z * (along - room);
        f.hips.position.copy(_hpB.applyMatrix4(_guM.copy(parent.matrixWorld).invert()));
      }
    }
  }
  f.model.position.y = f.baseY;
  applyStumpLeg(f, dt);
  applyFlinch(f, dt);
  applyGroundBow(f);
}

// Leg damage fraction (0 intact .. 1 empty); legs bend instead of breaking off.
function legDamage(f, side) {
  const leg = f.parts && f.parts['leg' + side];
  if (!leg || leg.detached) return 0;
  return Math.max(0, Math.min(1, 1 - leg.hp / leg.max));
}

// Damaged leg: dents come from the hits; on top of that the leg is posed bent and warped
// (rigid bone rotations, no stretching): a knee that won't straighten and a thigh knocked out
// of line, both growing with damage. The limp (sway, slower stride, trips) is in
// applyMalfunctions / moveSpeedMul / footStumble.
//
// Lost foot: the Walking clip alone looks like a healthy walk, so the stump leg is posed on
// top of it (procedural, rigid bone rotations only): walking, the stump is carried with the
// hip and knee flexed and the robot hops along on its good leg (the clip's stride on that
// side; feet grounding keeps the good sole on the mat); standing, the stump only touches
// down lightly with the weight on the good leg. Both feet gone: a bent-knee shuffle.
const _stAxis = new THREE.Vector3();
const _stPQ = new THREE.Quaternion();
const _stQ = new THREE.Quaternion();
const _stFwd = new THREE.Vector3();
function rotateBoneWorldAxis(bone, axis, angle) {
  if (!bone || !bone.parent || Math.abs(angle) < 1e-4) return;
  bone.parent.getWorldQuaternion(_stPQ);
  _stQ.setFromAxisAngle(_bp.copy(axis).applyQuaternion(_stPQ.invert()).normalize(), angle);
  bone.quaternion.premultiply(_stQ);
  bone.updateMatrixWorld(true);
}
function applyStumpLeg(f, dt) {
  const lost = {
    L: !!(f.subs && f.subs.footL && f.subs.footL.detached && !(f.parts.legL && f.parts.legL.detached)),
    R: !!(f.subs && f.subs.footR && f.subs.footR.detached && !(f.parts.legR && f.parts.legR.detached)),
  };
  const standing = !DOWN_STATES.has(f.state) && f.state !== 'ground';
  const both = lost.L && lost.R;
  const walking = f.state === 'walk';
  f.stumpW = f.stumpW || { L: 0, R: 0 };
  const k = Math.min(1, dt * 8);
  _stAxis.set(Math.cos(f.root.rotation.y), 0, -Math.sin(f.root.rotation.y)); // root right (up x fwd)
  for (const side of ['L', 'R']) {
    const want = lost[side] && standing ? 1 : 0;
    f.stumpW[side] += (want - f.stumpW[side]) * k;
    const w = f.stumpW[side];
    const leg = f.ikLegs && f.ikLegs[side];
    if (!leg || !leg.thigh || !leg.shin) continue;
    const bend = standing && !lost[side] ? legDamage(f, side) : 0;
    if (bend > 0.12) {
      f.model.updateWorldMatrix(true, true);
      const b = (bend - 0.12) / 0.88;
      _stFwd.set(Math.sin(f.root.rotation.y), 0, Math.cos(f.root.rotation.y));
      rotateBoneWorldAxis(leg.thigh, _stFwd, (side === 'L' ? -1 : 1) * 0.1 * b); // knocked out of line
      rotateBoneWorldAxis(leg.thigh, _stAxis, -0.1 * b);
      rotateBoneWorldAxis(leg.shin, _stAxis, 0.32 * b);                     // knee stays bent
      if (leg.foot) rotateBoneWorldAxis(leg.foot, _stFwd, (side === 'L' ? 1 : -1) * 0.12 * b); // ankle rolled
    }
    if (w < 0.01) continue;
    f.model.updateWorldMatrix(true, true);
    let hip; let knee;
    if (both) { hip = 0.12; knee = 0.32; }
    else if (walking) {
      // Carried stump with a small pump in time with the hop.
      const pump = Math.sin((f.limpT || 0) * 6.4) * 0.08;
      hip = 0.5 + pump; knee = 0.85 + pump;
    } else { hip = 0.16; knee = 0.3; }
    rotateBoneWorldAxis(leg.thigh, _stAxis, -hip * w); // knee comes forward
    rotateBoneWorldAxis(leg.shin, _stAxis, knee * w);  // stump folds back
  }
}

function resetMatch(keepDebris = false) {
  syncEnvironment();
  for (const f of [p1, p2]) {
    if (f.mixer) f.mixer.timeScale = 1;
    f.downLying = false;
    f.downClip = null;
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
    f.kdCount = 0;
    f.koTip = null;
    f.koHold = null;
    f.koKind = null;
    f.model.rotation.set(0, 0, 0);
    f.guardPush = null;
    f.hitPush = null;
    f.flinch = null;
    f.groundBow = 0;
    f.gN = 0;
    f.gKd = -1;
    f.contactT = -1;
    f.retract = false;
    f.atkContact = false;
    // Fresh brain each round: nothing carries over from the last KO.
    if (f.brain && (f.brain.kind === 'paced' || f.brain.kind === 'api')) f.brain = null;
    resetFighterPhysics(f, f.startX, 0);
    f.atkMods = null;
    resetFighterDamage(f, scene);
    if (!keepDebris) resetEyes(f);
    // Every round starts standing in the guard stance (no get-up). Hard-start the idle at full
    // weight and pose it now, so the first rendered frame never shows the bind (A/T) pose from
    // a cross-fade out of a stopped KO fall action.
    if (f.mixer) f.mixer.stopAllAction();
    f._locoW = null;
    f._locoStump = null;
    f.current = null;
    setAnim(f, idleClipFor(f), 0.08);
    const startAct = f.actions[f.current];
    if (startAct) { startAct.stopFading(); startAct.setEffectiveWeight(1); startAct.play(); }
    if (f.mixer) f.mixer.update(0);
    poseAfterMixer(f);
    f.state = 'idle';
  }
  clearAllDebris(scene, keepDebris);
  document.getElementById('overlay').classList.add('hidden');
  match.over = false;
  match.winner = null;
  match.phase = 'intro';
  match.introT = 0;
  match.camLock = false;
  match.roundLeft = null;
  match.koT = 0;
  match.orbitT = 0;
  match.overlayAt = 0;
  hitStopLeft = 0;
  match.slowLeft = 0;
  held.buf = null;
  paintRound();
  const banner = document.getElementById('banner');
  banner.style.opacity = '';
  banner.classList.remove('show');
  faceEachOther(p1, p2, 0, true);
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
  if (dt > 0 && match.slowLeft > 0) { // brief mild slow motion on the KO
    match.slowLeft = Math.max(0, match.slowLeft - rawDt);
    dt *= 0.4;
  }
  if (match.over && match.overlayAt && performance.now() >= match.overlayAt) showKoOverlay();
  if (match.phase === 'intro') {
    if (!match.introT) document.getElementById('banner').classList.add('show');
    match.introT += dt;
    // [announcer hook] hold the "Round N" card until the walkout / round call finishes.
    const hold = announceIntroSeconds() || 1.05;
    if (match.introT > hold) {
      match.phase = 'fight';
      document.getElementById('banner').classList.remove('show');
      startRoundClock();
      playSfx('bell');
      startCrowd();
      announce('fight', { delay: 0.05 });
    }
  }
  if (match.phase === 'fight' && !match.over) stepRound(dt);
  const canAct = match.phase === 'fight' && !match.over && !isSettingsOpen();
  const watch = !!shellCall('cpuControls', 'p1'); // Bot vs Bot: P1 is a CPU too
  p1.isCpu = watch;
  const pin = canAct ? (watch ? updateAI(p1, p2, dt) : consumeAttacks(rawInput(), dt)) : consumeAttacks({ sidestep: 0, inout: 0, punch: false, kick: false, block: false }, 1);
  const ain = canAct ? updateAI(p2, p1, dt) : { sidestep: 0, inout: 0, punch: false, kick: false, block: false };

  const p1Was = p1.state;
  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  // A buffered press is used up once the attack it asked for has started.
  if (held.buf && p1.state !== p1Was && (p1.state === 'punch' || p1.state === 'kick' || p1.state === 'ground' || p1.state === 'dodge')) held.buf = null;
  stepPhysics(dt);
  // A robot that is falling, lying or getting up has no standing capsule to push against:
  // the other can step over it to stomp, and nothing shoves the lying body around.
  for (const f of [p1, p2]) if (f.phys && f.phys.body) f.phys.body.collisionResponse = !DOWN_STATES.has(f.state) && !f.ghost;
  if (!DOWN_STATES.has(p1.state) && !DOWN_STATES.has(p2.state) && !p1.ghost && !p2.ghost) separate(p1, p2);
  faceEachOther(p1, p2, dt);
  for (const f of [p1, p2]) {
    updateBaseLayer(f);
    f.mixer.update(dt);
    f.root.position.y = 0;
    if (window.__rfDiag) diagFootStage(f, 0);
    poseAfterMixer(f, dt);
    if (window.__rfDiag) diagFootStage(f, 1);
    applyMalfunctions(f, dt);
    armSelfClear(f);
    if (f.koTip) stepKoTip(f, dt);
    stepEyes(f, dt);
    if (window.__rfDiag) diagFootStage(f, 2);
    applyJointLimits(f);
    if (window.__rfDiag) diagFootStage(f, 3);
    groundFeet(f, dt);
    if (window.__rfDiag) diagFootStage(f, 4);
    if (window.__rfDiag && (f.state === 'idle' || f.state === 'block')) logFloat(f);
    if (window.__rfDiag) logSlide(f, dt);
    stepFootSounds(f, dt);
  }
  updateContactShadows(p1);
  updateContactShadows(p2);
  stepDamage(scene, dt);
  if (!match.over && match.phase === 'fight') {
    if (isCatastrophic(p1) && p1.state !== 'ko') ko(p1, p2, { reason: p1.parts.head && p1.parts.head.detached ? 'head' : 'legs' });
    else if (isCatastrophic(p2) && p2.state !== 'ko') ko(p2, p1, { reason: p2.parts.head && p2.parts.head.detached ? 'head' : 'legs' });
  }

  if (!match.camLock) updateCamera(dt);
  placeTitles();
  updateFighterRims();
  hitLight.intensity = Math.max(0, hitLight.intensity - dt * 28);
  setBuzz(isSettingsOpen() ? 0 : buzzFromFighters());
  syncHud();
  updateStadium(dt); // [stadium-arena hook]
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
  // Round 2+ of the same match: the wreckage of earlier rounds stays on the mat.
  resetMatch(opts.round != null && opts.round > 1);
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
  syncEnvironment(); // the void wall exists now: hide it if the HDRI backdrop is on
  addFloorReflection(scene).then((m) => { floorMirror = m; m.visible = gfxKey !== 'low'; }).catch(() => {});
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
  // [stadium-arena hook] scenery-only; mat, walls and physics stay as built above.
  initStadium({
    scene, renderer, pmrem, industrial: built, gfx: gfxKey,
    applyHdri, getHdri: () => !!(getSettings().hdri || ARENA.hdri),
    trackLight,
    untrackLight(l) { const i = litLights.indexOf(l); if (i >= 0) litLights.splice(i, 1); },
    refreshLights: () => applyLight(getSettings().light),
    // [stadium-broadcast hook] read-only getters for crowd cam / broadcast feed / music.
    camera, canvas, getFighters: () => [p1, p2], getMatch: () => match,
  });
  initArenaPhysics();
  p1 = makeFighter(gltf, MODEL.colors.p1, 'p1');
  p2 = makeFighter(gltf, MODEL.colors.p2, 'p2');
  applyFighterConfig(p1, defaultFighterConfig('p1'));
  applyFighterConfig(p2, defaultFighterConfig('p2'));
  attachFighter(p1);
  attachFighter(p2);
  onPhysicsBounce((kind, impact, rec) => {
    const mass = rec && rec.mass != null ? rec.mass : 4;
    // Heavier parts hit harder and lower: loudness grows with impact speed and mass.
    const vol = Math.min(1, 0.22 + impact / 7 + Math.min(0.25, mass / 40));
    const rate = 0.92 + Math.min(0.15, impact / 30);
    const id = rec && rec.body ? rec.body.id : undefined;
    if (kind === 'cage' || kind === 'post') playSfx('cage', { vol, rate, id });
    else playSfx('bounce', { vol, rate, id, mass });
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
  faceEachOther(p1, p2, 0, true);
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

  window.__rfDebugBlobs = () => [p1, p2].map((f) => f.blobs ? Object.fromEntries(Object.entries(f.blobs).map(([k, b]) => [k, [b.visible, +b.material.opacity.toFixed(2), +b.position.x.toFixed(2), +b.position.z.toFixed(2)]])) : null);
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
      let meshMin = null;
      try { meshMin = +new THREE.Box3().setFromObject(f.model, true).min.y.toFixed(4); } catch (e) {}
      out[f.id] = { sole: (f.soleVerts ? f.soleVerts.left.reduce((n, e) => n + e.idx.length, 0) + f.soleVerts.right.reduce((n, e) => n + e.idx.length, 0) : 0), meshMin, rootY: +f.root.position.y.toFixed(4), groundY: +(f.groundY || 0).toFixed(4), minY: Number.isFinite(minY) ? +minY.toFixed(4) : null, bones };
    }
    return out;
  };
  // Read-only fight probe for headless checks (states, spacing, mesh-to-mat heights).
  window.__rfFightProbe = () => [p1, p2].map((f) => ({
    id: f.id,
    state: f.state,
    st: +f.stateT.toFixed(2),
    hp: f.health,
    cd: +f.cooldown.toFixed(2),
    brain: f.brain && f.brain.state ? f.brain.state.mode : null,
    dist: +p1.root.position.distanceTo(p2.root.position).toFixed(2),
    lying: !!f.downLying,
    low: (() => { const y = lowestBodyY(f); return y == null ? null : +y.toFixed(3); })(),
    feet: (() => { const y = lowestFootY(f); return y == null ? null : +y.toFixed(3); })(),
    clip: f.current,
    gy: +(f.groundY || 0).toFixed(3),
    det: f.parts ? Object.values(f.parts).filter((p) => p.detached).map((p) => p.id).concat(f.subs ? Object.values(f.subs).filter((s) => s.detached).map((s) => s.id) : []) : [],
    parts: f.parts ? Object.fromEntries(Object.values(f.parts).map((p) => [p.id, Math.round(p.hp)])) : null,
  }));
  // Foot twist about the shin axis (deg) and knee/elbow hinge angles, for spin/inversion checks.
  window.__rfBrainStats = () => [p1, p2].map((f) => f.brain && { kind: f.brain.kind, stats: f.brain.stats ? { ok: f.brain.stats.ok, errors: f.brain.stats.errors, action: f.brain.stats.action, err: f.brain.stats.lastError } : null });
  window.__rfFootDiag = () => [p1, p2].map((f) => f._footDiag && { max: f._footDiag.max.map((v) => +v.toFixed(1)), mixJump: +f._footDiag.mixJump.toFixed(1) });
  window.__rfFootYaw = () => [p1, p2].map((f) => {
    const out = { st: f.state, clip: f.current, clamped: f.jointStats && f.jointStats.clamped, axes: (f.joints || []).filter((j) => j.axis).map((j) => j.bone.name.replace('mixamorig', '') + ':' + j.axis.toArray().map((v) => v.toFixed(2)).join(',')) };
    const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion();
    for (const side of ['L', 'R']) {
      const leg = f.ikLegs && f.ikLegs[side];
      if (!leg || !leg.shin || !leg.foot) continue;
      leg.shin.getWorldQuaternion(qa); leg.foot.getWorldQuaternion(qb);
      const r = qa.invert().multiply(qb);
      if (r.w < 0) { r.x = -r.x; r.y = -r.y; r.z = -r.z; r.w = -r.w; }
      out['twist' + side] = +(2 * Math.atan2(r.y, r.w) * 180 / Math.PI).toFixed(1);
      if (leg.toe) {
        const a = new THREE.Vector3(); const b = new THREE.Vector3();
        leg.foot.getWorldPosition(a); leg.toe.getWorldPosition(b);
        const yaw = Math.atan2(b.x - a.x, b.z - a.z) - f.root.rotation.y;
        out['yaw' + side] = +(Math.atan2(Math.sin(yaw), Math.cos(yaw)) * 180 / Math.PI).toFixed(1);
        out['flat' + side] = +Math.hypot(b.x - a.x, b.z - a.z).toFixed(3);
        out.ry = +(f.root.rotation.y * 180 / Math.PI).toFixed(1);
        if (f.hips) { const hq = new THREE.Quaternion(); f.hips.getWorldQuaternion(hq); const hz = new THREE.Vector3(0, 0, 1).applyQuaternion(hq); out.hy = +(Math.atan2(hz.x, hz.z) * 180 / Math.PI).toFixed(1); }
      }
    }
    return out;
  });
  window.__rfFocus = (id, close) => {
    const f = id === 'p1' ? p1 : p2;
    match.camLock = true;
    const c = f.root.position;
    if (close === 'feet') { camera.position.set(c.x + 1.3, 0.55, c.z + 1.3); camera.lookAt(c.x, 0.15, c.z); return; }
    if (close) { camera.position.set(c.x + 1.1, 1.6, c.z + 1.7); camera.lookAt(c.x, 1.25, c.z); return; }
    camera.position.set(c.x + 2.6, 1.3, c.z + 3.2);
    camera.lookAt(c.x, 0.5, c.z);
  };
  window.__rfBreak = (id, sub) => debugBreakSub(id === 'p1' ? p1 : p2, sub, scene);
  window.__rfLegMesh = () => {
    const out = []; const v = new THREE.Vector3();
    p2.model.traverse((m) => {
      if (!m.isSkinnedMesh) return;
      const si = m.geometry.attributes.skinIndex; const sw = m.geometry.attributes.skinWeight;
      let n = 0; const box = new THREE.Box3();
      for (let i = 0; i < si.count; i++) {
        let best = -1; let bw = 0;
        for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
        const bn = m.skeleton.bones[best];
        if (!bn || !/LeftLeg|LeftFoot|LeftUpLeg/.test(bn.name)) continue;
        m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); box.expandByPoint(v); n++;
      }
      if (n) out.push([m.name, n, m.visible, +box.min.y.toFixed(2), +box.max.y.toFixed(2), m.skeleton.bones.includes(p2.parts.legL.bones[1]), m.bindMode]);
    });
    return out;
  };
  window.__rfLegProbe = () => { const v = new THREE.Vector3(); return p2.parts.legL.bones.map((b) => [b.name.replace('mixamorig:', ''), +b.getWorldScale(v).x.toFixed(4), +b.scale.x.toFixed(4)]); };
  window.__rfDamageProbe = () => ({ oil: oilStats(), p1: Object.values(p1.subs || {}).filter((x) => x.detached).map((x) => x.id), p2: Object.values(p2.subs || {}).filter((x) => x.detached).map((x) => x.id), hud: document.getElementById('parts2').innerHTML.length });
  window.__rfStrikeT = () => STRIKE_T;
  window.__rfTrace = (id, kind, clip, frames = 50) => {
    const f = id === 'p1' ? p1 : p2;
    const o = f === p1 ? p2 : p1;
    f.cooldown = 0; f.state = "idle"; const ok = tryAttack(f, kind, clip);
    const keys = ['LeftHand', 'RightToeBase', 'RightHand', 'LeftToeBase'];
    const bones = {}; f.model.traverse((b) => { if (b.isBone && keys.includes(boneKey(b.name)) && !bones[boneKey(b.name)]) bones[boneKey(b.name)] = b; });
    const out = []; let last = null; const v = new THREE.Vector3();
    for (let i = 0; i < frames; i++) {
      tick.__step ? tick.__step(1 / 60) : null;
      f.mixer.update(1 / 60); poseAfterMixer(f); f.model.updateWorldMatrix(true, true);
      const cur = {}; for (const k of keys) if (bones[k]) cur[k] = bones[k].getWorldPosition(v).clone();
      if (last) { let w = 0, wk = ''; for (const k in cur) { const d = cur[k].distanceTo(last[k]); if (d > w) { w = d; wk = k; } } out.push([i, f.state, f.current, wk, +(w * 60).toFixed(1), +(f.actions[clip] ? f.actions[clip].time : 0).toFixed(3), +(f.actions[clip] ? f.actions[clip].getEffectiveWeight() : 0).toFixed(2)]); }
      last = cur;
    }
    const ac = f.actions[f.attackClip];
    return { ok, cap: f.strikeCap, state: f.state, st: STRIKE_T[f.attackClip], clip: f.attackClip, ts: ac && ac.timeScale, all: Object.fromEntries(Object.entries(STRIKE_T).map(([k, x]) => [k, x.vpk])), out };
  };
  window.__rfClipSpeed = (name, key, N = 240) => {
    const f = p1; const act = f.actions[name]; if (!act) return null;
    let bone = null; f.model.traverse((o) => { if (!bone && o.isBone && boneKey(o.name) === key) bone = o; });
    f.mixer.stopAllAction(); act.reset(); act.setEffectiveWeight(1); act.play();
    const dur = act.getClip().duration; const v = new THREE.Vector3(); let last = null; const out = [];
    for (let i = 0; i <= N; i++) {
      act.time = dur * i / N; f.mixer.update(0); f.root.updateMatrixWorld(true);
      f.root.worldToLocal(bone.getWorldPosition(v));
      if (last) out.push([+(dur * i / N).toFixed(3), +(v.distanceTo(last) / (dur / N)).toFixed(2), +v.y.toFixed(2)]);
      last = v.clone();
    }
    return { dur, st: STRIKE_T && STRIKE_T[name], out };
  };
  window.__rfClipPose = (name, frac) => {
    const f = p1; const act = f.actions[name]; if (!act) return null;
    f.mixer.stopAllAction(); act.reset(); act.setEffectiveWeight(1); act.play();
    const out = [];
    for (const fr of frac) {
      act.time = act.getClip().duration * fr; f.mixer.update(0); f.root.updateMatrixWorld(true);
      const hq = f.hips.getWorldQuaternion(new THREE.Quaternion());
      const rq = f.root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hq).applyQuaternion(rq);
      const fw = new THREE.Vector3(0, 0, 1).applyQuaternion(hq).applyQuaternion(rq);
      const hp = f.root.worldToLocal(f.hips.getWorldPosition(new THREE.Vector3()));
      out.push({ fr, up: up.toArray().map((v) => +v.toFixed(2)), chest: fw.toArray().map((v) => +v.toFixed(2)), hips: hp.toArray().map((v) => +v.toFixed(2)) });
    }
    return { dur: act.getClip().duration, out };
  };
  // Debug: animation mixer state + limb/pose measurements (movement-size regression checks).
  window.__rfLowest = (id) => {
    const f = id === 'p1' ? p1 : p2;
    f.model.updateWorldMatrix(true, true);
    const v = new THREE.Vector3(); const res = [];
    for (const { mesh, idx } of f.bodyVerts) {
      if (!mesh.visible) continue;
      const vp = mesh.userData.vertPart; const si = mesh.geometry.attributes.skinIndex; const sw = mesh.geometry.attributes.skinWeight;
      for (const i of idx) {
        if (vp && partCodeDetached(f, vp[i])) continue;
        mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld);
        let best = 0; let bw = 0; for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
        res.push({ y: +v.y.toFixed(3), mesh: mesh.name, bone: boneKey(mesh.skeleton.bones[best].name), hidden: !!(mesh.userData.hiddenVerts && mesh.userData.hiddenVerts.has && mesh.userData.hiddenVerts.has(i)) });
      }
    }
    res.sort((a, b) => a.y - b.y);
    const byBone = {}; for (const r of res) if (!(r.bone in byBone)) byBone[r.bone] = r.y;
    return { lowest: res.slice(0, 6), byBone, gy: f.groundY, rootY: f.root.position.y };
  };
  window.__rfGait = (id) => {
    const f = id === 'p1' ? p1 : p2;
    const w = {}; let sumW = 0; const seen = new Set();
    for (const [name, a] of Object.entries(f.actions)) {
      if (seen.has(a)) continue; seen.add(a);
      if (!mixerActive(f, a)) continue;
      const ew = a.getEffectiveWeight();
      if (name !== 'GuardUpper') sumW += ew;
      if (ew > 0.02) w[name] = [+ew.toFixed(2), +a.timeScale.toFixed(2)];
    }
    const body = f.body || (f.phys && f.phys.body);
    const v = body ? Math.hypot(body.velocity.x, body.velocity.z) : null;
    return { st: f.state, w, sumW: +sumW.toFixed(2), mixTs: f.mixer.timeScale, g: f._gaitDbg || null, mul: +moveSpeedMul(f).toFixed(2),
      legL: +legDamage(f, 'L').toFixed(2), legR: +legDamage(f, 'R').toFixed(2), rotZ: +f.model.rotation.z.toFixed(3), v: v != null ? +v.toFixed(2) : null,
      feet: (() => { const L = f.ikLegs && f.ikLegs.L && f.ikLegs.L.foot; const R = f.ikLegs && f.ikLegs.R && f.ikLegs.R.foot; if (!L || !R) return null; f.model.updateWorldMatrix(true, true); const a = L.getWorldPosition(new THREE.Vector3()); const b = R.getWorldPosition(new THREE.Vector3()); return [+a.x.toFixed(3), +a.y.toFixed(3), +a.z.toFixed(3), +b.x.toFixed(3), +b.y.toFixed(3), +b.z.toFixed(3)]; })(), fmin: (() => { let m = Infinity; const v = new THREE.Vector3(); for (const b of f.footBones || []) { b.getWorldPosition(v); if (v.y < m) m = v.y; } return Number.isFinite(m) ? +m.toFixed(3) : null; })(), gy: +(f.groundY || 0).toFixed(3), cur: f.current, sole: +((lowestFootY(f) ?? 0) - matTopY()).toFixed(3), prevSt: f._prevState, x: +f.root.position.x.toFixed(3), z: +f.root.position.z.toFixed(3), y: +f.root.position.y.toFixed(3), hp: f.health, locoW: f._locoW };
  };
  window.__rfSize = SIZE;
  window.__rfSoleY = (id) => { const f = id === 'p1' ? p1 : p2; const y = f && lowestFootY(f); return y == null ? null : y; };
  window.__rfHealParts = () => { for (const f of [p1, p2]) { for (const p of Object.values(f.parts || {})) if (!p.detached) p.hp = p.max; for (const p of Object.values(f.subs || {})) if (!p.detached) p.hp = p.max; } };
  window.__rfHeal = () => { for (const f of [p1, p2]) if (f.state !== 'ko') f.health = Math.max(f.health, 40); };
  window.__rfAnimDiag = (id) => {
    const f = id === 'p1' ? p1 : p2;
    const acts = [];
    let sumW = 0;
    const seen = new Set();
    for (const [name, a] of Object.entries(f.actions)) {
      if (seen.has(a)) continue;
      seen.add(a);
      const w = a.getEffectiveWeight();
      const on = mixerActive(f, a);
      if (on) acts.push({ name, w: +w.toFixed(3), ts: +a.timeScale.toFixed(2), paused: a.paused });
      if (a.enabled && on && name !== 'GuardUpper') sumW += w;
    }
    const baseW = f.baseAct && mixerActive(f, f.baseAct) ? f.baseAct.getEffectiveWeight() : 0;
    const v = new THREE.Vector3();
    const pos = (k) => { let b = null; f.model.traverse((o) => { if (!b && (o.isBone || o.type === 'Bone') && boneKey(o.name) === k) b = o; }); if (!b) return null; b.getWorldPosition(v); return v.clone(); };
    f.model.updateWorldMatrix(true, true);
    const hips = pos('Hips'); const handR = pos('RightHand'); const handL = pos('LeftHand'); const footL = pos('LeftFoot'); const footR = pos('RightFoot'); const head = pos('Head');
    const sc = []; f.model.traverse((o) => { if ((o.isBone || o.type === 'Bone') && (Math.abs(o.scale.x - 1) > 0.01)) sc.push(boneKey(o.name) + ':' + o.scale.x.toFixed(2)); });
    return { st: f.state, clip: f.current, sumW: +sumW.toFixed(3), baseW: +baseW.toFixed(3), acts, mixTs: f.mixer.timeScale, hipFree: +(f.hipFree || 0).toFixed(2),
      handR: handR && hips ? +handR.distanceTo(hips).toFixed(3) : null, handL: handL && hips ? +handL.distanceTo(hips).toFixed(3) : null,
      feet: footL && footR ? +footL.distanceTo(footR).toFixed(3) : null, headY: head ? +head.y.toFixed(3) : null, hipsY: hips ? +hips.y.toFixed(3) : null,
      rootX: +f.root.position.x.toFixed(2), rootZ: +f.root.position.z.toFixed(2), hp: f.health, scaled: sc.slice(0, 8), modelScale: +f.model.scale.x.toFixed(3) };
  };
  window.__rfGround = (id) => { const f = id === 'p1' ? p1 : p2; return { state: f.state, kind: f.groundKind, hit: f.groundHit, bow: f.groundBow, gN: f.gN }; };
  // KO finish test: a final blow to partId of kind/force (optionally on an already wrecked leg).
  window.__rfKoTest = (id, partId, kind, force, wreckLeg) => {
    const f = id === 'p1' ? p1 : p2; const o = f === p1 ? p2 : p1;
    const part = f.parts[partId];
    if (wreckLeg && part) part.hp = Math.round(part.max * 0.15);
    const dir = new THREE.Vector3(f.root.position.x - o.root.position.x, 0, f.root.position.z - o.root.position.z).normalize();
    const pt = f.root.position.clone(); pt.y += ({ head: 2.25, torso: 1.45, armL: 1.5, armR: 1.5 }[partId] || 0.7) * SIZE;
    f.health = 0;
    applyPartHit(f, partId, 30, pt, dir, scene, { force, final: true });
    ko(f, o, { dir, force, partId, kind });
    return f.koKind;
  };
  window.__rfKoState = (id) => {
    const f = id === 'p1' ? p1 : p2; const h = f.hipsBone || findHips(f); const v = new THREE.Vector3();
    return { state: f.state, kind: f.koKind, hipsY: +h.getWorldPosition(v).y.toFixed(2), low: +(lowestBodyY(f) ?? 0).toFixed(2), rotZ: +f.model.rotation.z.toFixed(2), held: !!(f.koHold && f.koHold.held), legs: ['legL', 'legR'].filter((k) => f.parts[k].detached), head: f.parts.head.detached };
  };
  window.__rfBlowEye = (id, side = 'L') => { const f = id === 'p1' ? p1 : p2; const e = f.eyes && f.eyes.find((x) => x.side === side); blowEye(f, e, new THREE.Vector3(0, 0, 1)); return f.eyes.map((x) => x.blown); };
  window.__rfFighterStats = (id) => (id === 'p1' ? p1 : p2).stats;
  window.__rfForceKO = (id) => { const f = id === 'p1' ? p1 : p2; ko(f, f === p1 ? p2 : p1); };
  window.__rfForceKnockdown = (id) => {
    const f = id === 'p1' ? p1 : p2;
    const o = f === p1 ? p2 : p1;
    knockDown(f, toward(o, f), 6, 'head');
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

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader as RGBELoader } from 'three/addons/loaders/HDRLoader.js';
import { SIZE, MODEL, ARENA, COMBAT, DAMAGE, GFX_PRESETS, LOOP_CLIPS } from './config.js';
import { CLIP_SPEEDS } from './clip-speeds.js';
import { applyChrome, setChromeLow } from './chrome.js';
import { initJointLimits, applyJointLimits } from './joints.js';
import { setWiresLow } from './wires.js';
import { createApiBrain, wantsApiBrain, initApiBrainUI } from './api-brain.js';
import { getSettings, isSettingsOpen, initSettings, updateFps, cycleCameraMode } from './settings.js';
import { announce, unlockAudio, playSfx, playHit, setBuzz, startCrowd } from './audio.js';
import { buildArena as buildArenaVisual, addArenaLights, addFloorReflection } from './arena.js';
// [stadium-arena hook] stadium scenery lives in its own module.
import { initStadium, stadiumOwnsEnv, stadiumApplyEnv, stadiumSetGfx, updateStadium } from './arena/stadium.js';
import {
  initArenaPhysics,
  attachFighter,
  setFighterMove,
  stepPhysics,
  impactVelocity,
  resetFighterPhysics,
  clearPhysicsDebris,
  onPhysicsBounce,
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
  prepareFighterDamage(f);
  cacheFeet(f);
  cacheBody(f);
  if (!STRIKE_T) STRIKE_T = measureStrikes(f);
  return f;
}

// Strike timing per attack clip, measured once from the clip itself: when the fist/foot is
// furthest forward (the hit), the window around it, and when the strike has retracted.
// Attacks skip the slow lead-in, hit on the measured frames and hand control back as soon as
// the strike is pulled back, instead of locking the robot for the whole (long) Mixamo clip.
let STRIKE_T = null;
function measureStrikes(f) {
  const A = MODEL.animations;
  const kicks = new Set([...(A.kickVariants || []), ...(A.kickSpecial || []), ...(A.flipSpecial || []), A.kick]);
  const names = new Set([...(A.punchVariants || []), ...(A.punchRight || []), ...(A.punchLeft || []), A.punch, ...kicks]);
  const out = {};
  const v = new THREE.Vector3();
  const save = f.current;
  f.mixer.stopAllAction();
  for (const name of names) {
    const act = name && f.actions[name];
    if (!act) continue;
    const kind = kicks.has(name) ? 'kick' : 'punch';
    const bones = f.strikeBones[kind];
    if (!bones || !bones.length) continue;
    const dur = act.getClip().duration;
    act.reset();
    act.setEffectiveWeight(1);
    act.timeScale = 1;
    act.play();
    const N = 60;
    const s = [];
    for (let i = 0; i <= N; i++) {
      act.time = (dur * i) / N;
      f.mixer.update(0);
      f.root.updateMatrixWorld(true);
      let reach = -Infinity;
      let low = Infinity;
      for (const b of bones) {
        b.getWorldPosition(v);
        f.root.worldToLocal(v);
        reach = Math.max(reach, v.z);
        low = Math.min(low, v.y);
      }
      s.push({ t: act.time, reach, low });
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
      // A kick hands control back once the kicking foot is back near the mat.
      const floor = s[0].low + 0.08;
      let i2 = i1;
      while (i2 < N && s[i2].low > floor) i2++;
      end = Math.min(dur, Math.max(a1 + 0.1, s[i2].t));
    }
    const lead = kind === 'kick' ? 0.3 : 0.2; // clip seconds kept before the active window
    out[name] = { kind, dur, start: Math.max(0, a0 - lead), a0, a1, end, peak: s[pk].t, reach: +(s[pk].reach * 1).toFixed(3) };
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
  if (!f.blobs) f.blobs = { body: makeBlob(1.25, 0.5), left: makeBlob(0.42, 0.75), right: makeBlob(0.42, 0.75) };
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
    bone.getWorldPosition(_blobP);
    blob.position.set(_blobP.x, top, _blobP.z);
    const h = Math.max(0, _blobP.y - top);
    blob.material.opacity = blob.userData.baseOpacity * Math.max(0, 1 - h / 0.35);
    const sc = 1 + h * 1.5;
    blob.scale.set(sc, sc, 1);
  }
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
  if (target > f.groundY) f.groundY = target; // lift instantly: feet never sink
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
  const fadeT = Math.max(0.15, Math.min(0.3, fade));
  if (f.current === clipName && next.isRunning() && next.getEffectiveWeight() > 0.5) {
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
  // Over-full (a one-shot started while older clips still held weight): three.js averages
  // the excess, which dilutes the clip that should own the body. Outside footwork (which
  // sweeps its own leftovers), fade every clip except the current one.
  if (sum > 1.02 && !f.locoActive) {
    const cur = f.actions[f.current];
    for (const a of seen) {
      if (a === cur || a === f.actions.GuardUpper || a === f.baseAct || !mixerActive(f, a)) continue;
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
    if (gp.buttons[2]?.pressed || gp.buttons[4]?.pressed || gp.buttons[5]?.pressed || gp.buttons[7]?.pressed) {
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
  held.punch = inp.punch;
  held.kick = inp.kick;
  held.ground = !!inp.ground;
  if (ground) { held.buf = 'ground'; held.bufT = COMBAT.inputBuffer || 0.3; }
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

function locoMoveSpeeds(f, blocking) {
  const limp = moveSpeedMul(f);
  const blockMul = blocking ? (COMBAT.blockMoveSpeed / Math.max(0.2, COMBAT.moveSpeed)) : 1;
  const mul = limp * blockMul;
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
  if (f.state === 'ko' || f.state === 'down' || f.state === 'ground') return;
  let rate = 9;
  if (f.state === 'getup') {
    const act = f.actions.GettingUp;
    const prog = act ? act.time / Math.max(0.1, act.getClip().duration) : 1;
    if (prog < 0.7) return;
    rate = 3;
  }
  const want = Math.atan2(other.root.position.x - f.root.position.x, other.root.position.z - f.root.position.z);
  const cur = f.root.rotation.y;
  let diff = want - cur;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const k = snap ? 1 : 1 - Math.exp(-rate * Math.max(0, dt));
  f.root.rotation.set(0, cur + diff * k, 0);
}

function faceEachOther(a, b, dt = 0, snap = false) {
  faceToward(a, b, dt, snap);
  faceToward(b, a, dt, snap);
}

function tryAttack(f, kind, clipName) {
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground') return false;
  if (f.cooldown > 0) return false;
  if (kind === 'punch' && !canPunch(f)) return false;
  if (kind === 'kick' && !canKick(f)) return false;
  const mods = attackMods(f, kind);
  if (kind === 'punch' && !punchClipsFor(f).length) return false;
  const other = f === p1 ? p2 : p1;
  const clip = fitStrikeClip(f, kind, clipName
    || (kind === 'punch' ? pickPunch(f) : pickKick(f, true))
    || MODEL.animations[kind], other);
  f.state = kind;
  f.stateT = 0;
  f.hitThisAttack = false;
  f.atkContact = false;
  f.contactT = -1;
  f._strikePrev = null;
  f._diag = null;
  f.atkMods = mods;
  f.attackClip = clip;
  f.blocking = false;
  f.shield.visible = false;
  setAnim(f, clip, 0.18); // long enough to blend over the skipped lead-in (no pops)
  setFighterMove(f, 0, 0); // no walking velocity carried into the strike
  playSfx('whoosh');
  const action = f.actions[clip] || f.actions[kind];
  if (action) {
    // Faster strikes: punches ~1.3x, kicks ~1.15x (damage slows them again), starting just
    // before the measured wind-up instead of from the clip's idle lead-in.
    const speed = (kind === 'punch' ? COMBAT.punchSpeed : COMBAT.kickSpeed) || 1;
    action.timeScale = speed * mods.timeScale;
    const st = STRIKE_T && STRIKE_T[action.getClip().name];
    if (st) action.time = st.start;
  }
  return true;
}

// Choose a strike whose measured reach fits the gap: the fist/foot should just reach the
// body surface (short elbows and uppercuts up close, jabs and long kicks from further out),
// so strikes neither whiff short nor bury themselves in the other robot's chest.
function strikeTip(name) {
  const st = STRIKE_T && STRIKE_T[name];
  if (!st) return null;
  return Math.min(1.65, st.reach) + COMBAT.bodyRadius;
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
  f.cooldown = Math.max(f.cooldown, rec);
  f.state = 'idle';
  f.atkContact = false;
  setAnim(f, idleClipFor(f), fade);
}

const _seg = new THREE.Vector3();
const _bp = new THREE.Vector3();
// A strike lands when a fist/forearm (punch) or foot/shin (kick) actually reaches the
// defender's body capsule, so hits fire on visible contact, not on root distance.
// Returns the bone that made contact (or true without strike bones), else null.
function strikeContact(atk, def, kind) {
  const bones = atk.strikeBones && atk.strikeBones[kind];
  if (!bones || !bones.length) return atk.root.position.distanceTo(def.root.position) <= COMBAT[kind].reach || null;
  const base = def.root.position;
  const y0 = base.y + 0.3 * SIZE;
  const y1 = base.y + 2.15 * SIZE;
  // Bone centres sit inside the fist / foot shell: allow for its thickness.
  const reach = COMBAT.bodyRadius + (kind === 'kick' ? COMBAT.kickShell : COMBAT.fistShell);
  atk.model.updateWorldMatrix(true, true);
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
      _seg.set(base.x, Math.max(y0, Math.min(y1, p.y)), base.z);
      if (p.distanceTo(_seg) <= reach) hit = b;
    }
    if (last) last.copy(_bp); else prev.set(b, _bp.clone());
    if (hit) break;
  }
  return hit;
}
const _sw = new THREE.Vector3();
const _li = new THREE.Vector3();
// Is any striking bone (fist/forearm or foot/shin) inside the other robot's body capsule?
function limbInside(atk, def, kind) {
  if (DOWN_STATES.has(def.state)) return false;
  const bones = atk.strikeBones && atk.strikeBones[kind];
  if (!bones) return false;
  const base = def.root.position;
  const r = COMBAT.bodyRadius * 0.85 + (kind === 'kick' ? COMBAT.kickShell : COMBAT.fistShell) * 0.5;
  for (const b of bones) {
    b.getWorldPosition(_li);
    _seg.set(base.x, Math.max(base.y + 0.3 * SIZE, Math.min(base.y + 2.15 * SIZE, _li.y)), base.z);
    if (_li.distanceTo(_seg) < r) return true;
  }
  return false;
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

function applyHit(atk, def, spec, kind, strikeBone) {
  if (def.state === 'ko' || def.state === 'down' || def.state === 'getup' || def.invuln > 0) return;
  const blocked = def.blocking;
  const hit = pickHit(atk, def, kind || 'punch', toward);
  // Arm/leg wear (attackMods) times the fist/foot that landed: lost fingers or hand hit weaker.
  const mul = ((atk.atkMods && atk.atkMods.damageMul) || 1) * strikeMul(atk, kind || 'punch', strikeBone);
  const blockMul = blocked ? (1 - COMBAT.blockReduction * blockReductionMul(def)) : 1;
  const loc = LOC_MUL[hit.partId] || 1;
  const closing = impactVelocity(atk, def, hit.dir);
  const swing = (kind === 'kick' ? 3.4 : 2.4) * mul;
  const force = (closing + swing) * (blocked ? 0.45 : 1);
  const dmg = Math.max(1, Math.round(spec.damage * mul * blockMul * loc * (0.5 + 0.55 * (force / 5))));
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
    ko(def, atk, { dir: fwd, force });
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
      def.state = 'hit';
      def.stateT = 0;
      const clip = stumbleClip || pickHitClip(def, hit.partId);
      setAnim(def, clip, 0.12);
      const act = def.actions[clip];
      const clipDur = act ? act.getClip().duration / Math.max(0.2, act.timeScale || 1) : COMBAT.hitStun;
      const stun = (stumbleClip ? COMBAT.hitStunHeavy : COMBAT.hitStun) + (counter ? COMBAT.counterExtra : 0);
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
    let diff = Math.atan2(Math.sin(want - f.root.rotation.y), Math.cos(want - f.root.rotation.y));
    f.root.rotation.y += diff * Math.min(1, dt * 10);
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
  const dmg = Math.round((stomp ? g.stompDamage : g.poundDamage) * ((f.atkMods && f.atkMods.damageMul) || 1) * (LOC_MUL[t.part] || 1));
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
  if (def.health <= 0) ko(def, f, { dir: new THREE.Vector3(dir.x, 0, dir.z).normalize(), force: 3 });
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
  }  announce('knockdown', { delay: 0.35 });
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
  if ((settled && f.downLieT >= COMBAT.downRest) || f.stateT > COMBAT.downMax) beginGetUp(f);
}

// KO: a clip fall that stays down (the action clamps on its last frame).
const KO_FALLS = ['KnockedOut', 'StandingReactDeathBackward', 'KnockedDown'];
function koFall(f, dir, force) {
  const opts = KO_FALLS.filter((c) => f.actions[c]);
  // A leg torn off: the robot drops on the spot (KnockedDown folds forward onto the mat).
  const legGone = f.parts && ((f.parts.legL && f.parts.legL.detached) || (f.parts.legR && f.parts.legR.detached));
  const clip = legGone && f.actions.KnockedDown ? 'KnockedDown' : opts[Math.floor(Math.random() * opts.length)];
  f.hitPush = null;
  f.guardPush = null;
  f.downLying = false;
  f.flinch = null;
  setFighterMove(f, 0, 0);
  if (!clip) return;
  const act = setAnim(f, clip, 0.12);
  if (act) act.timeScale = clip === 'KnockedOut' ? 1.15 : 1.25;
  f.koClip = clip;
  f.landed = false;
}

function ko(loser, winner, info) {
  loser.health = 0;
  loser.state = 'ko';
  loser.blocking = false;
  loser.shield.visible = false;
  const dir = (info && info.dir) || new THREE.Vector3(winner.root.position.x - loser.root.position.x, 0, winner.root.position.z - loser.root.position.z).normalize();
  const force = (info && info.force) || 6;
  koFall(loser, dir, force);
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
    if (info && info.reason === 'head') sub.textContent = winner && winner.id === 'p1' ? "You took the opponent's head." : 'Your head was torn off.';
    else if (info && info.reason === 'legs') sub.textContent = 'A leg is gone. The fighter collapsed.';
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
    strikeRange: { punch: COMBAT.punch.reach, kick: COMBAT.kick.reach },
    self: {
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
    },
    opp: {
      health: opp.health,
      state: opp.state,
      stateT: opp.stateT,
      attacking: opp.state === 'punch' || opp.state === 'kick',
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
  if (intent.attack === 'ground') inp.ground = true;
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
  if (f.state === 'ko') { setFighterMove(f, 0, 0); return; }
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

  if (f.state === 'punch' || f.state === 'kick') {
    const spec = COMBAT[f.state];
    const action = f.actions[f.attackClip] || f.actions[f.state] || f.actions[resolveClip(f, f.state)];
    const tm = strikeTiming(f, action);
    const ct = action ? action.time : f.stateT; // clip playhead: windows stay right at any speed
    // A small step into the strike when just out of reach; it stops on contact and never
    // drives inside striking distance (that pushed fists through torsos).
    const gap = f.root.position.distanceTo(other.root.position);
    if (!f.atkContact && ct < tm.a0 && gap > (COMBAT.strikeGap || 1.2)) {
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
      applyHit(f, other, spec, f.state, contact.isBone || contact.type === 'Bone' ? contact : null);
    }
    // Solid bodies: whenever the striking limb is inside the other robot's body (any phase,
    // landed or not), the clip stops advancing there and the strike is pulled back.
    if (limbInside(f, other, f.state)) {
      if (!f.hitThisAttack && ct >= tm.a0 - 0.08 && ct <= tm.a1) {
        // Already in the body at the start of the window: that is the connect.
        f.hitThisAttack = true;
        applyHit(f, other, spec, f.state, null);
      }
      if (f.contactT < 0) f.contactT = f.stateT;
      if (action) action.timeScale = Math.min(action.timeScale, 0.08);
    } else if (f.contactT >= 0 && action) action.timeScale = Math.min(action.timeScale, 0.25);
    // The fist stops at the surface: after contact the strike is pulled back (blend to guard)
    // instead of playing on through the body.
    const pulled = f.contactT >= 0 && f.stateT - f.contactT > (COMBAT.contactHold || 0.1);
    const done = pulled || ct >= tm.end - 0.01 || (action && !action.isRunning());
    // The player can cancel the retraction into movement, guard or the next strike.
    const wantsOut = !f.isCpu && ct > tm.a1 && (inp.block || inp.punch || inp.kick
      || Math.abs(inp.sidestep) + Math.abs(inp.inout) > 0.3);
    if ((done || wantsOut) && (f.state === 'punch' || f.state === 'kick')) {
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
function stepLegs(f, speed, dt) {
  const act = locoActions(f).walkBack;
  if (!act) return;
  const clipV = clipWorldSpeed(f, 'WalkingBackwards') || 0.6;
  const target = speed > 0.03 ? Math.min(1.4, 0.5 + speed / clipV * 0.5) : 0;
  f._legW = (f._legW || 0) + (target - (f._legW || 0)) * Math.min(1, dt * 18);
  if (f._legW > 0.01) {
    if (!act.isRunning()) act.reset().play();
    act.enabled = true;
    act.setEffectiveWeight(f._legW);
    act.timeScale = Math.max(0.6, Math.min(2.6, speed / clipV));
    if (f._locoW) f._locoW.walkBack = Math.min(1, f._legW);
  } else if (act.isRunning() && f.state !== 'walk') {
    act.setEffectiveWeight(0);
    act.stop();
    f._legW = 0;
    if (f._locoW) f._locoW.walkBack = 0;
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

function updateCamera(dt) {
  const mode = match.over ? 'arena' : cameraMode();
  if (mode !== camModeLive) {
    camModeLive = mode;
    camera.near = mode === 'first' ? 0.04 : 0.1;
    camera.updateProjectionMatrix();
    dt = 0; // snap to the new view
  }
  setFirstPersonHide(mode === 'first');
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
  if (act) act.timeScale = act.getClip().duration / Math.max(0.6, COMBAT.getupTime || 1.25);
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

function resetMatch() {
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
    f.guardPush = null;
    f.hitPush = null;
    f.flinch = null;
    f.groundBow = 0;
    f.gN = 0;
    f.gKd = -1;
    f.contactT = -1;
    f.atkContact = false;
    // Fresh brain each round: nothing carries over from the last KO.
    if (f.brain && (f.brain.kind === 'paced' || f.brain.kind === 'api')) f.brain = null;
    resetFighterPhysics(f, f.startX, 0);
    f.atkMods = null;
    resetFighterDamage(f, scene);
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
  clearAllDebris(scene);
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
  const watch = !!shellCall('cpuControls', 'p1'); // Bot vs Bot: P1 is a CPU too
  p1.isCpu = watch;
  const pin = canAct ? (watch ? updateAI(p1, p2, dt) : consumeAttacks(rawInput(), dt)) : consumeAttacks({ sidestep: 0, inout: 0, punch: false, kick: false, block: false }, 1);
  const ain = canAct ? updateAI(p2, p1, dt) : { sidestep: 0, inout: 0, punch: false, kick: false, block: false };

  const p1Was = p1.state;
  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  // A buffered press is used up once the attack it asked for has started.
  if (held.buf && p1.state !== p1Was && (p1.state === 'punch' || p1.state === 'kick' || p1.state === 'ground')) held.buf = null;
  stepPhysics(dt);
  // A robot that is falling, lying or getting up has no standing capsule to push against:
  // the other can step over it to stomp, and nothing shoves the lying body around.
  for (const f of [p1, p2]) if (f.phys && f.phys.body) f.phys.body.collisionResponse = !DOWN_STATES.has(f.state);
  if (!DOWN_STATES.has(p1.state) && !DOWN_STATES.has(p2.state)) separate(p1, p2);
  faceEachOther(p1, p2, dt);
  for (const f of [p1, p2]) {
    updateBaseLayer(f);
    f.mixer.update(dt);
    f.root.position.y = 0;
    if (window.__rfDiag) diagFootStage(f, 0);
    poseAfterMixer(f, dt);
    if (window.__rfDiag) diagFootStage(f, 1);
    applyMalfunctions(f, dt);
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

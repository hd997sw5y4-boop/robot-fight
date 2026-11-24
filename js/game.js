import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader as RGBELoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { IS_MOBILE, IS_IOS } from './mobile.js';
import { SIZE, CAM_SIZE, MODEL, SKINS, ARENA, COMBAT, DAMAGE, GFX_PRESETS, LOOP_CLIPS, UNUSED_CLIPS, getFighterStats, CAGE_PAD, SPECIAL, MOVES, ROBOT_MOVES } from './config.js';
import { CLIP_SPEEDS } from './clip-speeds.js';
import { applyChrome, setChromeLow } from './chrome.js';
import { initJointLimits, applyJointLimits, fitJointLimits, hingeOf, hingeAngle, flexHinge } from './joints.js';
import { setWiresLow, setWireObstacles, wireWarmMaterials } from './wires.js';
import { createApiBrain, wantsApiBrain, initApiBrainUI, fighterApiCfg, apiLabel, apiStatsSnapshot, onApiDecision } from './api-brain.js';
import { memoryKey, isLearningOn, promptNotes, rememberApiFights } from './api-learn.js';
import { getSettings, isSettingsOpen, initSettings, updateFps, lastFps, cycleCameraMode, setCameraMode } from './settings.js';
import { startFight as logStartFight, endFight as logEndFight, abandonFight as logAbandonFight, logFps, logGlitch, logStrike, logRound, logCpuIdle, stepFightQuality, logFall, logGetUp, logAnimSwitch, logInputPress, logInputAction, noteFrameWork, wallDist, setFightApiStats, setFightLearning, logHeldRepeat, logBellBlock, logSpecial, hasOpenFight } from './fight-log.js';
import { broadcastMain, initBroadcast, updateBroadcast, xrPresenting } from './arena/broadcast.js';
import { unlockAudio, playSfx, playHit, setBuzz, startCrowd } from './audio.js';
import { announce, announceIntroSeconds } from './announcer.js';
import { buildArena as buildArenaVisual, addArenaLights, updateCageFade, addFloorReflection } from './arena.js';
import {
  initArenaPhysics,
  attachFighter,
  setFighterMove,
  stepPhysics,
  settleLooseDebris,
  impactVelocity,
  resetFighterPhysics,
  clearPhysicsDebris,
  onPhysicsBounce,
  setDebrisLow,
  setFighterDowned,
  getPhysicsDebris,
  detachFighter,
  cageSlideVelocity,
} from './physics.js';
import {
  registerFightRuntime,
  notifyFightEnd,
  defaultFighterConfig,
  AI_PERSONALITIES,
  onFightEnd,
} from './api.js';
import { createPacedBrain } from './brain.js';
import { bindSpecials, initSpecial, tryDash, tryCharge, trySlam, tryOverheat, stepSpecial, clearSpecial, specialAvail, syncEnergyHud, specialWarmObjects } from './specials.js';
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
  shedChips,
  damageFx,
  damageWarmMaterials,
} from './damage.js';

let prevCamMode = null;
const canvas = document.getElementById('c');
const keys = new Set();
const tapped = new Set();
const held = { punch: false, kick: false, ground: false, move: null, buf: null, bufT: 0 };

// [game-shell hook] Optional menus / rounds / ladder layer (js/shell/*.js). No-op when absent.
function shellCall(name, ...args) {
  const sh = window.RFShellHook;
  return sh && typeof sh[name] === 'function' ? sh[name](...args) : undefined;
}
// Lazy read handle for the shell (paint, stats, menu camera, pause via the clock). Getters only.
shellCall('onReady', {
  THREE,
  SIZE,
  ARENA,
  get camera() { return camera; },
  get clock() { return clock; },
  get match() { return match; },
  get p1() { return p1; },
  get p2() { return p2; },
  showSelectPreview,
  hideSelectPreview,
  previewSelectFighter,
  preloadSkin: loadSkin,
  memSnapshot() { return typeof window.__rfMem === 'function' ? window.__rfMem() : null; },
});

// Phones start on Low (no shadows, no floor mirror, light crowd, pixel ratio <= 1.5); the
// Settings switch still works there, with the mobile caps kept.
const normGfx = (k) => (k === 'low' || k === 'medium' ? k : 'high');
let gfxKey = normGfx(getSettings().gfx);
setChromeLow(gfxKey === "low");
setWiresLow(gfxKey === "low");
setDebrisLow(gfxKey === "low");

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !IS_IOS,
  powerPreference: IS_IOS ? 'low-power' : 'high-performance',
});
// WebGL context loss (iOS drops it under memory pressure or when the tab is backgrounded):
// keep the page alive and let the viewer tap to reload. Do not auto-reload on restore —
// that is a common iOS loop when the tab is already short on memory.
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  if (document.getElementById('rfGlLost')) return;
  const d = document.createElement('div');
  d.id = 'rfGlLost';
  d.innerHTML = '<div><b>Graphics paused</b><span>The browser reset the 3D view. Tap to reload.</span></div>';
  d.addEventListener('click', () => location.reload());
  document.body.appendChild(d);
}, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
// three r187 dropped PCFSoftShadowMap (it fell back to PCF with a console warning); PCF is the
// same filtered look, asked for directly.
renderer.shadowMap.type = THREE.PCFShadowMap;
// Reading shader logs after every link forces the browser to finish the compile right there
// (a stall on first use). Only checked when debugging (?debug in the URL).
renderer.debug.checkShaderErrors = /[?&]debug\b/.test(location.search);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020306);
scene.fog = new THREE.Fog(0x020306, 14, 34);

function clampFov(v) {
  return Math.max(45, Math.min(90, +v || 50));
}
let fovTarget = clampFov(getSettings().fov);
let fovLive = fovTarget;
const camera = new THREE.PerspectiveCamera(fovLive, 1, 0.1, 80);
camera.position.set(0, (ARENA.matTop || 0) + 3.2 * CAM_SIZE, 12.5 * CAM_SIZE);

// Bloom on High: visors, sparks, LED rings and light shafts. Multisampled target
// keeps anti-aliasing, which a plain composer would lose.
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType, samples: IS_MOBILE ? 0 : 4,
}));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.18, 0.35, 1.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let useBloom = false;

// Auto resolution: lower the render scale when frames run slow, raise it back when there is headroom.
const dyn = { scale: 1, acc: 0, n: 0, cooldown: 0 };
function gfxPreset() {
  const p = { ...GFX_PRESETS[gfxKey] };
  if (IS_IOS) {
    p.pixelCap = Math.min(p.pixelCap || 2, gfxKey === 'low' ? 1 : 1.5);
    p.shadows = false;
    p.shadowSize = 256;
    p.mirror = 0;
    return p;
  }
  if (IS_MOBILE) {
    p.pixelCap = gfxKey === 'low' ? 1 : (GFX_PRESETS.mobile.pixelCap || 1.25);
    p.shadowSize = Math.min(p.shadowSize, GFX_PRESETS.mobile.shadowSize);
  }
  return p;
}
function basePixelRatio() {
  return Math.min(window.devicePixelRatio || 1, gfxPreset().pixelCap);
}
function applyPixelRatio() {
  const pr = Math.max(0.5, basePixelRatio() * dyn.scale);
  renderer.setPixelRatio(pr);
  if (useBloom) composer.setPixelRatio(pr);
}
function stepDynamicRes(dt) {
  const min = gfxPreset().minScale || 0.6;
  // High floors at 1 (native sharpness). Don't lower the backbuffer on that preset.
  if (min >= 1) {
    if (dyn.scale !== 1) { dyn.scale = 1; applyPixelRatio(); resize(); }
    return;
  }
  if (dt <= 0) return;
  // Every change reallocates the drawing buffer (a hitch of its own), so it reacts to sustained
  // trends only: 2 s under 45 fps to step down, 4 s over 57 fps to step back up, 3 s apart.
  dyn.acc += dt; dyn.n += 1; dyn.cooldown -= dt;
  if (dyn.acc < 1) return;
  const fps = dyn.n / dyn.acc;
  dyn.acc = 0; dyn.n = 0;
  dyn.slow = fps < 45 ? (dyn.slow || 0) + 1 : 0;
  dyn.fast = fps > 57 ? (dyn.fast || 0) + 1 : 0;
  if (dyn.cooldown > 0) return;
  let next = dyn.scale;
  if (dyn.slow >= 2) next = Math.max(min, dyn.scale - 0.1);
  else if (dyn.fast >= 4 && dyn.scale < 1) next = Math.min(1, dyn.scale + 0.05);
  if (next !== dyn.scale) {
    dyn.scale = next;
    dyn.cooldown = 3;
    dyn.slow = 0; dyn.fast = 0;
    applyPixelRatio();
    resize();
  }
}
function renderFrame() {
  if (useBloom) composer.render();
  else renderer.render(scene, camera);
}

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
  orbit.touchedAt = performance.now();
}, { passive: false });

// Mouse orbit like Window Workshop 3D: drag (left or right button) to spin 360° and tilt;
// double-click to reset the view.
const orbit = { yaw: 0, pitch: 0.26, zoom: 1, drag: false, touchedAt: -1e9 };
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 2) return;
  orbit.drag = true;
  canvas.setPointerCapture?.(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!orbit.drag) return;
  orbit.yaw -= e.movementX * 0.0065;
  orbit.pitch = Math.max(0.02, Math.min(1.4, orbit.pitch + e.movementY * 0.005));
  orbit.touchedAt = performance.now();
});
const endDrag = (e) => { orbit.drag = false; canvas.releasePointerCapture?.(e.pointerId); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', () => { orbit.yaw = 0; orbit.pitch = 0.26; orbit.zoom = 1; orbit.touchedAt = performance.now(); });

const hitLight = new THREE.PointLight(0xffb44a, 0, 6);
hitLight.decay = 2;
hitLight.userData.baseIntensity = 0;
scene.add(hitLight);

const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
const darkBg = new THREE.Color(0x020306);
scene.environment = roomEnv;
scene.environmentIntensity = 0.62;

let hdriEnv = null;
let hdriBg = null;
let hdriLoading = null;
let hdriEnabled = !IS_MOBILE && !!getSettings().hdri; // 6.7 MB HDR + PMREM: too heavy for phones

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
  const on = hdriEnabled && !!hdriEnv;
  // HDRI (when on) is reflections only; the surround stays a dark, spotlit void.
  scene.environment = on ? hdriEnv : roomEnv;
  scene.environmentIntensity = on ? 1.2 : 0.62;
  scene.background = darkBg;
  scene.backgroundBlurriness = 0;
  scene.backgroundIntensity = 1;
  scene.fog = new THREE.Fog(0x020306, 14, 34);
  scene.traverse((o) => { if (o.userData && o.userData.voidWall) o.visible = true; });
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
if (hdriEnabled) loadHdri().then(() => syncEnvironment());

let lightMul = Math.max(0.5, Math.min(2, getSettings().light || 1));
const litLights = [];

let floorMirror = null;
// Floor mirror resolution per preset (Medium renders it at half size).
function setMirrorRes(m) {
  const w = (GFX_PRESETS[gfxKey] && GFX_PRESETS[gfxKey].mirror) || 1024;
  const u = m.material && m.material.uniforms;
  if (u && u.strength) u.strength.value = gfxKey === 'high' ? 0.52 : 0.38;
  const rt = m.getRenderTarget && m.getRenderTarget();
  if (!rt) return;
  const h = Math.round(w / Math.max(1, window.innerWidth / Math.max(1, window.innerHeight)));
  if (rt.width === w && rt.height === h) return;
  rt.setSize(w, h);
  const tx = u && u.texel;
  if (tx) tx.value.set(1 / w, 1 / h);
}
// Medium re-rendered all three shadow maps (two spots + the fill) over every caster each frame:
// three extra scene passes, most of Medium's ~840 draw calls a frame (Low ~190). The key spot
// still updates every frame; the other two take turns (30 Hz each), so two passes a frame.
// High keeps every map live.
let shadowLights = [];
let shadowTurn = 0;
function scheduleShadows() {
  if (gfxKey !== 'medium' || !renderer.shadowMap.enabled || shadowLights.length < 3) return;
  shadowTurn ^= 1;
  for (let i = 1; i < shadowLights.length; i++) {
    const sh = shadowLights[i].shadow;
    sh.autoUpdate = false;
    sh.needsUpdate = !sh.map || ((i + shadowTurn) & 1) === 0;
  }
}
function applyGfx(key) {
  gfxKey = normGfx(key);
  if (floorMirror) { floorMirror.visible = gfxKey !== 'low' && !IS_IOS; setMirrorRes(floorMirror); }
  setChromeLow(gfxKey === 'low');
  setWiresLow(gfxKey === 'low');
  setDebrisLow(gfxKey === 'low');
  const p = gfxPreset();
  useBloom = !!p.bloom;
  dyn.scale = 1;
  applyPixelRatio();
  renderer.toneMappingExposure = p.exposure * lightMul;
  renderer.shadowMap.enabled = p.shadows;
  shadowLights = [];
  scene.traverse((o) => {
    if (o.isLight && o.shadow) {
      o.castShadow = !!(p.shadows && o.userData.wantsShadow);
      if (o.castShadow) shadowLights.push(o);
      o.shadow.autoUpdate = true;
      o.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      if (o.shadow.map) {
        o.shadow.map.dispose();
        o.shadow.map = null;
      }
    }
  });
  applyLightIntensities();
  resize();
  if (fightersStaged) prewarmShaders(); // shadows on/off: every lit material gets a new shader
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
  if (useBloom) composer.setSize(w, h); // the bloom chain's targets exist only when it is used
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
  t.anisotropy = 16;
  return t;
}
const metalColor = loadTex('./textures/metal_color.jpg', THREE.SRGBColorSpace);
const metalRough = loadTex('./textures/metal_rough.jpg');

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

function wallOutward(x, z) {
  const a = ARENA.apothem || 6.1;
  const ax = a - Math.abs(x);
  const az = a - Math.abs(z);
  const diag = a * Math.SQRT2 - (Math.abs(x) + Math.abs(z));
  if (ax <= az && ax <= diag) return [x >= 0 ? 1 : -1, 0];
  if (az <= diag) return [0, z >= 0 ? 1 : -1];
  const nx = x >= 0 ? 1 : -1, nz = z >= 0 ? 1 : -1;
  const len = Math.hypot(nx, nz) || 1;
  return [nx / len, nz / len];
}

function atCageWall(f) {
  if (!f || !f.root) return false;
  return wallDist(f.root.position.x, f.root.position.z) < CAGE_PAD + 0.15;
}

function escapeInfo(f, opp) {
  const atWall = atCageWall(f);
  const tooClose = !!(f && opp && f.root.position.distanceTo(opp.root.position) < (COMBAT.separate || 1.1 * SIZE) + 0.06);
  const escape = { offWall: atWall, retreat: true, circle_left: true, circle_right: true };
  if (atWall && opp) {
    const [nx, nz] = wallOutward(f.root.position.x, f.root.position.z);
    const fx = opp.root.position.x - f.root.position.x;
    const fz = opp.root.position.z - f.root.position.z;
    const fl = Math.hypot(fx, fz) || 1;
    const retOut = (-fx / fl) * nx + (-fz / fl) * nz;
    escape.retreat = retOut <= 0.2;
  }
  return { atWall, tooClose, escape };
}

let bellRung = false;
function shellRoundOver() {
  const M = window.RFShell && window.RFShell.match;
  if (!M || !M.phase || (M.cfg && M.cfg.mode === 'training')) return false;
  return M.phase !== 'fight' && M.phase !== 'intro' && M.phase !== 'idle';
}
function inBell() {
  return !!(bellRung || match.over || shellRoundOver());
}
function ringBell(reason) {
  if (bellRung) return;
  bellRung = true;
  for (const f of [p1, p2]) {
    if (!f) continue;
    if (f.brain && f.brain.kind === 'api' && typeof f.brain.freeze === 'function') f.brain.freeze();
    f.blocking = false;
    if (f.shield) f.shield.visible = false;
  }
}
function clearBell() {
  bellRung = false;
  for (const f of [p1, p2]) {
    if (f && f.brain && f.brain.kind === 'api' && typeof f.brain.thaw === 'function') f.brain.thaw();
  }
}
function settleAfterBell(f) {
  if (!f || f.state === 'ko' || f.state === 'down' || f.state === 'getup') return;
  setFighterMove(f, 0, 0);
  f.hitPush = null;
  f.blocking = false;
  if (f.shield) f.shield.visible = false;
  const won = match.over && match.winner === f.id;
  if (won && typeof playVictory === 'function') {
    if (f.state !== 'idle' || (f.current && f.current !== 'Victory' && f.current !== 'VictoryIdle')) playVictory(f);
    return;
  }
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'hit' || f.state === 'dodge' || f.state === 'walk' || f.state === 'block') {
    f.state = 'idle';
    setAnim(f, idleClipFor(f), 0.22);
  }
}

let fighterGltf = null;
// Alternate bodies (config SKINS): loaded once, then each side keeps one built fighter per
// body so switching back and forth in fighter select does not rebuild anything.
const skinGltf = {};
const skinLoads = {};
const fighterCache = { p1: {}, p2: {} };
const pendingSkin = {};
function textureMaxDim() {
  if (IS_IOS) return 512;
  if (IS_MOBILE) return 1024;
  return 0;
}
function downscaleTexture(tex, maxDim) {
  if (!tex || !tex.image || !maxDim) return;
  const img = tex.image;
  const w = img.width || 0, h = img.height || 0;
  if (!w || !h || Math.max(w, h) <= maxDim) return;
  const scale = maxDim / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * scale));
  const nh = Math.max(1, Math.round(h * scale));
  const c = document.createElement('canvas');
  c.width = nw; c.height = nh;
  try { c.getContext('2d').drawImage(img, 0, 0, nw, nh); } catch (_) { return; }
  tex.image = c;
  if (tex.source) tex.source.data = c;
  tex.needsUpdate = true;
}
function downscaleGltfTextures(root, maxDim) {
  if (!root || !maxDim) return;
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const mat of [].concat(o.material || [])) {
      if (!mat) continue;
      for (const key of Object.keys(mat)) {
        const v = mat[key];
        if (v && v.isTexture && !seen.has(v)) { seen.add(v); downscaleTexture(v, maxDim); }
      }
    }
  });
}
function usedSkinIds() {
  const used = new Set();
  if (p1 && p1.skin) used.add(p1.skin);
  if (p2 && p2.skin) used.add(p2.skin);
  for (const side of ['p1', 'p2']) {
    const cfg = pendingSkin[side];
    if (cfg && cfg.skin) used.add(cfg.skin);
  }
  return used;
}
function disposeFighterInstance(f) {
  if (!f || f === p1 || f === p2) return;
  if (f.brain && f.brain.kind === 'api' && typeof f.brain.freeze === 'function') f.brain.freeze();
  f.brain = null;
  if (f.mixer) { try { f.mixer.stopAllAction(); } catch (_) {} }
  if (f.phys) detachFighter(f);
  if (f.root && f.root.parent) f.root.parent.remove(f.root);
  if (f.root) f.root.traverse((o) => {
    if (o.geometry && o.geometry.__rfOwn) o.geometry.dispose();
    for (const mat of [].concat(o.material || [])) if (mat) mat.dispose();
  });
}
function disposeSkinSource(id) {
  const g = skinGltf[id];
  if (!g) return;
  if (g.scene) {
    g.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      for (const mat of [].concat(o.material || [])) {
        if (!mat) continue;
        for (const v of Object.values(mat)) if (v && v.isTexture) v.dispose();
        mat.dispose();
      }
    });
  }
  delete skinGltf[id];
  delete skinLoads[id];
}
function disposeUnusedSkins() {
  const used = usedSkinIds();
  for (const side of ['p1', 'p2']) {
    const active = side === 'p1' ? p1 : p2;
    const activeKey = active ? (active.skin || 'robot') : null;
    for (const key of Object.keys(fighterCache[side])) {
      if (key === activeKey) continue;
      disposeFighterInstance(fighterCache[side][key]);
      delete fighterCache[side][key];
    }
  }
  for (const id of Object.keys(skinGltf)) if (!used.has(id)) disposeSkinSource(id);
}
const memPeak = { jsMB: 0, texMB: 0, texCount: 0, geometries: 0, skins: 0, at: 0 };
function memSnapshot() {
  const seen = new Set();
  let texBytes = 0;
  const visit = (root) => {
    if (!root) return;
    root.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of [].concat(o.material || [])) {
        if (!mat) continue;
        for (const v of Object.values(mat)) {
          if (!v || !v.isTexture || seen.has(v)) continue;
          seen.add(v);
          const img = v.image;
          const w = (img && (img.width || img.videoWidth)) || 0;
          const h = (img && (img.height || img.videoHeight)) || 0;
          texBytes += w * h * 4 * (v.generateMipmaps ? 1.33 : 1);
        }
      }
    });
  };
  visit(scene);
  if (fighterGltf && fighterGltf.scene) visit(fighterGltf.scene);
  for (const id of Object.keys(skinGltf)) if (skinGltf[id] && skinGltf[id].scene) visit(skinGltf[id].scene);
  for (const side of ['p1', 'p2']) for (const key of Object.keys(fighterCache[side])) {
    const f = fighterCache[side][key];
    if (f && f.root && (!f.root.parent || f.root.parent !== scene)) visit(f.root);
  }
  const js = (typeof performance !== 'undefined' && performance.memory)
    ? {
      usedMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      totalMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      limitMB: +(performance.memory.jsHeapSizeLimit / 1048576).toFixed(1),
    }
    : null;
  const snap = {
    js,
    renderer: renderer.info && renderer.info.memory ? { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } : null,
    skinsLoaded: Object.keys(skinGltf),
    cache: { p1: Object.keys(fighterCache.p1), p2: Object.keys(fighterCache.p2) },
    texCount: seen.size,
    texMB: +(texBytes / 1048576).toFixed(2),
    pixelRatio: renderer.getPixelRatio(),
    shadows: !!(renderer.shadowMap && renderer.shadowMap.enabled),
    ios: !!IS_IOS,
    mobile: !!IS_MOBILE,
    peak: { ...memPeak },
  };
  if (js && js.usedMB > memPeak.jsMB) memPeak.jsMB = js.usedMB;
  if (snap.texMB > memPeak.texMB) memPeak.texMB = snap.texMB;
  if (snap.texCount > memPeak.texCount) memPeak.texCount = snap.texCount;
  if (snap.renderer && snap.renderer.geometries > memPeak.geometries) memPeak.geometries = snap.renderer.geometries;
  if (snap.skinsLoaded.length > memPeak.skins) memPeak.skins = snap.skinsLoaded.length;
  memPeak.at = Date.now();
  snap.peak = { ...memPeak };
  return snap;
}
try { window.__rfMem = memSnapshot; } catch (_) {}

function loadSkin(id) {
  if (!SKINS[id]) return Promise.resolve(null);
  if (!skinLoads[id]) {
    skinLoads[id] = new GLTFLoader().loadAsync(SKINS[id].url).then((g) => {
      downscaleGltfTextures(g.scene, textureMaxDim());
      // Keep only body-specific clip takes (Ghoul's Victory / Taunt). Shared robot clips
      // are wired in fighterFor; carrying a second full Mixamo set bloated the heap.
      if (g.animations && g.animations.length) {
        const keep = new Set(['Victory', 'VictoryIdle', 'Taunt']);
        g.animations = g.animations.filter((c) => keep.has(c.name));
      }
      skinGltf[id] = g;
      window.dispatchEvent(new CustomEvent('rf-skin-ready', { detail: { id } }));
      for (const side of ['p1', 'p2']) {
        const cfg = pendingSkin[side];
        if (!cfg || cfg.skin !== id) continue;
        delete pendingSkin[side];
        if (previewMode) previewSelectFighter(side, cfg);
        else if (!fightersStaged || match.phase !== 'fight') swapSkin(side, id);
      }
      return g;
    }).catch((err) => { console.warn('[skin]', id, err); delete skinLoads[id]; return null; });
  }
  return skinLoads[id];
}
function fighterFor(side, skinId) {
  const key = skinId || 'robot';
  if (fighterCache[side][key]) return fighterCache[side][key];
  let src = fighterGltf;
  if (skinId) {
    prepFootworkClips(fighterGltf); // shared clips: prep once, on the robot's list
    // A body may bring its own take of a clip (same name, e.g. Ghoul's Victory / Taunt); it
    // replaces the shared one for that fighter only. Everything else plays the shared clips.
    const own = new Map((skinGltf[skinId].animations || []).map((c) => [c.name, c]));
    const anims = own.size ? fighterGltf.animations.map((c) => own.get(c.name) || c) : fighterGltf.animations;
    src = { scene: skinGltf[skinId].scene, animations: anims, __footworkPrepped: true };
  }
  const f = makeFighter(src, side === 'p1' ? MODEL.colors.p1 : MODEL.colors.p2, side, skinId || null);
  fighterCache[side][key] = f;
  return f;
}
// Put `skinId`'s body on a side (null = standard robot). Returns the side's fighter.
// A body that is still downloading keeps the current one and swaps in when it arrives.
function swapSkin(side, skinId, cfg) {
  const cur = side === 'p2' ? p2 : p1;
  const want = skinId && SKINS[skinId] ? skinId : null;
  if (!cur || (cur.skin || null) === want) return cur;
  if (want && !skinGltf[want]) {
    pendingSkin[side] = { ...(cfg || {}), skin: want };
    loadSkin(want);
    return cur;
  }
  const nf = fighterFor(side, want);
  const staged = !!cur.root.parent;
  const hadPhys = !!cur.phys;
  if (cur.brain && cur.brain.kind === 'api' && typeof cur.brain.freeze === 'function') cur.brain.freeze();
  cur.brain = null;
  if (hadPhys) detachFighter(cur);
  if (cur.root.parent) cur.root.parent.remove(cur.root);
  applyFighterConfig(nf, cur.config);
  nf.root.position.copy(cur.root.position);
  nf.root.rotation.copy(cur.root.rotation);
  nf.root.visible = cur.root.visible;
  if (nf.mixer && cur.mixer) nf.mixer.timeScale = cur.mixer.timeScale;
  if (side === 'p2') p2 = nf; else p1 = nf;
  if (staged) scene.add(nf.root);
  if (hadPhys) attachFighter(nf);
  warmedFor = null;
  if (staged) prewarmShaders();
  disposeUnusedSkins();
  return nf;
}
let arenaLoaded = false;
let fightersStaged = false;
let previewMode = null;
let selectPads = null;

function stageFighters(opts) {
  opts = opts || {};
  if (!fighterGltf) return;
  if (!p1 || !p2) {
    p1 = fighterFor('p1', null);
    p2 = fighterFor('p2', null);
    applyFighterConfig(p1, defaultFighterConfig('p1'));
    applyFighterConfig(p2, defaultFighterConfig('p2'));
  }
  if (!fightersStaged) {
    if (p1.mixer) p1.mixer.timeScale = 1;
    if (p2.mixer) p2.mixer.timeScale = 1;
    scene.add(p1.root, p2.root);
    if (opts.physics !== false) {
      if (!p1.phys) attachFighter(p1);
      if (!p2.phys) attachFighter(p2);
    }
    fightersStaged = true;
  } else if (opts.physics !== false) {
    if (p1 && !p1.phys) attachFighter(p1);
    if (p2 && !p2.phys) attachFighter(p2);
  }
  p1.root.visible = true;
  p2.root.visible = true;
  prewarmShaders();
}

function unstageFighters() {
  if (!p1 && !p2) return;
  clearBell();
  for (const f of [p1, p2]) {
    if (!f) continue;
    if (f.brain && f.brain.kind === 'api' && typeof f.brain.freeze === 'function') f.brain.freeze();
    f.brain = null;
    if (f.mixer) { f.mixer.stopAllAction(); f.mixer.timeScale = 0; }
    clearSpecial(f);
    detachFighter(f);
    if (f.root && f.root.parent) f.root.parent.remove(f.root);
  }
  fightersStaged = false;
  match.phase = 'idle';
  match.over = false;
  match.camLock = false;
  disposeUnusedSkins();
}


function applyStatProfile(f) {
  if (!f) return;
  const id = (f.config && f.config.profile) || f.id;
  f.stats = getFighterStats(id);
  f.stat = f.stats.mul;
  const tough = (f.stat && f.stat.toughness) || 1;
  const retune = (bag, specs) => {
    if (!bag || !specs) return;
    for (const [pid, part] of Object.entries(bag)) {
      const spec = specs[pid];
      if (!spec || part == null || spec.hp == null) continue;
      const max = Math.round(spec.hp * tough);
      const ratio = part.max > 0 ? part.hp / part.max : 1;
      part.max = max;
      if (previewMode || match.phase !== 'fight') part.hp = max;
      else part.hp = Math.max(0, Math.min(max, Math.round(max * ratio)));
    }
  };
  retune(f.parts, DAMAGE.parts);
  retune(f.subs, DAMAGE.sub);
}

function makeSelectPad(color, x) {
  const g = new THREE.Group();
  const low = gfxKey === 'low';
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72 * SIZE, 1.02 * SIZE, low ? 24 : 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  g.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.72 * SIZE, low ? 20 : 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.002;
  g.add(disc);
  g.position.set(x, matTopY() + 0.018, 0);
  g.userData.selectPad = true;
  return g;
}

function ensureSelectPads() {
  if (selectPads) return selectPads;
  const a = p1 && p1.startX != null ? p1.startX : -2.15 * SIZE;
  const b = p2 && p2.startX != null ? p2.startX : 2.15 * SIZE;
  selectPads = [makeSelectPad(0x3d8bff, a), makeSelectPad(0xff4040, b)];
  for (const p of selectPads) scene.add(p);
  return selectPads;
}

function removeSelectPads() {
  if (!selectPads) return;
  for (const p of selectPads) {
    if (p.parent) p.parent.remove(p);
    p.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  selectPads = null;
}

function paintPreviewFighter(f, cfg) {
  if (!f || !cfg) return f;
  const side = f.id;
  f = swapSkin(side, cfg.skin || null, cfg);
  applyFighterConfig(f, {
    ...f.config,
    name: cfg.name || (f.config && f.config.name),
    profile: cfg.profile || cfg.id,
    color: cfg.color != null ? cfg.color : f.config.color,
  });
  const shell = window.RFShell;
  if (shell && typeof shell.paint === 'function' && cfg.primary) {
    shell.paint(f, cfg.primary, cfg.accent || cfg.primary);
  }
  return f;
}

function poseSelectIdle(f, seed) {
  if (!f) return;
  f.state = 'idle';
  f.stateT = 0;
  if (f.mixer) { f.mixer.timeScale = 1; f.mixer.stopAllAction(); }
  f.current = null;
  const clip = (typeof idleClipFor === 'function') ? idleClipFor(f) : (MODEL.animations.idle || 'FightingIdle');
  setAnim(f, clip, 0.01);
  const act = f.actions[f.current];
  if (act) {
    const dur = act.getClip().duration;
    act.stopFading();
    act.setEffectiveWeight(1);
    act.play();
    act.time = ((seed || 0) * 0.73) % Math.max(0.1, dur);
  }
  if (f.mixer) f.mixer.update(0);
  if (typeof poseAfterMixer === 'function') poseAfterMixer(f);
}

function showSelectPreview(cfg) {
  cfg = cfg || {};
  if (!fighterGltf) return false;
  previewMode = 'select';
  match.phase = 'idle';
  match.over = false;
  match.camLock = true;
  const banner = document.getElementById('banner');
  if (banner) banner.classList.remove('show');
  stageFighters({ physics: false });
  if (!p1 || !p2) return false;
  ensureSelectPads();
  if (cfg.p1) paintPreviewFighter(p1, cfg.p1);
  if (cfg.p2) paintPreviewFighter(p2, cfg.p2);
  for (const f of [p1, p2]) {
    f.root.visible = true;
    f.root.position.set(f.startX, matTopY(), 0);
    f.root.scale.set(1, 1, 1);
    f.groundY = matTopY();
    if (f.shield) f.shield.visible = false;
  }
  poseSelectIdle(p1, 0.2);
  poseSelectIdle(p2, 1.1);
  faceEachOther(p1, p2, 0, true);
  return true;
}

function hideSelectPreview(opts) {
  opts = opts || {};
  removeSelectPads();
  const was = previewMode;
  previewMode = null;
  if (was && !opts.keepStaged) unstageFighters();
  else if (!opts.keepStaged) match.camLock = false;
  disposeUnusedSkins();
}

function previewSelectFighter(side, cfg) {
  const f = side === 'p2' ? p2 : p1;
  if (!f || !previewMode) {
    if (!showSelectPreview(side === 'p2' ? { p2: cfg } : { p1: cfg })) return;
  }
  const target = side === 'p2' ? p2 : p1;
  const nf = paintPreviewFighter(target, cfg || {});
  if (nf && nf !== target) { // new body: stand it on its pad in the guard idle
    nf.root.visible = true;
    nf.root.position.set(nf.startX, matTopY(), 0);
    nf.root.scale.set(1, 1, 1);
    nf.groundY = matTopY();
    if (nf.shield) nf.shield.visible = false;
    poseSelectIdle(nf, side === 'p2' ? 1.1 : 0.2);
  }
  if (p1 && p2) faceEachOther(p1, p2, 0, true);
}

function stepSelectPreview(dt) {
  if (p1 && p1.mixer) { p1.mixer.update(dt); if (typeof poseAfterMixer === 'function') poseAfterMixer(p1); }
  if (p2 && p2.mixer) { p2.mixer.update(dt); if (typeof poseAfterMixer === 'function') poseAfterMixer(p2); }
  if (selectPads) {
    const spin = dt * 0.45;
    selectPads[0].rotation.y += spin;
    selectPads[1].rotation.y -= spin;
  }
}

function collectWireObstacles() {
  if (gfxKey === 'low' || !p1 || !p2) { setWireObstacles([]); return; }
  const list = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (const f of [p1, p2]) {
    for (const c of bodyCaps(f)) {
      if (!c.a) continue;
      c.a.getWorldPosition(a);
      if (c.b) c.b.getWorldPosition(b);
      else b.copy(a).y += 0.22 * SIZE;
      list.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, r: c.r });
    }
  }
  setWireObstacles(list);
}

function findClip(clips, name) {
  const lower = name.toLowerCase();
  return clips.find((c) => c.name === name) || clips.find((c) => c.name.toLowerCase() === lower);
}

function tint(root, color, ownPaint) {
  const c = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = [].concat(o.material);
    o.material = mats.length === 1 ? mats[0].clone() : mats.map((m) => m.clone());
    if (!ownPaint) for (const m of [].concat(o.material)) applyChrome(o, m, c);
    for (const m of [].concat(o.material)) {
      if (m && m.color && !ownPaint) {
        if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
        m.color.copy(m.userData.baseColor).lerp(c, 0.42);
      }
      if (m) {
        m.envMapIntensity = 1.25;
        m.needsUpdate = true;
        for (const map of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) {
          if (map) map.anisotropy = IS_IOS ? 1 : (IS_MOBILE ? 4 : 16);
        }
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
  if (f.noPaint) return; // skins with their own textures keep them
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
  if (cfg && cfg.apiBrain) {
    const a = { ...cfg.apiBrain };
    delete a.key;
    f.config.apiBrain = a;
  } else if (f.config.apiBrain) delete f.config.apiBrain;
  if (f.config.color != null) retintFighter(f, f.config.color);
  if (cfg && (cfg.profile || cfg.profileId)) f.config.profile = cfg.profile || cfg.profileId;
  applyStatProfile(f);
  const el = document.getElementById(f.id === 'p1' ? 'n1' : 'n2');
  if (el) el.textContent = f.config.name;
}

// One Skeleton per robot. The GLB binds each of a robot's ~74 skinned parts to its own subset
// of the rig (51 skins), so every frame three.js recomputed and uploaded ~50 bone-matrix
// textures per robot and rebound a different one for nearly every draw, in the main, shadow and
// mirror passes alike. All parts now share one Skeleton over every bone: each part's skin
// indices are remapped to it and its bind matrix re-expressed against the shared bind inverses
// (bone world at load), which leaves boneInverse x bindMatrix, and so the skinning, unchanged.
// A part whose bind doesn't fit (it would have to move) keeps its own skeleton.
const _shX = new THREE.Matrix4();
const _shT = new THREE.Matrix4();
function shareSkeleton(model) {
  model.updateMatrixWorld(true);
  const meshes = [];
  model.traverse((m) => { if (m.isSkinnedMesh && m.skeleton && m.bindMode === 'attached' && m.geometry && m.geometry.attributes.skinIndex) meshes.push(m); });
  if (meshes.length < 2) return 0;
  const bones = [];
  const index = new Map();
  for (const m of meshes) for (const b of m.skeleton.bones) if (b && !index.has(b)) { index.set(b, bones.length); bones.push(b); }
  const inverses = bones.map((b) => b.matrixWorld.clone().invert());
  const shared = new THREE.Skeleton(bones, inverses);
  let n = 0;
  for (const m of meshes) {
    const sk = m.skeleton;
    let X = null, ok = true;
    for (let j = 0; j < sk.bones.length && ok; j++) {
      const b = sk.bones[j];
      if (!b || !sk.boneInverses[j]) { ok = false; break; }
      _shT.multiplyMatrices(b.matrixWorld, sk.boneInverses[j]).multiply(m.bindMatrix);
      if (!X) { X = _shX.copy(_shT); continue; }
      const a = _shT.elements, c = X.elements;
      for (let k = 0; k < 16; k++) if (Math.abs(a[k] - c[k]) > 1e-4 * (1 + Math.abs(c[k]))) { ok = false; break; }
    }
    if (!ok || !X) continue;
    const g = m.geometry.clone(); // the GLB's geometry is shared with the source scene and the other robot
    g.__rfOwn = true;
    const si = g.attributes.skinIndex;
    const out = new Uint16Array(si.count * 4);
    for (let i = 0; i < si.count; i++) {
      for (let c = 0; c < 4; c++) {
        const b = sk.bones[si.getComponent(i, c)];
        out[i * 4 + c] = b ? index.get(b) : 0;
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(out, 4));
    m.geometry = g;
    m.bindMatrix.copy(X);
    m.bindMatrixInverse.copy(X).invert();
    m.skeleton = shared;
    n++;
  }
  return n;
}

function makeFighter(gltf, color, side, skinId) {
  const skinDef = (skinId && SKINS[skinId]) || null;
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  shareSkeleton(model);
  const box = meshBox(model);
  const height = box ? box.getSize(new THREE.Vector3()).y : 0;
  const scale = height > 0.001 ? (MODEL.targetHeight / height) : (MODEL.scale || 1);
  model.scale.setScalar(scale);
  const box2 = meshBox(model);
  if (box2) model.position.y = -box2.min.y + MODEL.footOffset;
  tint(model, color, skinDef && skinDef.paint === false);
  // Tiny pieces (fingers, bolts) skip shadow casting; the large plates still shadow the mat.
  model.updateMatrixWorld(true);
  const _b = new THREE.Box3();
  const _sz = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    _b.setFromObject(o).getSize(_sz);
    if (Math.max(_sz.x, _sz.y, _sz.z) < 0.22) o.castShadow = false;
  });
  if (!skinDef || skinDef.visor !== false) addVisor(model, color);
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
    if (UNUSED_CLIPS.includes(clip.name)) continue;
    pruneOrphanTracks(clip, model);
    const act = mixer.clipAction(clip);
    const loop = LOOP_CLIPS.includes(clip.name);
    act.loop = loop ? THREE.LoopRepeat : THREE.LoopOnce;
    if (!loop) act.clampWhenFinished = true;
    actions[clip.name] = act;
  }
  for (const [key, val] of Object.entries(MODEL.animations)) {
    if (typeof val === 'string' && actions[val]) actions[key] = actions[val];
  }
  // Joint limits measure every bone from its bind rest. Save it before the idle poses the
  // bones: limits measured from FightingIdle frame 0 treated a ~20 deg bent knee as straight.
  model.traverse((o) => { if (o.isBone || o.type === 'Bone') { o.userData.restQ = o.quaternion.clone(); o.userData.restP = o.position.clone(); } });
  const startIdle = MODEL.animations.idle || 'FightingIdle';
  if (actions[startIdle]) actions[startIdle].play();
  mixer.update(0);
  const box3 = meshBox(model);
  if (box3) model.position.y = -box3.min.y + MODEL.footOffset;

  const startX = side === 'p1' ? -2.15 * SIZE : 2.15 * SIZE;
  root.position.set(startX, ARENA.matTop || 0, 0);

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
    hipsBindQ: hips ? hips.quaternion.clone() : null,
    config: defaultFighterConfig(side),
    modelScale: scale,
    skin: skinDef ? skinId : null,
    noPaint: !!(skinDef && skinDef.paint === false),
  };
  f.config.color = color;

  mixer.addEventListener('finished', () => {
    if (f.state === 'ko' || f.state === 'down' || f.state === 'getup') return;
    if (inBell() || match.over) { settleAfterBell(f); return; }
    if (f.health > 0 && (f.state === 'punch' || f.state === 'kick')) endAttack(f, 0.15);
    else if (f.health > 0 && f.state === 'hit') {
      f.hitPush = null;
      f.state = 'idle';
      setAnim(f, idleClipFor(f), 0.15);
    }
  });
  initJointLimits(f); // bind rest saved above, before the idle posed the bones
  fitJointLimits(f, gltf.animations);
  // Stat profile (js/config.js FIGHTER_PROFILES): Blue Striker / Red Bruiser by default; a shell
  // config may name another profile. f.stat holds the multipliers fight code applies.
  f.stats = getFighterStats((f.config && f.config.profile) || side);
  f.stat = f.stats.mul;
  initSpecial(f);
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
// Airborne clips (front flip dodge), measured once: when the whole body leaves the mat and
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
const PUNCH_RETURN = 0.72; // punches' pull-back (follow-through or rewind) speed vs the strike
const PUNCH_WINDOW_PAD = 0.04;
// A punch's step-in may travel this fast (x SIZE m/s) so a punch from normal range arrives with
// the fist; its share of the impact force stays capped (PUNCH_CLOSE_CAP) so it isn't a shove.
const PUNCH_STEP_V = 4.2;
const PUNCH_CLOSE_CAP = 1.3; // clip seconds added each side of a punch's measured hit window
const RETRACT_EASE = 0.09; // s: a landed strike eases into its pull-back instead of reversing in one frame
function measureStrikes(f) {
  const A = MODEL.animations;
  const moveClips = Object.values(MOVES);
  const kicks = new Set([...(A.kickVariants || []), ...(A.kickSpecial || []), ...(A.flipSpecial || []), A.kick,
    ...moveClips.filter((m) => m.kind === 'kick').map((m) => m.clip)]);
  const names = new Set([...(A.punchVariants || []), ...(A.punchRight || []), ...(A.punchLeft || []), A.punch, ...kicks,
    ...moveClips.map((m) => m.clip)]);
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
    // Wind-up: the strike is most pulled back (lowest reach) in the 0.45 s before the peak;
    // from there on the fist/foot drives out. Striking side: the bone furthest out at the peak.
    let iw = pk;
    for (let i = pk; i >= 0 && s[i].t >= s[pk].t - 0.45; i--) if (s[i].reach < s[iw].reach) iw = i;
    let hb = 0;
    for (let j = 1; j < bones.length; j++) if (s[pk].zs[j] > s[pk].zs[hb]) hb = j;
    const side = /^Left/.test(boneKey(bones[hb].name)) ? 'L' : 'R';
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
    out[name] = { kind, dur, start: startT, a0, a1, end, peak: s[pk].t, windup: s[iw].t, side, reach: +(s[pk].reach * 1).toFixed(3), vpk: +vpk.toFixed(2), gap0: +gap0.toFixed(3) };
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
  const top = matTopY() + 0.005; // above the mat decal
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
// Skinned-vertex sampling for grounding and contact shadows. three's getVertexPosition re-skins
// every sampled vertex with two 4x4 matrix products per bone influence; the game sampled ~1,800
// sole vertices several times a frame per robot and ~17,000 body vertices twice a frame while a
// robot was down (the 20+ ms knockdown frames in the fight log). Each sampled vertex now keeps
// its bind-space offset per influence (boneInverse x bindMatrix x v), so its world position is
// sum(w x boneWorld x offset): the same result for an attached bind, at a fraction of the cost.
// Rebuilt when the damage code rewrites positions or skin weights (attribute versions).
const _skinCache = new WeakMap();
const _skV = new THREE.Vector3();
const _skW = new THREE.Vector3();
function skinSample(mesh, idx) {
  const g = mesh.geometry;
  const a = g && g.attributes;
  const pos = a && a.position, si = a && a.skinIndex, sw = a && a.skinWeight;
  if (!mesh.isSkinnedMesh || !pos || !si || !sw || !mesh.skeleton || mesh.bindMode !== 'attached') return null;
  if (g.morphAttributes && g.morphAttributes.position && g.morphAttributes.position.length) return null;
  const ver = pos.version + ':' + si.version + ':' + sw.version;
  let c = _skinCache.get(idx);
  if (c && c.mesh === mesh && c.ver === ver && c.sk === mesh.skeleton && c.pos === pos && c.si === si && c.sw === sw) return c;
  const sk = mesh.skeleton;
  const n = idx.length;
  const start = new Uint32Array(n + 1);
  const bones = [];
  const L = [];
  for (let k = 0; k < n; k++) {
    start[k] = bones.length;
    const i = idx[k];
    _skV.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix);
    for (let j = 0; j < 4; j++) {
      const w = sw.getComponent(i, j);
      if (w === 0) continue;
      const bi = si.getComponent(i, j);
      const b = sk.bones[bi];
      if (!b || !sk.boneInverses[bi]) continue;
      _skW.copy(_skV).applyMatrix4(sk.boneInverses[bi]);
      bones.push(b);
      L.push(_skW.x, _skW.y, _skW.z, w);
    }
  }
  start[n] = bones.length;
  c = { mesh, ver, sk, pos, si, sw, start, bones, L: new Float64Array(L) };
  _skinCache.set(idx, c);
  return c;
}
function skinY(c, k) {
  const L = c.L;
  let y = 0;
  for (let j = c.start[k], e = c.start[k + 1]; j < e; j++) {
    const m = c.bones[j].matrixWorld.elements;
    const o = j * 4;
    y += L[o + 3] * (m[1] * L[o] + m[5] * L[o + 1] + m[9] * L[o + 2] + m[13]);
  }
  return y;
}
function skinXYZ(c, k, out) {
  const L = c.L;
  let x = 0, y = 0, z = 0;
  for (let j = c.start[k], e = c.start[k + 1]; j < e; j++) {
    const m = c.bones[j].matrixWorld.elements;
    const o = j * 4, w = L[o + 3], lx = L[o], ly = L[o + 1], lz = L[o + 2];
    x += w * (m[0] * lx + m[4] * ly + m[8] * lz + m[12]);
    y += w * (m[1] * lx + m[5] * ly + m[9] * lz + m[13]);
    z += w * (m[2] * lx + m[6] * ly + m[10] * lz + m[14]);
  }
  return out.set(x, y, z);
}
function soleLow(f, side) {
  const sv = f.soleVerts && f.soleVerts[side];
  if (!sv || !sv.length) return null;
  let best = null;
  for (const { mesh, idx } of sv) {
    if (!mesh.visible) continue;
    const hidden = mesh.userData.hiddenVerts;
    const c = skinSample(mesh, idx);
    for (let k = 0; k < idx.length; k += Math.max(1, Math.floor(idx.length / 12))) {
      const i = idx[k];
      if (hidden && hidden[i]) continue;
      if (c) skinXYZ(c, k, _sl);
      else { mesh.getVertexPosition(i, _sl); _sl.applyMatrix4(mesh.matrixWorld); }
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
  f.ikArms = { L: {}, R: {} };
  f.groundY = matTopY();
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
    if (n === 'LeftShoulder') f.ikArms.L.shoulder = o;
    if (n === 'LeftArm') f.ikArms.L.upper = o;
    if (n === 'LeftForeArm') f.ikArms.L.lower = o;
    if (n === 'LeftHand') f.ikArms.L.hand = o;
    if (n === 'RightShoulder') f.ikArms.R.shoulder = o;
    if (n === 'RightArm') f.ikArms.R.upper = o;
    if (n === 'RightForeArm') f.ikArms.R.lower = o;
    if (n === 'RightHand') f.ikArms.R.hand = o;
  });
  for (const side of ['L', 'R']) {
    const leg = f.ikLegs[side];
    if (leg && leg.foot) leg.foot.userData.bindQ = leg.foot.quaternion.clone();
    if (leg && leg.toe) leg.toe.userData.bindQ = leg.toe.quaternion.clone();
  }
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
      if (idx.length) { f.soleVerts[side].push({ mesh: m, idx }); skinSample(m, idx); }
    }
  });
}

const _footY = new THREE.Vector3();
const _ikA = new THREE.Vector3();
const _ikB = new THREE.Vector3();
const _ikC = new THREE.Vector3();
const _ikT = new THREE.Vector3();
const _ikQ = new THREE.Quaternion();
const _ikQ2 = new THREE.Quaternion();
const _ikD = new THREE.Vector3();
const _ikAxis = new THREE.Vector3();
const _ikWQ = new THREE.Quaternion();
const _ikPQ = new THREE.Quaternion();
const _ikWant = new THREE.Quaternion();

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
        const hidden = mesh.userData.hiddenVerts;
        const c = skinSample(mesh, idx);
        if (c) {
          for (let k = 0; k < idx.length; k++) {
            if (hidden && hidden[idx[k]]) continue; // torn-off foot / toes: not on the robot any more
            const y = skinY(c, k);
            if (y < minY) minY = y;
          }
          continue;
        }
        if (mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
        for (const i of idx) {
          if (hidden && hidden[i]) continue;
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
    skinSample(m, idx); // built at load, not on the first knockdown frame
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
    const vp = mesh.userData.vertPart;
    const c = skinSample(mesh, idx);
    if (c) {
      for (let k = 0; k < idx.length; k++) {
        if (vp && partCodeDetached(f, vp[idx[k]])) continue;
        const y = skinY(c, k);
        if (y < minY) minY = y;
      }
      continue;
    }
    if (mesh.bindMode === 'attached') mesh.bindMatrixInverse.copy(mesh.matrixWorld).invert();
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
  // Standing clips are grounded by the feet. If the hips come down near the feet (a stumble
  // or reaction that crouches toward a sit), the whole body is measured too, so the seat and
  // hands rest on the mat instead of sinking through it.
  let bodyCheck = onBody;
  if (!bodyCheck && f.hipsBone && minY != null) {
    f.hipsBone.getWorldPosition(_footY);
    bodyCheck = _footY.y - minY < 0.42 * SIZE;
  }
  if (bodyCheck) {
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
  footwork(f, top, dt, skipIK);

  // Per-frame clamp after IK; not stored, so it can't accumulate.
  minY = bodyCheck ? Math.min(lowestFootY(f) ?? Infinity, lowestBodyY(f) ?? Infinity) : lowestFootY(f);
  if (!Number.isFinite(minY)) minY = null;
  if (minY != null && minY < top - 0.0004) {
    const lift = top - minY;
    f.root.position.y += lift;
    if (lift > 0.03) logGlitch('sinking', { id: f.id, d: +lift.toFixed(3), state: f.state });
  }
  f._lowY = minY == null ? null : Math.max(minY, top); // lowest grounded point, for the log
}

// Planted feet. A foot the clip puts on the mat is held where it landed (knee hinge + thigh
// swing, rotations only, bones keep their length), so the root moving under it (walking,
// stumbling, being pushed, turning, stepping into a strike) can't skate it across the mat.
// The hold lets go into a short swing back to the clip foot when the clip lifts the foot, when
// it trails the clip foot too far or the leg can't reach it (a re-plant step with a small lift),
// or when the state leaves footwork. Strikes script the feet (strikeFootwork): the lead foot
// steps in with the body over the wind-up, the back foot stays planted with its heel coming up
// as the hips drive through, and follows after the hit.
const DEG = Math.PI / 180;
const FW_STATES = new Set(['idle', 'block', 'walk', 'hit', 'punch', 'kick', 'ground', 'dash']);
const FW_GROUND = 0.04;        // clip sole this close to the mat counts as planted
const FW_LOCK_MAX = 0.15 * SIZE; // furthest a planted foot may trail the clip foot
const FW_SNAP = 2 * SIZE;      // further than this (a round reset): drop the plant
const FW_SHOVE = 5 * SIZE;     // root faster than this (m/s) is a shove: planted feet go with it
const FW_SWING = 0.12;         // s: lifted by the clip, the foot swings back to it
const FW_RESTEP = 0.17;        // s: re-plant step
const FW_OUT = 0.08;           // s: hand-off to the clip when footwork turns off
const FW_LIFT = 0.07 * SIZE;   // re-plant / step-in foot lift
const FW_HEEL = 16 * DEG;      // back heel lift at full drive
const _fwA = new THREE.Vector3();
const _fwT = new THREE.Vector3();
const _fwK = new THREE.Vector3();
const _fwQ = new THREE.Quaternion();
const _fwQ2 = new THREE.Quaternion();
const _fwQ3 = new THREE.Quaternion();
const _fwUp = new THREE.Vector3(0, 1, 0);
const FW_SWING_V = 1.6 * SIZE; // m/s: a hand-off swing is never faster than this on average
const FW_SHUFFLE = 0.03 * SIZE; // a hand-off shorter than this may slide; longer ones step
const FW_UP = 0.2;              // share of a step spent lifting (and setting down) in place
function fwSwing(p, x, y, z, dur, lift, cx, cz) {
  const d = cx == null ? 0 : Math.hypot(x - cx, z - cz);
  // A hand-off with no lift dragged a planted sole across the mat (plantSlide): anything longer
  // than a shuffle is a small step instead.
  if (!(lift > 0) && d > FW_SHUFFLE) lift = Math.min(FW_LIFT * 0.6, 0.3 * d + 0.015 * SIZE);
  p.mode = 'swing'; p.fx = x; p.fz = z; p.t = 0; p.lift = lift;
  p.dur = cx == null ? dur : Math.max(dur, d / FW_SWING_V);
}
// Step timing: the foot comes up first, travels while it is clear of the mat, then sets down
// (horizontal progress runs over the middle of the step, height over all of it). An even
// blend moved the sole sideways while it was still touching the mat at both ends.
function fwTravel(u, lift) {
  if (!(lift > 0)) return u * u * (3 - 2 * u);
  const v = Math.max(0, Math.min(1, (u - FW_UP) / (1 - 2 * FW_UP)));
  return v * v * (3 - 2 * v);
}
function footwork(f, top, dt, off) {
  if (!f.ikLegs) return;
  const P = f.footPlant || (f.footPlant = { L: { mode: 'free', w: 0, heel: 0 }, R: { mode: 'free', w: 0, heel: 0 } });
  const step = Math.max(dt || 0, 1e-3);
  const striking = f.state === 'punch' || f.state === 'kick';
  const sw = striking && f.strikeWork && f.strikeWork.clip === f.attackClip ? f.strikeWork : null;
  // Kicks pivot and lift on the clip's own feet: only the step in before one is posed here.
  const on = !off && FW_STATES.has(f.state) && f.airLock == null && !f.airMove
    && (f.state !== 'kick' || (sw && sw.u < 1 && sw.S > 0));
  // A shove (or a separation push) faster than any step carries the planted feet along.
  const rp = f.root.position;
  const last = f._fwRoot || (f._fwRoot = { x: rp.x, z: rp.z });
  const rdx = rp.x - last.x, rdz = rp.z - last.z;
  last.x = rp.x; last.z = rp.z;
  // (Also a single hitch frame that jumps the body further than a step could cover.)
  const shove = Math.hypot(rdx, rdz) > Math.min(FW_SHOVE * step, 0.09 * SIZE);
  for (const side of ['L', 'R']) {
    const leg = f.ikLegs[side];
    const p = P[side];
    if (!leg || !leg.thigh || !leg.shin || !leg.foot) continue;
    const part = f.parts && f.parts[side === 'L' ? 'legL' : 'legR'];
    const sub = f.subs && f.subs[side === 'L' ? 'footL' : 'footR'];
    leg.foot.getWorldPosition(_ikC); // the clip's ankle
    let low = _ikC.y;
    if (leg.toe) { leg.toe.getWorldPosition(_ikT); low = Math.min(low, _ikT.y); }
    const grounded = low - top < FW_GROUND;
    const role = sw ? sw.role[side] : null;
    const ok = on && role !== 'free' && !(part && part.detached) && !(sub && sub.detached);
    if (shove) {
      if (p.ax != null) { p.ax += rdx; p.az += rdz; }
      if (p.fx != null) { p.fx += rdx; p.fz += rdz; }
      if (p.sx != null) { p.sx += rdx; p.sz += rdz; }
    }
    // Where the foot is shown now (last frame's result), for hand-offs.
    const shownX = p.mode === 'free' ? _ikC.x : (p.sx != null ? p.sx : _ikC.x);
    const shownZ = p.mode === 'free' ? _ikC.z : (p.sz != null ? p.sz : _ikC.z);
    if (p.mode !== 'free' && Math.hypot(shownX - _ikC.x, shownZ - _ikC.z) > FW_SNAP) p.mode = 'free';
    let maxLock = FW_LOCK_MAX;
    if (!ok) {
      if (p.mode === 'lock' || p.mode === 'lead') fwSwing(p, shownX, 0, shownZ, FW_OUT, 0, _ikC.x, _ikC.z);
    } else if (role === 'lead' && sw.u < 1) {
      if (p.mode !== 'lead') { p.mode = 'lead'; p.fx = shownX; p.fz = shownZ; }
    } else {
      // Step done (or the strike ended mid-step): land it on the clip foot.
      if (p.mode === 'lead') fwSwing(p, shownX, 0, shownZ, FW_SWING, 0, _ikC.x, _ikC.z);
      if (role === 'back') maxLock = FW_LOCK_MAX + sw.S;
      if (p.mode === 'free' && grounded) { p.mode = 'lock'; p.ax = _ikC.x; p.az = _ikC.z; }
      else if (p.mode === 'lock') {
        const d = Math.hypot(p.ax - _ikC.x, p.az - _ikC.z);
        if (!grounded) fwSwing(p, p.ax, 0, p.az, FW_SWING, 0, _ikC.x, _ikC.z);
        else if (role === 'back' && sw.follow && d > 0.05 * SIZE) fwSwing(p, p.ax, 0, p.az, 0.2, 0.5 * FW_LIFT, _ikC.x, _ikC.z);
        else if (d > maxLock || !legReaches(leg, p.ax, _ikC.y, p.az)) fwSwing(p, p.ax, 0, p.az, FW_RESTEP, FW_LIFT * Math.max(0.6, Math.min(1, d / FW_LOCK_MAX)), _ikC.x, _ikC.z);
      }
    }
    // Target for this frame.
    let tx = _ikC.x, ty = _ikC.y, tz = _ikC.z;
    if (p.mode === 'lock') { tx = p.ax; tz = p.az; }
    else if (p.mode === 'lead') {
      const u = Math.max(0, Math.min(1, sw.u));
      const e = fwTravel(u, 1);
      tx = p.fx + (_ikC.x - p.fx) * e;
      tz = p.fz + (_ikC.z - p.fz) * e;
      ty += Math.min(FW_LIFT * 1.3, 0.04 * SIZE + 0.25 * sw.S) * Math.sin(Math.PI * u);
    } else if (p.mode === 'swing') {
      p.t += step;
      const u = Math.min(1, p.t / Math.max(1e-3, p.dur));
      const e = fwTravel(u, p.lift);
      tx = p.fx + (_ikC.x - p.fx) * e;
      tz = p.fz + (_ikC.z - p.fz) * e;
      ty += p.lift * Math.sin(Math.PI * u);
      if (u >= 1) {
        if (ok && grounded) { p.mode = 'lock'; p.ax = _ikC.x; p.az = _ikC.z; } else p.mode = 'free';
      }
    }
    p.w = p.mode === 'free' ? 0 : 1;
    // Back heel: comes up off the mat (pivoting on the ball of the foot) as the hips drive.
    const heelWant = role === 'back' && p.mode === 'lock' && leg.toe ? (f._strikeDrive || 0) : 0;
    p.heel += (heelWant - p.heel) * Math.min(1, step * 14);
    if (p.heel < 0.01) p.heel = 0;
    p.sx = tx; p.sz = tz;
    const moved = Math.hypot(tx - _ikC.x, ty - _ikC.y, tz - _ikC.z);
    if (moved < 0.0015 && !(p.heel > 0)) continue;
    _fwA.set(tx, ty, tz);
    if (p.heel > 0) {
      // Rotate the ankle about the toe: the toe stays, the heel lifts.
      leg.toe.getWorldPosition(_fwT);
      _fwT.x += tx - _ikC.x; _fwT.z += tz - _ikC.z;
      _fwK.set(_fwT.x - tx, 0, _fwT.z - tz);
      if (_fwK.lengthSq() > 1e-8) {
        _fwK.normalize().negate().cross(_fwUp).normalize();
        _fwQ.setFromAxisAngle(_fwK, FW_HEEL * p.heel);
        _fwA.sub(_fwT).applyQuaternion(_fwQ).add(_fwT);
      } else _fwQ.identity();
    }
    reachFoot(f, leg, _fwA);
    if (p.heel > 0 && leg.shin) {
      // Pitch the foot about the ball and keep the toes flat on the mat.
      leg.toe.getWorldQuaternion(_fwQ3);
      leg.foot.getWorldQuaternion(_fwQ2);
      leg.shin.getWorldQuaternion(_ikQ2);
      _fwQ2.premultiply(_fwQ);
      leg.foot.quaternion.copy(_ikQ2.invert().multiply(_fwQ2));
      leg.toe.quaternion.copy(_fwQ2.invert().multiply(_fwQ3));
      leg.foot.updateMatrixWorld(true);
    }
  }
}
// Can the leg reach this ankle position (_ikC is the clip ankle)? Hip-to-ankle under ~98% of
// the leg's length, or no further than the clip's own pose already stretches it.
function legReaches(leg, x, y, z) {
  leg.thigh.getWorldPosition(_ikA);
  leg.shin.getWorldPosition(_ikB);
  const l = _ikA.distanceTo(_ikB) + _ikB.distanceTo(_ikC);
  const d = Math.hypot(x - _ikA.x, y - _ikA.y, z - _ikA.z);
  return d < l * 0.98 || d <= _ikA.distanceTo(_ikC) + 0.005;
}

// Move the ankle to target by flexing the knee on its fitted hinge (sets the hip-to-ankle
// distance) and turning the thigh by the shortest arc (sets the direction), then give the
// foot back its world orientation so the sole stays flat. The knee never leaves its hinge
// plane, so it cannot twist or bend backward.
function reachFoot(f, leg, target) {
  const knee = hingeOf(f, leg.shin);
  if (!knee) return;
  leg.thigh.getWorldPosition(_ikA);
  leg.shin.getWorldPosition(_ikB);
  leg.foot.getWorldPosition(_ikC);
  leg.foot.getWorldQuaternion(_ikWQ);
  const l1 = _ikA.distanceTo(_ikB);
  const l2 = _ikB.distanceTo(_ikC);
  if (l1 < 1e-4 || l2 < 1e-4) return;
  const reach = (d) => Math.acos(Math.max(-1, Math.min(1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))));
  const d1 = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(l1 + l2 - 1e-4, _ikA.distanceTo(target)));
  // The knee's inner angle grows as the leg straightens; flex is the opposite way.
  const th = hingeAngle(knee);
  const lo = Math.max(knee.lim.min, 2) * DEG;
  const hi = knee.lim.max * DEG;
  const dFlex = Math.max(lo - th, Math.min(hi - th, reach(_ikA.distanceTo(_ikC)) - reach(d1)));
  if (Math.abs(dFlex) > 1e-5) {
    flexHinge(knee, dFlex);
    leg.shin.updateMatrixWorld(true);
    leg.foot.getWorldPosition(_ikC);
  }
  _ikD.copy(_ikC).sub(_ikA).normalize();
  _ikAxis.copy(target).sub(_ikA).normalize();
  _ikQ.setFromUnitVectors(_ikD, _ikAxis);
  if (leg.thigh.parent) {
    leg.thigh.parent.getWorldQuaternion(_ikQ2);
    _ikQ.premultiply(_stPQ.copy(_ikQ2).invert()).multiply(_ikQ2);
  }
  if (!qOk(_ikQ)) return;
  leg.thigh.quaternion.premultiply(_ikQ);
  leg.thigh.updateMatrixWorld(true);
  leg.shin.getWorldQuaternion(_ikQ2);
  leg.foot.quaternion.copy(_ikQ2.invert().multiply(_ikWQ));
  leg.foot.updateMatrixWorld(true);
}

// Leg hand-off out of a get-up. When GettingUp ends (or cuts) while the legs are still in
// the floor pose, they used to snap to the guard in one frame; instead the last shown leg pose
// is held and eased into the live clip. The same ease covers any one-frame leg pop while
// getting up and just after.
const LEG_BLEND_T = 0.35;
const LEG_WATCH_T = 0.6;      // s after a get-up in which a pop is still caught
const LEG_POP_RATE = 900 * DEG; // per-second leg turn that counts as a pop (30 deg at 30 fps)
const _lbQ = new THREE.Quaternion();
function blendLegPose(f, dt) {
  if (!f._legBones) {
    f._legBones = [];
    for (const s of ['L', 'R']) {
      const l = f.ikLegs && f.ikLegs[s];
      if (l) for (const b of [l.thigh, l.shin, l.foot, l.toe]) if (b) f._legBones.push(b);
    }
  }
  const bones = f._legBones;
  if (!bones.length) return;
  const lb = f.legBlend || (f.legBlend = {
    prev: bones.map((b) => b.quaternion.clone()), from: bones.map(() => new THREE.Quaternion()),
    t: 0, dur: 0, st: f.state, watch: 0,
  });
  const getup = f.state === 'getup';
  const exited = lb.st === 'getup' && !getup;
  lb.watch = getup ? LEG_WATCH_T : Math.max(0, lb.watch - (dt || 0));
  let pop = false;
  if (!exited && lb.watch > 0 && !(lb.t < lb.dur)) {
    const lim = Math.max(30 * DEG, LEG_POP_RATE * (dt || 1 / 60));
    for (let i = 0; i < bones.length && !pop; i++) pop = lb.prev[i].angleTo(bones[i].quaternion) > lim;
  }
  if (exited || pop) {
    for (let i = 0; i < bones.length; i++) lb.from[i].copy(lb.prev[i]);
    lb.t = 0;
    lb.dur = LEG_BLEND_T;
  }
  if (lb.t < lb.dur) {
    lb.t += dt || 0;
    const u = Math.min(1, lb.t / lb.dur);
    const e = u * u * (3 - 2 * u);
    for (let i = 0; i < bones.length; i++) {
      _lbQ.copy(bones[i].quaternion);
      bones[i].quaternion.slerpQuaternions(lb.from[i], _lbQ, e);
    }
  }
  for (let i = 0; i < bones.length; i++) lb.prev[i].copy(bones[i].quaternion);
  lb.st = f.state;
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
  // Oneshot clips follow the same groups as MODEL.animations (punches/kicks/combos, blocks-dodges, taunts-special, ko, knockdowns-getups).
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
    || ['KnockedOut', 'GettingUp', 'KnockedDown', 'StandingReactDeathBackward', 'StumbleBackwards', 'LivershotKnockdown', 'HitOnLegs'].includes(clipName);
  // fadeIn/crossFadeTo multiply their 0→1 interpolant by this.weight, so the incoming
  // clip must be weight 1 or it stays invisible (idle base layer fills the gap, but
  // the attack still runs and can deal damage). The interpolant is what blends in.
  const fadeT = Math.max(0.15, Math.min(0.4, fade));
  if (f.current && f.current !== clipName) logAnimSwitch(f.id, f.current, clipName, fade);
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

// Player: tapping punch walks punchVariants in order (resets if the last one missed or the window closed).
const PUNCH_CHAIN_WINDOW = 1.1;
function nextPlayerPunch(f) {
  const chain = punchClipsFor(f);
  if (!chain.length) return { clip: null, chain: 0 };
  const now = performance.now() / 1000;
  const sinceLast = f.lastPunchAt != null ? now - f.lastPunchAt : 99;
  const idx = sinceLast < PUNCH_CHAIN_WINDOW && f.chainHit ? ((f.chain || 0) + 1) % chain.length : 0;
  return { clip: chain[idx] || chain[0], chain: idx };
}

function pickKick(f) {
  const basic = availableClips(f, MODEL.animations.kickVariants);
  const clip = pickClip(basic, MODEL.animations.kick, f.lastKick, f);
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

// Light hit reactions by zone and force: harder blows favour the bigger reaction of the zone.
const HIT_HARD = { head: 'HitOnSideOfHead', torso: 'BigStomachHit', armL: 'Stunned', armR: 'Stunned', legL: 'Stunned', legR: 'Stunned' };
function pickHitClip(f, partId, force = 0) {
  const map = MODEL.animations.hitByPart || {};
  const extra = ['Stunned', 'HitToBody', 'BigStomachHit', 'HeadHit', 'HitOnSideOfHead'];
  const list = availableClips(f, (map[partId] || map.torso || []).concat(extra));
  const hard = force >= 3 ? HIT_HARD[partId] || HIT_HARD.torso : null;
  const clip = pickClip(list, MODEL.animations.hit || 'Stunned', f.lastHit, f, (n) => {
    if (n === hard) return 6;
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
  // C: Broadcast view on/off (the TV director as the main camera).
  if ((e.key === 'c' || e.key === 'C') && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const cur = getSettings().cam;
    if (cur === 'broadcast') setCameraMode(prevCamMode && prevCamMode !== 'broadcast' ? prevCamMode : 'arena');
    else { prevCamMode = cur; setCameraMode('broadcast'); }
    return;
  }
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!e.repeat) tapped.add(k);
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
// Releasing keys while the tab is unfocused never fires keyup; clear to avoid stuck movement.
function clearStuckKeys() {
  keys.clear();
  tapped.clear();
  held.punch = held.kick = held.ground = held.flipFront = held.dashFwd = held.dashBack = false;
  held.move = null;
}
window.addEventListener('blur', clearStuckKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearStuckKeys(); });

// Solo keyboard keys for the named moves (e.key, lower case). Free of every other binding.
const SOLO_MOVE_KEYS = {
  u: 'uppercut', o: 'elbow', h: 'spin_backfist', n: 'knee', m: 'sweep_kick', ' ': 'flying_kick',
  z: 'shoulder_charge', g: 'ground_slam', f: 'overheat',
};
function rawInput() {
  const shellInp = shellCall('input', 'p1'); // [game-shell hook] versus keys / menu idle
  if (shellInp) return shellInp;
  const inp = { sidestep: 0, inout: 0, punch: false, kick: false, block: false };
  if (keys.has('a') || keys.has('arrowleft')) inp.sidestep -= 1;
  if (keys.has('d') || keys.has('arrowright')) inp.sidestep += 1;
  if (keys.has('w') || keys.has('arrowup')) inp.inout += 1;
  if (keys.has('s') || keys.has('arrowdown')) inp.inout -= 1;
  inp.tapPunch = tapped.has('j');
  inp.tapKick = tapped.has('k');
  inp.tapGround = tapped.has('i');
  inp.tapFlipFront = tapped.has('y');
  inp.tapDashFwd = tapped.has('e');
  inp.tapDashBack = tapped.has('x');
  inp.punch = keys.has('j') || inp.tapPunch;
  inp.kick = keys.has('k') || inp.tapKick;
  inp.block = keys.has('l');
  inp.ground = keys.has('i') || inp.tapGround;
  inp.run = keys.has('shift');
  inp.flipFront = keys.has('y') || inp.tapFlipFront; // (P is pause)
  inp.dashFwd = keys.has('e') || inp.tapDashFwd;
  inp.dashBack = keys.has('x') || inp.tapDashBack;
  // Named moves: one key each (see SOLO_MOVE_KEYS). A tap is never lost between frames.
  for (const k in SOLO_MOVE_KEYS) {
    if (tapped.has(k)) inp.tapMove = SOLO_MOVE_KEYS[k];
    if (keys.has(k) && !inp.move) inp.move = SOLO_MOVE_KEYS[k];
  }
  if (inp.tapMove) inp.move = inp.tapMove;

  // Gamepad 1: the shell's DualSense reader (same mapping as versus), merged with the keys.
  const gp = navigator.getGamepads?.()[0];
  const pad = gp && window.RFShell && window.RFShell.readPad ? window.RFShell.readPad(gp) : null;
  if (pad) {
    inp.sidestep += pad.sidestep;
    inp.inout += pad.inout;
    for (const k of ['punch', 'kick', 'block', 'ground', 'run', 'dashFwd', 'dashBack', 'flipFront']) if (pad[k]) inp[k] = true;
    if (pad.move && !inp.move) inp.move = pad.move;
  }
  inp.sidestep = Math.max(-1, Math.min(1, inp.sidestep));
  inp.inout = Math.max(-1, Math.min(1, inp.inout));
  return inp;
}

// Player attacks are edge-triggered and buffered for a moment: a press made while the robot
// is still finishing a strike or recovering fires as soon as it can, instead of being lost.
function consumeAttacks(inp, dt = 0) {
  const punch = (inp.punch && !held.punch) || !!inp.tapPunch;
  const kick = (inp.kick && !held.kick) || !!inp.tapKick;
  const ground = (!!inp.ground && !held.ground) || !!inp.tapGround;
  const flipFront = (!!inp.flipFront && !held.flipFront) || !!inp.tapFlipFront;
  const dashFwd = (!!inp.dashFwd && !held.dashFwd) || !!inp.tapDashFwd;
  const dashBack = (!!inp.dashBack && !held.dashBack) || !!inp.tapDashBack;
  held.punch = inp.punch;
  held.kick = inp.kick;
  held.ground = !!inp.ground;
  held.flipFront = !!inp.flipFront;
  held.dashFwd = !!inp.dashFwd;
  held.dashBack = !!inp.dashBack;
  const move = inp.tapMove || (inp.move && inp.move !== held.move ? inp.move : null);
  held.move = inp.move || null;
  if (move) { held.buf = 'move:' + move; held.bufT = COMBAT.inputBuffer || 0.3; logInputPress('p1', move); }
  else if (dashFwd) { held.buf = 'dashFwd'; held.bufT = COMBAT.inputBuffer || 0.3; logInputPress('p1', 'dash_forward'); }
  else if (dashBack) { held.buf = 'dashBack'; held.bufT = COMBAT.inputBuffer || 0.3; logInputPress('p1', 'dash_back'); }
  else if (flipFront) { held.buf = 'flipFront'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (ground) { held.buf = 'ground'; held.bufT = COMBAT.inputBuffer || 0.3; }
  else if (punch) { held.buf = 'punch'; held.bufT = COMBAT.inputBuffer || 0.3; logInputPress('p1', 'punch'); }
  else if (kick) { held.buf = 'kick'; held.bufT = COMBAT.inputBuffer || 0.3; logInputPress('p1', 'kick'); }
  else if (held.buf) {
    held.bufT -= dt;
    if (held.bufT <= 0) held.buf = null;
  }
  const b = held.buf;
  return {
    sidestep: inp.sidestep, inout: inp.inout, block: inp.block, run: !!inp.run,
    punch: b === 'punch', kick: b === 'kick', ground: b === 'ground',
    flipFront: b === 'flipFront',
    dashFwd: b === 'dashFwd', dashBack: b === 'dashBack',
    move: b && b.startsWith('move:') ? b.slice(5) : null,
  };
}

const _toward = new THREE.Vector3();
const _moveRight = new THREE.Vector3();
const _moveVel = new THREE.Vector3();
function toward(me, other, out = _toward) {
  out.set(
    other.root.position.x - me.root.position.x,
    0,
    other.root.position.z - me.root.position.z,
  );
  if (out.lengthSq() < 1e-6) return out.set(me.id === 'p1' ? 1 : -1, 0, 0);
  return out.normalize();
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
  const fwd = toward(f, other, _toward);
  _moveRight.set(-fwd.z, 0, fwd.x);
  const along = inout >= 0 ? speeds.fwd : speeds.back;
  _moveVel.set(0, 0, 0);
  _moveVel.addScaledVector(_moveRight, sidestep * speeds.strafe);
  _moveVel.addScaledVector(fwd, inout * along);
  setFighterMove(f, _moveVel.x, _moveVel.z);
  return Math.hypot(_moveVel.x, _moveVel.z);
}

// Spacing is normally kept by footwork (stepFighter backs a robot off with its walk when it is
// inside COMBAT.separate) and by the physics capsules. This is only an emergency un-overlap for
// rare deep interpenetration, so roots are never shoved around without animation.
const _sepA = new THREE.Vector3();
const _sepB = new THREE.Vector3();
function chestOf(f, out) {
  const c = bodyCaps(f).find((k) => k.part === 'torso' && k.b);
  if (!c) return out.copy(f.root.position);
  return c.b.getWorldPosition(out);
}
// Torso-to-torso gap in the ground plane (leaning strikes bring chests together long before
// the roots meet).
function chestGap(a, b) {
  chestOf(a, _sepA); chestOf(b, _sepB);
  return Math.hypot(_sepB.x - _sepA.x, _sepB.z - _sepA.z);
}
const CLIP_PUSH_MIN = 0.03 * SIZE; // push-out correction (m) past which the bodies are parted
function separate(a, b, dt = 0) {
  const dx = b.root.position.x - a.root.position.x;
  const dz = b.root.position.z - a.root.position.z;
  const d = Math.hypot(dx, dz);
  // Only deep overlaps: a hard root min, and chests that have actually interpenetrated.
  // Soft clinch spacing is handled by footwork (CPU back-off / API retreat), not a per-frame shove.
  const hard = (COMBAT.separateHard || 0.92 * SIZE) * 0.92;
  let push = d < hard ? (hard - d) / 2 : 0;
  const cg = chestGap(a, b);
  const striking = a.state === 'punch' || a.state === 'kick' || b.state === 'punch' || b.state === 'kick';
  const chestMin = striking ? 0.28 * SIZE : 0.36 * SIZE;
  if (cg < chestMin) push = Math.max(push, (chestMin - cg) / 2);
  // An arm or head the push-out could not fully clear last frame (limbPushout): part the bodies
  // by the leftover depth, at the same capped rate, so a strike never stays buried.
  const buried = Math.max(a._clipPush || 0, b._clipPush || 0);
  if (buried > 0) push = Math.max(push, buried / 2);
  const cap = 0.7 * Math.max(dt, 0) * SIZE;
  if (push > cap) push = cap;
  if (push > 0 && d > 1e-4) {
    const nx = dx / d;
    const nz = dz / d;
    for (const [f, sgn] of [[a, -1], [b, 1]]) {
      let px = sgn * nx * push, pz = sgn * nz * push;
      const slid = cageSlideVelocity(f.root.position.x, f.root.position.z, px, pz);
      f.root.position.x += slid[0];
      f.root.position.z += slid[1];
      placeInOctagon(f.root.position, CAGE_PAD, false);
      if (f.phys && f.phys.body) f.phys.body.position.set(f.root.position.x, matTopY(), f.root.position.z);
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
  if (dx * dx + dz * dz > (0.35 * SIZE) ** 2) {
    const raw = Math.atan2(dx, dz);
    if (f.faceWant == null) f.faceWant = raw;
    else {
      // Keep the target heading continuous so a ±π wrap cannot flip the turn mid-way.
      const d = Math.atan2(Math.sin(raw - f.faceWant), Math.cos(raw - f.faceWant));
      f.faceWant += d;
    }
  }
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
  // Keep the current turn direction at large headings so a ±π wrap cannot reverse mid-turn.
  if (Math.abs(diff) > Math.PI * 0.5) {
    const sign = f.turnSign || Math.sign(f.yawVel || 0);
    if (sign && Math.sign(diff) !== sign) diff += sign * 2 * Math.PI;
  }
  if (Math.abs(diff) > 0.2) f.turnSign = Math.sign(diff);
  else if (Math.abs(diff) < YAW_DEADZONE) f.turnSign = 0;
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

/** Built-in paced CPU brain only: never treat an API or Player side as CPU-driven. */
function usesCpuBrain(f) {
  return !!(f && f.isCpu && !(f.brain && f.brain.kind === 'api') && !wantsApiBrain(f.id, f));
}

function tryAttack(f, kind, clipName, exact = false, moveId = null) {
  if (inBell() || match.over) { logBellBlock(f.id, kind); return false; }
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash') return false;
  if (f.cooldown > 0) return false;
  if (kind === 'punch' && !canPunch(f)) return false;
  if (kind === 'kick' && !canKick(f)) return false;
  const mods = attackMods(f, kind);
  if (kind === 'punch' && !punchClipsFor(f).length) return false;
  const other = f === p1 ? p2 : p1;
  const clip = exact && clipName ? clipName : fitStrikeClip(f, kind, clipName
    || (kind === 'punch' ? pickPunch(f) : pickKick(f, true))
    || MODEL.animations[kind], other);
  if (usesCpuBrain(f) && other && STRIKE_T) {
    const tip = strikeTip(clip);
    const gap = f.root.position.distanceTo(other.root.position);
    const mvR = moveId && MOVES[moveId] ? moveReach(MOVES[moveId]) : null;
    const close = Math.min((kind === 'kick' ? COMBAT.kickStep : COMBAT.punchStep) || 0, 0.48 * SIZE);
    if (mvR != null ? mvR < gap - 0.06 : (tip != null && tip + close < gap - 0.06)) return false;
  }
  if (!f.isCpu) logInputAction(f.id, moveId || kind);
  const mv = moveId ? MOVES[moveId] : null;
  f.move = mv;
  f.moveId = mv ? moveId : null;
  if (kind === 'punch' && !f.isCpu && !mv) f.lastPunchAt = performance.now() / 1000;
  if (kind === 'punch') f.chainHit = false;
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
  // Short fade-in over the skipped lead-in so the swing is at full weight before contact.
  let fadeAtk = Math.max(0.16, Math.min(0.22, ((st0 && st0.gap0) || 0) / (6 * SIZE)));
  setAnim(f, clip, fadeAtk);
  setFighterMove(f, 0, 0); // no walking velocity carried into the strike
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
    let base = Math.min(speed * mods.timeScale * statOf(f, 'speed'), cap);
    // Normalize the played window (lead-in skipped) so punches and kicks feel equally snappy
    // (specials keep their longer wind-ups). Still under the limb-speed cap, so nothing teleports.
    if (st && !SPECIAL_STRIKES.has(clip)) {
      const budget = (kind === 'punch' ? 0.42 : 0.58) / ((mv && mv.slow) || 1);
      const played = (st.end - st.start) / Math.max(0.2, base);
      if (played > budget) base = Math.min(cap, base * played / budget);
    }
    action.timeScale = base;
    f.strikeBase = base;
    f.strikeCap = cap;
    // Start in the wind-up, not at the measured contact frame, so the strike reads.
    if (st) action.time = isPoppyClip(clip) ? Math.max(0, st.start - 0.12) : Math.max(0, st.start - 0.22);
    // Punches: a readable wind-up, a very fast drive and a calmer recovery (same time to contact).
    f.strikePlan = kind === 'punch' && st && !SPECIAL_STRIKES.has(clip) && !(mv && mv.spin)
      ? punchPlan(clip, st, action.time, base, cap, mods.timeScale * statOf(f, 'speed')) : null;
    if (f.strikePlan) { action.time = f.strikePlan.t0; action.timeScale = f.strikePlan.rW; }
  }
  const whooshRate = (f.strikePlan && f.strikePlan.rW) || (action && action.timeScale) || 1;
  playSfx('whoosh', { rate: whooshRate, vol: 0.4 + Math.min(0.3, Math.abs(whooshRate) * 0.2) });
  // Spinning / flying moves travel on their own airborne path (feet IK off while the body turns
  // or leaves the mat); the rest step in with the normal strike footwork.
  f.strikeWork = mv && (mv.spin || mv.hop) ? null : strikeFootwork(f, other, kind, clip);
  if (mv && (mv.spin || mv.hop) && action) startMoveAir(f, other, mv, action, clip);
  return true;
}

// Spinning backfist / flying kick: an airborne window from the wind-up to just after the hit,
// with travel toward the opponent (stops short of the body; physics capsules stop it too). The
// lift (flying kick) and the turn (spinning backfist) are posed in applyMoveFx.
function startMoveAir(f, other, mv, action, clip) {
  const tm = strikeTiming(f, action);
  const t0 = action.time;
  const pk = tm.peak != null ? tm.peak : tm.a0;
  const t1 = Math.min(tm.end, tm.a1 + 0.45 * Math.max(0.05, tm.end - tm.a1));
  const gap = chestGap(f, other);
  const dir = toward(f, other).clone();
  const dist = Math.max(0, Math.min(mv.lunge || 0, gap - STEP_GAP, ringRoom(f, dir, mv.lunge || 0)));
  f.airLock = 0; // feet follow the clip (no planted-foot IK) and the root stays on the mat
  f.airMove = { action, air: { t0, t1: mv.hop ? t1 : pk, end: tm.end }, dir, dist, moved: 0 };
  f.moveFx = { t0, pk, t1, spun: false };
}

// Named move (keys, pad, CPU or API brain): strikes go through tryAttack with their clip,
// robot moves are energy specials (specials.js).
function tryMove(f, other, id) {
  if (id === 'shoulder_charge') return tryCharge(f, other);
  if (id === 'ground_slam') return trySlam(f, other);
  if (id === 'overheat') return tryOverheat(f, other);
  const mv = MOVES[id];
  if (!mv || !f.actions[mv.clip]) return false;
  // Uppercut, elbow and backfist are right-hand clips; the knee, sweep and flying kick need
  // both legs (one to stand or jump on).
  if (mv.kind === 'punch' && f.parts && f.parts.armR && f.parts.armR.detached) return false;
  if (mv.kind === 'kick' && f.parts && (f.parts.legL.detached || f.parts.legR.detached)) return false;
  return tryAttack(f, mv.kind, mv.clip, true, id);
}
// Damage spec for the strike being played (a named move overrides the punch / kick defaults).
function attackSpec(f) {
  const base = COMBAT[f.state] || COMBAT.punch;
  return f.move && f.attackClip === f.move.clip ? { ...base, damage: f.move.damage, knock: f.move.knock || 0 } : base;
}

// Punch playback plan in clip seconds. A uniform speed-up hid the anticipation, so the clip
// is played in phases: the wind-up (the fist pulled back while the hips and shoulder load) near
// real time, the drive from there to full extension as fast as the limb-speed cap allows, and the
// recovery at whatever rate brings the clip to its end when the old uniform playback did.
// Time to the peak stays within ~12% of the old playback, so balance and the measured hit
// windows (clip time) are unchanged.
const WINDUP_RATE = 1.0;   // clip speed of the wind-up (x real time, damage / stats scale it)
const WINDUP_MAX = 0.2;    // clip seconds of wind-up shown before the drive
function punchPlan(clip, st, t0Old, base, cap, slow) {
  const pk = st.peak != null ? st.peak : st.a0;
  if (!(pk > t0Old + 0.06)) return null;
  // Old uniform playback, integrated: 0.95x early, 1.2x through the window, PUNCH_RETURN after.
  const oldRate = (t) => Math.min(cap, base * ((t - st.start) / Math.max(0.05, pk - st.start) < 0.3 ? 0.95 : (t <= st.a1 ? 1.2 : PUNCH_RETURN)));
  const wall = (a, b, rate) => { let T = 0; const n = 24; for (let i = 0; i < n; i++) { const t = a + (b - a) * (i + 0.5) / n; T += (b - a) / n / rate(t); } return T; };
  const Tpk = wall(t0Old, pk, oldRate);
  const Tend = wall(t0Old, st.end, oldRate);
  const tw = Math.max(t0Old + 0.02, Math.min(pk - 0.05, st.windup != null ? st.windup : t0Old + 0.6 * (pk - t0Old)));
  const t0 = Math.max(t0Old, tw - WINDUP_MAX);
  let rW = Math.min(cap, WINDUP_RATE * slow);
  const rS = Math.min(cap, Math.max(rW, (pk - tw) / Math.max(0.03, Tpk - (tw - t0) / rW)));
  const allow = Tpk * 1.12;
  if ((tw - t0) / rW + (pk - tw) / rS > allow) rW = Math.min(cap, (tw - t0) / Math.max(0.02, allow - (pk - tw) / rS));
  const rF = Math.max(rW, rS * 0.7); // through the rest of the hit window
  const Ta1 = (tw - t0) / rW + (pk - tw) / rS + Math.max(0, st.a1 - pk) / rF;
  const rR = Math.min(cap, Math.max(base * 0.5, Math.max(0, st.end - st.a1) / Math.max(0.05, Tend - Ta1)));
  return { clip, t0, tw, pk, a1: st.a1, end: st.end, rW, rS, rF, rR, side: st.side || 'R' };
}
function punchPlanRate(p, ct) {
  const k = 0.05; // eased ramps so the speed change reads as one fluid motion, not a snap
  if (ct < p.tw - k) return p.rW;
  if (ct < p.tw + k) return p.rW + (p.rS - p.rW) * (ct - p.tw + k) / (2 * k);
  if (ct < p.pk) return p.rS;
  if (ct < p.a1) return p.rF;
  return p.rR;
}

// Strike footwork, planned at the start of the attack. Out of reach, the robot steps in during
// the wind-up: the lead foot lifts and lands with the body while the back foot stays planted,
// then follows after the hit. Up close the feet just stay planted. (footwork() poses the feet.)
const STEP_GAP = 0.62 * SIZE; // a step in stops at this chest gap (the strike's own lean closes the rest)
// In-fighting moves (uppercut, elbow, knee) step in tighter: their fist / knee stays close to the body.
const stepGapOf = (f) => (f.move && f.move.stepGap) || STEP_GAP;
function strikeFootwork(f, other, kind, clip) {
  if (!other || !f.ikLegs || !f.ikLegs.L.foot || !f.ikLegs.R.foot) return null;
  const st = STRIKE_T && STRIKE_T[clip];
  const fwd = toward(f, other);
  const proj = (side) => { f.ikLegs[side].foot.getWorldPosition(_ikC); return _ikC.x * fwd.x + _ikC.z * fwd.z; };
  const lead = proj('L') >= proj('R') ? 'L' : 'R';
  const back = lead === 'L' ? 'R' : 'L';
  const max = (kind === 'kick' ? COMBAT.kickStep : COMBAT.punchStep) || 0;
  const S = Math.max(0, Math.min(max, chestGap(f, other) - stepGapOf(f)));
  const role = { L: null, R: null };
  let stepper = lead;
  if (kind === 'kick') {
    // The support leg steps; the kicking leg is the clip's.
    const kicker = (st && st.side) || back;
    stepper = kicker === 'L' ? 'R' : 'L';
    role[kicker] = 'free';
  } else role[back] = 'back';
  if (S > 0.06 * SIZE) role[stepper] = 'lead';
  return { clip, kind, S, u: S > 0.06 * SIZE ? 0 : 1, x0: f.root.position.x, z0: f.root.position.z, fx: fwd.x, fz: fwd.z, t0: null, stopped: false, follow: false, role };
}

// Jabs, straights (Punching / PunchCombo) and hooks get a peak arm-extension IK so the
// punching arm is almost fully straight and the fist actually reaches the longer punch range.
// Elbows and uppercuts stay the short in-fighting clips.
const PUNCH_EXTEND_CLIPS = new Set(['LeadJab', 'Punching', 'PunchCombo', 'RightHook']);
const PUNCH_AIM_CLIPS = new Set(['LeadJab', 'Punching', 'PunchCombo', 'RightHook', 'Uppercut', 'ElbowPunching']);

// Choose a strike whose measured reach fits the gap: the fist/foot should just reach the
// body surface (short elbows and uppercuts up close, jabs and long kicks from further out),
// so strikes neither whiff short nor bury themselves in the other robot's chest.
function strikeTip(name) {
  const st = STRIKE_T && STRIKE_T[name];
  if (!st) return null;
  // Jabs, straights and hooks get a little extra reach so the almost-straight arm IK
  // is accounted for when choosing a clip and gating the hit (elbows / uppercuts stay short).
  const extra = PUNCH_EXTEND_CLIPS.has(name) ? (name === 'RightHook' ? 0.18 : 0.30) * SIZE : 0;
  return Math.min(2.05 * SIZE, st.reach + extra) + COMBAT.bodyRadius;
}
function fitStrikeClip(f, kind, clip, other) {
  if (!STRIKE_T || !other) return clip;
  const gap = f.root.position.distanceTo(other.root.position);
  // Only credit a short step-in: the full step often stops once chests are close,
  // so assuming the whole punchStep made Punching / Uppercut look in range and then miss.
  const stepIn = Math.min((kind === 'kick' ? COMBAT.kickStep : COMBAT.punchStep) || 0, 0.48 * SIZE);
  const fits = (n) => {
    const tip = strikeTip(n);
    return tip != null && tip + stepIn >= gap - 0.02 && tip <= gap + 0.35;
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
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash') {
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
  const mv = f.move && f.attackClip === f.move.clip ? f.move : null;
  const base = (mv && mv.recover) || (COMBAT.recoverByClip && COMBAT.recoverByClip[f.attackClip]) || spec.recover || 0.25;
  const who = f.isCpu ? ((aiProfile(f).recoverMul) || COMBAT.cpuRecoverMul || 1) : (COMBAT.playerRecoverMul || 1);
  const rec = base * who * (f.hitThisAttack ? 1 : (COMBAT.whiffMul || 2)) * ((f.atkMods && f.atkMods.cooldownMul) || 1) * (!f.isCpu && f.chain > 0 ? 0.8 : 1);
  f.cooldown = Math.max(f.cooldown, rec / statOf(f, 'recovery'));
  // After 2–3 connected hits the attacker has to reset. Stops nonstop swinging.
  if ((f._hitCombo || 0) >= 3) {
    f.cooldown = Math.max(f.cooldown, f.isCpu ? 0.72 : 0.38);
    f._hitCombo = 0;
  }
  f.state = 'idle';
  f.atkContact = false;
  f.strikePlan = null;
  f.move = null;
  f.moveId = null;
  f.backOff = Math.max(f.backOff || 0, 0.4);
  endAir(f);
  if (!f.hitThisAttack && f.attackClip) logStrike(f.id, f.attackClip, 'miss', 0);
  setAnim(f, idleClipFor(f), isPoppyClip(f.attackClip) ? Math.max(fade, 0.28) : fade);
}

/* ---------- front flip dodge ---------- */
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
  f.moveFx = null;
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
  if (inBell() || match.over) { logBellBlock(f.id, 'dodge'); return false; }
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
  playSfx('whoosh', { rate: 1.05, vol: 0.55 });
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
const TIP_SHELL = { punch: 0.12, kick: 0.125 }; // bone centre to fist / foot surface (base size)
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
  const shell = kind === 'kick'
    ? Math.max((TIP_SHELL.kick || 0.125) * SIZE, COMBAT.kickShell || 0)
    : Math.max((TIP_SHELL.punch || 0.12) * SIZE, COMBAT.fistShell || 0);
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
      if (!qOk(_sq)) break;
      a.arm.quaternion.premultiply(_sq);
      a.arm.updateWorldMatrix(false, true);
    }
  }
}

// A procedural turn is applied only when it is a real rotation: a NaN (from a degenerate world
// matrix, e.g. under a torn-off part's zero scale) would otherwise poison the bone (nanBone).
const qOk = (q) => Number.isFinite(q.x + q.y + q.z + q.w);
const TORSO_PARTS = ['torso', 'head'];
function strikeSideName(f) {
  const bones = f.strikeBones && f.strikeBones[f.state];
  if (!bones || !bones.length) return null;
  const n = bones[0].name || '';
  if (/Left/i.test(n)) return 'Left';
  if (/Right/i.test(n)) return 'Right';
  return null;
}
function swingOutOfCapsule(f, bone, pts, target, parts, margin, deepOnly) {
  if (!bone || bone.scale.x < 0.01) return 0;
  let moved = 0;
  for (let pass = 0; pass < 2; pass++) {
    bone.getWorldPosition(_sa);
    let worst = null;
    for (const b of pts) {
      if (!b) continue;
      b.getWorldPosition(_sp);
      const pr = capsuleProbe(target, _sp, parts);
      if (pr.point && pr.d < margin && (!worst || pr.d < worst.d)) worst = { d: pr.d, p: _sp.clone() };
    }
    if (!worst) break;
    if (deepOnly && worst.d > -0.08 * SIZE) break;
    const pr = capsuleProbe(target, worst.p, parts);
    const n = worst.p.clone().sub(pr.point);
    if (pr.d < 0 || n.lengthSq() < 1e-6) n.copy(worst.p).sub(target.root.position).setY(0);
    if (n.lengthSq() < 1e-8) break;
    n.normalize();
    const lever = worst.p.clone().sub(_sa);
    const len = Math.max(0.1, lever.length());
    const axis = lever.cross(n);
    if (axis.lengthSq() < 1e-8) break;
    axis.normalize();
    const ang = Math.min(0.45, (margin - worst.d) / len);
    if (!bone.parent) break;
    bone.parent.getWorldQuaternion(_sqp);
    axis.applyQuaternion(_sqp.invert());
    _sq.setFromAxisAngle(axis, ang);
    if (!qOk(_sq)) break; // a torn-off parent's zero scale makes its world rotation NaN
    bone.quaternion.premultiply(_sq);
    bone.updateWorldMatrix(false, true);
    moved = Math.max(moved, margin - worst.d);
  }
  return moved;
}
function limbPushout(f, other) {
  if (f) f._clipOther = 0;
  if (!f || f.ghost) return 0;
  if (!f._armBones) {
    const by = {};
    f.model.traverse((o) => { if (o.isBone || o.type === 'Bone') by[String(o.name).replace(/^mixamorig[:._]*/i, '')] = o; });
    f._armBones = ['Left', 'Right'].map((s) => ({ side: s, arm: by[s + 'Arm'], pts: [by[s + 'ForeArm'], by[s + 'Hand']] })).filter((a) => a.arm && a.pts[0] && a.pts[1]);
  }
  const punching = (f.state === 'punch' || f.state === 'kick') && f.contactT < 0 && !f.hitThisAttack;
  const strikeSide = punching ? strikeSideName(f) : null;
  f.model.updateWorldMatrix(true, true);
  if (other && !other.ghost) other.model.updateWorldMatrix(true, true);
  const margin = 0.025 * SIZE;
  let clipAmt = 0;
  // Depth left in the OTHER body by an arm that isn't the strike still on its way in (or by the
  // head): only that parts the bodies (separate). An arm folded into its own torso (guard pose,
  // damage bends) or a fist arriving at its target must never shove the fighters apart.
  let otherAmt = 0;
  for (const a of f._armBones) {
    const deepOnly = !!(punching && strikeSide && a.side === strikeSide);
    if (other && !other.ghost) {
      const d = swingOutOfCapsule(f, a.arm, a.pts, other, TORSO_PARTS, margin, deepOnly);
      clipAmt = Math.max(clipAmt, d);
      if (!deepOnly) otherAmt = Math.max(otherAmt, d);
    }
    clipAmt = Math.max(clipAmt, swingOutOfCapsule(f, a.arm, a.pts, f, ['torso'], margin, deepOnly));
  }
  const head = f.flinchBones && f.flinchBones.Head;
  const neck = f.flinchBones && f.flinchBones.Neck;
  if (head && neck && other && !other.ghost) {
    head.getWorldPosition(_sp);
    const pr = capsuleProbe(other, _sp, TORSO_PARTS);
    if (pr.point && pr.d < margin) {
      neck.getWorldPosition(_sa);
      const n = _sp.clone().sub(pr.point);
      if (pr.d < 0 || n.lengthSq() < 1e-6) n.copy(_sp).sub(other.root.position).setY(0);
      if (n.lengthSq() > 1e-8) {
        n.normalize();
        const lever = _sp.clone().sub(_sa);
        const len = Math.max(0.08, lever.length());
        const axis = lever.cross(n);
        if (axis.lengthSq() > 1e-8 && neck.parent) {
          axis.normalize();
          neck.parent.getWorldQuaternion(_sqp);
          axis.applyQuaternion(_sqp.invert());
          _sq.setFromAxisAngle(axis, Math.min(0.4, (margin - pr.d) / len));
          if (qOk(_sq)) neck.quaternion.premultiply(_sq);
          neck.updateWorldMatrix(false, true);
          clipAmt = Math.max(clipAmt, margin - pr.d);
          otherAmt = Math.max(otherAmt, margin - pr.d);
        }
      }
    }
  }
  f._clipOther = otherAmt;
  return clipAmt;
}

function clampRootMotion(f, dt) {
  if (!f || !f.root) return;
  const pos = f.root.position;
  if (!f._prevRoot || f._rootWarp) {
    f._prevRoot = pos.clone();
    f._rootWarp = false;
    return;
  }
  if (!(dt > 1e-4)) { f._prevRoot.set(pos.x, pos.y, pos.z); return; }
  const dx = pos.x - f._prevRoot.x;
  const dz = pos.z - f._prevRoot.z;
  const speed = Math.hypot(dx, dz) / dt;
  const air = f.airLock != null || f.state === 'dodge' || f.state === 'dash';
  const cap = (air ? 11 : 6.8) * SIZE;
  if (speed > cap) {
    const s = cap / speed;
    pos.x = f._prevRoot.x + dx * s;
    pos.z = f._prevRoot.z + dz * s;
    if (f.phys && f.phys.body) {
      f.phys.body.position.x = pos.x;
      f.phys.body.position.z = pos.z;
      f.phys.body.velocity.x *= s;
      f.phys.body.velocity.z *= s;
    }
    if (speed > 10) logGlitch('teleport', { id: f.id, v: +speed.toFixed(2), clip: f.current });
  }
  f._prevRoot.set(pos.x, pos.y, pos.z);
}

function hookFightLogShell() {
  const S = window.RFShell;
  if (!S || S.__fightLogHooked) return;
  S.__fightLogHooked = true;
  const labelsFor = () => {
    const mode = (S.state && S.state.mode) || 'fight';
    const lab = { p1: 'Player', p2: 'CPU' };
    if (mode === 'watch') { lab.p1 = 'CPU'; lab.p2 = 'CPU'; }
    else if (mode === 'versus') { lab.p1 = 'Player'; lab.p2 = 'Player'; }
    else if (mode === 'training') { lab.p1 = 'Player'; lab.p2 = 'CPU'; }
    if (mode === 'tournament') { lab.p1 = 'API'; lab.p2 = 'API'; }
    if (p1 && wantsApiBrain(p1.id, p1)) lab.p1 = apiLabel(fighterApiCfg(p1));
    if (p2 && wantsApiBrain(p2.id, p2)) lab.p2 = apiLabel(fighterApiCfg(p2));
    return lab;
  };
  const apiStatsFor = () => {
    const apiStats = {};
    if (p1 && p1.brain && p1.brain.kind === 'api') apiStats.p1 = apiStatsSnapshot(p1.brain);
    if (p2 && p2.brain && p2.brain.kind === 'api') apiStats.p2 = apiStatsSnapshot(p2.brain);
    return Object.keys(apiStats).length ? apiStats : null;
  };
  const winnerOf = (M, w) => {
    if (w === 0 || w === 1) return w === 0 ? 'p1' : 'p2';
    if (w == null && M) {
      if (M.wins && M.wins[0] !== M.wins[1]) return M.wins[0] > M.wins[1] ? 'p1' : 'p2';
      const d0 = M.total && M.total[0] && M.total[0].damage;
      const d1 = M.total && M.total[1] && M.total[1].damage;
      if (d0 != null && d1 != null && Math.abs(d0 - d1) >= 1) return d0 > d1 ? 'p1' : 'p2';
    }
    if (w == null) return 'draw';
    return w === 0 ? 'p1' : 'p2';
  };
  const closeLoggedFight = (w, ended) => {
    if (!hasOpenFight()) return null;
    const M = S.match;
    const rounds = M && M.rounds;
    const last = rounds && rounds[rounds.length - 1];
    const method = last ? last.method : (w == null ? 'Decision' : 'KO');
    const done = logEndFight({
      winner: winnerOf(M, w),
      method,
      p1, p2,
      labels: labelsFor(),
      apiStats: apiStatsFor(),
      ended: ended || 'complete',
    });
    try { rememberApiFights(done, p1, p2); } catch (e) { console.warn('[fight-log]', e); }
    return done;
  };
  const matchOver = (M) => {
    if (!M || (M.cfg && M.cfg.mode === 'training')) return false;
    const best = M.bestOf || 1;
    const need = Math.ceil(best / 2);
    return (M.wins && (M.wins[0] >= need || M.wins[1] >= need)) || M.round >= best;
  };
  S.on('roundBegin', (n) => {
    if (n === 1) {
      logStartFight({ p1, p2, mode: (S.state && S.state.mode) || 'fight', labels: labelsFor() });
      try { setFightLearning(learningForSides()); } catch (e) { console.warn('[fight-log]', e); }
    }
  });
  S.on('roundEnd', (r) => {
    ringBell('round');
    logRound(r);
    const M = S.match;
    if (matchOver(M)) closeLoggedFight(M && M.winner, 'complete');
  });
  S.on('matchEnd', (w) => { closeLoggedFight(w, 'complete'); });
  onApiDecision((rec) => {
    if (rec && rec.held) logHeldRepeat(rec.id, { action: rec.heldAction || rec.action, reason: rec.heldReason || rec.kind || 'no_answer' });
  });
  if (typeof S.abortMatch === 'function' && !S.__fightLogAbortHooked) {
    S.__fightLogAbortHooked = true;
    const prev = S.abortMatch;
    S.abortMatch = (...args) => {
      try {
        const M = S.match;
        if (hasOpenFight()) {
          if (M && M.phase === 'match-end') closeLoggedFight(M.winner, 'complete');
          else {
            const done = logAbandonFight('quit');
            try { rememberApiFights(done, p1, p2); } catch (e) { console.warn('[fight-log]', e); }
          }
        }
      } catch (e) { console.warn('[fight-log]', e); }
      const ret = prev.apply(S, args);
      try { unstageFighters(); } catch (e) { console.warn('[unstage]', e); }
      return ret;
    };
  }
}

function learningForSides() {
  const one = (f, fallback) => {
    if (!f) return null;
    const api = wantsApiBrain(f.id, f) || (f.brain && f.brain.kind === 'api') || (f.config && f.config.apiBrain);
    if (!api) return null;
    const c = fighterApiCfg(f);
    const name = (f.config && f.config.name) || f.id || fallback;
    const memKey = memoryKey(name, c.provider, c.model);
    const on = isLearningOn(memKey);
    return { on, memKey, note: on ? promptNotes(memKey) : '' };
  };
  return { p1: one(p1, 'P1'), p2: one(p2, 'P2') };
}

function isPoppyClip(clip) {
  if (!clip || /Flip|Dodge|GettingUp|Knocked/i.test(clip)) return false;
  return /Uppercut|ElbowPunching|PunchCombo|LegSweep|Kick/i.test(clip);
}

function pruneOrphanTracks(clip, root) {
  if (!clip || !clip.tracks || !root) return;
  const names = new Set();
  const add = (n) => { if (n) names.add(n); };
  root.traverse((o) => {
    add(o.name);
    if (o.isSkinnedMesh && o.skeleton) for (const b of o.skeleton.bones) add(b && b.name);
  });
  const nodeName = (tr) => {
    const raw = String(tr.name || '');
    if (THREE.PropertyBinding && THREE.PropertyBinding.parseTrackName) {
      try {
        const p = THREE.PropertyBinding.parseTrackName(raw);
        if (p && p.nodeName) return p.nodeName;
      } catch (_) {}
    }
    const parts = raw.split('.');
    if (parts.length >= 2 && /^(quaternion|position|scale)$/i.test(parts[parts.length - 1])) {
      return parts.slice(0, -1).join('.');
    }
    return parts[0];
  };
  const kept = clip.tracks.filter((tr) => names.has(nodeName(tr)));
  if (kept.length !== clip.tracks.length) clip.tracks = kept;
}

// Procedural flinch: a damped spring that snaps the spine/neck/head away from the blow and
// back, layered on top of whatever clip is playing, so every connect visibly lands.
const FLINCH_W = {
  head: { Spine: 0.16, Spine1: 0.28, Spine2: 0.42, Neck: 0.78, Head: 1.0 },
  torso: { Spine: 0.62, Spine1: 0.7, Spine2: 0.58, Neck: 0.36, Head: 0.28, LeftShoulder: 0.22, RightShoulder: 0.22 },
  arm: { Spine: 0.28, Spine1: 0.38, Spine2: 0.52, Neck: 0.22, Head: 0.2, LeftShoulder: 0.3, RightShoulder: 0.3 },
  leg: { Spine: 0.5, Spine1: 0.32, Spine2: 0.2, Neck: 0.1, Head: 0.1 },
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
  const rise = 0.028;
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
    captureRawBone(f, bone);
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
  if (inBell() || match.over) { logBellBlock(atk && atk.id, kind || 'hit'); return; }
  if (def.state === 'ko' || def.state === 'down' || def.state === 'getup' || def.invuln > 0) return;
  const blocked = def.blocking;
  const hit = pickHit(atk, def, kind || 'punch', toward, contact); // sparks / dents at the real contact
  // Arm/leg wear (attackMods) times the fist/foot that landed: lost fingers or hand hit weaker.
  const mul = ((atk.atkMods && atk.atkMods.damageMul) || 1) * strikeMul(atk, kind || 'punch', strikeBone) * statOf(atk, 'power') / statOf(def, 'armor');
  // Comeback surge: a robot near KO and well behind hits a little harder (momentum swings).
  const surge = atk.health < 25 && def.health > atk.health * 2 ? 1.12 : 1;
  const blockMul = blocked ? (1 - COMBAT.blockReduction * blockReductionMul(def)) : 1;
  const loc = LOC_MUL[hit.partId] || 1;
  const closing = Math.min(impactVelocity(atk, def, hit.dir), kind === 'punch' ? PUNCH_CLOSE_CAP : Infinity);
  const swing = (kind === 'kick' ? 3.4 : 2.4) * mul;
  const force = (closing + swing) * (blocked ? 0.45 : 1);
  const dmg = Math.max(1, Math.round(spec.damage * mul * surge * blockMul * loc * (0.5 + 0.55 * (force / 5))));
  def.health = Math.max(0, def.health - dmg);
  logStrike(atk.id, atk.attackClip || kind || 'punch', blocked ? 'block' : 'land', dmg);
  atk.chainHit = !blocked;
  applyPartHit(def, hit.partId, dmg, hit.point, hit.dir, scene, { blocked, force, final: def.health <= 0 });
  applyStrikeWear(atk, kind || 'punch', strikeBone, blocked, force, scene, hit.dir);
  hitLight.color.setHex(blocked ? 0x88ccff : 0xffc060);
  hitLight.intensity = 14 + Math.min(12, force * 1.4);
  hitLight.position.copy(hit.point);
  // Heavy: a hard-hitting blow, a stepped-in strike, or a full kick (measured: a planted kick
  // lands at force ~3.1-3.4, a planted punch ~2.4; stepping in adds ~1).
  const heavy = !blocked && (dmg >= 7 || force >= 4.2 || (kind === 'kick' && force >= 3.3));
  // Counter hit: caught mid-swing. Longer hitstun.
  const counter = !blocked && (def.state === 'punch' || def.state === 'kick');
  const solidHit = !blocked && force >= COMBAT.stumbleForce;
  // Impact weight: a shake scaled by how hard it landed (Settings shake toggle respected
  // in addShake) and a bright flash right at the contact point.
  const hard = Math.max(0, Math.min(1, (force - 2) / 4 + (heavy ? 0.25 : 0) + (counter ? 0.25 : 0)));
  playHit({ blocked, heavy, kick: kind === 'kick', hard });
  const finishing = def.health <= 0 || isCatastrophic(def);
  if (blocked) addShake(0.045, 0.08);
  else if (finishing || counter) addShake(finishing ? 0.28 : 0.16, finishing ? 0.26 : 0.18);
  else if (heavy) addShake(0.13 + hard * 0.04, 0.17);
  else addShake(0.055 + hard * 0.02, 0.1);
  addImpactFreeze(blocked ? 0.04 : (finishing || counter ? COMBAT.hitStopCounter : heavy ? COMBAT.hitStopHeavy : COMBAT.hitStopLight));
  hitFlash(hit.point, blocked ? 0.45 : 0.7 + hard * 0.85, blocked ? 0x9fd0ff : 0xfff0c8);
  const fwd = hit.dir;
  // Attacker feels the connect: the drive stops and the torso recoils a touch off the target.
  atk.atkContact = true;
  atk.backOff = 0.3; def.backOff = 0.3;
  startFlinch(atk, fwd.clone().negate(), blocked ? 0.16 : 0.12, 'torso');
  // Defender visibly takes it: a strong head/body snap away from the blow (smaller on guard).
  const flinchAmp = blocked
    ? Math.min(0.42, 0.2 + force * 0.04)
    : heavy
      ? Math.min(1.2, 0.88 + force * 0.06)
      : Math.min(0.78, 0.5 + force * 0.05);
  startFlinch(def, fwd, flinchAmp, blocked ? 'arm' : hitZone(hit.partId));
  // Knockback walks out through hitPush / setFighterMove (physics owns the body).
  // A short hit-stop freezes both fighters first; gravity is not changed.
  const solid = !blocked && (force >= COMBAT.stumbleForce || heavy);
  const stumbleClip = solid && def.actions.StumbleBackwards ? 'StumbleBackwards' : null;
  if (blocked) {
    def.guardPush = { x: fwd.x, z: fwd.z, dist: COMBAT.hitRock * 0.7 * Math.min(1.5, 0.85 + force * 0.1), t0: 0, t1: 0.22, legs: true, t: 0 };
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
    const knock = (heavy && (counter || force >= COMBAT.knockdownForce || stacked || torsoWrecked(def)
      || (kind === 'kick' && Math.random() < (COMBAT.kickKnockChance || 0))))
      || (spec.knock > 0 && Math.random() < spec.knock); // sweep, charge, slam, overheat
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
      // A landed blow always holds a flinch or stumble. WalkingBackwards is only for a light tap.
      const lightTap = !heavy && !counter && force < 2.6;
      const useStumble = !lightTap && !!def.actions.StumbleBackwards && !!(stumbleClip || force >= 2.6 || solid);
      const clip = useStumble ? 'StumbleBackwards' : pickHitClip(def, hit.partId, force);
      // Counters take the heavy stun plus the extra frames, so a read wins the turn.
      const baseStun = (useStumble || counter) ? COMBAT.hitStunHeavy : COMBAT.hitStun;
      const stun = (baseStun + (counter ? COMBAT.counterExtra : 0)) / statOf(def, 'recovery');
      startHitReaction(def, fwd, { clip, useStumble, lightTap, stun });
    }
  }
}

// StumbleBackwards is a few backward steps that end in a sit-down onto the mat. As a hit
// reaction (the robot stays up) only the stepping part may play: past STUMBLE_STEP_END of the
// clip the hips drop toward the mat while the root was still held up by the feet, and the robot
// sank ~55 cm into the mat on long stuns. The stun now fits inside the steps (the clip is
// slowed to fill a long stun, never run into the sit), and groundFeet also checks the body.
const STUMBLE_STEP_END = 0.27; // hips start to drop at ~0.3 of the clip (measured)
function startHitReaction(def, fwd, { clip, useStumble, lightTap, stun }) {
  def.state = 'hit';
  def.stateT = 0;
  setAnim(def, clip, 0.12);
  const act = def.actions[clip];
  def.hitDur = stun;
  if (useStumble && act) {
    // A re-hit mid-stumble keeps the clip going (no pose pop), so only the steps left count.
    const left = act.getClip().duration * STUMBLE_STEP_END - (act.isRunning() ? act.time : 0);
    const ts = Math.max(0.2, act.timeScale || 1);
    // Leave a 0.12 s blend back to the guard before the steps run out.
    if ((stun + 0.12) * ts > left) {
      act.timeScale = Math.max(0.35, left / (stun + 0.12));
      if ((stun + 0.12) * act.timeScale > left) def.hitDur = Math.max(0.2, left / act.timeScale - 0.12);
    }
  }
  const gaitName = useStumble ? 'StumbleBackwards' : (lightTap ? 'WalkingBackwards' : clip);
  const gait = clipGait(def, gaitName) * Math.max(0.2, (act && act.timeScale) || 1);
  const t1 = useStumble ? def.hitDur * 0.92 : Math.max(lightTap ? 0.2 : 0.22, stun * (lightTap ? 0.75 : 0.55));
  def.hitPush = { x: fwd.x, z: fwd.z, dist: gait * t1 * (lightTap ? 1 : 0.75), gait, t0: 0, t1, legs: !!lightTap };
  setFighterMove(def, fwd.x * gait * (lightTap ? 1 : 0.75), fwd.z * gait * (lightTap ? 1 : 0.75));
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
  if (inBell() || match.over) { logBellBlock(f.id, 'ground'); return false; }
  if (f.state === 'ko' || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash') return false;
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
  playSfx('whoosh', { rate: stomp ? 1.15 : 1.1, vol: 0.6 });
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
  startFlinch(f, new THREE.Vector3(-dir.x, 0, -dir.z), 0.06, 'torso');
  if (def.health <= 0) ko(def, f, { dir: new THREE.Vector3(dir.x, 0, dir.z).normalize(), force: 3, partId: t.part, kind: 'ground' });
}

// Forward bow for the ground punch (and a small one for the stomp), applied after the mixer.
const _bowAxis = new THREE.Vector3();
const _bowPQ = new THREE.Quaternion();
const _bowQ = new THREE.Quaternion();
const _bowFwd = new THREE.Vector3();
function applyGroundBow(f) {
  // Ground attacks: a weight 0..1 of the stomp / pound bow. Robot moves (state 'dash'): an
  // angle in radians (forward +, back -) for the charge lean, the slam and the overheat burst.
  const ground = f.state === 'ground';
  const w = ground ? (f.groundBow || 0) : (f.state === 'dash' ? (f.specialBow || 0) : 0);
  if (Math.abs(w) <= 0.001) return;
  const amt = ground ? (f.groundKind === 'stomp' ? COMBAT.ground.stompBow : COMBAT.ground.poundBow) * Math.min(1.85, damageFx().bend) : 1;
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

// At the peak of a jab, straight or hook, blend a two-bone arm IK so the punching arm is
// almost fully straight (elbow nearly locked) and the fist reaches toward the target. The
// body still steps in; this only extends the arm on top of the clip. Hooks keep a little
// elbow bend so they still read as hooks. The weight follows the clip playhead both ways, so
// a landed punch stays extended to the surface and folds back as the clip rewinds (pulled
// strikes play backwards), instead of snapping in at the moment of contact. The fist (the
// strike bone) is posed here before the next frame's contact test, so the hit follows it.
function punchExtendWeight(f) {
  if (f.state !== 'punch' || !PUNCH_AIM_CLIPS.has(f.attackClip)) return 0;
  const action = f.actions[f.attackClip];
  if (!action) return 0;
  const tm = strikeTiming(f, action);
  const ct = action.time;
  const peak = tm.peak != null ? tm.peak : tm.a0;
  const rise = Math.max(0.05, peak - tm.start);
  let w = 0;
  if (ct <= tm.start) w = 0;
  else if (ct <= peak) {
    const u = Math.max(0, Math.min(1, (ct - (peak - rise * 0.85)) / (rise * 0.85)));
    w = u * u * (3 - 2 * u);
  } else if (ct <= tm.a1) w = 1;
  else {
    const u = Math.max(0, Math.min(1, (ct - tm.a1) / Math.max(0.06, (tm.end || tm.a1 + 0.1) - tm.a1)));
    w = 1 - u * u * (3 - 2 * u);
  }
  if (f.attackClip === 'RightHook') w *= 0.72;
  return w;
}

function punchingArmSide(f) {
  const bones = f.strikeBones && f.strikeBones.punch;
  if (!bones || !bones.length) return 'R';
  let best = bones[0], bestZ = -Infinity;
  for (const b of bones) {
    b.getWorldPosition(_ikA);
    f.root.worldToLocal(_ikA);
    if (_ikA.z > bestZ) { bestZ = _ikA.z; best = b; }
  }
  const n = boneKey(best.name);
  if (/^Left/.test(n)) return 'L';
  if (/^Right/.test(n)) return 'R';
  return 'R';
}

function aimBoneY(bone, worldDir, weight) {
  if (!bone || !bone.parent || !(weight > 0) || !(worldDir.lengthSq() >= 1e-8)) return;
  bone.parent.updateWorldMatrix(true, false);
  bone.parent.getWorldQuaternion(_ikPQ);
  bone.getWorldQuaternion(_ikWQ);
  _ikB.set(0, 1, 0).applyQuaternion(_ikWQ).normalize();
  _ikC.copy(worldDir).normalize();
  const dot = THREE.MathUtils.clamp(_ikB.dot(_ikC), -1, 1);
  if (dot > 0.9999) return;
  _ikQ.setFromUnitVectors(_ikB, _ikC);
  _ikWant.copy(_ikQ).multiply(_ikWQ);
  _ikWant.copy(_ikPQ).invert().multiply(_ikWant);
  if (!qOk(_ikWant)) return;
  bone.quaternion.slerp(_ikWant, weight);
}

const _ikPole = new THREE.Vector3();
const _ikPoleDir = new THREE.Vector3();
const _ikNat = new THREE.Vector3();
function applyPunchReach(f) {
  const w = Math.min(1, punchExtendWeight(f));
  if (!(w >= 0.02)) return; // NaN-safe
  const other = f === p1 ? p2 : p1;
  if (!other || !f.ikArms) return;
  const hook = f.attackClip === 'RightHook';
  const tight = f.attackClip === 'Uppercut' || f.attackClip === 'ElbowPunching';
  const side = punchingArmSide(f);
  const arm = f.ikArms[side];
  if (!arm || !arm.upper || !arm.lower || !arm.hand) return;
  if (arm.upper.scale.x < 0.01) return; // missing / torn-off arm

  f.model.updateWorldMatrix(true, true);
  arm.upper.getWorldPosition(_ikA); // shoulder / upper origin
  arm.lower.getWorldPosition(_ikB); // elbow
  arm.hand.getWorldPosition(_ikC);  // hand
  const len1 = _ikA.distanceTo(_ikB);
  const len2 = _ikB.distanceTo(_ikC);
  if (len1 < 0.02 || len2 < 0.02) return;
  const full = len1 + len2;
  const upper = f.attackClip === 'Uppercut';
  const lock = upper ? 0.92 : tight ? 0.82 : hook ? 0.9 : 0.955; // long, but the elbow keeps a hint of bend (less robotic)
  const curLen = _ikA.distanceTo(_ikC);

  // Aim: blend the clip's punch direction with a line to the opponent's chest.
  _ikD.copy(_ikC).sub(_ikA);
  if (_ikD.lengthSq() < 1e-6) return;
  _ikD.normalize();
  const chestY = other.root.position.y + (upper ? 1.7 : 1.25) * SIZE; // the uppercut rises into the chin
  _ikT.set(other.root.position.x, chestY, other.root.position.z).sub(_ikA);
  if (_ikT.lengthSq() > 1e-6) _ikT.normalize();
  else _ikT.copy(_ikD);
  const aimMix = upper ? 0.85 : tight ? 0.72 : hook ? 0.35 : 0.82;
  _ikD.lerp(_ikT, aimMix * w).normalize();

  const wantLen = curLen + (full * lock - curLen) * w;
  // Don't drive the fist through the opponent; the step in still closes the rest of the gap.
  const toChest = Math.hypot(other.root.position.x - _ikA.x, other.root.position.z - _ikA.z);
  const maxToBody = Math.max(0.1, toChest - (COMBAT.bodyRadius || 0.27 * SIZE) - 0.02);
  const reach = Math.min(wantLen, maxToBody);
  _ikT.copy(_ikA).addScaledVector(_ikD, reach);

  // Keep the clip's elbow plane (pole = current elbow offset from the shoulder).
  arm.lower.getWorldPosition(_ikB);
  _ikC.copy(_ikB).sub(_ikA);
  const d = _ikA.distanceTo(_ikT);
  const dist = THREE.MathUtils.clamp(d, Math.abs(len1 - len2) + 0.004, len1 + len2 - 0.012);
  _ikD.copy(_ikT).sub(_ikA);
  if (_ikD.lengthSq() < 1e-8) return;
  _ikD.setLength(dist);

  let cosA = (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist);
  cosA = THREE.MathUtils.clamp(cosA, -1, 1);
  const angA = Math.acos(cosA);
  // Bend side (pole). The clip's elbow decides it while the arm is clearly bent; as the clip
  // arm straightens that offset shrinks to noise and could swing the elbow backward (the joint
  // limit then snapped it: the LeftForeArm "jointFlip" pops in uppercuts / elbow strikes), so
  // it blends into the natural side: elbow down and back toward the body.
  _ikPoleDir.copy(_ikD).normalize();
  _ikPole.copy(_ikC).addScaledVector(_ikPoleDir, -_ikC.dot(_ikPoleDir));
  const clipBend = _ikPole.length();
  toward(f, other, _ikNat).multiplyScalar(-0.45);
  _ikNat.y -= 1;
  _ikNat.addScaledVector(_ikPoleDir, -_ikNat.dot(_ikPoleDir));
  if (_ikNat.lengthSq() > 1e-8) {
    _ikNat.normalize();
    const k = Math.min(1, clipBend / (0.3 * len1));
    if (clipBend > 1e-6) _ikPole.divideScalar(clipBend); else _ikPole.copy(_ikNat);
    _ikPole.lerp(_ikNat, 1 - k);
  }
  // Solve with this pole; if the elbow then bends the wrong way (far outside its hinge range,
  // which the joint limits would snap back as a "jointFlip"), solve again on the natural side.
  const elbow = hingeOf(f, arm.lower);
  _ikQu.copy(arm.upper.quaternion);
  _ikQl.copy(arm.lower.quaternion);
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      arm.upper.quaternion.copy(_ikQu);
      arm.lower.quaternion.copy(_ikQl);
      arm.upper.updateMatrixWorld(true);
      if (_ikNat.lengthSq() < 1e-8) return;
      _ikPole.copy(_ikNat);
    }
    _ikAxis.crossVectors(_ikD, _ikPole);
    if (_ikAxis.lengthSq() < 1e-8) {
      _ikAxis.set(0, 1, 0).cross(_ikD);
      if (_ikAxis.lengthSq() < 1e-8) _ikAxis.set(1, 0, 0).cross(_ikD);
    }
    _ikAxis.normalize();
    // Upper-arm direction: rotate the shoulder→target line by angA around the pole axis.
    const upperDir = _ikD.clone().normalize().applyAxisAngle(_ikAxis, angA);
    const elbowPos = _ikA.clone().addScaledVector(upperDir, len1);
    const lowerDir = _ikA.clone().add(_ikD).sub(elbowPos);
    if (lowerDir.lengthSq() < 1e-8) return;
    lowerDir.normalize();
    aimBoneY(arm.upper, upperDir, w);
    arm.upper.updateMatrixWorld(true);
    aimBoneY(arm.lower, lowerDir, w);
    arm.lower.updateMatrixWorld(true);
    if (!elbow || !elbow.axis || !elbow.lim) return;
    const th = hingeAngle(elbow) / DEG;
    if (th > elbow.lim.min - 60 && th < elbow.lim.max + 60) return;
  }
}
const _ikQu = new THREE.Quaternion();
const _ikQl = new THREE.Quaternion();

// Structural damage (not tiredness): a torso past 70% damage folds on any heavy blow.
function torsoWrecked(f) {
  const t = f.parts && f.parts.torso;
  const fold = damageFx().bend >= 1.7 ? 0.55 : damageFx().bend >= 1.2 ? 0.62 : 0.7;
  return !!(t && 1 - t.hp / t.max >= fold);
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
// Robots take blows from the front, so every fall goes back along the blow; the clip is picked
// by where it landed and how hard (knockdowns only happen on heavy blows, see applyHit):
//   medium (force < FALL_HEAVY): body / legs fold to the knees and rise again (LivershotKnockdown,
//     its own recovery); head / arms take a few stumble steps back and sit down hard.
//   heavy: head snaps straight back (StandingReactDeathBackward) or drops (KnockedOut); body
//     doubles over and drops (KnockedOut); legs are swept out (HitOnLegs); arms drop it or
//     stumble it down.
// Every fall ends lying on the back, the pose GettingUp starts from. `from` / `lieAt` / `holdAt`
// are clip fractions; `push` is the knockback travel in body sizes at force 5.
const FALL = {
  kneel: { clip: 'LivershotKnockdown', from: 0.04, speed: 1.2, lieAt: null, push: 0.3 },
  stumble: { clip: 'StumbleBackwards', from: 0.12, speed: 1.3, lieAt: 0.55, push: 0.7 },
  snapBack: { clip: 'StandingReactDeathBackward', from: 0.4, speed: 1.35, lieAt: 0.8, push: 0.45 },
  drop: { clip: 'KnockedOut', from: 0.12, speed: 1.2, lieAt: 0.5, push: 0.55 },
  sweep: { clip: 'HitOnLegs', from: 0, speed: 1.25, lieAt: 0.5, holdAt: 0.6, push: 0.35 },
};
const FALL_HEAVY = 5.4;
const FALL_BY_ZONE = {
  head: { medium: [['stumble', 2], ['snapBack', 1]], heavy: [['snapBack', 3], ['drop', 2]] },
  torso: { medium: [['kneel', 4], ['stumble', 1]], heavy: [['drop', 3], ['kneel', 1]] },
  leg: { medium: [['kneel', 3], ['sweep', 1]], heavy: [['sweep', 3], ['drop', 1]] },
  arm: { medium: [['stumble', 3], ['kneel', 1]], heavy: [['drop', 2], ['stumble', 1]] },
};

function pickFall(def, force, partId) {
  const zone = hitZone(partId);
  const tier = force >= FALL_HEAVY ? 'heavy' : 'medium';
  const list = FALL_BY_ZONE[zone][tier].filter(([k]) => def.actions[FALL[k].clip] && k !== def.lastFall);
  const opts = list.length ? list : FALL_BY_ZONE[zone][tier].filter(([k]) => def.actions[FALL[k].clip]);
  let r = Math.random() * opts.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of opts) { r -= w; if (r <= 0) return { key: k, zone, tier }; }
  return opts.length ? { key: opts[0][0], zone, tier } : null;
}

function knockDown(def, fwd, force, partId) {
  const pick = pickFall(def, force, partId) || (def.actions.StumbleBackwards ? { key: 'stumble', zone: 'torso', tier: 'medium' } : null);
  if (!pick) return;
  const spec = FALL[pick.key];
  logFall(def.id, def.root && def.root.position);
  def.state = 'down';
  def.stateT = 0;
  def.kdCount = (def.kdCount || 0) + 1;
  def.blocking = false;
  def.shield.visible = false;
  def.downClip = spec.clip;
  def.downSpec = spec;
  def.downKind = pick.key + ':' + pick.zone + ':' + pick.tier;
  def.downForce = force;
  def.lastFall = pick.key;
  def.downLying = false;
  def.downLieT = 0;
  def.landed = false;
  def.groundY = def.groundY || 0;
  def.fallYaw = def.root.rotation.y;
  def.fallYawVel = 0;
  const act = setAnim(def, spec.clip, 0.1);
  const dur = act ? act.getClip().duration : 1;
  if (act) {
    act.paused = false;
    act.time = spec.from * dur;
    act.timeScale = spec.speed;
  }
  // Travel back along the blow while the robot goes down (harder blows travel farther),
  // eased out by pushSpeed, then it stays where it landed.
  const fallT = Math.max(0.25, (dur * ((spec.lieAt != null ? spec.lieAt : 0.3) - spec.from)) / spec.speed);
  const dist = spec.push * SIZE * Math.max(0.7, Math.min(1.5, force / 5));
  const t1 = Math.min(fallT, 1.1);
  const gait = dist / t1;
  def.hitPush = { x: fwd.x, z: fwd.z, dist, gait, t0: 0, t1, legs: false };
  setFighterMove(def, fwd.x * gait, fwd.z * gait);
  announce('knockdown', { delay: 0.35 }); // [announcer hook]
}

function dampFallYaw(f, dt) {
  if (f.fallYaw == null) return;
  let err = f.root.rotation.y - f.fallYaw;
  while (err > Math.PI) err -= Math.PI * 2;
  while (err < -Math.PI) err += Math.PI * 2;
  const k = f.downLying ? 6 : 14;
  f.fallYawVel = (f.fallYawVel || 0) * Math.pow(0.02, dt) - err * k * dt;
  f.root.rotation.y += f.fallYawVel * dt;
}

// First knockdown is a short settle. Each later one stays down longer, capped.
function knockdownRest(f) {
  const n = Math.max(0, (f.kdCount || 1) - 1);
  const step = COMBAT.downRestStep != null ? COMBAT.downRestStep : 0.45;
  const cap = COMBAT.downRestCap != null ? COMBAT.downRestCap : 1.8;
  const later = Math.min(cap - COMBAT.downRest, n * step);
  const blow = Math.max(0, Math.min(0.25, ((f.downForce || 5) - FALL_HEAVY) * 0.18));
  return Math.min(cap, COMBAT.downRest + later + blow) / statOf(f, 'recovery');
}

function stepDown(f, dt) {
  const spec = f.downSpec || FALL.stumble;
  dampFallYaw(f, dt);
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
    if (!f.landed && frac > 0.22) { f.landed = true; playSfx('clank', { vol: 0.7, rate: 0.62 }); addShake(0.07, 0.1); }
    if (frac >= 0.97 || !act.isRunning() || f.stateT > dur / spec.speed + 0.4) {
      f.state = 'idle';
      f.hitPush = null;
      f.cooldown = Math.max(f.cooldown, 0.2);
      setAnim(f, idleClipFor(f), 0.25);
    }
    return;
  }
  if (spec.holdAt && !act.paused && frac >= spec.holdAt) { act.time = spec.holdAt * dur; act.paused = true; }
  if (!f.downLying && frac >= spec.lieAt) {
    f.downLying = true;
    if (!f.landed) { f.landed = true; playSfx('clank', { vol: 1, rate: 0.55 }); addShake(0.15, 0.18); }
  }
  if (!f.downLying) return;
  // Lie still after the settle, then get up. Later knockdowns stay down longer.
  // The clock runs through ground hits, so a robot can't be kept down by stomps.
  f.downLieT += dt;
  const settled = act.paused || frac >= 0.78 || !act.isRunning();
  const rest = knockdownRest(f);
  if ((settled && f.downLieT >= rest) || f.stateT > COMBAT.downMax) beginGetUp(f);
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
      if (k.vel > 1.2 && k.bounces < 2) { k.vel = -k.vel * 0.22; k.bounces++; playSfx('clank', { vol: 0.9, rate: 0.6 }); addShake(0.12, 0.14); }
      else { k.vel = 0; k.done = true; if (!f.landed) { f.landed = true; playSfx('clank', { vol: 1, rate: 0.55 }); addShake(0.16, 0.18); } }
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
  ringBell('ko');
  match.winner = winner ? winner.id : null;
  match.koT = 0;
  match.orbitT = 0;
  match.overlayAt = performance.now() + 1600;
  const title = document.getElementById('ko-title');
  const sub = document.getElementById('ko-sub');
  const methodEl = document.getElementById('ko-method');
  const headGone = (info && info.reason === 'head') || (loser.parts && loser.parts.head && loser.parts.head.detached);
  const legGone = (info && info.reason === 'legs') || (loser.parts && ['legL', 'legR'].some((k) => loser.parts[k] && loser.parts[k].detached));
  const blue = winner && winner.id === 'p1';
  if (methodEl) methodEl.textContent = headGone || legGone ? 'Part loss' : 'Knockout';
  if (title) title.textContent = blue ? 'Blue wins' : 'Red wins';
  if (sub) {
    if (headGone) sub.textContent = blue ? 'The head came off. Chassis down.' : 'Your head was torn off.';
    else if (legGone) sub.textContent = 'A leg is gone. The chassis collapsed.';
    else sub.textContent = blue ? 'You won the fight.' : 'The other chassis is down.';
  }
  playSfx('ko');
  addShake(0.28, 0.28);
  addImpactFreeze(COMBAT.hitStopCounter || 0.12);
  startKoSlow();
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

// How far (root to root) a named strike reaches: the clip's measured reach plus its own lunge
// (spinning / flying moves) or a short strike step.
function moveReach(mv) {
  if (mv.range) return mv.range;
  const tip = strikeTip(mv.clip);
  if (tip == null) return null;
  return tip + (mv.lunge || Math.min((mv.kind === 'kick' ? COMBAT.kickStep : COMBAT.punchStep) || 0, 0.48 * SIZE));
}
// Named strikes the brain may pick now: free to start, the limb is there, and in reach
// (the clip's measured reach plus its step or lunge).
function moveAvail(f, opp) {
  const out = {};
  const free = !(f.state === 'ko' || DOWN_STATES.has(f.state) || f.state === 'hit' || f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'dash') && !(f.cooldown > 0);
  const gap = f.root.position.distanceTo(opp.root.position);
  for (const id in MOVES) {
    const mv = MOVES[id];
    if (!free || !f.actions[mv.clip] || DOWN_STATES.has(opp.state)) { out[id] = false; continue; }
    if (mv.kind === 'punch' && f.parts && f.parts.armR && f.parts.armR.detached) { out[id] = false; continue; }
    if (mv.kind === 'kick' && f.parts && (f.parts.legL.detached || f.parts.legR.detached)) { out[id] = false; continue; }
    const reach = moveReach(mv);
    const tip = strikeTip(mv.clip);
    // Lunging moves are for a bit of distance, not for when the bodies are already together.
    out[id] = reach == null ? false : reach >= gap + 0.04 && (!mv.lunge || gap > tip * 0.75);
  }
  return out;
}
function brainSnapshot(f, opp, dt) {
  const busy = f.state === 'ko' || f.state === 'down' || f.state === 'getup' || f.state === 'hit';
  const gt = isLyingDown(opp) ? nearestGroundTarget(f, opp) : null;
  const esc = escapeInfo(f, opp);
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
      canAct: !busy && f.state !== 'punch' && f.state !== 'kick' && f.state !== 'ground' && f.state !== 'dash',
      canPunch: canPunch(f) && punchClipsFor(f).length > 0,
      canKick: canKick(f),
      canBlock: canBlock(f),
      blocking: !!f.blocking,
      edge: +ringEdge(f).toFixed(2),
      atWall: atCageWall(f),
      parts: partHealth(f),
      canFlip: canFlip(f) && !(f.dodgeCD > 0),
      energy: specialAvail(f).energy,
      specials: specialAvail(f),
      moves: moveAvail(f, opp),
    },
    tooClose: esc.tooClose,
    escape: esc.escape,
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
  if (intent.dodge === 'front') inp.flipFront = true;
  if (intent.attack && (MOVES[intent.attack] || ROBOT_MOVES.includes(intent.attack))) inp.move = intent.attack;
  else if (intent.attack === 'ground') inp.ground = true;
  else if (intent.attack === 'dash_forward' || intent.attack === 'dashFwd') inp.dashFwd = true;
  else if (intent.attack === 'dash_back' || intent.attack === 'dashBack') inp.dashBack = true;
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
  const api = wantsApiBrain(cpu.id, cpu);
  if (api) {
    cpu.isCpu = true;
    if (!cpu.brain || cpu.brain.kind !== 'api') cpu.brain = createApiBrain(cpu.id, () => fighterApiCfg(cpu));
    cpu._ai = cpu.brain.state || cpu._ai;
    return intentToInput(cpu, player, cpu.brain.think(brainSnapshot(cpu, player, dt)));
  }
  // CPU modes only (vs CPU, CPU vs CPU). Never built for an API or Player side.
  cpu.isCpu = true;
  if (!cpu.brain || cpu.brain.kind === 'api') cpu.brain = createPacedBrain(() => aiProfile(cpu));
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
  // Flip interrupted (hit, KO, round end): drop the airborne state.
  if ((f.dodge && f.state !== 'dodge') || (f.airLock != null && f.state !== 'dodge' && f.state !== 'kick' && f.state !== 'punch' && !f.special)) endAir(f);
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
  if (inBell() || match.over) {
    if (f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'hit' || f.state === 'dodge') {
      // Let the current clip finish (no new attacks, no damage — applyHit is gated).
    } else {
      setFighterMove(f, 0, 0);
      settleAfterBell(f);
      return;
    }
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
    // Weight curve over the strike: a slight held wind-up, a hard acceleration into the impact,
    // and a heavier follow-through (contact / retraction below override it).
    const plan = f.strikePlan && f.strikePlan.clip === f.attackClip ? f.strikePlan : null;
    if (plan && action && !f.retract && f.contactT < 0 && action.timeScale > 0) {
      action.timeScale = Math.min(f.strikeCap || Infinity, punchPlanRate(plan, ct));
    } else if (action && f.strikeBase && !f.retract && f.contactT < 0 && action.timeScale > 0 && !(f.airMove && f.airMove.action === action)) {
      const st0 = tm.start, pk = tm.peak != null ? tm.peak : tm.a0;
      const u = (ct - st0) / Math.max(0.05, pk - st0);
      // Punches come back slower than they go out (a natural pull-back, no hold at the end).
      const mul = u < 0.3 ? 0.95 : (ct <= tm.a1 ? 1.2 : (f.state === 'punch' ? PUNCH_RETURN : 0.95));
      action.timeScale = Math.min(f.strikeCap || Infinity, f.strikeBase * mul);
    }
    // Out of reach, the strike steps in over the wind-up (strikeFootwork): the body travels the
    // planned step on an eased curve while the lead foot steps with it. It stops on contact and
    // never drives inside striking distance (that pushed fists through torsos).
    const gap = f.root.position.distanceTo(other.root.position);
    const airKick = f.airMove && f.airMove.action === action ? f.airMove : null;
    const sw = f.strikeWork && f.strikeWork.clip === f.attackClip ? f.strikeWork : null;
    if (sw && sw.t0 == null) sw.t0 = ct;
    if (airKick) stepAirMove(f, dt); // airborne travel only, lands still
    else if (sw && sw.u < 1) {
      const ut = Math.max(0, Math.min(1, (ct - sw.t0) / Math.max(0.04, tm.a0 - sw.t0)));
      const moved = (f.root.position.x - sw.x0) * sw.fx + (f.root.position.z - sw.z0) * sw.fz;
      if (!sw.stopped && (f.atkContact || chestGap(f, other) <= stepGapOf(f) || limbInside(f, other, f.state))) sw.stopped = true;
      // The step keeps closing through the hit window until contact (or the chest-gap stop),
      // so a strike thrown from normal range finishes its step and connects instead of the
      // body stopping short at the start of the window while the fist is still out of reach.
      if (!sw.stopped && ct < tm.a1) {
        const want = sw.S * ut * ut * (3 - 2 * ut);
        // (Capped well under the root-teleport check: physics steps at 60 Hz.)
        const v = Math.max(0, Math.min((f.state === 'punch' ? PUNCH_STEP_V : 2.8) * SIZE, (want - moved) / Math.max(dt, 1 / 60)));
        const fwd = toward(f, other);
        setFighterMove(f, fwd.x * v, fwd.z * v);
      } else setFighterMove(f, 0, 0);
      sw.u = Math.max(sw.u, ut, sw.stopped ? 0 : Math.min(1, moved / Math.max(1e-3, sw.S)));
    } else setFighterMove(f, 0, 0);
    // The back foot follows once the hit has landed or the window has passed.
    if (sw && !sw.follow && ((f.contactT >= 0 && f.stateT - f.contactT > 0.06) || ct > tm.a1 || f.retract)) sw.follow = true;
    // Limb contact decides, not root distance: the swept fist/foot test runs through the whole
    // active window (the old root-distance gate let near-miss strikes skip the test and sail
    // through the body).
    const win = f.state === 'punch' ? PUNCH_WINDOW_PAD : 0;
    const contact = !f.hitThisAttack && ct >= tm.a0 - win && ct <= tm.a1 + win ? strikeContact(f, other, f.state) : null;
    if (window.__rfDiag && ct >= tm.a0 && ct <= tm.a1) diagMargin(f, other, f.state, gap);
    if (contact) {
      f.hitThisAttack = true;
      f.contactT = f.stateT;
      applyHit(f, other, attackSpec(f), f.state, contact.bone, contact);
    }
    // Solid bodies: whenever the striking limb is inside the other robot's body (any phase,
    // landed or not), the clip stops advancing there and the strike is pulled back.
    if (limbInside(f, other, f.state)) {
      if (!f.hitThisAttack && ct >= tm.a0 - 0.08 && ct <= tm.a1) {
        // Already in the body at the start of the window: that is the connect.
        f.hitThisAttack = true;
        const tip = (f.strikeBones[f.state] || []).map((b) => b.getWorldPosition(new THREE.Vector3())).map((p) => ({ p, pr: capsuleProbe(other, p) })).sort((x, y) => x.pr.d - y.pr.d)[0];
        applyHit(f, other, attackSpec(f), f.state, null, tip && tip.pr.point ? { point: tip.pr.point, part: tip.pr.part } : null);
      }
      if (f.contactT < 0) f.contactT = f.stateT;
      // (An airborne attack can't hang in mid-air: it lands through its follow-through instead.)
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
    const special = SPECIAL_STRIKES.has(f.attackClip) || !!airKick;
    if (pulled && !special && action && !f.retract && ct > tm.start + 0.04) {
      f.retract = true;
      f.retractT = 0;
      f.retractV = Math.min(RETRACT_SPEED * (f.state === 'punch' ? PUNCH_RETURN : 1), f.strikeCap || Infinity);
      action.paused = false;
    }
    if (f.retract && action && f.retractV) {
      f.retractT = (f.retractT || 0) + dt;
      const e = smooth01(f.retractT / RETRACT_EASE);
      action.timeScale = -f.retractV * (0.2 + 0.8 * e);
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
      f.retractV = 0;
      endAttack(f, f.state === 'punch' ? (pulled ? 0.22 : 0.26) : (pulled ? 0.16 : 0.2));
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
  if (inp.dashFwd && tryDash(f, other, 1)) return;
  if (inp.dashBack && tryDash(f, other, -1)) return;
  if (inp.ground && tryGroundAttack(f, other)) return;
  if (inp.flipFront && tryDodge(f, other, 'front')) return;
  if (inp.move && tryMove(f, other, inp.move)) return;
  if (inp.punch) {
    if (!f.isCpu) {
      const next = nextPlayerPunch(f);
      if (tryAttack(f, 'punch', next.clip, !!next.clip)) f.chain = next.chain;
    } else tryAttack(f, 'punch', inp.punchClip);
  } else if (inp.kick) tryAttack(f, 'kick', inp.kickClip);
  if (f.state === 'punch' || f.state === 'kick' || f.state === 'ground' || f.state === 'hit' || f.state === 'ko' || f.state === 'dash') return;

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
  if (usesCpuBrain(f) && gap < sep && !otherDown && !atCageWall(f)) {
    inout = Math.min(inout, -Math.min(1, 0.35 + (sep - gap) / 0.15));
  }
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
      const moveAmt = Math.min(1.5, Math.abs(inp.sidestep) + Math.abs(inp.inout));
      playSfx('servo', { vol: 0.16 + 0.22 * moveAmt, rate: 0.72 + 0.5 * moveAmt, limit: 200 });
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

// Clip foot speed in world metres / second (fallback: backward walk, then moveSpeed).
function clipGait(f, name) {
  return clipWorldSpeed(f, name) || clipWorldSpeed(f, 'WalkingBackwards') || COMBAT.moveSpeed * 0.3;
}

// Travel speed inside [t0, t1] (zero outside). When hp.gait is set, cruise at the clip's foot
// speed (short ease in/out) so backward walk, stumble and knockback don't slide in place.
function pushSpeed(hp, t) {
  const span = Math.max(0.05, hp.t1 - hp.t0);
  const u = (t - hp.t0) / span;
  if (u < 0 || u > 1) return 0;
  if (hp.gait != null && hp.gait > 0) {
    const ease = Math.min(0.12, span * 0.2) / span;
    let m = 1;
    if (u < ease) m = u / Math.max(1e-4, ease);
    else if (u > 1 - ease) m = (1 - u) / Math.max(1e-4, ease);
    return hp.gait * m;
  }
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
      playSfx('step', { vol: 0.4, rate: 0.86 + Math.random() * 0.2 });
    }
    rec.y = y;
  }
}

const hudGhost = { p1: 1, p2: 1, last: { p1: 1, p2: 1 }, hitAt: { p1: -1, p2: -1 } };
function resetHudGhost() { hudGhost.p1 = hudGhost.p2 = 1; hudGhost.last.p1 = hudGhost.last.p2 = 1; hudGhost.hitAt.p1 = hudGhost.hitAt.p2 = -1; }
function syncHud(dt = 0) {
  syncEnergyHud(p1, p2);
  if (!p1 || !p2) return;
  const now = performance.now() / 1000;
  const max = COMBAT.maxHealth;
  for (const [f, hid, gid] of [[p1, 'hp1', 'ghost1'], [p2, 'hp2', 'ghost2']]) {
    const hp = Math.max(0, f.health / max);
    const bar = document.getElementById(hid);
    if (bar) bar.style.transform = `scaleX(${hp})`;
    const wrap = bar && bar.parentElement;
    if (wrap) {
      wrap.classList.toggle('danger', hp > 0 && hp <= 0.25);
      if (hp < (hudGhost.last[f.id] ?? 1) - 1e-4) {
        wrap.classList.remove('flash'); void wrap.offsetWidth; wrap.classList.add('flash');
      }
    }
    hudGhost.last[f.id] = hp;
    const gEl = document.getElementById(gid);
    if (gEl) {
      if (hp < hudGhost[f.id] - 1e-4) {
        if (hudGhost.hitAt[f.id] < 0) hudGhost.hitAt[f.id] = now;
        if (now - hudGhost.hitAt[f.id] > 0.45) hudGhost[f.id] = Math.max(hp, hudGhost[f.id] - dt * 0.6);
      } else {
        hudGhost[f.id] = hp;
        hudGhost.hitAt[f.id] = -1;
      }
      gEl.style.transform = `scaleX(${hudGhost[f.id]})`;
    }
  }
  const vig = document.getElementById('vignette');
  if (vig) vig.classList.toggle('hurt', p1.health > 0 && p1.health <= max * 0.25 && !match.over && match.phase === 'fight');
  syncPartHud(p1, document.getElementById('parts1'));
  syncPartHud(p2, document.getElementById('parts2'));
}

const camT = new THREE.Vector3();
const lookT = new THREE.Vector3();
// Timed camera kick in metres. Light ~0.06 m / 100 ms, heavy ~0.15 m / 170 ms, KO ~0.28 m / 280 ms.
const shakeState = { amp: 0, dur: 0.12, t: 1 };
function addShake(amount, dur) {
  if (!getSettings().shake) return;
  const amp = Math.max(0, Math.min(0.32, amount || 0));
  if (amp < 0.01) return;
  const d = dur || (amp >= 0.22 ? 0.26 : amp >= 0.11 ? 0.17 : 0.1);
  const alive = shakeState.t < shakeState.dur ? Math.pow(1 - shakeState.t / shakeState.dur, 1.6) : 0;
  if (amp >= shakeState.amp * alive) {
    shakeState.amp = amp;
    shakeState.dur = d;
    shakeState.t = 0;
  }
}
function stepShake(dt) {
  if (!getSettings().shake) { shakeState.t = shakeState.dur; return; }
  if (shakeState.t < shakeState.dur) shakeState.t += dt;
}
function shakeEnv() {
  if (shakeState.amp <= 0 || shakeState.t >= shakeState.dur) return 0;
  return shakeState.amp * Math.pow(1 - shakeState.t / shakeState.dur, 1.6);
}
function applyCameraShake() {
  const amp = shakeEnv();
  if (amp <= 0) return;
  if (camModeLive === 'first' && !match.over) {
    camera.rotateX((Math.random() - 0.5) * amp * 0.35);
    camera.rotateZ((Math.random() - 0.5) * amp * 0.22);
    return;
  }
  camera.position.x += (Math.random() - 0.5) * amp;
  camera.position.y += (Math.random() - 0.5) * amp * 0.45;
}

// Hit-stop: both fighters hold. Gravity is untouched because the sim clock just pauses.
let impactFreeze = 0;
let koSlowLeft = 0;
function addImpactFreeze(sec) {
  const s = Math.max(0, Math.min(0.14, sec || 0));
  if (s > impactFreeze) impactFreeze = s;
}
function startKoSlow() {
  koSlowLeft = 0.30;
}

// Contact flash: an additive glow sprite, timed on wall-clock so it stays visible on impact.
let _flash = null;
function hitFlash(point, size, color) {
  if (!point) return;
  if (!_flash) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.8)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    _flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, toneMapped: false }));
    _flash.renderOrder = 20;
    scene.add(_flash);
  }
  _flash.position.copy(point);
  _flash.material.color.setHex(color);
  _flash.userData = { t: 0, life: size > 1.1 ? 0.16 : 0.1, size: size * SIZE };
  _flash.visible = true;
}
function stepFlash(rawDt) {
  if (!_flash || !_flash.visible) return;
  const u = _flash.userData;
  u.t += rawDt;
  const k = u.t / u.life;
  if (k >= 1) { _flash.visible = false; return; }
  _flash.scale.setScalar(u.size * (0.7 + k * 0.6));
  _flash.material.opacity = 1 - k * k;
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
let camModeAuto = false;
// Small HUD label under the timer naming the view on screen; it grows briefly on a change.
const CAM_NAMES = { arena: 'Arena', fighting: 'Fighting', third: '3rd Person', first: '1st Person', broadcast: 'Broadcast' };
let camLabelTimer = 0;
function paintCamLabel(mode) {
  const el = document.getElementById('camLabel');
  const name = document.getElementById('camLabelName');
  if (!el || !name) return;
  name.textContent = CAM_NAMES[mode] || mode;
  el.classList.add('pulse');
  clearTimeout(camLabelTimer);
  camLabelTimer = setTimeout(() => el.classList.remove('pulse'), 1300);
}
let camModeChangedAt = -1e9;

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
  // Standoff uses CAM_SIZE so the slightly larger robots fill more of the frame.
  const want = Math.max(3.4 * CAM_SIZE, Math.min(13 * CAM_SIZE, Math.max(span / Math.tan(hHalf), 2.1 * SIZE / Math.tan(vHalf))));
  fightCamDist = snap || !fightCamDist ? want : fightCamDist + (want - fightCamDist) * (1 - Math.pow(0.05, dt));
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const mt = matTopY();
  camT.set(mx + _fcN.x * fightCamDist, mt + 1.4 * SIZE + fightCamDist * 0.04, mz + _fcN.z * fightCamDist);
  _cvB.set(mx, mt + 1.3 * SIZE, mz); // a little above the chest: the fighters sit under the round titles
  if (snap) { camera.position.copy(camT); lookT.copy(_cvB); } else {
    camera.position.lerp(camT, 1 - Math.pow(0.002, dt));
    lookT.lerp(_cvB, 1 - Math.pow(0.0005, dt));
  }
  camera.lookAt(lookT);
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
    const back = 2.25 * CAM_SIZE + dist * 0.28;
    const mt = matTopY();
    camT.set(a.x - _cvF.x * back + _cvR.x * 0.62 * SIZE, mt + 1.95 * SIZE + dist * 0.05, a.z - _cvF.z * back + _cvR.z * 0.62 * SIZE);
    placeInOctagon(camT, -1.5, false);
    lookT.set(a.x + _cvF.x * dist * 0.62, mt + 1.12 * SIZE, a.z + _cvF.z * dist * 0.62);
    camera.position.lerp(camT, k);
    camera.lookAt(lookT);
  } else {
    // Eye just in front of the visor (so no head geometry sits between it and the scene),
    // riding the head bone so the view moves with the body; aimed at the opponent's chest.
    const head = p1.flinchBones && p1.flinchBones.Head;
    p1.model.updateWorldMatrix(true, true);
    if (head) head.getWorldPosition(_cvA); else _cvA.set(a.x, a.y + 1.65 * SIZE, a.z);
    _cvA.addScaledVector(_cvF, 0.2 * SIZE);
    _cvA.y += 0.05 * SIZE;
    camera.position.lerp(_cvA, k);
    _cvB.set(b.x, b.y + ((p2.state === 'down' || p2.state === 'ko') ? 0.35 * SIZE : 1.2 * SIZE), b.z);
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

const _camFromP = new THREE.Vector3();
const _camFromL = new THREE.Vector3();
const _camSaveP = new THREE.Vector3();
const _camSaveL = new THREE.Vector3();
const _camSaveD = new THREE.Vector3();
const _camLookE = new THREE.Vector3();
let _camFromFov = 50;
let camEase = 0;
function updateCamera(dt) {
  if (!p1 || !p2 || !fightersStaged) return;
  const prevMode = camModeLive;
  _camSaveP.copy(camera.position);
  camera.getWorldDirection(_camSaveD);
  _camSaveL.copy(camera.position).addScaledVector(_camSaveD, 6);
  const saveFov = camera.fov;
  updateCameraInner(dt);
  if (prevMode !== camModeLive) {
    camEase = 1;
    _camFromP.copy(_camSaveP);
    _camFromL.copy(_camSaveL);
    _camFromFov = saveFov;
  }
  if (camEase > 0) {
    const toP = camera.position.clone();
    camera.getWorldDirection(_camSaveD);
    const toL = camera.position.clone().addScaledVector(_camSaveD, 6);
    const toFov = camera.fov;
    camEase = Math.max(0, camEase - Math.max(dt || 0, 0.001) / 0.4);
    const a = 1 - camEase;
    const s = a * a * (3 - 2 * a);
    camera.position.lerpVectors(_camFromP, toP, s);
    _camLookE.lerpVectors(_camFromL, toL, s);
    camera.lookAt(_camLookE);
    if (Math.abs(toFov - _camFromFov) > 0.05) {
      camera.fov = _camFromFov + (toFov - _camFromFov) * s;
      camera.updateProjectionMatrix();
    }
  }
  applyCameraShake();
}


function updateCameraInner(dt) {
  if (xrPresenting()) { setFirstPersonHide(false); return; }
  const want = cameraMode();
  // Broadcast keeps directing through the KO (close-ups, cuts); other views go to the arena.
  const mode = match.over && want !== 'broadcast' ? 'arena' : want;
  if (mode !== camModeLive) {
    // Manual: the player picked this view (V, C, pad, menu). Auto: the game switched it
    // (match over -> arena, head torn off -> 3rd person).
    camModeAuto = mode !== (getSettings().cam || 'arena');
    camModeChangedAt = performance.now();
    camModeLive = mode;
    paintCamLabel(mode);
    camera.near = mode === 'first' ? 0.04 : 0.1;
    camera.updateProjectionMatrix();
    // Mid-fight view changes ease in updateCamera (no snap).
  }
  setFirstPersonHide(mode === 'first');
  if (mode === 'broadcast' && broadcastMain(camera)) return;
  if (mode === 'fighting') { updateFightingCamera(dt); return; }
  if (mode !== 'arena') { updateFollowCamera(dt, mode); return; }
  const a = p1.root.position;
  const b = p2.root.position;
  // Over: aim above the bodies so the fighters sit in the lower frame, under the title.
  const downed = p1.state === 'down' || p2.state === 'down' || p1.state === 'ko' || p2.state === 'ko';
  const midY = matTopY() + (match.over ? 1.45 : downed ? 0.82 : 1.15) * SIZE;
  lookT.set((a.x + b.x) / 2, midY, (a.z + b.z) / 2);
  if (match.over) {
    match.orbitT = (match.orbitT || 0) + dt;
    const radius = 8.2 * CAM_SIZE;
    const ang = match.orbitT * 0.22;
    const y = matTopY() + 3.7 * CAM_SIZE + Math.sin(match.orbitT * 0.18) * 0.3;
    camT.set(lookT.x + Math.sin(ang) * radius, y, lookT.z + Math.cos(ang) * radius);
    camera.position.lerp(camT, dt <= 0 ? 0 : 1 - Math.pow(0.015, dt));
    camera.lookAt(lookT);
    return;
  }
  const dist = a.distanceTo(b);
  const r = Math.max(0.7, Math.hypot(2.3 * CAM_SIZE, 8.6 * CAM_SIZE + dist * 0.3) * orbit.zoom);
  // Zoomed in close, aim a little lower so the feet and mat stay in frame.
  lookT.y = midY - (1 - Math.min(1, orbit.zoom)) * 0.45 * SIZE;
  const cp = Math.cos(orbit.pitch);
  camT.set(
    lookT.x + Math.sin(orbit.yaw) * cp * r,
    Math.max(matTopY() + 0.08, lookT.y + Math.sin(orbit.pitch) * r),
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
}

let p1;
let p2;
let cagePanels = null;
const match = { phase: 'idle', introT: 0, over: false, winner: null, roundLeft: null, roundIndex: 1, roundTimeOverride: null };
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
  ringBell('time');
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

// Get-up: every knockdown fall ends lying on the back near the pose GettingUp starts from
// (measured with __rfClipPose), so a short cross-fade is seamless and no bone is ever posed by
// physics. There is one get-up clip, so its pace follows the blow: after a medium knockdown
// the robot skips the first beat on the mat and springs up quicker; after a heavy one it
// rolls up slower and heavier. No root turn here: it gets up facing the way it fell and only
// re-faces the opponent once upright (faceToward).
function beginGetUp(f) {
  if (!f || f.state === 'getup') return;
  logGetUp(f.id, f.root && f.root.position);
  if (f.phys && f.phys.body) f.phys.body.velocity.setZero();
  f.state = 'getup';
  f.stateT = 0;
  f.downLying = false;
  f.flinch = null;
  if (f.mixer) f.mixer.timeScale = 1;
  const clip = f.actions.GettingUp ? 'GettingUp' : (MODEL.animations.getUp || 'GettingUp');
  const act = setAnim(f, clip, 0.25);
  if (act) {
    const heavy = (f.downForce || 5) >= FALL_HEAVY;
    const pace = (heavy ? 0.88 : 1.14) * (0.95 + Math.random() * 0.1);
    act.time = act.getClip().duration * (heavy ? 0 : 0.08);
    // The (remaining) clip, paced to COMBAT.getupTime.
    act.timeScale = act.getClip().duration / Math.max(0.6, COMBAT.getupTime || 1.25) * statOf(f, 'recovery') * pace;
  }
  announce('getup', { delay: 0.2 }); // [announcer hook]
}

const _hpA = new THREE.Vector3();
const _hpB = new THREE.Vector3();
const _hpE = new THREE.Euler();
const _hpBnd = new THREE.Euler();
const _hpQ = new THREE.Quaternion();
const _hpY = new THREE.Vector3(0, 1, 0);
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

// Three.js PropertyMixer skips writing a bone when a paused or clamped-at-end clip evaluates to
// the exact same quaternion as last frame (e.g. HitOnLegs holdAt or a finished knockdown clip).
// Restore any bone that post-mixer passes (hips yaw-pin, ground-hit flinch) premultiplied last
// frame before mixer.update(), so those rotations never stack on top of themselves into a spin.
function captureRawBone(f, bone) {
  if (!f || !bone) return;
  if (!f._rawBoneQ) f._rawBoneQ = new Map();
  if (!f._rawBoneQ.has(bone)) f._rawBoneQ.set(bone, bone.quaternion.clone());
}
function restoreRawPose(f) {
  if (!f || !f._rawBoneQ || !f._rawBoneQ.size) return;
  for (const [bone, q] of f._rawBoneQ) bone.quaternion.copy(q);
  f._rawBoneQ.clear();
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
    // Pin hips yaw to the bind pose so clip root rotation cannot fight steerYaw: one rotation
    // about the vertical (lean and bounce stay; hipFree still eases the pin off for strikes).
    // Yaw is only measurable while the hips are fairly upright. Lying flat (falls, get-up roll)
    // the Euler yaw is gimbal noise and pinning it spun the lying body around, so the
    // correction is frozen at its last upright value there and blends back in on the way up.
    if (f.hipsBindQ && w > 0.01) {
      const upY = 1 - 2 * (f.hips.quaternion.x ** 2 + f.hips.quaternion.z ** 2); // hips up axis . vertical
      const e = _hpE.setFromQuaternion(f.hips.quaternion, 'YXZ');
      const b = _hpBnd.setFromQuaternion(f.hipsBindQ, 'YXZ');
      const live = Math.atan2(Math.sin(b.y - e.y), Math.cos(b.y - e.y));
      const s = Math.max(0, Math.min(1, (upY - 0.55) / 0.35));
      if (f.hipYawFix == null) f.hipYawFix = live;
      const dy = f.hipYawFix + Math.atan2(Math.sin(live - f.hipYawFix), Math.cos(live - f.hipYawFix)) * s * s * (3 - 2 * s);
      if (upY > 0.9) f.hipYawFix = live;
      captureRawBone(f, f.hips);
      f.hips.quaternion.premultiply(_hpQ.setFromAxisAngle(_hpY, dy * w));
    }
    // Weight shift: back over the rear leg in the wind-up, forward and down onto the lead leg
    // as the punch lands (the planted feet hold, so the knees take it).
    const sb = strikeBodyCurve(f, dt);
    if (sb.shift !== 0 && f.hips.parent) {
      // Up close (elbows, hooks inside) the forward shift shrinks so the body doesn't drive in.
      const room = sb.shift > 0 ? Math.max(0, Math.min(1, (chestGap(f, f === p1 ? p2 : p1) - 0.42 * SIZE) / (0.3 * SIZE))) : 1;
      sb.shift *= room * (SHIFT_SCALE[f.attackClip] ?? 1);
      const parent = f.hips.parent;
      parent.updateWorldMatrix(true, false);
      const fw = toward(f, f === p1 ? p2 : p1);
      _hpB.copy(f.hips.position).applyMatrix4(parent.matrixWorld);
      _hpB.x += fw.x * sb.shift * 0.1 * SIZE;
      _hpB.z += fw.z * sb.shift * 0.1 * SIZE;
      _hpB.y -= Math.max(0, sb.shift) * 0.025 * SIZE;
      f.hips.position.copy(_hpB.applyMatrix4(_guM.copy(parent.matrixWorld).invert()));
    }
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
  applyMoveFx(f, dt);
  applyStumpLeg(f, dt);
  applyFlinch(f, dt);
  applyGroundBow(f);
  applyStrikeTwist(f);
  applyPunchReach(f);
}

// Spinning backfist: one full turn of the body from the wind-up into the hit (eases into the
// strike, never unwinds back). Flying kick / ground slam: the body leaves the mat (the root stays
// on it with airLock, so groundFeet doesn't pull the feet down).
function applyMoveFx(f, dt) {
  const fx = f.moveFx;
  const mv = f.move;
  let yaw = null;
  let lift = 0;
  if (fx && mv && (f.state === 'punch' || f.state === 'kick') && f.attackClip === mv.clip) {
    const action = f.actions[mv.clip];
    const ct = action ? action.time : 0;
    if (mv.spin && !fx.spun) {
      const u = (ct - fx.t0) / Math.max(0.05, fx.pk - fx.t0);
      if (u >= 1) fx.spun = true;
      else if (!(f === p1 && cameraMode() === 'first')) {
        const c = Math.max(0, u);
        yaw = Math.PI * 2 * mv.spin * c * c * c * (c * (c * 6 - 15) + 10);
      }
    }
    if (mv.hop) {
      const u = (ct - fx.t0) / Math.max(0.05, fx.t1 - fx.t0);
      if (u > 0 && u < 1) lift = mv.hop * Math.sin(Math.PI * u);
    }
  }
  if (mv && mv.turn && f.state === 'punch' && f.attackClip === mv.clip && !(f === p1 && cameraMode() === 'first')) {
    // Square up: the clip's fist line drifts off to the side, so the body turns into the target.
    const action = f.actions[mv.clip];
    const tm = action && strikeTiming(f, action);
    if (tm) {
      const ct = action.time, a0 = tm.a0, a1 = tm.a1, end = tm.end || a1 + 0.15;
      const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
      const k = ct < a0 ? sm((ct - tm.start) / Math.max(0.05, a0 - tm.start))
        : ct <= a1 ? 1 : 1 - sm((ct - a1) / Math.max(0.05, end - a1));
      yaw = mv.turn * k;
    }
  }
  if (f.state === 'dash' && f.specialLift) lift += f.specialLift;
  if (yaw != null) f.model.rotation.y = yaw;
  else if (f.model.rotation.y !== 0) {
    // Interrupted mid-turn: settle back to facing forward over ~0.1 s.
    let r = f.model.rotation.y % (Math.PI * 2);
    if (r > Math.PI) r -= Math.PI * 2;
    r *= Math.exp(-Math.max(dt || 0, 1 / 120) * 30);
    f.model.rotation.y = Math.abs(r) < 1e-3 ? 0 : r;
  }
  if (lift > 0) f.model.position.y += lift;
}

// Full-body punch: an additive turn about the vertical layered on the clip, hips first, then
// the spine, the chest and last the punching shoulder. It loads away from the punch in the
// wind-up, drives through on the strike (each link a beat behind the one below) and settles in
// the recovery. Driven by the clip playhead, so a pulled punch rewinding unwinds it too. The
// thighs are turned back by the hip turn so the planted legs don't swing with the pelvis.
// Degrees: [load, drive] per link.
// Hooks and elbows already sweep across in the clip; a big extra turn drove them into the body.
const TWIST_LINKS = [['hips', 8, 12, 0], ['Spine', 4, 7, 0.1], ['Spine1', 4, 6, 0.2], ['Spine2', 3, 5, 0.3], ['shoulder', 2, 9, 0.38]];
const SHIFT_SCALE = { ElbowPunching: 0.2, RightHook: 0.3, Uppercut: 0.3 };
const TWIST_SCALE = { LeadJab: 0.6, Punching: 1, PunchCombo: 0.7, ElbowPunching: 0.25, RightHook: 0.25, Uppercut: 0.3 };
const _twQ = new THREE.Quaternion();
const _twP = new THREE.Quaternion();
const _twY = new THREE.Vector3(0, 1, 0);
const smooth01 = (x) => { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); };
function strikeBodyCurve(f, dt) {
  const sb = f._sb || (f._sb = { v: TWIST_LINKS.map(() => 0), shift: 0, sign: 1, side: 'R' });
  const plan = f.state === 'punch' && f.strikePlan && f.strikePlan.clip === f.attackClip ? f.strikePlan : null;
  const action = plan && f.actions[plan.clip];
  if (plan && action) {
    const ct = action.time;
    const sc = (TWIST_SCALE[plan.clip] || 0.8) * (f === p1 && cameraMode() === 'first' ? 0.35 : 1);
    sb.sign = plan.side === 'L' ? -1 : 1; // the punching shoulder comes forward
    sb.side = plan.side;
    const load = smooth01((ct - plan.t0) / Math.max(0.03, plan.tw - plan.t0));
    const s = (ct - plan.tw) / Math.max(0.03, plan.pk - plan.tw);
    const rec = ct > plan.pk ? 1 - smooth01((ct - plan.pk) / Math.max(0.05, plan.end - plan.pk)) : 1;
    for (let i = 0; i < TWIST_LINKS.length; i++) {
      const [, L, D, delay] = TWIST_LINKS[i];
      const d = ct < plan.tw ? 0 : smooth01((s - delay) / 0.8);
      sb.v[i] = sc * sb.sign * DEG * (ct < plan.tw ? -L * load : (-L * (1 - d) + D * d) * rec);
    }
    const dh = ct < plan.tw ? 0 : smooth01(s / 0.8);
    sb.shift = (ct < plan.tw ? -0.4 * load : (-0.4 * (1 - dh) + dh) * rec) * (f === p1 && cameraMode() === 'first' ? 0.5 : 1);
    f._strikeDrive = Math.max(0, dh * rec);
  } else {
    // Out of the punch the layer settles back over ~0.1 s instead of snapping.
    const k = Math.exp(-Math.max(dt || 0, 1 / 120) * 22);
    for (let i = 0; i < sb.v.length; i++) sb.v[i] *= k;
    sb.shift *= k;
    if (Math.abs(sb.shift) < 1e-3) sb.shift = 0;
    f._strikeDrive = 0;
  }
  return sb;
}
function yawBoneWorld(b, ang) {
  if (!b || !b.parent || !(Math.abs(ang) > 1e-5)) return;
  b.parent.getWorldQuaternion(_twP);
  _twQ.setFromAxisAngle(_twY, ang);
  const q = _twP.clone().invert().multiply(_twQ).multiply(_twP);
  if (!qOk(q)) return;
  b.quaternion.premultiply(q).normalize();
  b.updateMatrixWorld(true);
}
function applyStrikeTwist(f) {
  const sb = f._sb;
  if (!sb || !f.hips || DOWN_STATES.has(f.state)) return;
  if (!sb.v.some((a) => Math.abs(a) > 1e-4)) return;
  f.model.updateWorldMatrix(true, true);
  for (let i = 0; i < TWIST_LINKS.length; i++) {
    const a = sb.v[i];
    if (!Number.isFinite(a)) { sb.v[i] = 0; continue; }
    const key = TWIST_LINKS[i][0];
    if (key === 'hips') {
      yawBoneWorld(f.hips, a);
      for (const s of ['L', 'R']) yawBoneWorld(f.ikLegs && f.ikLegs[s] && f.ikLegs[s].thigh, -a);
    } else if (key === 'shoulder') {
      yawBoneWorld(f.ikArms && f.ikArms[sb.side] && f.ikArms[sb.side].shoulder, a);
    } else yawBoneWorld(f.flinchBones && f.flinchBones[key], a);
  }
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
  if (!qOk(_stQ)) return;
  bone.quaternion.premultiply(_stQ);
  bone.updateMatrixWorld(true);
}
// Flex a knee along its fitted hinge axis. A turn about the body's right axis twisted any
// knee whose leg was not square to the body (fighting stance, strafe).
function bendKnee(f, shin, ang) {
  const j = hingeOf(f, shin);
  if (!j || Math.abs(ang) < 1e-4) return;
  flexHinge(j, ang);
  shin.updateMatrixWorld(true);
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
    const fxBend = damageFx().bend;
    const bend = standing && !lost[side] ? Math.min(1, legDamage(f, side) * fxBend) : 0;
    if (bend > 0.12) {
      f.model.updateWorldMatrix(true, true);
      const b = (bend - 0.12) / 0.88;
      const ang = Math.min(1.6, 0.85 + 0.3 * fxBend);
      _stFwd.set(Math.sin(f.root.rotation.y), 0, Math.cos(f.root.rotation.y));
      rotateBoneWorldAxis(leg.thigh, _stFwd, (side === 'L' ? -1 : 1) * 0.1 * b * ang); // knocked out of line
      rotateBoneWorldAxis(leg.thigh, _stAxis, -0.1 * b * ang);
      bendKnee(f, leg.shin, 0.32 * b * ang);                                       // knee stays bent
      if (leg.foot) rotateBoneWorldAxis(leg.foot, _stFwd, (side === 'L' ? 1 : -1) * 0.12 * b * ang); // ankle rolled
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
    bendKnee(f, leg.shin, knee * w);                   // stump folds back
    // Pin the torn foot/toe so the stump cannot whip (yaw spikes after a foot comes off).
    if (leg.foot && leg.foot.userData.bindQ) leg.foot.quaternion.slerp(leg.foot.userData.bindQ, 0.55 * w);
    if (leg.toe && leg.toe.userData.bindQ) leg.toe.quaternion.slerp(leg.toe.userData.bindQ, 0.65 * w);
  }
}

function resetMatch(keepDebris = false) {
  syncEnvironment();
  for (const f of [p1, p2]) {
    if (f.mixer) f.mixer.timeScale = 1;
    f.downLying = false;
    f.downClip = null;
    f.health = COMBAT.maxHealth;
    clearSpecial(f);
    initSpecial(f);
    f.state = 'idle';
    f.stateT = 0;
    f.cooldown = 0;
    f.invuln = 0;
    f.chain = 0;
    f.chainHit = false;
    f.lastPunchAt = null;
    f.blocking = false;
    f.hitThisAttack = false;
    f.shield.visible = false;
    f.root.position.set(f.startX, matTopY(), 0);
    f._rootWarp = true;
    f._prevRoot = null;
    f.root.scale.set(1, 1, 1);
    f.groundY = matTopY();
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
  clearBell();
  match.over = false;
  match.winner = null;
  match.phase = 'intro';
  match.introT = 0;
  match.camLock = false;
  match.roundLeft = null;
  match.koT = 0;
  match.orbitT = 0;
  match.overlayAt = 0;
  held.buf = null;
  resetHudGhost();
  paintRound();
  const banner = document.getElementById('banner');
  banner.style.opacity = '';
  banner.classList.remove('show');
  faceEachOther(p1, p2, 0, true);
  syncHud();
}

function publicFighterConfig(f) {
  const c = f && f.config ? { ...f.config } : {};
  if (c.apiBrain) { const a = { ...c.apiBrain }; delete a.key; c.apiBrain = a; }
  delete c.key;
  return c;
}

const _logH = new THREE.Vector3();
const _logHd = new THREE.Vector3();
const _logFt = new THREE.Vector3();
function fighterLogPose(f) {
  if (!f || !f.root) return null;
  const r = f.root.position;
  let hips = r.y + 1.0 * SIZE, head = r.y + 1.7 * SIZE;
  if (f.hipsBone) { f.hipsBone.getWorldPosition(_logH); hips = _logH.y; }
  const hb = f.flinchBones && f.flinchBones.Head;
  if (hb) { hb.getWorldPosition(_logHd); head = _logHd.y; }
  let footX = r.x, footZ = r.z;
  const foot = f.ikLegs && ((f.ikLegs.L && f.ikLegs.L.foot) || (f.ikLegs.R && f.ikLegs.R.foot));
  if (foot) { foot.getWorldPosition(_logFt); footX = _logFt.x; footZ = _logFt.z; }
  // Both soles (toe or ankle, whichever is lower) for the planted-foot slide check.
  const feet = [];
  for (const side of ['L', 'R']) {
    const leg = f.ikLegs && f.ikLegs[side];
    if (!leg || !leg.foot) { feet.push(null); continue; }
    // Lowest of ankle / toe for "on the mat", plus both points' XZ: the log judges a slide by
    // the slower of the two, so a foot pivoting on its heel or on its ball isn't a slide.
    leg.foot.getWorldPosition(_logFt);
    let y = _logFt.y, tx = _logFt.x, tz = _logFt.z;
    if (leg.toe) { leg.toe.getWorldPosition(_logH); y = Math.min(y, _logH.y); tx = _logH.x; tz = _logH.z; }
    feet.push([_logFt.x, y, _logFt.z, tx, tz]);
  }
  const cap = f.phys && f.phys.body && f.phys.body.position;
  const act = f.current && f.actions[f.current];
  const vis = f._visCount;
  return {
    x: r.x, z: r.z, y: r.y, yaw: f.root.rotation.y,
    hips, head, wall: wallDist(r.x, r.z),
    state: f.state, clip: f.current,
    wx: act ? act.getEffectiveWeight() : 1,
    footX, footZ, feet, low: f._lowY,
    capX: cap ? cap.x : r.x, capZ: cap ? cap.z : r.z,
    vis: vis && vis.n, mats: vis && vis.mats,
  };
}
function countFighterVis(f) {
  if (!f || !f.model) return { n: 0, mats: 0 };
  let n = 0, mats = 0;
  const seen = new Set();
  f.model.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    n += 1;
    const m = o.material;
    if (m && !seen.has(m)) { seen.add(m); mats += 1; }
  });
  return { n, mats };
}

// Off the fight loop (menus, fighter select, results) the fight's own effects must not freeze
// in mid-air: dash jets / shockwave rings are removed, sparks and smoke keep falling
// and fading, and loose debris settles or shrinks away.
function stepLooseEffects(dt, noPhysics) {
  for (const f of [p1, p2]) if (f && f.special) clearSpecial(f);
  if (noPhysics) settleLooseDebris();
  stepDamage(scene, dt);
}

// Pose sanity: a non-finite bone rotation (one bad IK / limit frame) would make that limb vanish
// for a frame and poison anything that follows the bone (stump wires kept NaN for good). Any
// such bone goes back to its last good pose and the fight log records which bone and clip.
function guardPose(f) {
  if (!f.poseBones) {
    f.poseBones = [];
    f.model.traverse((o) => { if (o.isBone) f.poseBones.push({ b: o, q: o.quaternion.clone(), p: o.position.clone() }); });
  }
  let bad = null;
  for (const e of f.poseBones) {
    const q = e.b.quaternion, p = e.b.position;
    if (Number.isFinite(q.x + q.y + q.z + q.w + p.x + p.y + p.z)) { e.q.copy(q); e.p.copy(p); continue; }
    q.copy(e.q); p.copy(e.p);
    if (!bad) bad = boneKey(e.b.name);
  }
  if (bad) {
    f.model.updateWorldMatrix(true, true);
    logGlitch('nanBone', { id: f.id, bone: bad, state: f.state, clip: f.current });
  }
}

function tick() {
  const now = performance.now();
  if (renderer && renderer.info && renderer.info.reset) renderer.info.reset();
  if (tick._wall == null) tick._wall = now;
  const wallDt = Math.min(0.25, Math.max(0.0001, (now - tick._wall) / 1000));
  tick._wall = now;
  const rawDt = Math.min(0.05, clock.getDelta());
  const fps = updateFps(wallDt);
  logFps(fps);
  stepFov(rawDt);
  stepFlash(rawDt);
  stepShake(rawDt);
  const frozen = !isSettingsOpen() && impactFreeze > 0;
  if (impactFreeze > 0) impactFreeze = Math.max(0, impactFreeze - rawDt);
  let dt = isSettingsOpen() ? 0 : rawDt;
  let camDt = dt;
  if (frozen) camDt = rawDt;
  else if (!isSettingsOpen() && koSlowLeft > 0 && dt > 0) {
    koSlowLeft = Math.max(0, koSlowLeft - rawDt);
    dt *= 0.5;
    camDt = dt;
  }
  if (match.over && match.overlayAt && performance.now() >= match.overlayAt) showKoOverlay();
  const live = !!(p1 && p2 && fightersStaged && !previewMode);
  if (live && !bellRung && (shellRoundOver() || match.over)) ringBell('round');
  let canAct = false;
  const simT0 = performance.now();
  if (live) {
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
  // dt is 0 while the shell pause or Settings holds the clock: nobody decides or acts then (a
  // CPU used to start strikes into a frozen frame, and the log counted it as stuck).
  canAct = match.phase === 'fight' && !match.over && !inBell() && !isSettingsOpen() && !frozen && dt > 0;
  const watch = !!shellCall('cpuControls', 'p1'); // Bot vs Bot: P1 is a CPU too
  p1.isCpu = watch;
  const emptyIn = { sidestep: 0, inout: 0, punch: false, kick: false, block: false };
  let pin;
  let ain;
  if (frozen) {
    // Hold the input buffer (dt 0) so a press during the freeze is remembered, not burned.
    if (!watch) consumeAttacks(rawInput(), 0);
    pin = emptyIn;
    ain = emptyIn;
    dt = 0;
  } else {
    pin = canAct ? (watch ? updateAI(p1, p2, dt) : consumeAttacks(rawInput(), dt)) : consumeAttacks(emptyIn, 1);
    ain = canAct ? updateAI(p2, p1, dt) : emptyIn;
  }
  tapped.clear();
  shellCall('clearTapped');

  const p1Was = p1.state;
  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  // A buffered press is used up once the attack it asked for has started.
  if (held.buf && p1.state !== p1Was && (p1.state === 'punch' || p1.state === 'kick' || p1.state === 'ground' || p1.state === 'dodge' || p1.state === 'dash')) held.buf = null;
  stepPhysics(dt);
  stepSpecial(p1, p2, dt);
  stepSpecial(p2, p1, dt);
  // A robot that is falling, lying or getting up does not block the other (so it can be
  // stomped), but it still hits the cage and the floor so it cannot slide out of the ring.
  for (const f of [p1, p2]) setFighterDowned(f, DOWN_STATES.has(f.state) || !!f.ghost);
  if (!DOWN_STATES.has(p1.state) && !DOWN_STATES.has(p2.state) && !p1.ghost && !p2.ghost) separate(p1, p2, dt);
  faceEachOther(p1, p2, dt);
  for (const f of [p1, p2]) {
    restoreRawPose(f);
    updateBaseLayer(f);
    f.mixer.update(dt);
    f.root.position.y = 0;
    if (window.__rfDiag) diagFootStage(f, 0);
    poseAfterMixer(f, dt);
    if (window.__rfDiag) diagFootStage(f, 1);
    applyMalfunctions(f, dt);
    armSelfClear(f);
    const clipAmt = limbPushout(f, f === p1 ? p2 : p1);
    // A strike still pressed into the other body after the push-out (the hook that stayed
    // buried for seconds in the log): ease the two bodies apart next frame.
    f._clipPush = dt > 0 && (f._clipOther || 0) > CLIP_PUSH_MIN ? f._clipOther : 0;
    if (dt > 0 && clipAmt > 0.04 * SIZE) logGlitch('clipping', { id: f.id, d: +clipAmt.toFixed(3), clip: f.current });
    if (f.koTip) stepKoTip(f, dt);
    stepEyes(f, dt);
    if (window.__rfDiag) diagFootStage(f, 2);
    const jf0 = (f.jointStats && f.jointStats.flips) || 0;
    if (f.jointStats) f.jointStats.flipBones.length = 0;
    applyJointLimits(f);
    const jf = f.jointStats ? f.jointStats.flips - jf0 : 0;
    if (jf > 0 && dt > 0) logGlitch('jointFlip', { id: f.id, n: jf, state: f.state, clip: f.current, bones: f.jointStats.flipBones.join(',') });
    blendLegPose(f, dt);
    if (window.__rfDiag) diagFootStage(f, 3);
    groundFeet(f, dt);
    guardPose(f);
    clampRootMotion(f, dt);
    // Keep roots inside the octagon after clip motion and knockdown travel.
    const pad = DOWN_STATES.has(f.state) || f.ghost ? CAGE_PAD + 0.15 : CAGE_PAD;
    placeInOctagon(f.root.position, pad, false);
    if (f.phys && f.phys.body) {
      f.phys.body.position.x = f.root.position.x;
      f.phys.body.position.z = f.root.position.z;
    }
    if (window.__rfDiag) diagFootStage(f, 4);
    if (window.__rfDiag && (f.state === 'idle' || f.state === 'block')) logFloat(f);
    if (window.__rfDiag) logSlide(f, dt);
    stepFootSounds(f, dt);
  }
  if (canAct) {
    const reach = (COMBAT.kick && COMBAT.kick.reach) || (COMBAT.punch && COMBAT.punch.reach) || 1.7 * SIZE;
    const gap = p1.root.position.distanceTo(p2.root.position);
    const canThrow = (f) => !DOWN_STATES.has(f.state) && f.state !== 'hit' && f.state !== 'punch' && f.state !== 'kick' && f.state !== 'ground'
      && ((canPunch(f) && punchClipsFor(f).length > 0) || canKick(f)); // no limb left to strike with is not "stuck"
    // A robot waiting for the other to get up is not stuck.
    if (usesCpuBrain(p1)) logCpuIdle('p1', gap < reach * 1.25 && !DOWN_STATES.has(p2.state), canThrow(p1), dt);
    if (usesCpuBrain(p2)) logCpuIdle('p2', gap < reach * 1.25 && !DOWN_STATES.has(p1.state), canThrow(p2), dt);
  }
  updateContactShadows(p1);
  updateContactShadows(p2);
  collectWireObstacles();
  stepDamage(scene, dt);
  if (!match.over && match.phase === 'fight') {
    if (isCatastrophic(p1) && p1.state !== 'ko') ko(p1, p2, { reason: p1.parts.head && p1.parts.head.detached ? 'head' : 'legs' });
    else if (isCatastrophic(p2) && p2.state !== 'ko') ko(p2, p1, { reason: p2.parts.head && p2.parts.head.detached ? 'head' : 'legs' });
  }
  } else if (previewMode === 'select' && p1 && p2) {
    tapped.clear();
    shellCall('clearTapped');
    stepSelectPreview(dt);
    setWireObstacles([]);
    stepLooseEffects(dt, true);
  } else {
    tapped.clear();
    shellCall('clearTapped');
    stepPhysics(dt);
    setWireObstacles([]);
    stepLooseEffects(dt, false);
  }

  if (!match.camLock) updateCamera(camDt);
  placeTitles();
  updateFighterRims();
  hitLight.intensity = Math.max(0, hitLight.intensity - dt * 28);
  setBuzz(isSettingsOpen() ? 0 : buzzFromFighters());
  syncHud(dt);
  try { updateBroadcast(); } catch (e) { console.warn('[broadcast]', e); }
  updateCageFade(cagePanels, camera, rawDt);
  scheduleShadows();
  const renderT0 = performance.now();
  renderFrame();
  const renderMs = performance.now() - renderT0;
  const simMs = renderT0 - simT0;
  stepDynamicRes(wallDt);
  if (!tick._memT || now - tick._memT > 1000) { tick._memT = now; try { memSnapshot(); } catch (_) {} }
  if (match.phase === 'fight' && p1 && p2) {
    if (!tick._visT || now - tick._visT > 200) {
      tick._visT = now;
      p1._visCount = countFighterVis(p1);
      p2._visCount = countFighterVis(p2);
    }
    const debrisFlags = [];
    const list = typeof getPhysicsDebris === 'function' ? getPhysicsDebris() : [];
    const floorY = matTopY() - 0.05;
    for (const d of list) {
      const pos = d.body ? d.body.position : (d.mesh && d.mesh.position);
      if (!pos) continue;
      // Each escape is reported once (the flag used to stay set and count every frame).
      const out = !!d.escapedNew || (!d.frozen && wallDist(pos.x, pos.z) < -0.05);
      d.escapedNew = false;
      const under = !d.frozen && pos.y < floorY;
      if (out || under) debrisFlags.push({ x: pos.x, y: pos.y, z: pos.z, out, under });
    }
    const camPos = camera.position;
    const info = renderer.info && renderer.info.render;
    const mem = renderer.info && renderer.info.memory;
    stepFightQuality({
      phase: match.phase,
      dt, wallDt, fps, simMs, renderMs,
      render: info ? { calls: info.calls, tris: info.triangles, geometries: mem ? mem.geometries : 0, textures: mem ? mem.textures : 0, programs: renderer.info.programs ? renderer.info.programs.length : 0, pr: +renderer.getPixelRatio().toFixed(2) } : null,
      debrisLive: list.length,
      camMode: camModeLive || (getSettings() && getSettings().cam),
      camAuto: camModeAuto,
      camManual: (camModeLive === 'arena' && (orbit.drag || now - orbit.touchedAt < 1500)) || (!camModeAuto && now - camModeChangedAt < 1200),
      matY: matTopY(),
      draws: info ? info.calls : 0,
      tris: info ? info.triangles : 0,
      shadowOn: !!(renderer.shadowMap && renderer.shadowMap.enabled),
      p1: fighterLogPose(p1),
      p2: fighterLogPose(p2),
      gap: p1.root.position.distanceTo(p2.root.position),
      cam: { x: camPos.x, y: camPos.y, z: camPos.z, wall: wallDist(camPos.x, camPos.z) },
      debris: debrisFlags.length ? debrisFlags : null,
    });
  }
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

// Shader pre-warm. Effects (sparks, smoke, oil, torn-off parts, chips, wires, dash
// jets) used to compile their shaders the first time they appeared mid-fight: 100-250 ms
// hitches on a Mac, and the log showed new programs being linked all fight long. At fight start
// (and after a graphics change) one tiny copy of every variant is compiled with the live lights
// and shadow setup, off the main thread where the browser supports it, then removed.
let warmedFor = '';
let warmKeep = []; // warm-up materials kept alive so their programs stay cached
function prewarmShaders() {
  if (!p1 || !p2) return;
  const key = gfxKey + '|' + (renderer.shadowMap.enabled ? 1 : 0) + '|' + (hdriEnabled && hdriEnv ? 1 : 0);
  if (warmedFor === key) return;
  warmedFor = key;
  const g = new THREE.Group();
  g.name = 'shaderWarm';
  const geo = new THREE.BoxGeometry(0.001, 0.001, 0.001);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
  const temp = [];
  const add = (obj) => { obj.frustumCulled = false; g.add(obj); return obj; };
  const robotMats = new Set();
  for (const f of [p1, p2]) f.model.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m) robotMats.add(m); });
  for (const m of robotMats) {
    // Torn-off pieces and chips: the robot materials on plain and instanced meshes, lit and
    // shadow-receiving or not (settled debris drops shadows), with and without vertex colours.
    const plain = m.clone();
    plain.vertexColors = false;
    temp.push(plain);
    for (const mat of [m, plain]) {
      for (const recv of [true, false]) {
        const a = add(new THREE.Mesh(geo, mat)); a.receiveShadow = recv; a.castShadow = recv;
        const b = add(new THREE.InstancedMesh(geo, mat, 1)); b.receiveShadow = recv; b.castShadow = recv;
      }
    }
  }
  for (const f of [p1, p2]) if (f.shield) add(new THREE.Mesh(geo, f.shield.material)); // hidden until a block
  for (const m of damageWarmMaterials()) add(new THREE.Mesh(geo, m));
  const wm = wireWarmMaterials();
  for (const m of wm.mesh) add(new THREE.Mesh(geo, m));
  add(new THREE.Line(geo, wm.line));
  const fx = specialWarmObjects();
  for (const o of fx) { o.visible = true; add(o); }
  camera.getWorldDirection(_warmDir);
  g.position.copy(camera.position).addScaledVector(_warmDir, 2);
  scene.add(g);
  // The warm-up materials stay alive: three frees a program when the last material using it
  // is disposed, so effects that make and dispose their own materials (jets, chips) would
  // otherwise compile again on every use. The previous set is released only after this one
  // holds the programs.
  const keep = temp.slice();
  for (const o of fx) o.traverse((c) => { if (c.material) keep.push(c.material); });
  const done = () => {
    scene.remove(g);
    geo.dispose();
    for (const o of fx) o.traverse((c) => { if (c.geometry && c.geometry !== geo) c.geometry.dispose(); });
    for (const m of warmKeep) if (!keep.includes(m)) m.dispose();
    warmKeep = keep;
  };
  // Parallel compile where the browser has it (Chrome); otherwise a plain compile right now.
  // compile() can't see every variant a real frame uses (the transmission pass renders into a
  // linear target without tone mapping; shadow depth programs), so one real frame with the
  // invisible warm-up set in view follows; it builds exactly the programs the fight will use.
  const finish = () => { try { renderFrame(); } catch (e) { /* the next tick renders anyway */ } done(); };
  const p = renderer.extensions.has('KHR_parallel_shader_compile') ? renderer.compileAsync(scene, camera) : null;
  if (p && p.then) p.then(finish, done);
  else { renderer.compile(scene, camera); finish(); }
}
const _warmDir = new THREE.Vector3();

function startFightFromShell(opts) {
  opts = opts || {};
  hideSelectPreview({ keepStaged: true });
  stageFighters();
  if (opts.p1) applyFighterConfig(swapSkin('p1', opts.p1.skin || null, opts.p1), opts.p1);
  if (opts.p2) applyFighterConfig(swapSkin('p2', opts.p2.skin || null, opts.p2), opts.p2);
  if (opts.round != null) match.roundIndex = opts.round;
  if (opts.roundTime != null) match.roundTimeOverride = opts.roundTime;
  // Shell owns best-of-N rounds; stash opts.bestOf so getFightState can report it if no shell match is running.
  if (opts.bestOf === 1 || opts.bestOf === 3 || opts.bestOf === 5) match.bestOf = opts.bestOf;
  if (opts.onEnd) onFightEnd(opts.onEnd);
  // Debris is cleared between rounds so landed pieces cannot pile up and cost frames.
  resetMatch(false);
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
  if (!arenaLoaded) return { ready: false };
  if (!p1 || !p2 || !fightersStaged) {
    return { ready: true, staged: false, phase: match.phase || 'idle', over: false, winner: null, roundIndex: match.roundIndex, roundLeft: null, bestOf: match.bestOf || 1, wins: { p1: 0, p2: 0 } };
  }
  const sh = window.RFShell && window.RFShell.match;
  const wins = (sh && sh.wins)
    ? { p1: sh.wins[0] || 0, p2: sh.wins[1] || 0 }
    : (match.wins || { p1: 0, p2: 0 });
  const bestOf = (sh && sh.bestOf) || match.bestOf || 1;
  return {
    ready: true,
    phase: match.phase,
    over: match.over,
    winner: match.winner,
    roundIndex: match.roundIndex,
    roundLeft: match.roundLeft,
    bestOf,
    wins,
    p1: { health: p1.health, state: p1.state, config: publicFighterConfig(p1) },
    p2: { health: p2.health, state: p2.state, config: publicFighterConfig(p2) },
  };
}

function onLoad(gltf) {
  const built = buildArenaVisual(scene, { tiled, metalColor, metalRough });
  const lightRig = addArenaLights(scene, built.fixturePos);
  syncEnvironment(); // the void wall exists now: hide it if the HDRI backdrop is on
  // Sharp planar mirror on the metal mat (hidden on Low).
  addFloorReflection(scene).then((m) => {
    floorMirror = m;
    if (floorMirror) {
      floorMirror.visible = gfxKey !== 'low' && !IS_IOS;
      setMirrorRes(floorMirror);
    }
  });
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
  cagePanels = built.fencePanels;
  initBroadcast({
    scene, renderer, camera, canvas,
    getFighters: () => [p1, p2], getMatch: () => match,
  });
  initArenaPhysics();
  fighterGltf = gltf;
  downscaleGltfTextures(gltf.scene, textureMaxDim());
  // Load only the two fighters in the current match / preview, not the whole roster.
  onPhysicsBounce((kind, impact, rec) => {
    const mass = rec && rec.mass != null ? rec.mass : 4;
    // Heavier parts hit harder and lower: loudness grows with impact speed and mass.
    const vol = Math.min(1, 0.22 + impact / 7 + Math.min(0.25, mass / 40));
    const rate = 0.92 + Math.min(0.15, impact / 30);
    const id = rec && rec.body ? rec.body.id : undefined;
    if (kind === 'cage' || kind === 'post') playSfx('cage', { vol, rate, id });
    else playSfx('bounce', { vol, rate, id, mass });
  });
  hookFightLogShell();
  bindSpecials({
    scene, gfxKey, playSfx, setAnim, idleClipFor, toward, placeInOctagon, endAttack, setFighterMove,
    inBell, canPunch, logBellBlock, logSpecial, logInputAction, endAir, addShake,
    matTop: ARENA.matTop || 0,
    strikeStart: (clip) => (STRIKE_T && STRIKE_T[clip] ? STRIKE_T[clip].start : null),
    // Shoulder charge / ground slam / overheat: a body blow through the normal hit path
    // (damage, guard, reaction, knockdown chance, KO). False if it couldn't land.
    dealSpecialHit(atk, def, spec, point, dir) {
      if (def.state === 'ko' || DOWN_STATES.has(def.state) || def.invuln > 0) return false;
      applyHit(atk, def, { damage: spec.damage, knock: spec.knock || 0 }, 'special', null, { point, dir });
      return true;
    },
    // The shared contact light, used as the overheat glow / slam flash (no extra light).
    heatLight(pos, color, intensity) {
      hitLight.color.setHex(color);
      hitLight.intensity = Math.max(hitLight.intensity, intensity);
      hitLight.position.copy(pos);
    },

  });
  arenaLoaded = true;
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
      let f = id === 'p2' ? p2 : p1;
      if (!f) return null;
      if (cfg && 'skin' in cfg) f = swapSkin(f.id, cfg.skin || null, cfg);
      applyFighterConfig(f, cfg);
      return f.config;
    },
    showSelectPreview,
    hideSelectPreview,
    previewSelectFighter,
    preloadSkin: loadSkin,
    memSnapshot,
  });
  applyGfx(gfxKey);
  resize();
  // Robots stay out of the scene until a fight starts (preloaded gltf only).
  try { renderer.compile(scene, camera); noteFrameWork('compile'); } catch (_) {}
  document.getElementById('loader').classList.add('hidden');
  document.getElementById('again').addEventListener('click', () => { stageFighters(); resetMatch(); });
  window.__rfPreviewDamage = () => {
    stageFighters();
    match.phase = 'fight';
    match.introT = 99;
    match.camLock = true;
    const banner = document.getElementById('banner');
    banner.classList.remove('show');
    banner.style.opacity = '0';
    const towardCam = new THREE.Vector3(0.15, 0.05, 1);
    const info = previewDamage(p2, scene, towardCam);
    const look = new THREE.Vector3(p2.root.position.x - 0.15, matTopY() + 0.75, p2.root.position.z + 0.7);
    camera.position.set(p2.root.position.x - 0.4, matTopY() + 2.55, p2.root.position.z + 5.1);
    camera.lookAt(look);
    window.__rfDebug = info;
    applyMalfunctions(p1, 0);
    applyMalfunctions(p2, 0);
    stepDamage(scene, 0);
    syncHud();
    renderFrame();
  };
  window.__rfSetHdri = (on) => applyHdri(!!on);
  window.__rfHdriReady = () => !!hdriEnv;
  window.__rfCenterShot = () => {
    startFightFromShell({ skipIntro: true });
    const banner = document.getElementById('banner');
    if (banner) { banner.classList.remove('show'); banner.style.opacity = '0'; }
    const overlay = document.getElementById('overlay');
    if (overlay) overlay.classList.add('hidden');
    const fps = document.getElementById('fps');
    if (fps) fps.classList.add('hidden');
    match.camLock = true;
    const mid = new THREE.Vector3().addVectors(p1.root.position, p2.root.position).multiplyScalar(0.5);
    const mt = matTopY();
    camera.fov = 38;
    camera.updateProjectionMatrix();
    camera.position.set(mid.x, mt + 3.55, mid.z + 11.0);
    camera.lookAt(mid.x, mt + 1.55 * SIZE, mid.z);
    renderFrame();
    return { y: camera.position.y, lookY: mt + 1.55 * SIZE, size: SIZE, matTop: mt, gfx: gfxKey };
  };
  // Debug / automated checks: start a named move for one side; returns whether it started.
  window.__rfMove = (id, move) => {
    const f = id === 'p2' ? p2 : p1;
    const ok = tryMove(f, f === p1 ? p2 : p1, move);
    return { ok, state: f.state, clip: f.attackClip, energy: f.energy };
  };
  window.__rfMoveReach = () => Object.fromEntries(Object.entries(MOVES).map(([id, mv]) => [id, +(moveReach(mv) || 0).toFixed(2)]));
  window.__rfFighters = () => [p1, p2].map((f) => ({ state: f.state, hp: f.health, energy: f.energy, x: +f.root.position.x.toFixed(2), z: +f.root.position.z.toFixed(2), clip: f.attackClip, move: f.moveId || f.specialKind || null, cd: f.cooldown }));
  // Debug: put P1 this far (root to root) in front of P2, facing it.
  window.__rfPlace = (gap) => {
    const dir = toward(p2, p1);
    p1.root.position.set(p2.root.position.x + dir.x * gap, p1.root.position.y, p2.root.position.z + dir.z * gap);
    if (p1.phys && p1.phys.body) { p1.phys.body.position.x = p1.root.position.x; p1.phys.body.position.z = p1.root.position.z; }
    p1._rootWarp = true;
    return +p1.root.position.distanceTo(p2.root.position).toFixed(2);
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
  // Leg check: knee flex (deg) on the fitted hinge, how far knee/ankle/toe sit from their bind
  // spot inside the parent bone (must stay 0: bones never stretch), and foot plant weights.
  window.__rfLegCheck = () => [p1, p2].map((f) => ({
    id: f.id, state: f.state, clip: f.current,
    knee: ['LeftLeg', 'RightLeg'].map((k) => (f.hinges && f.hinges[k] ? +(hingeAngle(f.hinges[k]) * 57.2958).toFixed(1) : null)),
    boneOff: ['L', 'R'].map((s) => Math.max(...['shin', 'foot', 'toe'].map((n) => {
      const b = f.ikLegs && f.ikLegs[s][n];
      return b && b.userData.restP ? +b.position.distanceTo(b.userData.restP).toFixed(6) : 0;
    }))),
    plant: f.footPlant ? [+f.footPlant.L.w.toFixed(2), +f.footPlant.R.w.toFixed(2)] : null,
    flips: f.jointStats ? f.jointStats.flips : 0,
  }));
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
    if (close === 'feet') { camera.position.set(c.x + 1.3, matTopY() + 0.55, c.z + 1.3); camera.lookAt(c.x, matTopY() + 0.15, c.z); return; }
    if (close) { camera.position.set(c.x + 1.1, matTopY() + 1.6, c.z + 1.7); camera.lookAt(c.x, matTopY() + 1.25, c.z); return; }
    camera.position.set(c.x + 2.6, matTopY() + 1.3, c.z + 3.2);
    camera.lookAt(c.x, matTopY() + 0.5, c.z);
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
  // Debug: objects spawned into the scene since the first call (strays: parts, chips, jets).
  window.__rfStrays = () => {
    const base = window.__rfStrayBase || (window.__rfStrayBase = new Set(scene.children));
    return scene.children.filter((o) => !base.has(o) && o.visible && o !== p1.root && o !== p2.root && (o.isMesh || o.isGroup))
      .map((o) => [o.uuid.slice(0, 6), o.name || '', +(o.position.y - matTopY()).toFixed(2), o.geometry ? o.geometry.type : o.children.length, o.material && o.material.color ? o.material.color.getHexString() : '', Object.keys(o.userData || {}).join('|')]);
  };
  // Debug: punching arm extension (shoulder-to-hand / arm length) and the strike phase.
  window.__rfArmExt = (id, punch, gap) => {
    const f = id === 'p1' ? p1 : p2;
    if (punch) {
      const o = f === p1 ? p2 : p1;
      if (gap) { const d = toward(f, o); o.root.position.set(f.root.position.x + d.x * gap, o.root.position.y, f.root.position.z + d.z * gap); if (o.phys && o.phys.body) o.phys.body.position.set(o.root.position.x, o.phys.body.position.y, o.root.position.z); }
      f.cooldown = 0; const cpu = f.isCpu; f.isCpu = false; if (f.state !== 'punch') tryAttack(f, 'punch', punch, true); f.isCpu = cpu;
    }
    const a = f.ikArms && f.ikArms[punchingArmSide(f)]; if (!a || !a.upper) return null;
    const A = a.upper.getWorldPosition(new THREE.Vector3()), B = a.lower.getWorldPosition(new THREE.Vector3()), C = a.hand.getWorldPosition(new THREE.Vector3());
    const act = f.actions[f.attackClip];
    return { st: f.state, clip: f.attackClip, t: act ? +act.time.toFixed(3) : null, ts: act ? +act.timeScale.toFixed(2) : null, ext: +(A.distanceTo(C) / (A.distanceTo(B) + B.distanceTo(C))).toFixed(3), w: +punchExtendWeight(f).toFixed(2), hit: !!f.hitThisAttack, retract: !!f.retract, gap: +f.root.position.distanceTo((f === p1 ? p2 : p1).root.position).toFixed(2) };
  };
  // Debug: a fighter's facing (deg): root yaw, and the hips' spine / chest headings in world.
  window.__rfYawProbe = (id) => {
    const f = id === 'p1' ? p1 : p2; const hq = f.hips.getWorldQuaternion(new THREE.Quaternion());
    const y = new THREE.Vector3(0, 1, 0).applyQuaternion(hq); const z = new THREE.Vector3(0, 0, 1).applyQuaternion(hq);
    const d = (v) => Math.round(Math.atan2(v.x, v.z) * 57.3);
    return { st: f.state, clip: f.downClip || f.koClip || null, root: Math.round(f.root.rotation.y * 57.3), spine: d(y), chest: d(z), up: +y.y.toFixed(2), x: +f.root.position.x.toFixed(2), z: +f.root.position.z.toFixed(2) };
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
  window.__rfShed = (id, partId = 'torso', force = 5) => {
    const f = id === 'p1' ? p1 : p2;
    const pt = f.root.position.clone().add(new THREE.Vector3(0, (partId.startsWith('arm') ? 1.25 : 1.1) * SIZE, 0.12 * SIZE));
    const c = bodyCaps(f).find((k) => k.part === partId);
    if (c) c.a.getWorldPosition(pt);
    return shedChips(f, partId, pt, new THREE.Vector3(0, 0, 1), force, scene);
  };
  window.__rfBlowEye = (id, side = 'L') => { const f = id === 'p1' ? p1 : p2; const e = f.eyes && f.eyes.find((x) => x.side === side); blowEye(f, e, new THREE.Vector3(0, 0, 1)); return f.eyes.map((x) => x.blown); };
  window.__rfFighterStats = (id) => (id === 'p1' ? p1 : p2).stats;
  // Debug: a strong non-knockdown stumble with a chosen stun (long stuns used to sink the robot).
  window.__rfForceStumble = (id, stun = 1.4) => {
    const f = id === 'p1' ? p1 : p2;
    const o = f === p1 ? p2 : p1;
    if (!f.actions.StumbleBackwards || DOWN_STATES.has(f.state) || f.state === 'ko') return null;
    startHitReaction(f, toward(o, f), { clip: 'StumbleBackwards', useStumble: true, lightTap: false, stun });
    return f.actions.StumbleBackwards.timeScale;
  };
  // Debug: renderer load right now (last rendered frame).
  window.__rfRenderInfo = () => {
    const i = renderer.info;
    return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0, pr: renderer.getPixelRatio(), gfx: gfxKey, debris: getPhysicsDebris().length };
  };
  window.__rfForceKO = (id) => { const f = id === 'p1' ? p1 : p2; ko(f, f === p1 ? p2 : p1); };
  window.__rfForceKnockdown = (id, partId = 'head', force = 6) => {
    const f = id === 'p1' ? p1 : p2;
    const o = f === p1 ? p2 : p1;
    knockDown(f, toward(o, f), force, partId);
    return f.downKind;
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
    camera.position.set(mid.x + 0.15, matTopY() + 0.28, mid.z + 2.15);
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

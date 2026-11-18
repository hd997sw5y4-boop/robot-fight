'use strict';
/* [stadium-broadcast] Crowd watch: a seat in the stands.
   Desktop: a new camera mode 'crowd' in the V-key / Settings camera cycle, with drag-to-look.
   VR: an "Enter VR" button (only when immersive-vr is supported) that seats the viewer in the
   same spot with a seated ('local') reference space. In VR the game never moves the camera:
   the headset pose is the only motion (no shakes, no cuts, no follow). */
import * as THREE from 'three';
import { CAM_MODES, getSettings, setCameraMode } from '../settings.js';
import { STADIUM } from './stadium-config.js';
import { getArena } from './stadium.js';

const MODE = 'crowd';
const ROW = 4;             // lower-bowl row (0 = front)
const SEAT_ANGLE = Math.PI / 2; // +Z side: the same side the default cameras start on
const EYE = 1.32;          // seated eye height above the tread (m)

let ctx = null;
let xrSession = null;
let rig = null;
let camPrevParent = null;
let btn = null;
const look = { yaw: 0, pitch: 0, drag: false };
const _eye = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qLook = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
let aimSmooth = null;

/** Eye position of the crowd-watch seat (an aisle step, so no crowd figure sits there). */
export function crowdSeatEye(out = new THREE.Vector3()) {
  if (getArena() !== 'stadium') {
    // Industrial has no stands: a raised ringside vantage instead.
    return out.set(0, 3.4, 11.5);
  }
  const L = STADIUM.lower;
  const r = L.r0 + ROW * L.depth + 0.42;
  const y = L.y0 + ROW * L.rise;
  const n = Math.floor((Math.PI * 2 * r) / 0.56);
  const step = (Math.PI * 2) / n;
  const s = Math.round(SEAT_ANGLE / step / 18) * 18; // aisle index (matches stadium.js)
  const a = s * step;
  return out.set(Math.cos(a) * r, y + EYE, Math.sin(a) * r);
}

export function xrPresenting() {
  return !!(ctx && ctx.renderer.xr && ctx.renderer.xr.isPresenting);
}

/**
 * [stadium-broadcast hook] target: called at the top of game.js updateCamera.
 * Returns true when this module owns the camera this frame (crowd mode or VR).
 */
export function updateCrowdCam(camera, dt) {
  if (!ctx) return false;
  if (xrPresenting()) return true; // headset pose only
  if (getSettings().cam !== MODE) { aimSmooth = null; return false; }
  crowdSeatEye(_eye);
  // Base view: toward the fighters (smoothed), then the player's drag-look offset on top.
  const [p1, p2] = ctx.getFighters ? ctx.getFighters() : [];
  if (p1 && p2) _aim.set((p1.root.position.x + p2.root.position.x) / 2, 1.3, (p1.root.position.z + p2.root.position.z) / 2);
  else _aim.set(0, 1.3, 0);
  if (!aimSmooth) aimSmooth = _aim.clone();
  else aimSmooth.lerp(_aim, dt <= 0 ? 0 : 1 - Math.pow(0.15, dt));
  if (camera.near !== 0.1) { camera.near = 0.1; camera.updateProjectionMatrix(); }
  camera.position.copy(_eye);
  _m.lookAt(_eye, aimSmooth, camera.up);
  _qLook.setFromRotationMatrix(_m);
  _e.set(look.pitch, look.yaw, 0, 'YXZ');
  _q.setFromEuler(_e);
  camera.quaternion.copy(_qLook).multiply(_q);
  return true;
}

function bindLook(canvas) {
  canvas.addEventListener('pointerdown', (e) => {
    if (getSettings().cam !== MODE || xrPresenting()) return;
    look.drag = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!look.drag || getSettings().cam !== MODE) return;
    look.yaw = THREE.MathUtils.clamp(look.yaw - e.movementX * 0.004, -1.9, 1.9);
    look.pitch = THREE.MathUtils.clamp(look.pitch - e.movementY * 0.004, -1.0, 1.1);
  });
  const end = () => { look.drag = false; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('dblclick', () => { if (getSettings().cam === MODE) { look.yaw = 0; look.pitch = 0; } });
}

function addModeOption() {
  if (!CAM_MODES.includes(MODE)) CAM_MODES.push(MODE); // V-key cycle reads this array
  const sel = document.getElementById('setCam');
  if (sel && !sel.querySelector('option[value="crowd"]')) {
    const o = document.createElement('option');
    o.value = MODE;
    o.textContent = 'Crowd watch (seat in the stands)';
    sel.appendChild(o);
  }
  // settings.js validated the saved view before 'crowd' existed: restore it.
  try {
    if (localStorage.getItem('rf_cam') === MODE && getSettings().cam !== MODE) setCameraMode(MODE);
    else if (sel) sel.value = getSettings().cam;
  } catch (_) { /* ignore */ }
}

// ---------------------------------------------------------------- WebXR

function makeButton() {
  btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'rfEnterVr';
  btn.textContent = 'Enter VR';
  btn.title = 'Watch from a seat in the stands (VR headset)';
  Object.assign(btn.style, {
    position: 'fixed', right: '14px', bottom: '14px', zIndex: '40', padding: '9px 16px',
    font: '600 14px ui-sans-serif, system-ui, sans-serif', color: '#e9f3ff',
    background: 'rgba(12,18,32,0.82)', border: '1px solid rgba(56,214,255,0.6)', borderRadius: '8px',
    cursor: 'pointer', letterSpacing: '0.04em',
  });
  btn.addEventListener('click', () => {
    if (xrSession) { xrSession.end().catch(() => {}); return; }
    enterVr();
  });
  document.body.appendChild(btn);
}

async function enterVr() {
  if (!navigator.xr || xrSession) return;
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    onSessionStart(session);
  } catch (e) {
    console.warn('[crowd cam] VR session failed', e);
  }
}

async function onSessionStart(session) {
  const { renderer, scene, camera } = ctx;
  xrSession = session;
  session.addEventListener('end', onSessionEnd);
  // Seated: 'local' puts the origin at the head at session start, so the rig is the eye point.
  renderer.xr.setReferenceSpaceType('local');
  rig = new THREE.Group();
  rig.name = 'crowdWatchRig';
  crowdSeatEye(rig.position);
  // Face the ring center (yaw only; the headset supplies pitch/roll). World units are meters.
  rig.rotation.y = Math.atan2(rig.position.x, rig.position.z);
  scene.add(rig);
  camPrevParent = camera.parent;
  rig.add(camera);
  camera.position.set(0, 0, 0);
  camera.quaternion.identity();
  try { ctx.unlockAudio && ctx.unlockAudio(); } catch (_) { /* ignore */ }
  await renderer.xr.setSession(session);
  if (btn) btn.textContent = 'Exit VR';
}

function onSessionEnd() {
  const { scene, camera } = ctx;
  if (xrSession) xrSession.removeEventListener('end', onSessionEnd);
  xrSession = null;
  if (rig) {
    rig.remove(camera);
    if (camPrevParent) camPrevParent.add(camera);
    scene.remove(rig);
    rig = null;
  }
  if (btn) btn.textContent = 'Enter VR';
}

/** Called from initStadium (ctx: renderer, scene, camera, canvas, getFighters). */
export function initCrowdCam(c) {
  ctx = c;
  addModeOption();
  if (c.canvas) bindLook(c.canvas);
  window.__rfCrowdSeat = () => crowdSeatEye().toArray();
  const renderer = c.renderer;
  if (!renderer || !renderer.xr) return;
  // xr.enabled only matters while presenting; normal desktop frames render exactly as before.
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => { if (ok) makeButton(); }).catch(() => {});
  }
}

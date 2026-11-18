'use strict';
/* Settings sheet: open/close (Esc + backdrop), localStorage, pause hook.
   Layout and periwinkle sheet styling follow WW3D addons/menu-tidy.js + ui2027.css.
   Volume rows follow WW3D addons/master-volume.js (squared taper lives in audio.js). */

import { unlockAudio, setVolumes, playSfx, startCrowd } from './audio.js';
import { IS_MOBILE } from './mobile.js';

const KEYS = {
  gfx: 'rf_gfx',
  gfxPicked: 'rf_gfx_picked',
  master: 'rf_vol_master',
  sfx: 'rf_vol_sfx',
  crowd: 'rf_vol_crowd',
  ann: 'rf_vol_ann',
  shake: 'rf_shake',
  cpu: 'rf_cpu',
  round: 'rf_round',
  controls: 'rf_controls',
  fps: 'rf_fps',
  fov: 'rf_fov',
  light: 'rf_light',
  hdri: 'rf_hdri',
  cam: 'rf_cam',
  autoRematch: 'rf_autorematch',
};

// Camera views, in the order the V key cycles them. 'arena' is the original orbit camera.
export const CAM_MODES = ['arena', 'fighting', 'third', 'first', 'broadcast'];

// Default graphics preset until the player picks one (KEYS.gfxPicked marks a real choice, so
// an older auto-saved 'high' doesn't pin a Mac to High).
function defaultGfx() {
  if (IS_MOBILE) return 'low';
  try {
    const ua = navigator.userAgent || '';
    if (/Macintosh|Mac OS X/.test(ua)) return 'medium';
    if ((window.devicePixelRatio || 1) >= 1.5) return 'medium';
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const r = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      const lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
      if (/Intel|SwiftShader|llvmpipe|Software|Mali|Adreno|PowerVR|Apple GPU/i.test(r) && !/Iris Xe MAX|Arc/i.test(r)) return 'medium';
    }
  } catch (_) {}
  return 'high';
}

const defaults = {
  gfx: defaultGfx(), // phones Low; Macs / Retina / integrated GPUs Medium; other desktops High
  master: 1,
  sfx: 1,
  crowd: 0.7,
  ann: 0.9,
  shake: true,
  cpu: 'normal',
  round: 0,
  controls: true,
  fps: false,
  fov: 50,
  light: 1,
  hdri: true,
  cam: 'arena',
  autoRematch: false, // Bot vs Bot: start the next match by itself after the results
};

function read() {
  const s = { ...defaults };
  try {
    const gfx = localStorage.getItem(KEYS.gfx);
    if (localStorage.getItem(KEYS.gfxPicked) === '1' && (gfx === 'low' || gfx === 'medium' || gfx === 'high')) s.gfx = gfx;
    const m = localStorage.getItem(KEYS.master);
    if (m != null && isFinite(+m)) s.master = Math.max(0, Math.min(1, +m));
    const x = localStorage.getItem(KEYS.sfx);
    if (x != null && isFinite(+x)) s.sfx = Math.max(0, Math.min(1, +x));
    const an = localStorage.getItem(KEYS.ann);
    if (an != null && isFinite(+an)) s.ann = Math.max(0, Math.min(1, +an));
    const cr = localStorage.getItem(KEYS.crowd);
    if (cr != null && isFinite(+cr)) s.crowd = Math.max(0, Math.min(1, +cr));
    const sh = localStorage.getItem(KEYS.shake);
    if (sh != null) s.shake = sh !== '0';
    const cpu = localStorage.getItem(KEYS.cpu);
    if (cpu === 'easy' || cpu === 'normal' || cpu === 'hard') s.cpu = cpu;
    const r = localStorage.getItem(KEYS.round);
    if (r === '0' || r === '60' || r === '90' || r === '120') s.round = +r;
    const c = localStorage.getItem(KEYS.controls);
    if (c != null) s.controls = c !== '0';
    const f = localStorage.getItem(KEYS.fps);
    if (f != null) s.fps = f === '1';
    const fov = localStorage.getItem(KEYS.fov);
    if (fov != null && isFinite(+fov)) s.fov = Math.max(45, Math.min(90, +fov));
    const light = localStorage.getItem(KEYS.light);
    if (light != null && isFinite(+light)) s.light = Math.max(0.5, Math.min(2, +light));
    const hdri = localStorage.getItem(KEYS.hdri);
    if (hdri != null) s.hdri = hdri === '1';
    const cam = localStorage.getItem(KEYS.cam);
    if (CAM_MODES.includes(cam)) s.cam = cam;
    s.autoRematch = localStorage.getItem(KEYS.autoRematch) === '1';
  } catch (_) {}
  return s;
}

function write(s) {
  try {
    localStorage.setItem(KEYS.gfx, s.gfx);
    localStorage.setItem(KEYS.master, String(s.master));
    localStorage.setItem(KEYS.sfx, String(s.sfx));
    localStorage.setItem(KEYS.crowd, String(s.crowd));
    localStorage.setItem(KEYS.ann, String(s.ann));
    localStorage.setItem(KEYS.shake, s.shake ? '1' : '0');
    localStorage.setItem(KEYS.cpu, s.cpu);
    localStorage.setItem(KEYS.round, String(s.round));
    localStorage.setItem(KEYS.controls, s.controls ? '1' : '0');
    localStorage.setItem(KEYS.fps, s.fps ? '1' : '0');
    localStorage.setItem(KEYS.fov, String(s.fov));
    localStorage.setItem(KEYS.light, String(s.light));
    localStorage.setItem(KEYS.hdri, s.hdri ? '1' : '0');
    localStorage.setItem(KEYS.cam, s.cam);
    localStorage.setItem(KEYS.autoRematch, s.autoRematch ? '1' : '0');
  } catch (_) {}
}

const settings = read();
let open = false;
let hooks = {};

export function getSettings() {
  return settings;
}

export function isSettingsOpen() {
  return open;
}

function paint() {
  const $ = (id) => document.getElementById(id);
  const gfx = $('setGfx');
  if (gfx) gfx.value = settings.gfx;
  const shake = $('setShake');
  if (shake) shake.checked = settings.shake;
  const fps = $('setFps');
  if (fps) fps.checked = settings.fps;
  const master = $('setMaster');
  const masterV = $('setMasterV');
  if (master && document.activeElement !== master) master.value = String(settings.master);
  if (masterV) masterV.textContent = Math.round(settings.master * 100) + '%';
  const sfx = $('setSfx');
  const sfxV = $('setSfxV');
  if (sfx && document.activeElement !== sfx) sfx.value = String(settings.sfx);
  if (sfxV) sfxV.textContent = Math.round(settings.sfx * 100) + '%';
  const crowd = $('setCrowd');
  const crowdV = $('setCrowdV');
  if (crowd && document.activeElement !== crowd) crowd.value = String(settings.crowd);
  if (crowdV) crowdV.textContent = Math.round(settings.crowd * 100) + '%';
  const ann = $('setAnn');
  const annV = $('setAnnV');
  if (ann && document.activeElement !== ann) ann.value = String(settings.ann);
  if (annV) annV.textContent = settings.ann > 0 ? Math.round(settings.ann * 100) + '%' : 'Off';
  const cpu = $('setCpu');
  if (cpu) cpu.value = settings.cpu;
  const round = $('setRound');
  if (round) round.value = String(settings.round);
  const controls = $('setControls');
  if (controls) controls.checked = settings.controls;
  const fov = $('setFov');
  const fovV = $('setFovV');
  if (fov && document.activeElement !== fov) fov.value = String(Math.round(settings.fov));
  if (fovV) fovV.textContent = Math.round(settings.fov) + '°';
  const light = $('setLight');
  const lightV = $('setLightV');
  if (light && document.activeElement !== light) light.value = String(settings.light);
  if (lightV) lightV.textContent = Math.round(settings.light * 100) + '%';
  const hdriEl = $('setHdri');
  if (hdriEl) hdriEl.checked = !!settings.hdri;
  const camEl = $('setCam');
  if (camEl) camEl.value = settings.cam;
  const arEl = $('setAutoRematch');
  if (arEl) arEl.checked = !!settings.autoRematch;
  applyChrome();
}

function applyChrome() {
  const bottom = document.getElementById('bottom');
  if (bottom) bottom.classList.toggle('hidden', !settings.controls);
  const fpsEl = document.getElementById('fps');
  if (fpsEl) {
    fpsEl.classList.toggle('hidden', !settings.fps);
    fpsEl.setAttribute('aria-hidden', settings.fps ? 'false' : 'true');
  }
  setVolumes(settings.master, settings.sfx, settings.crowd, settings.ann);
  startCrowd();
}

// Camera view: from the Settings select or the V key (cycles); saved like every setting.
export function setCameraMode(mode) {
  settings.cam = CAM_MODES.includes(mode) ? mode : 'arena';
  persist();
  paint();
  return settings.cam;
}

export function cycleCameraMode() {
  const i = CAM_MODES.indexOf(settings.cam);
  return setCameraMode(CAM_MODES[(i + 1) % CAM_MODES.length]);
}

function persist() {
  write(settings);
  applyChrome();
  if (hooks.onChange) hooks.onChange(settings);
}

export function setSettingsOpen(next) {
  next = !!next;
  if (open === next) return;
  open = next;
  const panel = document.getElementById('setp');
  const back = document.getElementById('setpBack');
  const btn = document.getElementById('settingsBtn');
  if (panel) panel.classList.toggle('hidden', !open);
  if (back) {
    if (open) back.removeAttribute('hidden');
    else back.setAttribute('hidden', '');
  }
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) {
    paint();
    const x = document.getElementById('setpX');
    if (x) x.focus();
  } else if (btn) {
    btn.focus();
  }
  if (hooks.onToggle) hooks.onToggle(open);
}

function bindSlider(id, key) {
  const el = document.getElementById(id);
  if (!el) return;
  let lastTick = 0;
  el.addEventListener('pointerdown', () => unlockAudio());
  el.addEventListener('input', () => {
    settings[key] = Math.max(0, Math.min(1, +el.value));
    persist();
    const n = performance.now();
    if (n - lastTick > 90) {
      lastTick = n;
      playSfx('tick');
    }
  });
  el.addEventListener('change', () => {
    settings[key] = Math.max(0, Math.min(1, +el.value));
    persist();
    playSfx('click');
  });
  el.addEventListener('dblclick', () => {
    settings[key] = 1;
    el.value = '1';
    persist();
    playSfx('click');
    paint();
  });
}

export function initSettings(nextHooks) {
  hooks = nextHooks || {};
  applyChrome();
  paint();
  const btn = document.getElementById('settingsBtn');
  const close = document.getElementById('setpX');
  const back = document.getElementById('setpBack');
  if (btn) btn.addEventListener('click', () => { unlockAudio(); setSettingsOpen(!open); });
  if (close) close.addEventListener('click', () => setSettingsOpen(false));
  if (back) back.addEventListener('click', () => setSettingsOpen(false));
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (open) {
      e.preventDefault();
      setSettingsOpen(false);
    } else if (!e.repeat) {
      e.preventDefault();
      unlockAudio();
      setSettingsOpen(true);
    }
  });
  const gfx = document.getElementById('setGfx');
  if (gfx) gfx.addEventListener('change', () => {
    settings.gfx = gfx.value === 'low' || gfx.value === 'medium' ? gfx.value : 'high';
    try { localStorage.setItem(KEYS.gfxPicked, '1'); } catch (_) {}
    persist();
    if (hooks.applyGfx) hooks.applyGfx(settings.gfx);
  });
  document.getElementById('setShake')?.addEventListener('change', (e) => {
    settings.shake = e.target.checked;
    persist();
  });
  document.getElementById('setFps')?.addEventListener('change', (e) => {
    settings.fps = e.target.checked;
    persist();
  });
  document.getElementById('setCpu')?.addEventListener('change', (e) => {
    settings.cpu = e.target.value;
    persist();
  });
  document.getElementById('setRound')?.addEventListener('change', (e) => {
    settings.round = +e.target.value;
    persist();
  });
  document.getElementById('setAutoRematch')?.addEventListener('change', (e) => {
    settings.autoRematch = e.target.checked;
    persist();
  });
  document.getElementById('setControls')?.addEventListener('change', (e) => {
    settings.controls = e.target.checked;
    persist();
  });
  bindSlider('setMaster', 'master');
  bindSlider('setSfx', 'sfx');
  bindSlider('setCrowd', 'crowd');
  bindSlider('setAnn', 'ann');
  bindFov();
  bindLight();
  document.getElementById('setHdri')?.addEventListener('change', (e) => {
    settings.hdri = e.target.checked;
    persist();
    if (hooks.applyHdri) hooks.applyHdri(settings.hdri);
  });
  document.getElementById('setCam')?.addEventListener('change', (e) => {
    setCameraMode(e.target.value);
  });
}

function clampFov(v) {
  return Math.max(45, Math.min(90, +v || 50));
}

export function setFov(v, persistIt) {
  settings.fov = clampFov(v);
  if (persistIt !== false) persist();
  else if (hooks.onChange) hooks.onChange(settings);
  if (hooks.applyFov) hooks.applyFov(settings.fov);
  const fov = document.getElementById('setFov');
  const fovV = document.getElementById('setFovV');
  if (fov && document.activeElement !== fov) fov.value = String(Math.round(settings.fov));
  if (fovV) fovV.textContent = Math.round(settings.fov) + '°';
  return settings.fov;
}

function bindFov() {
  const el = document.getElementById('setFov');
  if (!el) return;
  el.addEventListener('pointerdown', () => unlockAudio());
  el.addEventListener('input', () => setFov(el.value, true));
  el.addEventListener('change', () => { setFov(el.value, true); playSfx('click'); });
  el.addEventListener('dblclick', () => { setFov(50, true); playSfx('click'); paint(); });
}

function clampLight(v) {
  return Math.max(0.5, Math.min(2, +v || 1));
}

export function setLight(v, persistIt) {
  settings.light = clampLight(v);
  if (persistIt !== false) persist();
  else if (hooks.onChange) hooks.onChange(settings);
  if (hooks.applyLight) hooks.applyLight(settings.light);
  const el = document.getElementById('setLight');
  const lab = document.getElementById('setLightV');
  if (el && document.activeElement !== el) el.value = String(settings.light);
  if (lab) lab.textContent = Math.round(settings.light * 100) + '%';
  return settings.light;
}

function bindLight() {
  const el = document.getElementById('setLight');
  if (!el) return;
  el.addEventListener('pointerdown', () => unlockAudio());
  el.addEventListener('input', () => setLight(el.value, true));
  el.addEventListener('change', () => { setLight(el.value, true); playSfx('click'); });
  el.addEventListener('dblclick', () => { setLight(1, true); playSfx('click'); paint(); });
}

export function updateFps(dt) {
  if (!settings.fps) return;
  updateFps._acc = (updateFps._acc || 0) + dt;
  updateFps._n = (updateFps._n || 0) + 1;
  if (updateFps._acc >= 0.5) {
    const el = document.getElementById('fps');
    if (el) el.textContent = Math.round(updateFps._n / updateFps._acc) + ' FPS';
    updateFps._acc = 0;
    updateFps._n = 0;
  }
}

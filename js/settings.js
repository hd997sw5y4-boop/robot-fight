'use strict';
/* Settings sheet: open/close (Esc + backdrop), localStorage, pause hook.
   Layout and periwinkle sheet styling follow WW3D addons/menu-tidy.js + ui2027.css.
   Volume rows follow WW3D addons/master-volume.js (squared taper lives in audio.js). */

import { unlockAudio, setVolumes, playSfx } from './audio.js';

const KEYS = {
  gfx: 'rf_gfx',
  master: 'rf_vol_master',
  sfx: 'rf_vol_sfx',
  shake: 'rf_shake',
  cpu: 'rf_cpu',
  round: 'rf_round',
  controls: 'rf_controls',
  fps: 'rf_fps',
};

const defaults = {
  gfx: 'high',
  master: 1,
  sfx: 1,
  shake: true,
  cpu: 'normal',
  round: 0,
  controls: true,
  fps: false,
};

function read() {
  const s = { ...defaults };
  try {
    const gfx = localStorage.getItem(KEYS.gfx);
    if (gfx === 'low' || gfx === 'high') s.gfx = gfx;
    const m = localStorage.getItem(KEYS.master);
    if (m != null && isFinite(+m)) s.master = Math.max(0, Math.min(1, +m));
    const x = localStorage.getItem(KEYS.sfx);
    if (x != null && isFinite(+x)) s.sfx = Math.max(0, Math.min(1, +x));
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
  } catch (_) {}
  return s;
}

function write(s) {
  try {
    localStorage.setItem(KEYS.gfx, s.gfx);
    localStorage.setItem(KEYS.master, String(s.master));
    localStorage.setItem(KEYS.sfx, String(s.sfx));
    localStorage.setItem(KEYS.shake, s.shake ? '1' : '0');
    localStorage.setItem(KEYS.cpu, s.cpu);
    localStorage.setItem(KEYS.round, String(s.round));
    localStorage.setItem(KEYS.controls, s.controls ? '1' : '0');
    localStorage.setItem(KEYS.fps, s.fps ? '1' : '0');
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
  const cpu = $('setCpu');
  if (cpu) cpu.value = settings.cpu;
  const round = $('setRound');
  if (round) round.value = String(settings.round);
  const controls = $('setControls');
  if (controls) controls.checked = settings.controls;
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
  setVolumes(settings.master, settings.sfx);
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
    settings.gfx = gfx.value === 'low' ? 'low' : 'high';
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
  document.getElementById('setControls')?.addEventListener('change', (e) => {
    settings.controls = e.target.checked;
    persist();
  });
  bindSlider('setMaster', 'master');
  bindSlider('setSfx', 'sfx');
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

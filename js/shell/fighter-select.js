/* Robot Fight shell: fighter select screen (P1 vs P2, 3D turntables, stats, roster grid).
   ES module, loaded before js/game.js. It takes over the existing 'select' screen through two small
   hooks in js/shell/menus.js (S.fighterSelect.open + S.selectHooks) and never touches fight code:
   the preview robots are clones of the real in-game fighter (same GLB, builder, tint, visor, clips).
   Stats come from js/config.js tuning. Sounds are the game's own Kenney CC0 UI clips via S.sfx,
   so they follow the Settings master / SFX volume. */
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { COMBAT, DAMAGE, MODEL } from '../config.js';

const S = window.RFShell;

/* ---------- roster data (add future robots here) ---------- */
// Reference ceilings for the bars, so later frames can sit above or below this one.
const STAT_SCALE = { power: 20, speed: 5, armor: 300, reach: 2.5 };
const partHp = Object.values(DAMAGE.parts).reduce((a, p) => a + p.hp, 0);
const ROBOTS = [
  {
    id: 'robot', name: 'Robot', cls: 'All-rounder', source: 'p1',
    stats: [
      { k: 'power', label: 'Power', v: (COMBAT.punch.damage + COMBAT.kick.damage) / 2, unit: 'dmg' },
      { k: 'speed', label: 'Speed', v: COMBAT.moveSpeed, unit: 'm/s' },
      { k: 'armor', label: 'Armor', v: partHp, unit: 'hp' },
      { k: 'reach', label: 'Reach', v: COMBAT.kick.range, unit: 'm' },
    ],
  },
  { id: 'slot-2', locked: true },
  { id: 'slot-3', locked: true },
  { id: 'slot-4', locked: true },
  { id: 'slot-5', locked: true },
  { id: 'slot-6', locked: true },
];
const robotById = (id) => ROBOTS.find((r) => r.id === id && !r.locked) || ROBOTS[0];
const SIDE_COLOR = { p1: '#3f7dff', p2: '#ff4040' };
const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" fill="none"/></svg>';

const st = { active: false, ready: { p1: false, p2: false }, pick: { p1: 'robot', p2: 'robot' }, host: null, busy: false, ptr: false, portrait: null };
let stage = null;

const esc = (t) => S.esc(t);
const H = () => S.selectHooks;
const mode = () => S.state.mode;
const isCpu = (side) => side === 'p2' && mode() !== 'versus';
const presetName = (side) => H().paintName(H().sel[side]);

function oppList() { return ['random'].concat(S.ROSTER.map((o) => o.id)); }
function p2Paint() {
  const sel = H().sel;
  const m = mode();
  if (m === 'versus') return sel.p2;
  if (m === 'training') return { primary: '#4a505c', accent: '#9aabff' };
  if (m === 'arcade') return { primary: S.ROSTER[0].primary, accent: S.ROSTER[0].accent };
  if (sel.opp && sel.opp !== 'random') { const o = S.opponent(sel.opp); return { primary: o.primary, accent: o.accent }; }
  return { primary: '#e23b3b', accent: '#2a2d36' }; // random: shown in P2 red until the draw
}

/* ---------- DOM ---------- */
function selScreen() { return document.querySelector('.rfs-screen[data-screen="select"]'); }

function statRows(robot, side) {
  return robot.stats.map((s) => {
    const pct = Math.max(4, Math.min(100, (s.v / STAT_SCALE[s.k]) * 100));
    return `<div class="fs-stat"><span>${s.label}</span><i><u style="--v:${pct.toFixed(1)}%"></u></i><em>${+s.v.toFixed(2)}<small>${s.unit}</small></em></div>`;
  }).join('');
}

function ctrlToggle(side) {
  const m = mode();
  const cpu = isCpu(side);
  let lockP = false;
  let lockC = false;
  let note = '';
  if (side === 'p1') { lockC = true; note = 'P1 is always a player in this version.'; }
  else if (m === 'arcade') { lockP = true; note = 'Arcade is a solo ladder.'; }
  else if (m === 'training') { lockP = true; note = 'Training uses a dummy.'; }
  const b = (v, label, locked) => `<button type="button" class="rfs-f fs-tog" data-fs="ctrl" data-side="${side}" data-v="${v}" aria-pressed="${(v === 'cpu') === cpu}"${locked ? ' aria-disabled="true"' : ''}>${label}${locked ? LOCK_SVG : ''}</button>`;
  return `<div class="fs-ctrl" role="group" aria-label="${side.toUpperCase()} control">${b('player', 'Player', lockP)}${b('cpu', m === 'training' && side === 'p2' ? 'Dummy' : 'CPU', lockC)}</div>
    ${note ? `<p class="fs-note">${note}</p>` : ''}`;
}

function chips(side) {
  return `<div class="fs-lbl">Paint <b class="fs-pname">${esc(presetName(side))}</b></div>
    <div class="fs-chips">${S.PRESETS.map((p) => `<button type="button" class="rfs-f fs-chip" data-fs="paint" data-side="${side}" data-preset="${p.id}" style="--a:${p.primary};--b:${p.accent}" aria-label="${esc(p.name)}" title="${esc(p.name)}" aria-pressed="${presetName(side) === p.name}"></button>`).join('')}</div>`;
}

function p2Extra() {
  const m = mode();
  const sel = H().sel;
  if (m === 'versus') {
    return chips('p2') + '<div class="fs-pads"><span class="fs-padtxt"></span><button type="button" class="rfs-f fs-mini" data-fs="swap">Swap pads</button></div>';
  }
  if (m === 'fight') {
    const o = sel.opp === 'random' ? null : S.opponent(sel.opp);
    return `<div class="fs-lbl">CPU style</div>
      <div class="fs-step"><button type="button" class="rfs-f fs-arrow" data-fs="opp" data-d="-1" aria-label="Previous CPU style">‹</button>
        <div><b>${o ? esc(o.name) : 'Random'}</b><small>${o ? esc(o.style) + ' · ' + esc(o.title) : 'Any of the six'}</small></div>
        <button type="button" class="rfs-f fs-arrow" data-fs="opp" data-d="1" aria-label="Next CPU style">›</button></div>
      <p class="fs-note">CPU difficulty: <b class="fs-cpu"></b> (Settings)</p>`;
  }
  if (m === 'training') {
    return `<div class="fs-lbl">Dummy</div><div class="fs-seg">
      <button type="button" class="rfs-f fs-tog" data-fs="dummy" data-v="idle" aria-pressed="${!sel.dummyBlock}">Stand idle</button>
      <button type="button" class="rfs-f fs-tog" data-fs="dummy" data-v="block" aria-pressed="${!!sel.dummyBlock}">Hold block</button></div>`;
  }
  return `<div class="fs-lbl">Ladder</div><p class="fs-note">Six CPU styles, easiest first. First up: <b>${esc(S.ROSTER[0].name)}</b>. Lose and you can continue.</p>`;
}

function sidePanel(side) {
  const r = robotById(st.pick[side]);
  const who = side === 'p1' ? 'Player 1' : (isCpu(side) ? (mode() === 'training' ? 'Training dummy' : 'CPU') : 'Player 2');
  return `<section class="fs-side" data-side="${side}" style="--pc:${SIDE_COLOR[side]}">
    <header class="fs-head"><span class="fs-tag">${side.toUpperCase()}</span>
      <div><small>${who}</small><b>${esc(r.name)}</b><em>${esc(r.cls)}</em></div>
      <span class="fs-ready" aria-live="polite">Ready</span></header>
    ${ctrlToggle(side)}
    <div class="fs-stats">${statRows(r, side)}</div>
    <div class="fs-extra">${side === 'p1' ? chips('p1') : p2Extra()}</div>
    <button type="button" class="rfs-f fs-lock" data-fs="lock" data-side="${side}"></button>
  </section>`;
}

function rosterGrid() {
  return `<div class="fs-roster" role="listbox" aria-label="Robots">${ROBOTS.map((r) => r.locked
    ? `<button type="button" class="rfs-f fs-tile locked" data-fs="tile" data-id="${r.id}" aria-disabled="true" aria-label="Locked slot, coming soon"><span class="fs-lockic">${LOCK_SVG}</span><small>Soon</small></button>`
    : `<button type="button" class="rfs-f fs-tile" data-fs="tile" data-id="${r.id}" aria-label="${esc(r.name)}"${r.id === 'robot' ? ' data-autofocus' : ''}>
        <span class="fs-portrait">${st.portrait ? `<img src="${st.portrait}" alt="">` : ''}</span><small>${esc(r.name)}</small>
        <i class="fs-cur p1">1P</i><i class="fs-cur p2">${isCpu('p2') ? 'CPU' : '2P'}</i></button>`).join('')}</div>
    <div class="fs-caption" aria-live="polite"></div>`;
}

function render() {
  const scr = selScreen();
  const m = mode();
  const sub = H().MODE_INFO[m][1];
  scr.classList.add('fs-on');
  let host = scr.querySelector('.fs');
  if (!host) {
    host = document.createElement('div');
    host.className = 'fs';
    scr.appendChild(host);
    host.addEventListener('click', onClick);
    host.addEventListener('focusin', onFocus);
    host.addEventListener('pointermove', () => { st.ptr = true; });
    host.addEventListener('keydown', () => { st.ptr = false; }, true);
  }
  st.host = host;
  const keep = host.querySelector('.fs-stage');
  host.innerHTML = `
    <div class="fs-bg" aria-hidden="true"></div>
    <header class="fs-top"><small>${esc(H().MODE_INFO[m][0])} · ${esc(sub)}</small><b>Choose your fighter</b></header>
    ${sidePanel('p1')}
    <div class="fs-vsmark" aria-hidden="true"><b>VS</b></div>
    ${sidePanel('p2')}
    <div class="fs-mid">${rosterGrid()}</div>
    <footer class="fs-foot">
      <button type="button" class="rfs-f rfs-btn rfs-small" data-fs="back">Back <kbd>Esc</kbd></button>
      <span class="fs-hint">Arrows / WASD move · <kbd>Enter</kbd> lock in · <kbd>Esc</kbd> back</span>
      <button type="button" class="rfs-f rfs-btn rfs-go fs-go" data-fs="go">${m === 'arcade' ? 'To the ladder' : m === 'training' ? 'Train' : 'Fight'}</button>
    </footer>`;
  if (keep) host.prepend(keep);
  paint();
  if (stage) requestAnimationFrame(() => { if (stage) stage.resize(); });
}

function paint() {
  const host = st.host;
  if (!host) return;
  for (const side of ['p1', 'p2']) {
    const el = host.querySelector(`.fs-side[data-side="${side}"]`);
    const ready = st.ready[side];
    el.classList.toggle('is-ready', ready);
    const lock = el.querySelector('.fs-lock');
    lock.innerHTML = ready ? 'Ready <small>click to change</small>' : (isCpu(side) ? 'Lock CPU' : 'Lock in');
    lock.setAttribute('aria-pressed', String(ready));
    el.querySelectorAll('.fs-chip').forEach((b) => b.setAttribute('aria-pressed', String(presetName(side) === (S.PRESETS.find((p) => p.id === b.dataset.preset) || {}).name)));
    const pn = el.querySelector('.fs-pname');
    if (pn) pn.textContent = presetName(side);
  }
  const both = st.ready.p1 && st.ready.p2;
  host.classList.toggle('all-ready', both);
  host.querySelectorAll('.fs-tile:not(.locked)').forEach((t) => {
    t.classList.toggle('p1-ready', st.ready.p1);
    t.classList.toggle('p2-ready', st.ready.p2);
  });
  const cpu = host.querySelector('.fs-cpu');
  if (cpu) { const c = S.cpuSetting(); cpu.textContent = c[0].toUpperCase() + c.slice(1); }
  const pt = host.querySelector('.fs-padtxt');
  if (pt) {
    const n = S.pads().length;
    const a = S.state.padSwap ? 'P2' : 'P1';
    const b = S.state.padSwap ? 'P1' : 'P2';
    pt.textContent = n === 0 ? 'Keyboard only' : n === 1 ? `Pad → ${a}` : `Pad 1 → ${a} · Pad 2 → ${b}`;
  }
  if (stage) stage.paintRobots();
}

function flash(side) {
  const el = st.host && st.host.querySelector(`.fs-side[data-side="${side}"]`);
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  if (stage) stage.pulse(side);
}

function setReady(side, on, quiet) {
  if (st.ready[side] === on) return;
  st.ready[side] = on;
  if (on) { flash(side); if (!quiet) S.sfx('confirm'); }
  else if (!quiet) S.sfx('close');
  paint();
}

function lockNext() {
  if (!st.ready.p1) {
    setReady('p1', true);
    if (isCpu('p2')) setTimeout(() => { if (st.active && !st.ready.p2) setReady('p2', true, true); }, 260);
  } else if (!st.ready.p2) setReady('p2', true);
  if (st.ready.p1 && (st.ready.p2 || isCpu('p2'))) {
    const go = st.host.querySelector('.fs-go');
    if (go) requestAnimationFrame(() => go.focus({ preventScroll: true }));
  }
}

function caption(id) {
  const c = st.host && st.host.querySelector('.fs-caption');
  if (!c) return;
  const r = ROBOTS.find((x) => x.id === id);
  c.innerHTML = !r ? '' : r.locked ? '<b>Locked</b> · Coming soon' : `<b>${esc(r.name)}</b> · ${esc(r.cls)}`;
}

function onFocus(e) {
  const t = e.target;
  if (!t.classList || !t.classList.contains('rfs-f')) return;
  if (st.ptr) S.sfx('tick');
  st.ptr = false;
  if (t.dataset.fs === 'tile') caption(t.dataset.id);
}

function deny(el, msg) {
  S.sfx('close');
  if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  if (msg) S.toast(msg);
}

function onClick(e) {
  const b = e.target.closest('[data-fs]');
  if (!b || st.busy) return;
  const sel = H().sel;
  const side = b.dataset.side;
  switch (b.dataset.fs) {
    case 'tile':
      if (b.classList.contains('locked')) return deny(b, 'More robots are coming soon.');
      return lockNext();
    case 'lock':
      if (isCpu(side)) return setReady(side, !st.ready[side]);
      return st.ready[side] ? setReady(side, false) : (side === 'p1' ? lockNext() : setReady(side, true));
    case 'ctrl': {
      if (b.getAttribute('aria-disabled') === 'true') {
        return deny(b, side === 'p1' ? 'CPU control for P1 isn\'t supported by the game yet.' : (mode() === 'arcade' ? 'Arcade is solo: P2 is always the CPU ladder.' : 'Training always uses the dummy.'));
      }
      const want = b.dataset.v === 'cpu' ? 'fight' : 'versus';
      if (mode() === want) return;
      S.sfx('click');
      S.state.mode = want;
      st.ready.p2 = false;
      render();
      H().previewSelect();
      const nb = st.host.querySelector(`[data-fs="ctrl"][data-side="p2"][data-v="${b.dataset.v}"]`);
      if (nb) nb.focus({ preventScroll: true });
      return;
    }
    case 'paint':
      S.sfx('click');
      H().setPaint(side, H().fromPreset(b.dataset.preset));
      return paint();
    case 'opp': {
      const list = oppList();
      const i = (list.indexOf(sel.opp) + list.length + Number(b.dataset.d)) % list.length;
      sel.opp = list[i];
      S.save('opp', sel.opp);
      S.sfx('click');
      H().previewSelect();
      const ex = st.host.querySelector('.fs-side[data-side="p2"] .fs-extra');
      const d = b.dataset.d;
      ex.innerHTML = p2Extra();
      paint();
      const nb = ex.querySelector(`[data-fs="opp"][data-d="${d}"]`);
      if (nb) nb.focus({ preventScroll: true });
      return;
    }
    case 'dummy':
      sel.dummyBlock = b.dataset.v === 'block';
      S.save('dummyBlock', sel.dummyBlock);
      S.sfx('click');
      st.host.querySelectorAll('[data-fs="dummy"]').forEach((x) => x.setAttribute('aria-pressed', String((x.dataset.v === 'block') === sel.dummyBlock)));
      return;
    case 'swap':
      S.state.padSwap = !S.state.padSwap;
      S.sfx('click');
      return paint();
    case 'back':
      return S.nav('back');
    case 'go':
      return go();
    default:
  }
}

/* ---------- transition into the fight ---------- */
let vsEl = null;
function vsOverlay() {
  if (vsEl) return vsEl;
  vsEl = document.createElement('div');
  vsEl.className = 'fs-vs';
  vsEl.setAttribute('aria-hidden', 'true');
  vsEl.innerHTML = '<div class="fs-vs-l"><div><small></small><b></b><span></span></div></div><div class="fs-vs-r"><div><small></small><b></b><span></span></div></div><div class="fs-vs-mid"><b>VS</b></div><div class="fs-vs-fight"></div>';
  document.body.appendChild(vsEl);
  return vsEl;
}
function go() {
  const m = mode();
  if (!st.ready.p1) setReady('p1', true);
  if (!st.ready.p2) setReady('p2', true, isCpu('p2'));
  if (m === 'arcade') { H().start(); return; }
  st.busy = true;
  const sel = H().sel;
  const o = m === 'fight' && sel.opp !== 'random' ? S.opponent(sel.opp) : null;
  const ov = vsOverlay();
  const set = (cls, small, big, sub) => {
    const el = ov.querySelector(cls);
    el.querySelector('small').textContent = small;
    el.querySelector('b').textContent = big;
    el.querySelector('span').textContent = sub;
  };
  set('.fs-vs-l', 'Player 1', robotById(st.pick.p1).name, presetName('p1'));
  set('.fs-vs-r', m === 'versus' ? 'Player 2' : m === 'training' ? 'Training' : 'CPU', m === 'training' ? 'Dummy' : robotById(st.pick.p2).name,
    m === 'versus' ? presetName('p2') : (o ? o.name : (m === 'fight' ? 'Random' : '')));
  ov.className = 'fs-vs';
  void ov.offsetWidth;
  ov.classList.add('in');
  S.sfx('whoosh');
  setTimeout(() => S.sfx('confirm'), 380);
  setTimeout(() => {
    try { H().start(); } catch (err) { console.error('[fighter-select]', err); }
    st.busy = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      ov.classList.add('out');
      setTimeout(() => { ov.className = 'fs-vs'; }, 650);
    }));
  }, 1250);
}

/* ---------- 3D stage: two turntables, three-point light, player-tinted rims ---------- */
function radialTex(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, inner);
  gr.addColorStop(0.55, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function cloneFighter(src) {
  // Stash per-mesh userData (large damage vertex caches) so cloning stays cheap; restored right after.
  const saved = new Map();
  src.model.traverse((o) => { saved.set(o, o.userData); o.userData = {}; });
  let model;
  try { model = cloneSkinned(src.model); } finally { for (const [o, u] of saved) o.userData = u; }
  const a = [];
  const b = [];
  src.model.traverse((o) => a.push(o));
  model.traverse((o) => b.push(o));
  const map = new Map(a.map((o, i) => [o, b[i]]));
  const parts = {};
  for (const [id, part] of Object.entries(src.parts || {})) {
    parts[id] = { meshes: [].concat(part.meshes || [], part.skinned || []).map((m) => map.get(m)).filter(Boolean) };
  }
  const mats = [];
  const cm = (m) => {
    const c = m.clone();
    c.userData = {};
    if (m.userData && m.userData.baseColor && m.userData.baseColor.isColor) c.userData.baseColor = m.userData.baseColor.clone();
    mats.push(c);
    return c;
  };
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    const o = b[i];
    if (o.isMesh) {
      o.material = Array.isArray(s.material) ? s.material.map(cm) : cm(s.material);
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      o.visible = !(s.userData && s.userData.hiddenPart);
    }
    if (o.isBone) {
      const hs = s.userData && s.userData.homeScale;
      if (hs) o.scale.copy(hs); else if (o.scale.x < 0.01) o.scale.set(1, 1, 1);
    }
  }
  model.position.set(0, src.baseY != null ? src.baseY : src.model.position.y, 0);
  model.rotation.set(0, 0, 0);
  const mixer = new THREE.AnimationMixer(model);
  const idle = src.actions && (src.actions[MODEL.animations.idle] || src.actions.FightingIdle || src.actions.idle);
  if (idle) {
    const act = mixer.clipAction(idle.getClip());
    act.play();
    act.time = Math.random() * idle.getClip().duration;
  }
  mixer.update(0);
  return { model, parts, mats, mixer };
}

function makeStage(host) {
  const canvas = document.createElement('canvas');
  canvas.className = 'fs-stage';
  host.prepend(canvas);
  const low = (document.getElementById('setGfx') || {}).value === 'low';
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = !low;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 80);
  const own = { geos: [], mats: [], texs: [] };
  const keepG = (g) => { own.geos.push(g); return g; };
  const keepM = (m) => { own.mats.push(m); return m; };

  scene.add(new THREE.HemisphereLight(0xc8d4ff, 0x10121a, 0.45));
  const key = new THREE.DirectionalLight(0xfff0e0, 2.4);
  key.position.set(2.5, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -2, near: 1, far: 20 });
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xaebfff, 0.55);
  fill.position.set(-4, 2.5, 5);
  scene.add(fill);

  const floorTex = radialTex('rgba(28,32,46,1)', 'rgba(28,32,46,0)');
  own.texs.push(floorTex);
  const floor = new THREE.Mesh(keepG(new THREE.CircleGeometry(9, 64)),
    keepM(new THREE.MeshStandardMaterial({ map: floorTex, transparent: true, roughness: 0.55, metalness: 0.5, depthWrite: false })));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const shadowCatch = new THREE.Mesh(keepG(new THREE.CircleGeometry(6, 48)), keepM(new THREE.ShadowMaterial({ opacity: 0.45 })));
  shadowCatch.rotation.x = -Math.PI / 2;
  shadowCatch.position.y = 0.002;
  shadowCatch.receiveShadow = true;
  scene.add(shadowCatch);

  const R = 0.8;
  const baseGeo = keepG(new THREE.CylinderGeometry(R, R * 1.08, 0.2, 72));
  const topGeo = keepG(new THREE.CylinderGeometry(R * 0.95, R * 0.95, 0.02, 72));
  const ringGeo = keepG(new THREE.TorusGeometry(R * 0.985, 0.018, 10, 96));
  const baseMat = keepM(new THREE.MeshStandardMaterial({ color: 0x1a1d27, metalness: 0.85, roughness: 0.32 }));
  const topMat = keepM(new THREE.MeshStandardMaterial({ color: 0x2a2f3d, metalness: 0.6, roughness: 0.45 }));

  const sides = {};
  for (const side of ['p1', 'p2']) {
    const col = new THREE.Color(SIDE_COLOR[side]);
    const g = new THREE.Group();
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.1;
    base.castShadow = true;
    base.receiveShadow = true;
    const top = new THREE.Mesh(topGeo, topMat);
    top.position.y = 0.21;
    top.receiveShadow = true;
    const ringMat = keepM(new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.6, roughness: 0.4 }));
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    g.add(base, top, ring);
    const spin = new THREE.Group();
    spin.position.y = 0.22;
    g.add(spin);
    const rim = new THREE.SpotLight(col, 70, 14, 0.55, 0.7, 1.6);
    const rim2 = new THREE.SpotLight(col, 28, 14, 0.6, 0.8, 1.6);
    g.add(rim, rim.target, rim2, rim2.target);
    rim.target.position.set(0, 1.6, 0);
    rim2.target.position.set(0, 1.4, 0);
    scene.add(g);
    sides[side] = { g, spin, ring, ringMat, rim, rim2, bot: null, angle: side === 'p1' ? 0.55 : -0.55, boost: 0, pulse: 0 };
  }

  const src = S.fighters();
  for (const side of ['p1', 'p2']) {
    const f = src[side === 'p1' ? 0 : 1] || src[0];
    if (!f || !f.model) continue;
    const bot = cloneFighter(f);
    sides[side].bot = bot;
    sides[side].spin.add(bot.model);
  }

  function paintRobots() {
    const sel = H().sel;
    const pp = { p1: sel.p1, p2: p2Paint() };
    for (const side of ['p1', 'p2']) {
      const bot = sides[side].bot;
      if (bot) S.paint({ model: bot.model, parts: bot.parts }, pp[side].primary, pp[side].accent);
    }
  }

  let W = 1;
  let Hh = 1;
  function resize() {
    W = host.clientWidth || window.innerWidth;
    Hh = host.clientHeight || window.innerHeight;
    renderer.setSize(W, Hh, false);
    camera.aspect = W / Hh;
    const hr = host.getBoundingClientRect();
    const p1 = host.querySelector('.fs-side[data-side="p1"]');
    const p2 = host.querySelector('.fs-side[data-side="p2"]');
    const top = host.querySelector('.fs-top');
    const mid = host.querySelector('.fs-mid');
    const l = p1 ? p1.getBoundingClientRect().right - hr.left : W * 0.25;
    const r = p2 ? p2.getBoundingClientRect().left - hr.left : W * 0.75;
    const yTop = top ? top.getBoundingClientRect().bottom - hr.top : Hh * 0.12;
    const yBot = mid ? mid.getBoundingClientRect().top - hr.top : Hh * 0.75;
    const avail = Math.max(120, (r - l) / 2);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    // pixels per world unit: robot + pedestal must fit the band, pedestal must fit its half
    const ppu = Math.max(40, Math.min((yBot - yTop) * 0.86 / 2.75, avail * 0.94 / (R * 2.25)));
    const D = (Hh / 2) / (ppu * tanH);
    const halfW = D * tanH * camera.aspect;
    const cx1 = (l + W / 2) / 2;
    const cx2 = (r + W / 2) / 2;
    sides.p1.g.position.x = ((cx1 / W) * 2 - 1) * halfW;
    sides.p2.g.position.x = ((cx2 / W) * 2 - 1) * halfW;
    const sMid = (yTop + yBot) / 2 + 6;
    const T = 1.45 - (Hh / 2 - sMid) / ppu;
    camera.position.set(0, T + 0.5, D);
    camera.lookAt(0, T, 0);
    camera.updateProjectionMatrix();
    for (const side of ['p1', 'p2']) {
      const s = sides[side];
      const out = side === 'p1' ? -1 : 1;
      s.rim.position.set(out * 1.1, 3.4, -2.6);
      s.rim2.position.set(-out * 1.4, 2.6, -2.2);
    }
    host.style.setProperty('--vs-y', `${Math.round(sMid - 10)}px`);
  }

  let portraitDone = false;
  function takePortrait() {
    const s = sides.p1;
    if (!s.bot) return;
    const keepVis = sides.p2.g.visible;
    sides.p2.g.visible = false;
    const a = s.spin.rotation.y;
    s.spin.rotation.y = 0.35;
    const cam = new THREE.PerspectiveCamera(20, camera.aspect, 0.1, 50);
    const p = new THREE.Vector3();
    s.g.getWorldPosition(p);
    cam.position.set(p.x + 0.3, 2.3, 4.4);
    cam.lookAt(p.x, 2.12, 0);
    renderer.render(scene, cam);
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const sz = Math.min(canvas.width, canvas.height) * 0.7;
      c.getContext('2d').drawImage(canvas, (canvas.width - sz) / 2, (canvas.height - sz) / 2, sz, sz, 0, 0, 160, 160);
      st.portrait = c.toDataURL('image/png');
      const slot = host.querySelector('.fs-tile:not(.locked) .fs-portrait');
      if (slot) slot.innerHTML = `<img src="${st.portrait}" alt="">`;
    } catch (_) { /* portrait is decoration only */ }
    s.spin.rotation.y = a;
    sides.p2.g.visible = keepVis;
  }

  let raf = 0;
  let last = performance.now();
  let t = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (document.hidden || S.settingsOpen()) return; // paused while hidden or under Settings
    t += dt;
    for (const side of ['p1', 'p2']) {
      const s = sides[side];
      s.boost *= Math.exp(-dt * 2.6);
      s.pulse = Math.max(0, s.pulse - dt * 1.6);
      s.angle += dt * (0.32 + s.boost) * (side === 'p1' ? 1 : -1);
      s.spin.rotation.y = s.angle;
      const ready = st.ready[side];
      s.ringMat.emissiveIntensity = 1.2 + (ready ? 1.2 + Math.sin(t * 5) * 0.35 : Math.sin(t * 2 + (side === 'p1' ? 0 : 1.5)) * 0.25) + s.pulse * 5;
      s.rim.intensity = 70 * (1 + s.pulse * 1.6 + (ready ? 0.25 : 0));
      if (s.bot) s.bot.mixer.update(dt);
    }
    if (!portraitDone) { portraitDone = true; if (!st.portrait) takePortrait(); }
    renderer.render(scene, camera);
  }

  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  paintRobots();
  resize();
  raf = requestAnimationFrame(frame);

  return {
    resize,
    paintRobots,
    pulse(side) { sides[side].pulse = 1; sides[side].boost = 7; },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      for (const side of ['p1', 'p2']) {
        const bot = sides[side].bot;
        if (!bot) continue;
        bot.mixer.stopAllAction();
        bot.mixer.uncacheRoot(bot.model);
        bot.mats.forEach((m) => m.dispose()); // geometry + textures are shared with the arena robot: left alone
      }
      own.geos.forEach((g) => g.dispose());
      own.mats.forEach((m) => m.dispose());
      own.texs.forEach((x) => x.dispose());
      envRT.dispose();
      pmrem.dispose();
      if (key.shadow.map) key.shadow.map.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

function closeStage() {
  if (stage) { stage.dispose(); stage = null; }
  document.body.classList.remove('fs-open');
}

/* ---------- public entry + shell wiring ---------- */
function open(m) {
  const hooks = H();
  if (!hooks || !S.api || !S.fighters()[0]) return false;
  S.state.mode = m;
  st.ready = { p1: false, p2: false };
  st.busy = false;
  st.active = true;
  render();
  document.body.classList.add('fs-open');
  hooks.previewSelect();
  S.showScreen('select');
  // build the stage after layout so it can measure the panels
  requestAnimationFrame(() => {
    if (!st.active || S.state.screen !== 'select') return;
    try {
      if (!stage) stage = makeStage(st.host);
      else stage.resize();
      stage.paintRobots();
    } catch (err) {
      console.error('[fighter-select] preview unavailable', err);
      closeStage();
      document.body.classList.add('fs-open');
    }
  });
  return true;
}

if (S) {
  S.fighterSelect = { open, ROBOTS };
  const baseShow = S.showScreen;
  S.showScreen = (name) => {
    const was = st.active;
    if (was && name !== 'select') { st.active = false; closeStage(); }
    baseShow(name);
    // Returning to 'select' from the arcade ladder: rebuild with the current mode.
    if (!was && name === 'select' && H() && S.state.mode) open(S.state.mode);
  };
  const baseNav = S.nav;
  S.nav = (act) => {
    if (st.active && st.busy) return;
    if (st.active && act === 'back') {
      if (st.ready.p2 && !isCpu('p2')) return setReady('p2', false);
      if (st.ready.p1) { setReady('p1', false); if (isCpu('p2')) setReady('p2', false, true); return; }
      S.sfx('close');
    }
    baseNav(act);
  };
  S.on('pads', () => { if (st.active) paint(); });
  const setp = document.getElementById('setp');
  if (setp) new MutationObserver(() => { if (st.active && !S.settingsOpen()) paint(); }).observe(setp, { attributes: true, attributeFilter: ['class'] });
}

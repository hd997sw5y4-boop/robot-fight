import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODEL, ARENA, COMBAT, GFX_PRESETS, LOOP_CLIPS } from './config.js';
import { getSettings, isSettingsOpen, initSettings, updateFps } from './settings.js';
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

let gfxKey = getSettings().gfx === 'low' ? 'low' : 'high';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 12, 32);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
camera.position.set(0, 3.2, 12.5);

const hitLight = new THREE.PointLight(0xffb44a, 0, 6);
hitLight.decay = 2;
scene.add(hitLight);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.06).texture;
scene.environmentIntensity = 0.22;

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
  f.config = { ...base, ...cfg, ai: { ...base.ai, ...(cfg && cfg.ai) } };
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
  };
  f.config.color = color;

  mixer.addEventListener('finished', () => {
    if (f.state === 'ko' || f.state === 'down' || isRagdoll(f)) return;
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

function moveFighter(f, other, sidestep, inout, dt, speed) {
  const fwd = toward(f, other);
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const vel = new THREE.Vector3();
  vel.addScaledVector(right, sidestep);
  vel.addScaledVector(fwd, inout);
  if (vel.lengthSq() > 1) vel.normalize();
  setFighterMove(f, vel.x * speed, vel.z * speed);
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
  addShake(blocked ? 0.08 : 0.16 + dmg * 0.01 + force * 0.02);
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
  if (def.health <= 0) {
    ko(def, atk, { dir: fwd, force });
    return;
  }
  if (!blocked) {
    def.blocking = false;
    def.shield.visible = false;
    def.invuln = COMBAT.hitInvuln;
    const heavy = force >= 5.1 || dmg >= 12;
    if (heavy) {
      def.state = 'down';
      def.stateT = 0;
      enableRagdoll(def, { x: fwd.x * (4 + force), y: 2.2 + force * 0.15, z: fwd.z * (4 + force) }, { kind: 'down', until: performance.now() + 850 });
    } else {
      def.state = 'hit';
      def.stateT = 0;
      setAnim(def, hitClipFor(hit.partId), 0.06);
    }
  }
}

function playVictory(f) {
  if (!f) return;
  const names = []
    .concat(MODEL.animations.victoryVariants || [])
    .concat(MODEL.animations.victory || []);
  const clip = names.find((n) => n && f.actions[n]);
  if (clip) setAnim(f, clip, 0.2);
}

function ko(loser, winner, info) {
  loser.health = 0;
  loser.state = 'ko';
  loser.blocking = false;
  loser.shield.visible = false;
  const dir = (info && info.dir) || new THREE.Vector3(winner.root.position.x - loser.root.position.x, 0, winner.root.position.z - loser.root.position.z).normalize();
  const force = (info && info.force) || 6;
  enableRagdoll(loser, { x: dir.x * (5 + force), y: 3.1, z: dir.z * (5 + force) }, { kind: 'ko', until: Infinity });
  if (winner && winner.state !== 'ko') playVictory(winner);
  match.over = true;
  match.winner = winner ? winner.id : null;
  document.getElementById('ko-title').textContent = winner && winner.id === 'p1' ? 'Blue wins' : 'Red wins';
  document.getElementById('ko-sub').textContent = winner && winner.id === 'p1' ? 'You won the fight.' : 'CPU won the fight.';
  document.getElementById('overlay').classList.remove('hidden');
  playSfx('ko');
  addShake(0.28);
  notifyFightEnd({
    winner: match.winner,
    reason: 'ko',
    p1: { health: p1.health, config: p1.config },
    p2: { health: p2.health, config: p2.config },
  });
}

const ai = { t: 0, sidestep: 0, inout: 0, block: false, punch: false, kick: false };

function aiProfile() {
  const custom = p2 && p2.config && p2.config.ai;
  if (custom && custom.think) return custom;
  const d = (custom && custom.personality) || getSettings().cpu || 'normal';
  return { ...(AI_PERSONALITIES[d] || AI_PERSONALITIES.normal) };
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
          ? pickClip(MODEL.animations.flipSpecial || MODEL.animations.kickSpecial, MODEL.animations.kick)
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
  if (f.state === 'ko' || f.state === 'down' || isRagdoll(f)) return;

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
    f.stepT = (f.stepT || 0) + dt;
    if (f.stepT > 0.32) {
      f.stepT = 0;
      playSfx('step', { vol: 0.5 + Math.min(0.25, (Math.abs(inp.sidestep) + Math.abs(inp.inout)) * 0.2) });
    }
    f.servoT = (f.servoT || 0) + dt;
    if (f.servoT > 0.72) {
      f.servoT = 0;
      playSfx('servo', { vol: 0.28, rate: 1.05, limit: 200 });
    }
    if (!f.blocking) {
      f.state = 'walk';
      const clip = moveClipFor(inp.sidestep, inp.inout);
      if (f.current !== clip) setAnim(f, clip, 0.12);
    }
  } else {
    setFighterMove(f, 0, 0);
    if (!f.blocking) {
      const idle = idleClipFor(f);
      if (f.current !== idle) setAnim(f, idle, 0.18);
      f.state = 'idle';
    }
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
  const dt = (isSettingsOpen() || shellCall('paused')) ? 0 : rawDt; // [game-shell hook] pause menu
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
    if (f && f.state === 'down' && isRagdoll(f) && f.phys.ragdoll.until < performance.now()) {
      disableRagdoll(f);
      f.state = 'idle';
      f.stateT = 0;
      setAnim(f, idleClipFor(f), 0.2);
    }
  }
  stepFighter(p1, p2, pin, dt);
  stepFighter(p2, p1, ain, dt);
  stepPhysics(dt);
  if (!isRagdoll(p1) && !isRagdoll(p2)) separate(p1, p2);
  if (!isRagdoll(p1) && !isRagdoll(p2)) faceEachOther(p1, p2);
  for (const f of [p1, p2]) {
    if (isRagdoll(f)) continue;
    f.mixer.update(dt);
    f.root.position.y = 0;
    poseAfterMixer(f);
    applyMalfunctions(f, dt);
  }
  if (isRagdoll(p1)) applyMalfunctions(p1, dt);
  if (isRagdoll(p2)) applyMalfunctions(p2, dt);
  stepDamage(scene, dt);

  if (!match.camLock) updateCamera(dt);
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
  addArenaLights(scene, built.fixturePos);
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
  shellCall('onReady', { THREE, camera, match, get p1() { return p1; }, get p2() { return p2; } }); // [game-shell hook]
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

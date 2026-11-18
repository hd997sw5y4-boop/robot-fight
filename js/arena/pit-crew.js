'use strict';
/* Blue and red pit crews just outside the cage: CC0 Quaternius crew, Kenney props. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { ARENA } from '../config.js';
import { STADIUM } from './stadium-config.js';

const CHAR_FILES = { Worker: 'Worker.glb', Casual: 'Casual.glb', Casual2: 'Casual2.glb' };
const PROP_FILES = {
  desk: 'desk.glb',
  chair: 'chairDesk.glb',
  laptop: 'laptop.glb',
  keyboard: 'computerKeyboard.glb',
  screen: 'computerScreen.glb',
  mouse: 'computerMouse.glb',
  crane: 'crane.glb',
  craneLift: 'crane-lift.glb',
  rack: 'structure-tall.glb',
  box: 'box-small.glb',
  cog: 'cog-a.glb',
  arm: 'robot-arm-a.glb',
  lever: 'lever-single.glb',
};

let root = null;
let gfxKey = 'low';
let loadGen = 0;
let loading = false;
const cheerers = [];
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();

function std(color, { rough = 0.7, metal = 0.08, emissive, emi = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (emissive != null) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emi; }
  return m;
}

function loadGltf(loader, file) {
  return loader.loadAsync('./models/pit-crew/' + file);
}

function enableShadows(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

function fitOnFloor(obj, { height, width, keepXZ = false } = {}) {
  obj.updateMatrixWorld(true);
  _box.setFromObject(obj);
  if (_box.isEmpty()) return obj;
  _box.getSize(_size);
  let s = 1;
  if (height && _size.y > 1e-4) s = height / _size.y;
  if (width && _size.x > 1e-4) s = width / _size.x;
  if (s !== 1) {
    obj.scale.multiplyScalar(s);
    obj.updateMatrixWorld(true);
    _box.setFromObject(obj);
    _box.getSize(_size);
  }
  if (!keepXZ) {
    _box.getCenter(_center);
    obj.position.x -= _center.x;
    obj.position.z -= _center.z;
  }
  obj.position.y -= _box.min.y;
  return obj;
}

function cloneScene(gltf) {
  return cloneSkinned(gltf.scene);
}

function applyMaps(obj, maps, { metalness = 0.05, roughness = 0.8, color = 0xffffff } = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = [].concat(o.material);
    const out = src.map((m) => {
      const mat = m.clone();
      if (maps.map) mat.map = maps.map;
      if (maps.normalMap) mat.normalMap = maps.normalMap;
      if (maps.roughnessMap) mat.roughnessMap = maps.roughnessMap;
      if (maps.metalnessMap) mat.metalnessMap = maps.metalnessMap;
      mat.metalness = metalness;
      mat.roughness = roughness;
      mat.color.set(color);
      mat.needsUpdate = true;
      return mat;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
}

function tintClothes(obj, hex) {
  const team = new THREE.Color(hex);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const name = o.name || '';
    const cloth = /Body|Legs|Shirt|Pants|Torso/i.test(name);
    if (!cloth && !/Worker|Casual/i.test(name)) return;
    const src = [].concat(o.material);
    const out = src.map((m) => {
      const mat = m.clone();
      if (!mat.color) return mat;
      const c = mat.color;
      const isSkin = c.r > 0.35 && c.g > 0.22 && c.g < 0.72 && c.b < 0.5 && c.r > c.b + 0.12;
      const isHair = c.r < 0.22 && c.g < 0.2 && c.b < 0.18;
      if (isSkin || isHair) return mat;
      c.lerp(team, cloth ? 0.42 : 0.28);
      mat.needsUpdate = true;
      return mat;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
}

function screenGlow(obj, hex) {
  const team = new THREE.Color(hex);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const src = [].concat(o.material);
    const out = src.map((m, i) => {
      const mat = m.clone();
      // Kenney screens/laptops usually have a lighter display face as a later material.
      if (i > 0 || /screen|display|lid/i.test(o.name || '')) {
        mat.emissive = team;
        mat.emissiveIntensity = 0.35;
      }
      mat.needsUpdate = true;
      return mat;
    });
    o.material = out.length === 1 ? out[0] : out;
  });
}

function boneMap(rootObj) {
  const map = {};
  rootObj.traverse((o) => {
    if (o.isBone) map[o.name] = o;
  });
  return map;
}

function storeRest(bones) {
  for (const b of Object.values(bones)) {
    if (b && b.quaternion) b.userData.restQ = b.quaternion.clone();
  }
}

function applyLocal(bone, x, y, z) {
  if (!bone || !bone.userData.restQ) return;
  _euler.set(x, y, z);
  _quat.setFromEuler(_euler);
  bone.quaternion.copy(bone.userData.restQ).multiply(_quat);
}

function poseCrew(p, t) {
  const b = p.bones;
  if (!b) return;
  const ph = p.phase;
  const bob = Math.sin(t * 2.6 + ph) * 0.012;
  if (p._baseY == null) p._baseY = p.group.position.y;
  p.group.position.y = p._baseY + bob;
  const sway = Math.sin(t * 1.5 + ph) * 0.04;
  applyLocal(b.Hips, 0, sway * 0.4, 0);
  applyLocal(b.Chest, Math.sin(t * 1.7 + ph) * 0.03, 0, sway * 0.3);
  if (p.style === 'type') {
    applyLocal(b.Head, 0.28, 0, 0);
    applyLocal(b.UpperArmL, -0.85, 0, 0.35);
    applyLocal(b.UpperArmR, -0.85, 0, -0.35);
    applyLocal(b.LowerArmL, -0.55 + Math.sin(t * 8 + ph) * 0.18, 0, 0);
    applyLocal(b.LowerArmR, -0.5 + Math.sin(t * 9 + ph + 1) * 0.18, 0, 0);
  } else if (p.style === 'clap') {
    const s = (Math.sin(t * 5.2 + ph) + 1) * 0.5;
    applyLocal(b.UpperArmL, -1.15, 0, 0.55 + s * 0.55);
    applyLocal(b.UpperArmR, -1.15, 0, -0.55 - s * 0.55);
    applyLocal(b.LowerArmL, -0.7, 0, 0.2);
    applyLocal(b.LowerArmR, -0.7, 0, -0.2);
    applyLocal(b.Head, 0.05, sway * 0.4, 0);
  } else {
    // Cheer: arms up, slight wave — facing the cage and their robot.
    applyLocal(b.UpperArmL, -0.25, 0, 2.15 + Math.sin(t * 4 + ph) * 0.16);
    applyLocal(b.UpperArmR, -0.25, 0, -2.15 + Math.cos(t * 4.2 + ph) * 0.16);
    applyLocal(b.LowerArmL, -0.35, 0, 0.15);
    applyLocal(b.LowerArmR, -0.35, 0, -0.15);
    applyLocal(b.Head, -0.08, sway * 0.5, 0);
  }
}

function wrapProp(gltf, maps, kind, teamHex) {
  const obj = cloneScene(gltf);
  enableShadows(obj);
  if (kind === 'wood') applyMaps(obj, maps.wood, { metalness: 0.04, roughness: 0.82, color: 0xf0e6d4 });
  else if (kind === 'metal') applyMaps(obj, maps.metal, { metalness: 0.82, roughness: 0.38, color: 0xc8ccd2 });
  else if (kind === 'screen') screenGlow(obj, teamHex);
  return obj;
}

function makePerson(gltf, teamHex, seed, style) {
  const group = new THREE.Group();
  const model = cloneScene(gltf);
  enableShadows(model);
  tintClothes(model, teamHex);
  fitOnFloor(model, { height: 1.72 });
  group.add(model);
  const raw = boneMap(model);
  const bones = {
    Hips: raw.Hips,
    Chest: raw.Chest || raw.Torso || raw.Abdomen,
    Head: raw.Head,
    UpperArmL: raw['UpperArm.L'],
    UpperArmR: raw['UpperArm.R'],
    LowerArmL: raw['LowerArm.L'],
    LowerArmR: raw['LowerArm.R'],
  };
  storeRest(bones);
  return { group, bones, phase: seed * 1.7, style };
}

function makeDesk(assets, maps, teamHex) {
  const g = new THREE.Group();
  const desk = wrapProp(assets.desk, maps, 'wood');
  fitOnFloor(desk, { height: 0.76 });
  g.add(desk);

  const chair = wrapProp(assets.chair, maps, 'wood');
  fitOnFloor(chair, { height: 0.86 });
  chair.position.set(-0.15, 0, -0.62);
  // Seat faces +Z (the desk / cage); Kenney chair is already built that way.
  g.add(chair);

  const placeLaptop = (x) => {
    const laptop = wrapProp(assets.laptop, maps, 'screen', teamHex);
    fitOnFloor(laptop);
    laptop.position.set(x, 0.76, 0.02);
    g.add(laptop);
  };
  placeLaptop(-0.32);
  placeLaptop(0.28);

  const kb = wrapProp(assets.keyboard, maps, 'metal');
  fitOnFloor(kb, { width: 0.36 });
  kb.position.set(-0.32, 0.76, -0.12);
  g.add(kb);

  const mouse = wrapProp(assets.mouse, maps, 'metal');
  fitOnFloor(mouse);
  mouse.position.set(0.02, 0.76, -0.14);
  g.add(mouse);

  const screen = wrapProp(assets.screen, maps, 'screen', teamHex);
  fitOnFloor(screen, { height: 0.32 });
  screen.position.set(0.55, 0.76, 0.06);
  g.add(screen);

  const box = wrapProp(assets.box, maps, 'metal');
  fitOnFloor(box, { height: 0.16 });
  box.position.set(0.78, 0.76, -0.04);
  g.add(box);

  const cog = wrapProp(assets.cog, maps, 'metal');
  fitOnFloor(cog, { width: 0.16 });
  cog.position.set(0.78, 0.92, -0.04);
  g.add(cog);

  const lever = wrapProp(assets.lever, maps, 'metal');
  fitOnFloor(lever, { height: 0.14 });
  lever.position.set(-0.72, 0.76, 0.05);
  lever.rotation.y = 0.4;
  g.add(lever);
  return g;
}

function makeRack(assets, maps) {
  const g = new THREE.Group();
  const crane = wrapProp(assets.crane, maps, 'metal');
  fitOnFloor(crane, { height: 2.15 });
  crane.rotation.y = Math.PI / 2;
  g.add(crane);

  const rack = wrapProp(assets.rack, maps, 'metal');
  fitOnFloor(rack, { height: 1.7 });
  rack.position.set(-0.7, 0, 0.15);
  g.add(rack);

  const arm = wrapProp(assets.arm, maps, 'metal');
  fitOnFloor(arm, { height: 1.35 });
  arm.position.set(0.75, 0, -0.15);
  arm.rotation.y = -0.4;
  g.add(arm);

  const box = wrapProp(assets.box, maps, 'metal');
  fitOnFloor(box, { height: 0.38 });
  box.position.set(-0.7, 0, -0.35);
  g.add(box);

  const lift = wrapProp(assets.craneLift, maps, 'metal');
  fitOnFloor(lift, { height: 0.55 });
  lift.position.set(0.15, 0, 0.55);
  g.add(lift);
  return g;
}

function makeSide(sign, teamHex, assets, maps) {
  const g = new THREE.Group();
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);
  // Local +Z points at the cage and that side's robot.
  g.position.set(sign * (r + 1.85), 0, 0);
  g.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;

  const floorY = STADIUM.floorY != null ? STADIUM.floorY : -0.3;
  const top = -0.04;
  const thick = top - (floorY - 0.02);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, thick, 2.8),
    std(sign < 0 ? 0x1a2740 : 0x3a1a1a, { rough: 0.88, metal: 0.04 }),
  );
  pad.position.set(0, top - thick / 2, 0);
  pad.receiveShadow = true;
  g.add(pad);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.01, 0.14),
    std(teamHex, { rough: 0.4, metal: 0.2, emissive: teamHex, emi: 0.18 }),
  );
  stripe.position.set(0, top + 0.008, 1.15);
  g.add(stripe);

  const desk = makeDesk(assets, maps, teamHex);
  desk.position.set(0, top, 0.15);
  g.add(desk);

  const rack = makeRack(assets, maps);
  rack.position.set(1.4, top, -0.1);
  rack.rotation.y = -0.25;
  g.add(rack);

  // Crew stand behind the desk (local −Z) and face +Z: desk, cage, and their robot.
  const styles = ['type', 'cheer', 'clap'];
  const models = [assets.Worker, assets.Casual, assets.Casual2];
  const spots = [[-0.2, -0.72], [0.55, -0.95], [-0.7, -0.95]];
  const people = [];
  for (let i = 0; i < 3; i++) {
    const p = makePerson(models[i], teamHex, sign * 10 + i + 3, styles[i]);
    p.group.position.set(spots[i][0], top, spots[i][1]);
    p.group.rotation.y = 0;
    g.add(p.group);
    p._baseY = p.group.position.y;
    people.push(p);
  }
  return { group: g, people };
}

async function loadAndBuild() {
  if (loading || !root || gfxKey === 'low') return;
  const gen = ++loadGen;
  loading = true;
  const loader = new GLTFLoader();
  const tex = new THREE.TextureLoader();
  const loadTex = (url, srgb) => new Promise((resolve) => {
    tex.load(url, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      resolve(t);
    }, undefined, () => resolve(null));
  });
  try {
    const [woodColor, woodNormal, woodRough, metalColor, metalNormal, metalRough] = await Promise.all([
      loadTex('./textures/pit-crew/wood_color.jpg', true),
      loadTex('./textures/pit-crew/wood_normal.jpg', false),
      loadTex('./textures/pit-crew/wood_rough.jpg', false),
      loadTex('./textures/metal_color.jpg', true),
      loadTex('./textures/metal_normal.jpg', false),
      loadTex('./textures/metal_rough.jpg', false),
    ]);
    const maps = {
      wood: { map: woodColor, normalMap: woodNormal, roughnessMap: woodRough },
      metal: { map: metalColor, normalMap: metalNormal, roughnessMap: metalRough },
    };
    const files = { ...CHAR_FILES, ...PROP_FILES };
    const entries = await Promise.all(Object.entries(files).map(async ([k, f]) => [k, await loadGltf(loader, f)]));
    if (gen !== loadGen || !root) return;
    const assets = Object.fromEntries(entries);
    const blue = makeSide(-1, 0x2f74ff, assets, maps);
    const red = makeSide(1, 0xe23b3b, assets, maps);
    root.add(blue.group, red.group);
    cheerers.length = 0;
    cheerers.push(...blue.people, ...red.people);
    root.visible = gfxKey !== 'low';
  } catch (err) {
    console.warn('Pit crew models failed to load', err);
  } finally {
    if (gen === loadGen) loading = false;
  }
}

export function initPitCrew(scene, key) {
  if (key) gfxKey = key;
  disposePitCrew();
  root = new THREE.Group();
  root.name = 'PitCrews';
  scene.add(root);
  root.visible = gfxKey !== 'low';
  if (gfxKey !== 'low') loadAndBuild();
  return root;
}

export function setPitCrewGfx(key) {
  gfxKey = key;
  if (root) root.visible = key !== 'low';
  if (key !== 'low' && root && root.children.length === 0) loadAndBuild();
}

export function updatePitCrew(dt) {
  if (!root || !root.visible) return;
  const t = performance.now() / 1000;
  for (const p of cheerers) poseCrew(p, t);
}

export function disposePitCrew() {
  loadGen++;
  loading = false;
  if (!root) return;
  if (root.parent) root.parent.remove(root);
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = [].concat(o.material);
      for (const m of mats) if (m && m.dispose) m.dispose();
    }
  });
  root = null;
  cheerers.length = 0;
}

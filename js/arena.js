'use strict';
/* Cage, chrome mat, lights, and (optional) visible fence aimed at the approved concept art. */
import * as THREE from 'three';
import { ARENA } from './config.js';


const chromeTexLoader = new THREE.TextureLoader();
let chromeMaps = null;
let chromeWaiters = [];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function mixChromeMaps(chromeColor, chromeRough, chromeMetal, rustColor, rustRough) {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  const scratch = document.createElement('canvas');
  scratch.width = scratch.height = size;
  const sg = scratch.getContext('2d', { willReadFrequently: true });
  const blit = (img) => { sg.clearRect(0, 0, size, size); sg.drawImage(img, 0, 0, size, size); return sg.getImageData(0, 0, size, size).data; };
  const col = blit(chromeColor);
  const rgh = blit(chromeRough);
  const met = blit(chromeMetal);
  const rst = blit(rustColor);
  const rrg = blit(rustRough);
  const albedo = g.createImageData(size, size);
  const rough = g.createImageData(size, size);
  const metal = g.createImageData(size, size);
  for (let i = 0; i < col.length; i += 4) {
    // Rust mask: reddish patches only, contrast-crushed so most of the mat stays chrome.
    const rust = Math.max(0, (rst[i] * 1.15 - rst[i + 1] * 0.45 - rst[i + 2] * 0.2) / 255);
    const scuff = Math.max(0, (rgh[i] / 255 - 0.42) * 1.6);
    const stain = Math.min(1, rust * rust * 3.2 + scuff * 0.55);
    const cr = col[i], cg = col[i + 1], cb = col[i + 2];
    // Brighten the base toward chrome silver, then overlay rust and darker scuffs.
    const sr = Math.min(255, cr * 1.35 + 18);
    const sgv = Math.min(255, cg * 1.32 + 20);
    const sb = Math.min(255, cb * 1.28 + 24);
    albedo.data[i] = sr * (1 - stain) + rst[i] * stain;
    albedo.data[i + 1] = sgv * (1 - stain) + rst[i + 1] * stain;
    albedo.data[i + 2] = sb * (1 - stain) + rst[i + 2] * stain;
    albedo.data[i + 3] = 255;
    const chromeR = 0.08 + (rgh[i] / 255) * 0.28;
    const rustR = 0.42 + (rrg[i] / 255) * 0.5;
    const rv = Math.min(1, chromeR * (1 - stain) + rustR * stain);
    const r8 = Math.round(rv * 255);
    rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = r8;
    rough.data[i + 3] = 255;
    const chromeM = 0.88 + (met[i] / 255) * 0.12;
    const rustM = 0.22 + (met[i] / 255) * 0.15;
    const m8 = Math.round(Math.min(1, chromeM * (1 - stain) + rustM * stain) * 255);
    metal.data[i] = metal.data[i + 1] = metal.data[i + 2] = m8;
    metal.data[i + 3] = 255;
  }
  const toTex = (data, srgb) => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    cv.getContext('2d').putImageData(data, 0, 0);
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  };
  return { map: toTex(albedo, true), roughnessMap: toTex(rough, false), metalnessMap: toTex(metal, false) };
}

function requestChromeMaps() {
  if (chromeMaps) return Promise.resolve(chromeMaps);
  return Promise.all([
    loadImage('./textures/chrome_color.jpg'),
    loadImage('./textures/chrome_rough.jpg'),
    loadImage('./textures/chrome_metal.jpg'),
    loadImage('./textures/rust_color.jpg'),
    loadImage('./textures/rust_rough.jpg'),
  ]).then(([c, r, m, rc, rr]) => {
    chromeMaps = mixChromeMaps(c, r, m, rc, rr);
    const n = chromeTexLoader.load('./textures/chrome_normal.jpg');
    n.wrapS = n.wrapT = THREE.RepeatWrapping;
    n.colorSpace = THREE.NoColorSpace;
    chromeMaps.normalMap = n;
    for (const fn of chromeWaiters) fn(chromeMaps);
    chromeWaiters = [];
    return chromeMaps;
  }).catch((err) => { console.warn('Chrome mat textures failed', err); return null; });
}
requestChromeMaps();

function applyChromeMaps(mat, maps, repeat) {
  if (!mat || !maps) return;
  const wrap = (tex) => {
    const t = tex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.needsUpdate = true;
    return t;
  };
  mat.map = wrap(maps.map);
  mat.roughnessMap = wrap(maps.roughnessMap);
  mat.metalnessMap = wrap(maps.metalnessMap);
  if (maps.normalMap) {
    mat.normalMap = wrap(maps.normalMap);
    mat.normalScale = new THREE.Vector2(0.55, 0.55);
  }
  mat.needsUpdate = true;
}

function chainlinkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(210,210,214,0.92)';
  g.lineWidth = 5;
  g.lineJoin = 'round';
  const s = 28;
  for (let y = -s; y <= 256 + s; y += s) {
    for (let x = -s; x <= 256 + s; x += s) {
      g.beginPath();
      g.moveTo(x, y + s / 2);
      g.lineTo(x + s / 2, y);
      g.lineTo(x + s, y + s / 2);
      g.lineTo(x + s / 2, y + s);
      g.closePath();
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function logoTexture() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 1024, 1024);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 22;
  g.beginPath();
  g.arc(512, 512, 430, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.96)';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '700 86px ui-sans-serif, system-ui, sans-serif';
  g.letterSpacing = '0.18em';
  g.fillText('WINDOW', 512, 400);
  g.fillText('WORKSHOP', 512, 512);
  g.fillText('GAMES', 512, 624);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const FENCE_TOP = 2.82;
let cageFadeList = [];
const _camXZ = new THREE.Vector3();
const _posXZ = new THREE.Vector3();

export function updateCageFade(camera, focus, dt) {
  if (!cageFadeList.length || !camera) return;
  _camXZ.set(camera.position.x, 0, camera.position.z);
  const origin = focus ? _posXZ.set(focus.x, 0, focus.z) : _posXZ.set(0, 0, 0);
  const camDir = _camXZ.clone().sub(origin);
  if (camDir.lengthSq() < 1e-6) return;
  camDir.normalize();
  const k = dt <= 0 ? 1 : 1 - Math.pow(0.0008, dt);
  for (const piece of cageFadeList) {
    const outward = piece.pos.clone().setY(0).sub(origin);
    if (outward.lengthSq() < 1e-8) continue;
    outward.normalize();
    // 1 = piece sits on the camera side of the ring (between camera and fighters).
    const facing = outward.dot(camDir);
    const t = Math.max(0, Math.min(1, (facing - 0.08) / 0.62));
    const target = 1 - t * (1 - 0.12);
    for (const mesh of piece.meshes) {
      const mat = mesh.material;
      if (!mat) continue;
      mat.opacity = mat.opacity + (target - (mat.opacity ?? 1)) * k;
      mat.transparent = true;
      mat.depthWrite = mat.opacity > 0.92 && piece.kind === 'post';
      mesh.castShadow = mat.opacity > 0.55;
    }
  }
}

export function buildArena(scene, { tiled, metalColor, metalRough, metalMetal }) {
  const group = new THREE.Group();
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);

  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0xc8ced6,
    metalness: 0.93,
    roughness: 0.24,
    envMapIntensity: 1.15,
    clearcoat: 0.28,
    clearcoatRoughness: 0.22,
  });
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ARENA.floorThickness, 8), floorMat);
  const paintChrome = (maps) => applyChromeMaps(floorMat, maps, 4.2);
  if (chromeMaps) paintChrome(chromeMaps);
  else chromeWaiters.push(paintChrome);
  floor.position.y = -ARENA.floorThickness / 2;
  floor.rotation.y = Math.PI / 8;
  floor.receiveShadow = true;
  group.add(floor);

  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 64),
    new THREE.MeshPhysicalMaterial({
      map: logoTexture(),
      transparent: true,
      metalness: 0.85,
      roughness: 0.28,
      envMapIntensity: 1.1,
      emissive: 0xffffff,
      emissiveIntensity: 0.04,
      depthWrite: false,
    }),
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.y = 0.002;
  logo.receiveShadow = true;
  group.add(logo);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xf2f4f7,
    metalness: 0.15,
    roughness: 0.35,
    emissive: 0x888c92,
    emissiveIntensity: 0.12,
  });
  const inner = new THREE.Mesh(new THREE.RingGeometry(a - 0.2, a - 0.04, 8), ringMat);
  inner.rotation.x = -Math.PI / 2;
  inner.rotation.z = Math.PI / 8;
  inner.position.y = 0.003;
  group.add(inner);

  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.14, 8),
    new THREE.MeshPhysicalMaterial({ color: 0xb7bec6, metalness: 0.92, roughness: 0.22, envMapIntensity: 1.2 }),
  );
  // Solid trim cylinder: keep its top just under the mat top (y=0). At 0.02 its lid sat at
  // y=0.09 over the whole floor and the robots' feet sank into it.
  edge.position.y = -0.07 - 0.001;
  edge.rotation.y = Math.PI / 8;
  edge.receiveShadow = true;
  edge.castShadow = true;
  group.add(edge);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 22, 14, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 1, metalness: 0, side: THREE.BackSide }),
  );
  wall.position.y = 5.5;
  wall.name = 'arenaVoidWall';
  wall.userData.voidWall = true;
  group.add(wall);

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x1b1d22,
    metalness: 0.65,
    roughness: 0.38,
    map: tiled(metalColor, 1, 3),
    roughnessMap: tiled(metalRough, 1, 3),
  });
  const padMat = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.15, roughness: 0.7 });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x2a2d33,
    metalness: 0.7,
    roughness: 0.35,
    map: tiled(metalColor, 3, 0.4),
    roughnessMap: tiled(metalRough, 3, 0.4),
  });
  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xfff4dc,
    emissive: 0xffe7b0,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });

  const postH = 3.2;
  const corners = [];
  const cageFade = [];
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    corners.push(new THREE.Vector3(x, 0, z));
    if (ARENA.cage) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, postH, 12), postMat.clone());
      post.position.set(x, postH / 2, z);
      post.castShadow = true;
      post.receiveShadow = true;
      post.material.transparent = true;
      group.add(post);
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.4, 12), padMat.clone());
      pad.position.set(x, 1.35, z);
      pad.castShadow = true;
      pad.material.transparent = true;
      group.add(pad);
      cageFade.push({ kind: 'post', meshes: [post, pad], pos: new THREE.Vector3(x, 1.2, z) });
    }
  }

  const railHeights = [0.62, 1.45, 2.28];
  const yAxis = new THREE.Vector3(0, 1, 0);
  const linkTex = chainlinkTexture();
  const linkMat = new THREE.MeshStandardMaterial({
    map: linkTex,
    transparent: true,
    side: THREE.DoubleSide,
    color: 0x9aa0a8,
    metalness: 0.7,
    roughness: 0.35,
    // No alphaTest: we fade near-side panels to ~12% and alphaTest would discard the wires.
    depthWrite: false,
  });
  linkTex.repeat.set(6, 3);

  if (ARENA.cage) for (let i = 0; i < 8; i++) {
    const apos = corners[i];
    const bpos = corners[(i + 1) % 8];
    const dir = new THREE.Vector3().subVectors(bpos, apos);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(apos, bpos).multiplyScalar(0.5);
    const along = dir.clone().normalize();
    // Cylinders are Y-up; mapping +Y onto the side direction is never a 180° singularity.
    const railQ = new THREE.Quaternion().setFromUnitVectors(yAxis, along);
    const sideMeshes = [];
    for (const h of railHeights) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, len, 8), railMat.clone());
      rail.quaternion.copy(railQ);
      rail.position.set(mid.x, h, mid.z);
      rail.castShadow = true;
      rail.material.transparent = true;
      group.add(rail);
      sideMeshes.push(rail);
    }
    // PlaneGeometry faces +Z. Yaw so +Z points outward (center -> side midpoint).
    const fence = new THREE.Mesh(new THREE.PlaneGeometry(len, 2.55), linkMat.clone());
    fence.rotation.set(0, Math.atan2(mid.x, mid.z), 0);
    fence.position.set(mid.x, 1.48, mid.z);
    fence.castShadow = true;
    group.add(fence);
    sideMeshes.push(fence);
    cageFade.push({ kind: 'side', meshes: sideMeshes, pos: mid.clone() });
  }

  // Overhead spots (visual fixtures + actual lights added by caller via exported positions).
  const fixturePos = [];
  for (let i = 0; i < 4; i++) {
    const ang = i * Math.PI / 2 + Math.PI / 4;
    const fx = Math.cos(ang) * 3.4;
    const fz = Math.sin(ang) * 3.4;
    const fy = 7.1;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), fixtureMat);
    bulb.position.set(fx, fy, fz);
    group.add(bulb);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.28, 12), new THREE.MeshStandardMaterial({ color: 0x111214, metalness: 0.6, roughness: 0.4 }));
    can.position.set(fx, fy + 0.2, fz);
    group.add(can);
    fixturePos.push(new THREE.Vector3(fx, fy, fz));
  }

  scene.add(group);
  cageFadeList = ARENA.cage ? cageFade : [];
  return { group, fixturePos, fenceTop: FENCE_TOP };
}

export function addArenaLights(scene, fixturePos) {
  const hemi = new THREE.HemisphereLight(0xc5d6ee, 0x1a120c, 0.48);
  scene.add(hemi);
  const spots = [];
  for (const p of fixturePos) {
    // Spots stay punchy for overhead drama; ambient/fill carry the visibility lift.
    const s = new THREE.SpotLight(0xfff1d0, 20, 20, Math.PI / 6.2, 0.5, 1.05);
    s.position.copy(p);
    s.target.position.set(0, 0.4, 0);
    s.userData.wantsShadow = spots.length === 0;
    s.castShadow = spots.length === 0;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.0003;
    s.shadow.camera.near = 1;
    s.shadow.camera.far = 22;
    s.userData.baseIntensity = s.intensity;
    scene.add(s, s.target);
    spots.push(s);
  }
  hemi.userData.baseIntensity = hemi.intensity;
  const fill = new THREE.DirectionalLight(0x8ea4c4, 0.42);
  fill.position.set(-6, 6, 8);
  fill.userData.baseIntensity = fill.intensity;
  scene.add(fill);
  const fill2 = new THREE.DirectionalLight(0x6d7c92, 0.22);
  fill2.position.set(5, 4, 3);
  fill2.userData.baseIntensity = fill2.intensity;
  scene.add(fill2);
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.55);
  rim.position.set(0, 4.2, -11);
  rim.userData.baseIntensity = rim.intensity;
  scene.add(rim);
  const rimL = new THREE.DirectionalLight(0xb7d4ff, 0.4);
  rimL.position.set(-8, 3.6, -8);
  rimL.userData.baseIntensity = rimL.intensity;
  scene.add(rimL);
  const rimR = new THREE.DirectionalLight(0xffe1c2, 0.32);
  rimR.position.set(8, 3.4, -7);
  rimR.userData.baseIntensity = rimR.intensity;
  scene.add(rimR);
  return { hemi, spots, fill, fill2, rim, rimL, rimR };
}

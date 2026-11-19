'use strict';
/* Octagon MMA cage, painted metal mat (ambientCG Metal001 + decals), lights, and fade. */
import * as THREE from 'three';
import { ARENA, SIZE } from './config.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Woven chain-link: diagonal wires with a bright top edge and a dark underside,
// so it reads as round steel wire instead of flat lines. Alpha-tested so the
// fence sorts correctly and casts a real diamond shadow on the mat.
function chainlinkTexture() {
  const N = 512;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.clearRect(0, 0, N, N);
  const s = 64;
  g.lineCap = 'round';
  const wire = (x0, y0, x1, y1) => {
    g.strokeStyle = 'rgba(40,42,46,1)'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(178,182,188,1)'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = 'rgba(245,247,250,1)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x0 - 1, y0 - 1); g.lineTo(x1 - 1, y1 - 1); g.stroke();
  };
  for (let k = -N; k <= 2 * N; k += s) {
    wire(k, 0, k + N, N);
    wire(k, N, k + N, 0);
  }
  g.fillStyle = 'rgba(220,224,230,1)';
  for (let y = 0; y <= N; y += s / 2) {
    for (let x = ((y / (s / 2)) % 2) * (s / 2); x <= N; x += s) {
      g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Painted markings only (transparent canvas): start lines, corner wedges, scuffs, edge text.
// Layered as a decal over the Metal001 mat base — not a replacement for it.
function matDecalTexture(a) {
  const N = 2048;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  g.clearRect(0, 0, N, N);
  const k = N / (2 * (a / Math.cos(Math.PI / 8)) + 0.4); // px per world unit
  const cx = N / 2;
  const toPx = (x, z) => [cx + x * k, cx + z * k];
  for (let i = 0; i < 900; i++) {
    const rad = Math.random() * a * 0.95;
    const t = Math.random() * Math.PI * 2;
    const [x, y] = toPx(Math.cos(t) * rad, Math.sin(t) * rad);
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.05})`;
    g.lineWidth = 1 + Math.random() * 3;
    const ang = Math.random() * Math.PI * 2;
    const len = 10 + Math.random() * 60;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  const startX = 2.15 * SIZE;
  for (const [x, col] of [[-startX, '#2f74ff'], [startX, '#e23b3b']]) {
    const [px, py] = toPx(x, 0);
    g.fillStyle = col;
    g.globalAlpha = 0.85;
    g.fillRect(px - 0.06 * k, py - 0.7 * k, 0.12 * k, 1.4 * k);
    g.globalAlpha = 1;
  }
  const wedge = (ang, col) => {
    g.fillStyle = col;
    g.globalAlpha = 0.28;
    g.beginPath();
    const r0 = a * 0.78;
    const r1 = a * 1.02;
    g.moveTo(...toPx(Math.cos(ang - 0.2) * r0, Math.sin(ang - 0.2) * r0));
    g.lineTo(...toPx(Math.cos(ang - 0.2) * r1, Math.sin(ang - 0.2) * r1));
    g.lineTo(...toPx(Math.cos(ang + 0.2) * r1, Math.sin(ang + 0.2) * r1));
    g.lineTo(...toPx(Math.cos(ang + 0.2) * r0, Math.sin(ang + 0.2) * r0));
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  };
  wedge(Math.PI, '#2f74ff');
  wedge(0, '#e23b3b');
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = `800 ${Math.round(0.42 * k)}px ui-sans-serif, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const [z, rot] of [[a * 0.8, 0], [-a * 0.8, Math.PI]]) {
    const [px, py] = toPx(0, z);
    g.save(); g.translate(px, py); g.rotate(rot); g.fillText('ROBOT  FIGHT', 0, 0); g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  return { tex, size: N / k };
}

function merged(list, mat) {
  const geos = list.map(({ geo, m }) => { const g2 = geo.clone(); g2.applyMatrix4(m); return g2; });
  return new THREE.Mesh(mergeGeometries(geos, false), mat);
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
  t.anisotropy = 16;
  return t;
}

// World-XZ UVs so the tiled Metal001 plate reads even across the octagon, not polar-warped.
function uvWorldXZ(geometry, tile) {
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / tile;
    uv[i * 2 + 1] = pos.getZ(i) / tile;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function loadMatMetalMaps() {
  const loader = new THREE.TextureLoader();
  const wrap = (url, srgb) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 16;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return t;
  };
  return {
    map: wrap('./textures/mat_metal_color.jpg', true),
    normalMap: wrap('./textures/mat_metal_normal.jpg', false),
    roughnessMap: wrap('./textures/mat_metal_rough.jpg', false),
    metalnessMap: wrap('./textures/mat_metal_metalness.jpg', false),
  };
}

function cageHeight() {
  return ARENA.cageHeight || 1.48;
}

export const FENCE_TOP = 1.48;

export function buildArena(scene, { tiled, metalColor, metalRough }) {
  const group = new THREE.Group();
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);
  const H = cageHeight();

  // Base mat: ambientCG Metal001 (CC0), tiled in world XZ. Replaces the chrome mat.
  const matMaps = loadMatMetalMaps();
  const floorGeo = new THREE.CylinderGeometry(r, r, ARENA.floorThickness, 8);
  uvWorldXZ(floorGeo, 2.15); // ~2.15 m per tile across the ~13 m octagon
  // Sharp reflective plate: keep the color + a light normal, drop the roughness/metalness
  // maps so they cannot dull the mirror. Bloom and additive shafts/cones used to blow this
  // out into a white haze; those sources are gone, so a low roughness is safe again.
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xd4d8de,
    metalness: 0.88,
    roughness: 0.15,
    map: matMaps.map,
    normalMap: matMaps.normalMap,
    normalScale: new THREE.Vector2(0.22, 0.22),
    envMapIntensity: 1.05,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -ARENA.floorThickness / 2;
  floor.rotation.y = Math.PI / 8;
  floor.receiveShadow = true;
  group.add(floor);

  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 64),
    new THREE.MeshStandardMaterial({
      map: logoTexture(),
      transparent: true,
      metalness: 0.12,
      roughness: 0.62,
      envMapIntensity: 0.22,
      emissive: 0x000000,
      emissiveIntensity: 0,
      depthWrite: false,
    }),
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.y = 0.004;
  logo.receiveShadow = true;
  group.add(logo);

  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xd5d8de,
    metalness: 0.08,
    roughness: 0.55,
    emissive: 0x44464c,
    emissiveIntensity: 0.04,
  });
  const inner = new THREE.Mesh(new THREE.RingGeometry(a - 0.2, a - 0.04, 8), ringMat);
  inner.rotation.x = -Math.PI / 2;
  inner.rotation.z = Math.PI / 8;
  inner.position.y = 0.008;
  group.add(inner);

  // Raised rim around the mat: open band plus a top lip (not a solid disc over the paint).
  const edgeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide });
  const edge = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.14, 8, 1, true), edgeMat);
  edge.position.y = 0.02;
  edge.rotation.y = Math.PI / 8;
  edge.receiveShadow = true;
  group.add(edge);
  const lip = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r + 0.07, 8), edgeMat);
  lip.rotation.x = -Math.PI / 2;
  lip.rotation.z = Math.PI / 8;
  lip.position.y = 0.09;
  lip.receiveShadow = true;
  group.add(lip);

  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(22, 22, 14, 32, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x07080b, roughness: 1, metalness: 0, side: THREE.BackSide }),
  );
  wall.position.y = 5.5;
  wall.name = 'arenaVoidWall';
  wall.userData.voidWall = true;
  group.add(wall);

  const paint = matDecalTexture(a);
  const matDecal = new THREE.Mesh(
    new THREE.PlaneGeometry(paint.size, paint.size),
    new THREE.MeshStandardMaterial({
      map: paint.tex,
      transparent: true,
      roughness: 0.7,
      metalness: 0.06,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  matDecal.rotation.x = -Math.PI / 2;
  matDecal.position.y = 0.005;
  matDecal.receiveShadow = true;
  matDecal.renderOrder = 1;
  group.add(matDecal);

  const strip = new THREE.Mesh(
    new THREE.RingGeometry(a - 0.035, a - 0.005, 8),
    new THREE.MeshStandardMaterial({ color: 0x6e8cb4, emissive: 0x3a5478, emissiveIntensity: 0.45, roughness: 0.5, metalness: 0.1 }),
  );
  strip.rotation.x = -Math.PI / 2;
  strip.rotation.z = Math.PI / 8;
  strip.position.y = 0.01;
  group.add(strip);

  const postMat = new THREE.MeshStandardMaterial({
    color: 0x24272d, metalness: 0.8, roughness: 0.32,
    map: tiled(metalColor, 1, 3), roughnessMap: tiled(metalRough, 1, 3),
  });
  const vinylMat = new THREE.MeshStandardMaterial({ color: 0x0d0e11, metalness: 0.0, roughness: 0.42 });
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x3a3e45, metalness: 0.85, roughness: 0.3,
    map: tiled(metalColor, 3, 0.4), roughnessMap: tiled(metalRough, 3, 0.4),
  });
  const padColor = (i) => {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    const x = Math.cos(ang);
    if (x < -0.9) return 0x1d4fc4;
    if (x > 0.9) return 0xb81f1f;
    return 0x121317;
  };

  // Short cage: waist-to-chest on the ~2.74 m robots. Posts sit on the mat top (y = 0).
  const postH = H + 0.08;
  const fenceTop = H;
  const padH = H - 0.16;
  const padY = padH / 2; // bottom at y = 0
  const capY = padH;
  const ledTopY = Math.max(0.2, padH - 0.08);
  const corners = [];
  const postGeo = new THREE.CylinderGeometry(0.09, 0.11, postH, 14);
  const padGeo = new THREE.CylinderGeometry(0.2, 0.2, padH, 16);
  const capGeo = new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const ledGeo = new THREE.TorusGeometry(0.205, 0.022, 8, 28);
  const postParts = [];
  const blackPads = [];
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) {
    const ang = i * Math.PI / 4 + Math.PI / 8;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r;
    corners.push(new THREE.Vector3(x, 0, z));
    postParts.push({ geo: postGeo, m: new THREE.Matrix4().makeTranslation(x, postH / 2, z) });
    const col = padColor(i);
    if (col === 0x121317) {
      blackPads.push({ geo: padGeo, m: new THREE.Matrix4().makeTranslation(x, padY, z) });
      blackPads.push({ geo: capGeo, m: new THREE.Matrix4().makeTranslation(x, capY, z) });
    } else {
      const pm = new THREE.MeshStandardMaterial({ color: col, roughness: 0.4, metalness: 0.05 });
      const pad = new THREE.Mesh(padGeo, pm);
      pad.position.set(x, padY, z);
      pad.castShadow = true;
      const cap = new THREE.Mesh(capGeo, pm);
      cap.position.set(x, capY, z);
      const led = new THREE.Mesh(ledGeo, new THREE.MeshStandardMaterial({ color: col, emissive: new THREE.Color(col), emissiveIntensity: 0.7, roughness: 0.45, metalness: 0.15 }));
      led.rotation.x = Math.PI / 2;
      led.position.set(x, ledTopY, z);
      const led2 = led.clone();
      led2.position.y = 0.18;
      group.add(pad, cap, led, led2);
    }
  }
  const posts = merged(postParts, postMat);
  posts.castShadow = posts.receiveShadow = true;
  const pads = merged(blackPads, vinylMat);
  pads.castShadow = true;
  group.add(posts, pads);

  const linkTex = chainlinkTexture();
  const linkMat = new THREE.MeshStandardMaterial({
    map: linkTex,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    color: 0xb4bac2,
    metalness: 0.85,
    roughness: 0.3,
  });
  const fenceH = Math.max(0.4, fenceTop - 0.36);
  linkTex.repeat.set(7, Math.max(1.1, 3.2 * (fenceH / 2.34)));

  const xAxis = new THREE.Vector3(1, 0, 0);
  const railGeoCache = {};
  const rails = [];
  const fences = [];
  const topPads = [];
  const kickPads = [];
  const kickTrim = [];
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3(1, 1, 1);
  const kickH = 0.34;
  for (let i = 0; i < 8; i++) {
    const apos = corners[i];
    const bpos = corners[(i + 1) % 8];
    const dir = new THREE.Vector3().subVectors(bpos, apos);
    const len = dir.length();
    const mid = new THREE.Vector3().addVectors(apos, bpos).multiplyScalar(0.5);
    q.setFromUnitVectors(xAxis, dir.clone().normalize());
    const key = len.toFixed(3);
    if (!railGeoCache[key]) {
      railGeoCache[key] = {
        rail: new THREE.CylinderGeometry(0.03, 0.03, len, 8).rotateZ(Math.PI / 2),
        top: new THREE.CylinderGeometry(0.1, 0.1, len, 12).rotateZ(Math.PI / 2),
        fence: new THREE.PlaneGeometry(len, fenceH),
        kick: new THREE.BoxGeometry(len - 0.3, kickH, 0.12),
        trim: new THREE.BoxGeometry(len - 0.3, 0.035, 0.125),
      };
    }
    const G = railGeoCache[key];
    // Mid rail sits between the kick pad and the top pad.
    const midRailY = kickH + (fenceTop - kickH) * 0.42;
    rails.push({ geo: G.rail, m: m4.clone().compose(new THREE.Vector3(mid.x, midRailY, mid.z), q, sc) });
    topPads.push({ geo: G.top, m: m4.clone().compose(new THREE.Vector3(mid.x, fenceTop, mid.z), q, sc) });
    fences.push({ geo: G.fence, m: m4.clone().compose(new THREE.Vector3(mid.x, kickH + fenceH / 2, mid.z), q, sc) });
    // Kick pads sit on the mat (bottom at y = 0). Inner face stays near the mat flat (apothem).
    kickPads.push({ geo: G.kick, m: m4.clone().compose(new THREE.Vector3(mid.x, kickH / 2, mid.z), q, sc) });
    kickTrim.push({ geo: G.trim, m: m4.clone().compose(new THREE.Vector3(mid.x, kickH - 0.02, mid.z), q, sc) });
  }
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc0262a, roughness: 0.4, emissive: 0x400808 });
  const fencePanels = [];
  const fadeMat = (m) => { const c = m.clone(); c.transparent = true; return c; };
  for (let i = 0; i < 8; i++) {
    const side = new THREE.Group();
    const parts = [
      merged([fences[i]], fadeMat(linkMat)),
      merged([topPads[i]], fadeMat(vinylMat)),
    ];
    for (const m of parts) { m.castShadow = true; m.receiveShadow = true; side.add(m); }
    parts[0].userData.isFence = true;
    const apos = corners[i];
    const bpos = corners[(i + 1) % 8];
    side.userData.normal = new THREE.Vector3((apos.x + bpos.x) / 2, 0, (apos.z + bpos.z) / 2).normalize();
    side.userData.opacity = 1;
    side.userData.parts = parts;
    fencePanels.push(side);
    group.add(side);
  }
  group.userData.fencePanels = fencePanels;
  const railMesh = merged(rails, railMat);
  railMesh.castShadow = true;
  const kickMesh = merged(kickPads, vinylMat);
  kickMesh.receiveShadow = true;
  kickMesh.castShadow = true;
  group.add(railMesh, kickMesh, merged(kickTrim, trimMat));

  const fixtureMat = new THREE.MeshStandardMaterial({
    color: 0xfff4dc, emissive: 0xffe7b0, emissiveIntensity: 0.7, roughness: 0.45,
  });
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

  // Lift the whole octagon (mat, cage, fixtures) onto the raised stage. Skirt and steps
  // stay on the arena floor, added as a sibling group.
  const matTop = ARENA.matTop || 0;
  group.position.y = matTop;
  for (const p of fixturePos) p.y += matTop;
  addOctagonPlatform(scene, r, matTop);

  scene.add(group);
  return { group, fixturePos, fencePanels, fenceTop: H };
}

// Raised-stage skirt and steps (0.8-1 m apron). Steps sit on the +/-Z flats.
function addOctagonPlatform(scene, r, matTop) {
  const floorY = ARENA.floorY != null ? ARENA.floorY : 0;
  const h = matTop - floorY;
  if (h < 0.05) return;
  const apron = new THREE.Group();
  apron.name = 'octagonPlatform';
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x1a1d22, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.4,
  });
  const lipMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, metalness: 0.7, roughness: 0.32 });
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x22262c, metalness: 0.4, roughness: 0.45 });
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.04, r + 0.06, h, 8, 1, true), skirtMat);
  skirt.position.y = floorY + h / 2;
  skirt.rotation.y = Math.PI / 8;
  skirt.castShadow = true;
  skirt.receiveShadow = true;
  apron.add(skirt);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.08, 8), lipMat);
  pad.position.y = floorY + 0.04;
  pad.rotation.y = Math.PI / 8;
  pad.receiveShadow = true;
  apron.add(pad);
  const a = r * Math.cos(Math.PI / 8);
  const steps = 4;
  const rise = h / steps;
  const tread = 0.42;
  const width = 2.4;
  for (const sgn of [1, -1]) {
    for (let i = 0; i < steps; i++) {
      const y = floorY + rise * (i + 0.5);
      const z = sgn * (a + 0.08 + tread * (steps - i) - tread / 2);
      const box = new THREE.Mesh(new THREE.BoxGeometry(width, rise * 0.92, tread - 0.02), stepMat);
      box.position.set(0, y, z);
      box.castShadow = true;
      box.receiveShadow = true;
      apron.add(box);
    }
  }
  scene.add(apron);
}

const _cv = new THREE.Vector3();
export function updateCageFade(panels, camera, dt) {
  if (!panels) return;
  _cv.set(camera.position.x, 0, camera.position.z);
  if (_cv.lengthSq() < 1e-8) return;
  _cv.normalize();
  for (const p of panels) {
    const facing = p.userData.normal.dot(_cv);
    const target = facing > 0.55 ? 0.14 : facing > 0.1 ? 0.6 : 1;
    const o = p.userData.opacity += (target - p.userData.opacity) * Math.min(1, dt * 6);
    for (const mesh of p.userData.parts) {
      const m = mesh.material;
      m.opacity = o;
      m.depthWrite = o > 0.9;
      if (mesh.userData.isFence) m.alphaTest = o < 0.99 ? 0.05 : 0.5;
      mesh.castShadow = true;
    }
  }
}

export function addArenaLights(scene, fixturePos) {
  const hemi = new THREE.HemisphereLight(0x9eb4d0, 0x08060a, 0.22);
  scene.add(hemi);
  const spots = [];
  for (const p of fixturePos) {
    const s = new THREE.SpotLight(0xfff1d0, 14, 22, Math.PI / 7, 0.48, 1.05);
    s.position.copy(p);
    s.target.position.set(0, (ARENA.matTop || 0) + 0.35, 0);
    s.userData.industrialOverhead = true;
    s.userData.wantsShadow = spots.length < 2;
    s.castShadow = spots.length < 2;
    s.shadow.mapSize.set(2048, 2048);
    s.shadow.bias = -0.00025;
    s.shadow.normalBias = 0.02;
    s.shadow.camera.near = 2;
    s.shadow.camera.far = 16;
    s.shadow.radius = 2;
    s.userData.baseIntensity = s.intensity;
    scene.add(s, s.target);
    spots.push(s);
  }
  hemi.userData.baseIntensity = hemi.intensity;
  const fill = new THREE.DirectionalLight(0x8ea4c4, 0.22);
  fill.position.set(-6, 8, 8);
  fill.userData.baseIntensity = fill.intensity;
  fill.userData.wantsShadow = true;
  fill.castShadow = true;
  fill.shadow.mapSize.set(2048, 2048);
  fill.shadow.bias = -0.0004;
  fill.shadow.normalBias = 0.03;
  fill.shadow.camera.left = -9;
  fill.shadow.camera.right = 9;
  fill.shadow.camera.top = 9;
  fill.shadow.camera.bottom = -9;
  fill.shadow.camera.near = 1;
  fill.shadow.camera.far = 28;
  fill.shadow.radius = 2;
  scene.add(fill);
  const fill2 = new THREE.DirectionalLight(0x6d7c92, 0.1);
  fill2.position.set(5, 4, 3);
  fill2.userData.baseIntensity = fill2.intensity;
  scene.add(fill2);
  const rim = new THREE.DirectionalLight(0xcfe2ff, 0.72);
  rim.position.set(0, 4.2, -11);
  rim.userData.baseIntensity = rim.intensity;
  scene.add(rim);
  const rimL = new THREE.DirectionalLight(0xb7d4ff, 0.48);
  rimL.position.set(-8, 3.6, -8);
  rimL.userData.baseIntensity = rimL.intensity;
  scene.add(rimL);
  const rimR = new THREE.DirectionalLight(0xffe1c2, 0.4);
  rimR.position.set(8, 3.4, -7);
  rimR.userData.baseIntensity = rimR.intensity;
  scene.add(rimR);
  return { hemi, spots, fill, fill2, rim, rimL, rimR };
}

// Sharp planar mirror for the metal mat (no blur, modest mix, hidden on Low).
const FloorReflectShader = {
  name: 'FloorReflectShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0.38 },
    knee: { value: 0.35 },
    texel: { value: new THREE.Vector2(1 / 1024, 1 / 576) },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float knee;
    uniform vec2 texel;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      // Single sample: a 4-tap blur read as a white veil over the robots. Strength stays modest.
      vec3 c = texture2D( tDiffuse, uv ).rgb;
      float lum = dot( c, vec3( 0.299, 0.587, 0.114 ) );
      float a = clamp( strength * (0.32 + lum * 0.45), 0.0, 0.48 );
      gl_FragColor = vec4( c * color, a );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export async function addFloorReflection(scene) {
  const { Reflector } = await import('three/addons/objects/Reflector.js');
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);
  const w = 1024;
  const h = Math.round(w / Math.max(1, window.innerWidth / Math.max(1, window.innerHeight)));
  const mirror = new Reflector(new THREE.CircleGeometry(r * 0.995, 8), {
    textureWidth: w,
    textureHeight: h,
    color: 0xd8dee6,
    clipBias: 0.002,
    multisample: 0,
    shader: FloorReflectShader,
  });
  mirror.material.uniforms.texel.value.set(1 / w, 1 / h);
  mirror.material.transparent = true;
  mirror.material.depthWrite = false;
  mirror.rotation.x = -Math.PI / 2;
  mirror.rotation.z = Math.PI / 8;
  mirror.position.y = (ARENA.matTop || 0) + 0.0015;
  mirror.renderOrder = 1;
  mirror.name = 'floorReflection';
  scene.add(mirror);
  return mirror;
}

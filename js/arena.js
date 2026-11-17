'use strict';
/* Cage, mat logo, lights, and crowd silhouettes aimed at the approved concept art. */
import * as THREE from 'three';
import { ARENA } from './config.js';

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

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.12,
    roughness: 0.82,
    map: tiled(metalColor, 5, 5),
    roughnessMap: tiled(metalRough, 5, 5),
    metalnessMap: tiled(metalMetal, 5, 5),
  });
  floorMat.map.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.CylinderGeometry(r, r, ARENA.floorThickness, 8), floorMat);
  floor.position.y = -ARENA.floorThickness / 2;
  floor.rotation.y = Math.PI / 8;
  floor.receiveShadow = true;
  group.add(floor);

  const logo = new THREE.Mesh(
    new THREE.CircleGeometry(2.35, 64),
    new THREE.MeshStandardMaterial({
      map: logoTexture(),
      transparent: true,
      metalness: 0.05,
      roughness: 0.45,
      emissive: 0xffffff,
      emissiveIntensity: 0.08,
      depthWrite: false,
    }),
  );
  logo.rotation.x = -Math.PI / 2;
  logo.position.y = 0.01;
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
  inner.position.y = 0.012;
  group.add(inner);

  const edge = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 0.07, r + 0.07, 0.14, 8),
    new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.55, roughness: 0.4 }),
  );
  edge.position.y = 0.02;
  edge.rotation.y = Math.PI / 8;
  edge.receiveShadow = true;
  edge.castShadow = true;
  group.add(edge);

  const apron = new THREE.Mesh(
    new THREE.CylinderGeometry(r + 10, r + 10, 0.18, 16),
    new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.1, roughness: 0.95 }),
  );
  apron.position.y = -0.24;
  apron.receiveShadow = true;
  group.add(apron);

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

  addCrowd(group, r);
  scene.add(group);
  cageFadeList = ARENA.cage ? cageFade : [];
  return { group, fixturePos, fenceTop: FENCE_TOP };
}

function addCrowd(group, cageR) {
  const geo = new THREE.CapsuleGeometry(0.16, 0.55, 3, 6);
  const headGeo = new THREE.SphereGeometry(0.14, 6, 5);
  const mat = new THREE.MeshLambertMaterial({ color: 0x121014 });
  const n = 160;
  const body = new THREE.InstancedMesh(geo, mat, n);
  const heads = new THREE.InstancedMesh(headGeo, mat, n);
  body.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  heads.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  const dummy = new THREE.Object3D();
  let i = 0;
  for (; i < n; i++) {
    const ring = 0.55 + (i % 5) * 0.55;
    const ang = (i * 2.39996) + ring * 0.4;
    const rad = cageR + 1.35 + ring;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = 0.55 + (i % 7) * 0.04;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, -ang + Math.PI, (Math.random() - 0.5) * 0.08);
    dummy.scale.setScalar(0.85 + (i % 5) * 0.08);
    dummy.updateMatrix();
    body.setMatrixAt(i, dummy.matrix);
    dummy.position.y += 0.48;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
  }
  body.frustumCulled = false;
  heads.frustumCulled = false;
  group.add(body, heads);
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

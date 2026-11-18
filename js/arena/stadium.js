'use strict';
/* [stadium-arena] Original indoor stadium around the existing fight mat.
   Self-contained: game.js only calls the exported hooks marked "[stadium-arena hook]".
   The mat, ring walls, physics and grounding are untouched; this only adds scenery,
   a stadium environment map and a few extra lights, and hides the Industrial-only
   overhead bulbs while it is active. Switching back to Industrial disposes everything. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { STADIUM } from './stadium-config.js';

const ARENAS = ['stadium', 'industrial'];

function readArena() {
  if (!STADIUM.enabled) return 'industrial';
  try {
    const v = localStorage.getItem(STADIUM.storageKey);
    if (ARENAS.includes(v)) return v;
  } catch (_) { /* private mode */ }
  return ARENAS.includes(STADIUM.defaultArena) ? STADIUM.defaultArena : 'stadium';
}

let current = readArena();
let ctx = null;
let gfx = 'high';
let built = null; // { group, lights, env, tick }
const hiddenIndustrial = [];

/** True while the stadium owns scene.background / environment / fog. */
export function stadiumOwnsEnv() {
  return STADIUM.enabled && current === 'stadium';
}

export function getArena() {
  return current;
}

// ---------------------------------------------------------------- textures

function canvasTex(w, h, paint, { srgb = true, repeat = null } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function ribbonTex(repeatX) {
  const items = [
    ['ROBOT FIGHT', '#e9f3ff'],
    ['STEEL CHAMPIONSHIP', '#38d6ff'],
    ['WINDOW WORKSHOP GAMES', '#e9f3ff'],
    ['FIGHT NIGHT', '#ff4458'],
  ];
  const font = '800 64px ui-sans-serif, system-ui, sans-serif';
  const m = document.createElement('canvas').getContext('2d');
  m.font = font;
  let total = 30;
  for (const [txt] of items) total += m.measureText(txt).width + 46;
  return canvasTex(Math.ceil(total), 128, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#050a14');
    bg.addColorStop(1, '#0b1426');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.font = font;
    g.textBaseline = 'middle';
    let x = 30;
    for (const [txt, col] of items) {
      g.fillStyle = col;
      g.fillText(txt, x, h / 2 + 2);
      x += g.measureText(txt).width + 46;
      g.fillStyle = '#38d6ff';
      g.beginPath();
      g.arc(x - 23, h / 2, 9, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(56,214,255,0.55)';
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, h - 5, w, 5);
  }, { repeat: [repeatX, 1] });
}

function screenTex() {
  return canvasTex(1024, 576, (g, w, h) => {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#071026');
    bg.addColorStop(0.55, '#0d1f3f');
    bg.addColorStop(1, '#2a0b1c');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(56,214,255,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      g.moveTo(-200 + i * 110, h);
      g.lineTo(200 + i * 110, 0);
      g.stroke();
    }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffffff';
    g.font = '900 118px ui-sans-serif, system-ui, sans-serif';
    g.fillText('ROBOT FIGHT', w / 2, 150);
    g.fillStyle = '#38d6ff';
    g.font = '700 46px ui-sans-serif, system-ui, sans-serif';
    g.fillText('STEEL CHAMPIONSHIP', w / 2, 238);
    // Two corner bars (blue / red), generic.
    const bar = (x, col, label, align) => {
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fillRect(x, 320, 400, 46);
      g.fillStyle = col;
      g.fillRect(x + 4, 324, 392, 38);
      g.fillStyle = '#ffffff';
      g.font = '800 40px ui-sans-serif, system-ui, sans-serif';
      g.textAlign = align;
      g.fillText(label, align === 'left' ? x : x + 400, 410);
    };
    bar(70, '#2f8bff', 'BLUE CORNER', 'left');
    bar(w - 470, '#ff3b52', 'RED CORNER', 'right');
    g.textAlign = 'center';
    g.fillStyle = '#e9f3ff';
    g.font = '800 54px ui-sans-serif, system-ui, sans-serif';
    g.fillText('ROUND 1', w / 2, 345);
    g.fillStyle = 'rgba(233,243,255,0.6)';
    g.font = '600 28px ui-sans-serif, system-ui, sans-serif';
    g.fillText('WINDOW WORKSHOP GAMES', w / 2, 520);
  });
}

function lensTex(cols, rows) {
  return canvasTex(64 * cols, 64 * rows, (g, w, h) => {
    g.fillStyle = '#0c0d10';
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = x * 64 + 32;
        const cy = y * 64 + 32;
        const rg = g.createRadialGradient(cx, cy, 2, cx, cy, 27);
        rg.addColorStop(0, '#ffffff');
        rg.addColorStop(0.55, '#f3f7ff');
        rg.addColorStop(0.8, '#9fb2cc');
        rg.addColorStop(1, '#16181d');
        g.fillStyle = rg;
        g.beginPath();
        g.arc(cx, cy, 27, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

function glareTex() {
  return canvasTex(128, 128, (g, w) => {
    const rg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.18, 'rgba(235,244,255,0.55)');
    rg.addColorStop(0.5, 'rgba(160,190,230,0.12)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, w, w);
  });
}

function floorMarkTex() {
  return canvasTex(1024, 1024, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.strokeStyle = 'rgba(56,214,255,0.85)';
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 12, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 40, 0, Math.PI * 2);
    g.stroke();
  });
}

// ---------------------------------------------------------------- geometry helpers

// World-space UVs (3 m tiles) so one concrete texture reads the same on treads and risers.
function planarUv(geo, scale = 3) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / scale;
    uv[i * 2 + 1] = p.getZ(i) / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

function wrapUv(geo, r, scale = 3) {
  const p = geo.attributes.position;
  const uv = geo.attributes.uv;
  const circ = (Math.PI * 2 * r) / scale;
  for (let i = 0; i < p.count; i++) uv.setXY(i, uv.getX(i) * circ, p.getY(i) / scale);
  uv.needsUpdate = true;
  return geo;
}

function tread(rIn, rOut, y, segs) {
  const g = new THREE.RingGeometry(rIn, rOut, segs, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return planarUv(g);
}

function riser(r, y0, y1, segs) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, segs, 1, true);
  g.translate(0, (y0 + y1) / 2, 0);
  return wrapUv(g, r);
}

function rowY(tier, i) { return tier.y0 + i * tier.rise; }
function rowR(tier, i) { return tier.r0 + i * tier.depth; }

function bowlGeometry(tier, segs, frontY) {
  const parts = [];
  let prevY = frontY;
  for (let i = 0; i < tier.rows; i++) {
    const r = rowR(tier, i);
    const y = rowY(tier, i);
    parts.push(riser(r, prevY, y, segs));
    parts.push(tread(r, r + tier.depth, y, segs));
    prevY = y;
  }
  return mergeGeometries(parts);
}

function seatGeometry(detail) {
  const parts = [];
  const pan = new THREE.BoxGeometry(0.46, 0.07, 0.42);
  pan.translate(0, 0.44, 0.02);
  parts.push(pan);
  const back = new THREE.BoxGeometry(0.46, 0.44, 0.06);
  back.rotateX(-0.12);
  back.translate(0, 0.7, -0.2);
  parts.push(back);
  if (detail) {
    const post = new THREE.BoxGeometry(0.08, 0.42, 0.08);
    post.translate(0, 0.21, -0.08);
    parts.push(post);
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

// ---------------------------------------------------------------- build

function build(scene, renderer, pmrem, key) {
  const Q = STADIUM.quality[key] || STADIUM.quality.high;
  const segs = Q.segs;
  const group = new THREE.Group();
  group.name = 'stadiumArena';
  const lights = [];
  const tickers = [];
  const rnd = mulberry(1337);

  const texLoader = new THREE.TextureLoader();
  const loadTex = (url, srgb) => {
    const t = texLoader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const concColor = loadTex('./textures/stadium/concrete_color.jpg', true);
  const concRough = loadTex('./textures/stadium/concrete_rough.jpg', false);
  const concNormal = Q.normals ? loadTex('./textures/stadium/concrete_normal.jpg', false) : null;

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x7d838c, map: concColor, roughnessMap: concRough, roughness: 0.95,
    normalMap: concNormal, side: THREE.DoubleSide, envMapIntensity: 0.5,
  });
  if (concNormal) concrete.normalScale = new THREE.Vector2(0.6, 0.6);
  const darkConcrete = concrete.clone();
  darkConcrete.color = new THREE.Color(0x3b3f46);

  // Arena floor (sits just under the mat; mat height / physics unchanged).
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x30343b, map: concColor, roughnessMap: concRough, roughness: 0.55,
    normalMap: concNormal, metalness: 0.05, envMapIntensity: 0.9,
  });
  const floor = new THREE.Mesh(planarUv(new THREE.CircleGeometry(STADIUM.barrierR + 0.8, segs).rotateX(-Math.PI / 2), 2.5), floorMat);
  floor.position.y = STADIUM.floorY;
  floor.receiveShadow = true;
  group.add(floor);
  const mark = new THREE.Mesh(
    new THREE.CircleGeometry(10, 96).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: floorMarkTex(), transparent: true, depthWrite: false, opacity: 0.7, color: 0x8fdfff }),
  );
  mark.position.y = STADIUM.floorY + 0.01;
  group.add(mark);

  // Perimeter LED barrier (inner face reads correctly: negative repeat flips the BackSide mirror).
  const bR = STADIUM.barrierR;
  const ribbon = ribbonTex(-6);
  const ledMat = new THREE.MeshStandardMaterial({
    color: 0x000000, emissive: 0xffffff, emissiveMap: ribbon, emissiveIntensity: 1.25,
    roughness: 0.35, side: THREE.BackSide,
  });
  const barrier = new THREE.Mesh(new THREE.CylinderGeometry(bR, bR, 0.9, segs, 1, true), ledMat);
  barrier.position.y = 0.3;
  group.add(barrier);
  const cap = new THREE.Mesh(new THREE.RingGeometry(bR, bR + 0.35, segs).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.6 }));
  cap.position.y = 0.75;
  group.add(cap);
  tickers.push((dt) => { ribbon.offset.x -= dt * 0.012; });

  // Lower and upper bowls (merged stepped concrete).
  const L = STADIUM.lower;
  const U = STADIUM.upper;
  const lowerTopY = rowY(L, L.rows - 1);
  const lowerBack = rowR(L, L.rows);
  group.add(new THREE.Mesh(bowlGeometry(L, segs, STADIUM.floorY), concrete));
  // Fascia between tiers + LED ribbon.
  const fasciaTop = U.y0 - 0.3;
  const fascia = mergeGeometries([
    riser(STADIUM.fasciaR, lowerTopY, fasciaTop, segs),
    tread(STADIUM.fasciaR, U.r0, fasciaTop, segs),
    tread(lowerBack, STADIUM.fasciaR, lowerTopY, segs),
  ]);
  group.add(new THREE.Mesh(fascia, darkConcrete));
  const ribbon2 = ribbonTex(-9);
  const fasciaLed = new THREE.Mesh(
    new THREE.CylinderGeometry(STADIUM.fasciaR - 0.04, STADIUM.fasciaR - 0.04, 1.3, segs, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ribbon2, emissiveIntensity: 1.1, side: THREE.BackSide }),
  );
  fasciaLed.position.y = (lowerTopY + fasciaTop) / 2 + 0.15;
  group.add(fasciaLed);
  tickers.push((dt) => { ribbon2.offset.x += dt * 0.008; });
  group.add(new THREE.Mesh(bowlGeometry(U, segs, fasciaTop), concrete));

  // Outer wall + roof deck.
  const W = STADIUM.wallR;
  const wall = new THREE.Mesh(riser(W, STADIUM.floorY, STADIUM.roofY, segs), darkConcrete);
  group.add(wall);
  const roof = new THREE.Mesh(new THREE.CircleGeometry(W, segs).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0c0e13, roughness: 0.92, metalness: 0.2 }));
  roof.position.y = STADIUM.roofY;
  group.add(roof);

  // Entrance tunnels (diagonals) cut through the front rows of the lower bowl.
  const tunnelRows = 7;
  const tunnelHalfW = 1.9;
  const tunnelMat = new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 1 });
  const tunnelGlow = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d6ff, emissiveIntensity: 0.9 });
  for (const ang of STADIUM.tunnels) {
    const r1 = rowR(L, tunnelRows);
    const topY = rowY(L, tunnelRows - 1) + 0.05;
    const depth = r1 - L.r0 + 0.3;
    const block = new THREE.Mesh(new THREE.BoxGeometry(tunnelHalfW * 2 + 0.6, topY - STADIUM.floorY, depth), concrete);
    const mid = L.r0 - 0.3 + depth / 2;
    block.position.set(Math.cos(ang) * mid, (topY + STADIUM.floorY) / 2, Math.sin(ang) * mid);
    block.rotation.y = Math.atan2(Math.cos(ang), Math.sin(ang));
    group.add(block);
    const mouthH = Math.min(2.6, topY - STADIUM.floorY - 0.35);
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(tunnelHalfW * 2 - 0.4, mouthH), tunnelMat);
    const mr = L.r0 - 0.31;
    mouth.position.set(Math.cos(ang) * mr, STADIUM.floorY + mouthH / 2, Math.sin(ang) * mr);
    mouth.rotation.y = Math.atan2(-Math.cos(ang), -Math.sin(ang));
    group.add(mouth);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(tunnelHalfW * 2 - 0.2, 0.08, 0.04), tunnelGlow);
    strip.position.set(Math.cos(ang) * (mr - 0.03), STADIUM.floorY + mouthH + 0.08, Math.sin(ang) * (mr - 0.03));
    strip.rotation.y = mouth.rotation.y;
    group.add(strip);
  }

  // Seats + crowd (instanced).
  const seatXs = [];
  const crowdXs = [];
  const seatGap = 0.56;
  const sparseSeats = !Q.seatDetail;
  const addTier = (tier, density, tunnels) => {
    for (let i = 0; i < tier.rows; i++) {
      const r = rowR(tier, i) + 0.42;
      const y = rowY(tier, i);
      const n = Math.floor((Math.PI * 2 * r) / seatGap);
      const step = (Math.PI * 2) / n;
      for (let s = 0; s < n; s++) {
        if (s % 18 === 0 || s % 18 === 1) continue; // aisles
        const a = s * step;
        if (tunnels && i < tunnelRows + 1) {
          let blocked = false;
          for (const t of STADIUM.tunnels) {
            let d = Math.abs(a - t);
            d = Math.min(d, Math.PI * 2 - d);
            if (d * r < tunnelHalfW + 0.5) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        const occupied = rnd() < density;
        // Low graphics: upper-bowl seats only where someone sits (fewer instances).
        if (occupied || !(sparseSeats && tier === U)) seatXs.push(a, r, y);
        if (occupied) crowdXs.push(a, r, y);
      }
    }
  };
  addTier(L, Q.crowd, true);
  addTier(U, Q.crowdUpper, false);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const seatCount = seatXs.length / 3;
  const seats = new THREE.InstancedMesh(seatGeometry(Q.seatDetail),
    new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.05 }), seatCount);
  for (let k = 0; k < seatCount; k++) {
    const a = seatXs[k * 3];
    const r = seatXs[k * 3 + 1];
    const y = seatXs[k * 3 + 2];
    dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    dummy.rotation.set(0, Math.atan2(-Math.cos(a), -Math.sin(a)), 0);
    dummy.updateMatrix();
    seats.setMatrixAt(k, dummy.matrix);
    // Section colors: deep blue bowl, red accent sections behind the corners.
    const sector = Math.floor(((a + Math.PI / 12) / (Math.PI * 2)) * 12) % 12;
    color.setHex(sector % 3 === 0 ? 0x6b1e2a : 0x1f2f4a);
    seats.setColorAt(k, color);
  }
  seats.instanceMatrix.needsUpdate = true;
  if (seats.instanceColor) seats.instanceColor.needsUpdate = true;
  group.add(seats);

  const crowdCount = crowdXs.length / 3;
  const torsoGeo = new THREE.BoxGeometry(0.4, 0.56, 0.24);
  torsoGeo.translate(0, 0.78, -0.02);
  const headGeo = new THREE.IcosahedronGeometry(0.115, Q.seatDetail ? 1 : 0);
  headGeo.translate(0, 1.2, 0);
  const torsos = new THREE.InstancedMesh(torsoGeo, new THREE.MeshLambertMaterial(), crowdCount);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial(), crowdCount);
  const shirts = [0x1b2436, 0x6e1c24, 0x9a9ca2, 0x1c1e22, 0x24402f, 0x2d5378, 0x3e2a48, 0x55585e, 0x121316, 0x7a3a2c, 0x203a58, 0x2a2c31, 0x14161a, 0xb9bbc0];
  const skins = [0xc9a184, 0xb08462, 0x8e6243, 0x6d4630, 0x4a3022, 0xbd9172];
  for (let k = 0; k < crowdCount; k++) {
    const a = crowdXs[k * 3] + (rnd() - 0.5) * 0.004;
    const r = crowdXs[k * 3 + 1] + (rnd() - 0.5) * 0.08;
    const stand = rnd() < 0.12 ? 0.32 : 0;
    const y = crowdXs[k * 3 + 2] + stand + (rnd() - 0.5) * 0.06;
    dummy.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    dummy.rotation.set((rnd() - 0.5) * 0.12, Math.atan2(-Math.cos(a), -Math.sin(a)) + (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.1);
    const sc = 0.9 + rnd() * 0.2;
    dummy.scale.set(sc, sc, sc);
    dummy.updateMatrix();
    torsos.setMatrixAt(k, dummy.matrix);
    heads.setMatrixAt(k, dummy.matrix);
    torsos.setColorAt(k, color.setHex(shirts[Math.floor(rnd() * shirts.length)]));
    heads.setColorAt(k, color.setHex(skins[Math.floor(rnd() * skins.length)]));
  }
  dummy.scale.set(1, 1, 1);
  for (const m of [torsos, heads]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
  }

  // Roof truss (one InstancedMesh of unit cylinders).
  const T = STADIUM.truss;
  const members = [];
  const member = (a, b, rad) => members.push([a.clone(), b.clone(), rad]);
  const v = (r, ang, y, lat = 0) => new THREE.Vector3(
    Math.cos(ang) * r - Math.sin(ang) * lat, y, Math.sin(ang) * r + Math.cos(ang) * lat);
  const bays = 14;
  for (let s = 0; s < T.spokes; s++) {
    const ang = (s / T.spokes) * Math.PI * 2;
    for (let b = 0; b < bays; b++) {
      const r0 = T.inner + ((T.outer - T.inner) * b) / bays;
      const r1 = T.inner + ((T.outer - T.inner) * (b + 1)) / bays;
      const bot0 = v(r0, ang, T.bottom), bot1 = v(r1, ang, T.bottom);
      const tl0 = v(r0, ang, T.top, -0.6), tl1 = v(r1, ang, T.top, -0.6);
      const tr0 = v(r0, ang, T.top, 0.6), tr1 = v(r1, ang, T.top, 0.6);
      member(bot0, bot1, 0.09);
      member(tl0, tl1, 0.08);
      member(tr0, tr1, 0.08);
      member(bot0, tl0, 0.045);
      member(bot0, tr0, 0.045);
      member(tl0, tr0, 0.04);
      if (Q.diagonals) {
        member(bot0, b % 2 ? tl1 : tr1, 0.04);
        member(bot1, b % 2 ? tr0 : tl0, 0.04);
      }
    }
  }
  const ringTruss = (r, n) => {
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      member(v(r, a0, T.bottom), v(r, a1, T.bottom), 0.08);
      member(v(r, a0, T.top), v(r, a1, T.top), 0.08);
      member(v(r, a0, T.bottom), v(r, a0, T.top), 0.045);
      if (Q.diagonals) member(v(r, a0, T.bottom), v(r, a1, T.top), 0.04);
    }
  };
  ringTruss(T.inner, 24);
  ringTruss(T.inner + (T.outer - T.inner) * (5 / 14), 48);
  ringTruss(T.outer - 3.5, 72);
  const trussGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, false);
  const truss = new THREE.InstancedMesh(trussGeo,
    new THREE.MeshStandardMaterial({ color: 0x5c636d, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.9 }), members.length);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  members.forEach(([a, b, rad], i) => {
    dir.subVectors(b, a);
    const len = dir.length();
    dummy.position.addVectors(a, b).multiplyScalar(0.5);
    dummy.quaternion.setFromUnitVectors(yAxis, dir.normalize());
    dummy.scale.set(rad, len, rad);
    dummy.updateMatrix();
    truss.setMatrixAt(i, dummy.matrix);
  });
  dummy.quaternion.identity();
  dummy.scale.set(1, 1, 1);
  truss.instanceMatrix.needsUpdate = true;
  group.add(truss);

  // Fixtures: ring spot cans on the spokes, flood banks on the outer ring truss.
  const housingMat = new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.7, roughness: 0.45 });
  const lensSpot = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 2.4, emissiveMap: lensTex(1, 1) });
  const lensFlood = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xf4f8ff, emissiveIntensity: 2.0, emissiveMap: lensTex(4, 2) });
  const glare = Q.glare ? new THREE.SpriteMaterial({ map: glareTex(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false, opacity: 0.85 }) : null;
  const ringFix = [];
  const canGeo = new THREE.CylinderGeometry(0.32, 0.4, 0.7, 14, 1, false);
  const lensGeo = new THREE.CircleGeometry(0.3, 18);
  for (let s = 0; s < T.spokes; s++) {
    const ang = (s / T.spokes) * Math.PI * 2 + Math.PI / T.spokes;
    const p = v(10.5, ang, T.bottom - 0.75);
    const aim = v(2.2, ang, 0);
    const holder = new THREE.Group();
    holder.position.copy(p);
    holder.lookAt(aim);
    const can = new THREE.Mesh(canGeo, housingMat);
    can.rotation.x = Math.PI / 2;
    holder.add(can);
    const lens = new THREE.Mesh(lensGeo, lensSpot);
    lens.position.z = 0.36;
    holder.add(lens);
    if (glare) {
      const sp = new THREE.Sprite(glare);
      sp.position.z = 0.5;
      sp.scale.setScalar(2.2);
      holder.add(sp);
    }
    group.add(holder);
    ringFix.push({ p, aim });
  }
  // Ring cross-pipe the cans hang from.
  const pipeR = 10.5;
  const pipe = new THREE.Mesh(new THREE.TorusGeometry(pipeR, 0.07, 6, 96).rotateX(Math.PI / 2), housingMat);
  pipe.position.y = T.bottom - 0.35;
  group.add(pipe);

  const floodGeo = new THREE.BoxGeometry(2.6, 1.3, 0.45);
  const floodLens = new THREE.PlaneGeometry(2.4, 1.15);
  const floods = 24;
  for (let i = 0; i < floods; i++) {
    const ang = (i / floods) * Math.PI * 2;
    const p = v(T.outer - 3.5, ang, T.bottom - 0.9);
    const aim = v(i % 2 ? 3 : 20, ang + Math.PI * (i % 2 ? 1 : 0.92), i % 2 ? 0 : 4);
    const holder = new THREE.Group();
    holder.position.copy(p);
    holder.lookAt(aim);
    holder.add(new THREE.Mesh(floodGeo, housingMat));
    const lens = new THREE.Mesh(floodLens, lensFlood);
    lens.position.z = 0.235;
    holder.add(lens);
    if (glare && i % 2 === 0) {
      const sp = new THREE.Sprite(glare);
      sp.position.z = 0.6;
      sp.scale.setScalar(4.2);
      holder.add(sp);
    }
    group.add(holder);
  }

  // Fake volumetric light cones from the ring cans down to the mat.
  const coneMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
    uniforms: { uColor: { value: new THREE.Color(0xdfe9ff) }, uStrength: { value: key === 'low' ? 0.07 : 0.085 } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal);
      vV = normalize(cameraPosition - wp.xyz); vT = uv.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV; varying float vT;
      void main(){ float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
      float fade = smoothstep(0.0, 0.35, vT) * (0.35 + 0.65 * vT);
      gl_FragColor = vec4(uColor * core * fade * uStrength, 1.0); }`,
  });
  const coneStep = Math.max(1, Math.floor(ringFix.length / Q.cones));
  for (let i = 0; i < ringFix.length; i += coneStep) {
    const { p, aim } = ringFix[i];
    const len = p.distanceTo(aim);
    const cg = new THREE.CylinderGeometry(0.28, 2.6, len, 24, 1, true);
    // uv.y = 1 at the lamp, 0 at the floor; aim the cone's -Y end at the floor point.
    cg.translate(0, -len / 2, 0);
    const cone = new THREE.Mesh(cg, coneMat);
    cone.position.copy(p);
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim.clone().sub(p).normalize());
    cone.renderOrder = 5;
    group.add(cone);
  }

  // Center-hung scoreboard: four screens, LED rings, cables.
  const B = STADIUM.board;
  const board = new THREE.Group();
  board.position.y = B.y;
  board.add(new THREE.Mesh(new THREE.BoxGeometry(B.size, B.height, B.size), housingMat));
  const scr = screenTex();
  const scrMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: scr, emissiveIntensity: 1.15, roughness: 0.3 });
  const scrGeo = new THREE.PlaneGeometry(B.size - 0.36, B.height - 0.5);
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(scrGeo, scrMat);
    const a = (i * Math.PI) / 2;
    s.position.set(Math.sin(a) * (B.size / 2 + 0.01), 0, Math.cos(a) * (B.size / 2 + 0.01));
    s.rotation.y = a;
    board.add(s);
  }
  const ribbon3 = ribbonTex(2);
  const ringLed = new THREE.Mesh(new THREE.CylinderGeometry(B.size * 0.62, B.size * 0.62, 0.55, 64, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: ribbon3, emissiveIntensity: 1.2 }));
  ringLed.position.y = -B.height / 2 - 0.55;
  board.add(ringLed);
  const ringLedTop = ringLed.clone();
  ringLedTop.position.y = B.height / 2 + 0.45;
  board.add(ringLedTop);
  tickers.push((dt) => { ribbon3.offset.x += dt * 0.02; });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d6ff, emissiveIntensity: 0.9 });
  // Underside: dark panel with a thin glowing edge (a full glowing face blew out in the look-up view).
  for (let i = 0; i < 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(B.size - 0.2, 0.05, 0.06), glowMat);
    const a = (i * Math.PI) / 2;
    strip.position.set(Math.sin(a) * (B.size / 2 - 0.15), -B.height / 2 - 0.03, Math.cos(a) * (B.size / 2 - 0.15));
    strip.rotation.y = a;
    board.add(strip);
  }
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.8, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * T.inner, T.bottom - B.y, Math.sin(a) * T.inner);
    const bot = new THREE.Vector3(Math.cos(a) * B.size * 0.6, B.height / 2, Math.sin(a) * B.size * 0.6);
    const len = top.distanceTo(bot);
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 6), cableMat);
    c.position.addVectors(top, bot).multiplyScalar(0.5);
    c.quaternion.setFromUnitVectors(yAxis, top.clone().sub(bot).normalize());
    board.add(c);
  }
  group.add(board);

  // End-wall video screens above the upper bowl.
  const bigScr = screenTex();
  const bigMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: bigScr, emissiveIntensity: 1.0 });
  for (const ang of [-Math.PI / 2, Math.PI / 2]) {
    const holder = new THREE.Group();
    const r = W - 1.2;
    holder.position.set(Math.cos(ang) * r, 20.2, Math.sin(ang) * r);
    holder.lookAt(0, 12, 0);
    holder.add(new THREE.Mesh(new THREE.BoxGeometry(13.6, 6.4, 0.4), housingMat));
    const s = new THREE.Mesh(new THREE.PlaneGeometry(13, 5.9), bigMat);
    s.position.z = 0.21;
    holder.add(s);
    group.add(holder);
  }

  // Shadows: only the existing mat spot casts. Stadium pieces never cast; floor receives.
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; } });
  floor.receiveShadow = true;

  // Lights: cheap hemi lift for the bowl; on High a few shadowless spots wash the stands.
  const hemi = new THREE.HemisphereLight(0x9cb2d6, 0x15110e, key === 'low' ? 0.34 : 0.18);
  hemi.userData.stadium = true;
  scene.add(hemi);
  lights.push(hemi);
  for (let i = 0; i < Q.spots; i++) {
    const ang = (i / Q.spots) * Math.PI * 2 + Math.PI / 4;
    const s = new THREE.SpotLight(0xdfe8ff, 26, 0, Math.PI / 4.2, 0.7, 1.0);
    s.position.copy(v(6, ang + Math.PI, T.bottom - 1));
    s.target.position.copy(v(25, ang, 5));
    s.castShadow = false;
    s.userData.wantsShadow = false;
    scene.add(s, s.target);
    lights.push(s);
  }

  // Stadium environment for reflections (bright roof banks over a dark bowl).
  const env = makeEnv(pmrem);

  scene.add(group);
  const stats = { seats: seatCount, crowd: crowdCount, truss: members.length, gfx: key };
  return { group, lights, env, stats, tick: (dt) => { for (const t of tickers) t(dt); } };
}

const ENV_GAIN = 0.4;
function makeEnv(pmrem) {
  const s = new THREE.Scene();
  const geos = [];
  const mats = [];
  const add = (geo, colorScalar, pos, rotX = 0, hex = 0xffffff) => {
    const m = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    m.color.setHex(hex).multiplyScalar(colorScalar * ENV_GAIN);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(pos);
    mesh.rotation.x = rotX;
    s.add(mesh);
    geos.push(geo);
    mats.push(m);
    return mesh;
  };
  add(new THREE.SphereGeometry(60, 32, 16), 0.035, new THREE.Vector3(), 0, 0x8fa3c8);
  // Crowd band (dim, warm/cool speckle averaged out).
  add(new THREE.CylinderGeometry(30, 30, 14, 48, 1, true), 0.09, new THREE.Vector3(0, 6, 0), 0, 0x8a8f9c);
  // Ring floor bounce.
  add(new THREE.CircleGeometry(16, 32), 0.06, new THREE.Vector3(0, -1.5, 0), -Math.PI / 2, 0x9aa4b3);
  // Roof floods.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const m = add(new THREE.PlaneGeometry(3, 1.5), 9, new THREE.Vector3(Math.cos(a) * 34, 20, Math.sin(a) * 34), 0, 0xf0f5ff);
    m.lookAt(0, 0, 0);
  }
  // Ring cans overhead.
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    add(new THREE.CircleGeometry(0.9, 16), 22, new THREE.Vector3(Math.cos(a) * 10, 20, Math.sin(a) * 10), Math.PI / 2, 0xfff6ea);
  }
  // Scoreboard glow.
  add(new THREE.BoxGeometry(6, 3.6, 6), 0.5, new THREE.Vector3(0, 14, 0), 0, 0x4a7cff);
  const rt = pmrem.fromScene(s, 0.03, 0.1, 120);
  for (const g of geos) g.dispose();
  for (const m of mats) m.dispose();
  return rt;
}

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disposeBuilt(scene) {
  if (!built) return;
  const seen = new Set();
  const disposeMat = (m) => {
    if (!m || seen.has(m)) return;
    seen.add(m);
    for (const k of ['map', 'emissiveMap', 'roughnessMap', 'normalMap', 'metalnessMap', 'alphaMap']) {
      if (m[k] && !seen.has(m[k])) { seen.add(m[k]); m[k].dispose(); }
    }
    m.dispose();
  };
  built.group.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMat);
    if (o.isInstancedMesh) o.dispose();
  });
  scene.remove(built.group);
  for (const l of built.lights) {
    if (ctx && ctx.untrackLight) ctx.untrackLight(l);
    scene.remove(l);
    if (l.target) scene.remove(l.target);
    if (l.dispose) l.dispose();
  }
  if (built.env) built.env.dispose();
  built = null;
}

// ---------------------------------------------------------------- industrial bits

function setIndustrialExtras(visible) {
  if (!ctx || !ctx.industrial) return;
  if (!visible) {
    if (hiddenIndustrial.length) return;
    // Industrial overhead bulbs/cans (y > 6.5) clash with the stadium rig; hide, don't delete.
    for (const o of ctx.industrial.group.children) {
      if (o.position.y > 6.5 && o.visible) { o.visible = false; hiddenIndustrial.push(o); }
    }
  } else {
    for (const o of hiddenIndustrial) o.visible = true;
    hiddenIndustrial.length = 0;
  }
}

// ---------------------------------------------------------------- public hooks

/** Called by game.js applyHdri while the stadium is active. */
export function stadiumApplyEnv() {
  if (!ctx) return;
  const { scene } = ctx;
  scene.environment = built ? built.env.texture : scene.environment;
  scene.environmentIntensity = 0.7;
  scene.background = new THREE.Color(0x05070c);
  scene.backgroundBlurriness = 0;
  scene.backgroundIntensity = 1;
  scene.fog = new THREE.Fog(0x070a11, 34, 95);
  scene.traverse((o) => { if (o.userData && o.userData.voidWall) o.visible = false; });
}

/** Called by game.js applyGfx before shadows are re-applied. Rebuilds at the new quality. */
export function stadiumSetGfx(key) {
  const next = key === 'low' ? 'low' : 'high';
  if (next === gfx && (built || !stadiumOwnsEnv())) return;
  gfx = next;
  if (ctx && stadiumOwnsEnv()) rebuild();
}

function rebuild() {
  disposeBuilt(ctx.scene);
  built = build(ctx.scene, ctx.renderer, ctx.pmrem, gfx);
  for (const l of built.lights) if (ctx.trackLight) ctx.trackLight(l);
  setIndustrialExtras(false);
  stadiumApplyEnv();
  if (ctx.refreshLights) ctx.refreshLights();
  window.__rfStadiumStats = built.stats;
}

/** Switch arenas at runtime; persisted in localStorage. */
export function setArena(name) {
  const next = STADIUM.enabled && name === 'stadium' ? 'stadium' : 'industrial';
  current = next;
  try { localStorage.setItem(STADIUM.storageKey, next); } catch (_) { /* ignore */ }
  const sel = document.getElementById('setArena');
  if (sel) sel.value = next;
  if (!ctx) return;
  if (next === 'stadium') {
    rebuild();
  } else {
    disposeBuilt(ctx.scene);
    setIndustrialExtras(true);
    window.__rfStadiumStats = null;
    // Hand the environment back to the Industrial path (HDRI or dark room).
    if (ctx.applyHdri) ctx.applyHdri(ctx.getHdri ? ctx.getHdri() : true);
  }
}

function injectPicker() {
  if (!STADIUM.enabled || document.getElementById('setArena')) return;
  const gfxSel = document.getElementById('setGfx');
  const anchor = gfxSel && gfxSel.closest('label');
  if (!anchor) return;
  const label = document.createElement('label');
  label.textContent = 'Arena ';
  const sel = document.createElement('select');
  sel.id = 'setArena';
  for (const [v, t] of [['stadium', 'Stadium'], ['industrial', 'Industrial']]) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = t;
    sel.appendChild(o);
  }
  sel.value = current;
  sel.addEventListener('change', () => setArena(sel.value));
  label.appendChild(sel);
  anchor.after(label);
}

/**
 * Called once from game.js after the Industrial arena (mat) is built.
 * ctx: { scene, renderer, pmrem, industrial, gfx, applyHdri, getHdri, trackLight, untrackLight, refreshLights }
 */
export function initStadium(c) {
  ctx = c;
  gfx = c.gfx === 'low' ? 'low' : 'high';
  injectPicker();
  window.__rfSetArena = setArena;
  window.__rfGetArena = getArena;
  if (stadiumOwnsEnv()) rebuild();
}

/** Per-frame: scrolls LED ribbons. Cheap (texture offsets only). */
export function updateStadium(dt) {
  if (built && dt > 0) built.tick(Math.min(dt, 0.1));
}

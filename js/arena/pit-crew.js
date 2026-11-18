'use strict';
/* Blue and red pit crews just outside the cage: stylized low-poly crew, desk, tools, rack. */
import * as THREE from 'three';
import { ARENA } from '../config.js';
import { STADIUM } from './stadium-config.js';

let root = null;
const cheerers = [];

function std(color, { rough = 0.7, metal = 0.08, emissive, emi = 0 } = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  if (emissive != null) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emi; }
  return m;
}

function box(w, h, d, mat, x, y, z, parent) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function cyl(rt, rb, h, seg, mat, x, y, z, parent) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makePerson(teamHex, seed, style) {
  const g = new THREE.Group();
  const bodyCol = teamHex;
  const dark = 0x1a1c22;
  const skin = seed % 2 ? 0xc49a78 : 0x8d6a4f;
  const pant = 0x1c1e24;
  const shoe = 0x14151a;
  const bodyM = std(bodyCol, { rough: 0.62 });
  const pantM = std(pant, { rough: 0.7 });
  const skinM = std(skin, { rough: 0.75 });
  const shoeM = std(shoe, { rough: 0.8 });
  const hairM = std(seed % 3 ? 0x2a221c : 0x111214, { rough: 0.85 });

  cyl(0.075, 0.08, 0.42, 6, pantM, -0.09, 0.21, 0, g);
  cyl(0.075, 0.08, 0.42, 6, pantM, 0.09, 0.21, 0, g);
  box(0.11, 0.07, 0.18, shoeM, -0.09, 0.035, 0.02, g);
  box(0.11, 0.07, 0.18, shoeM, 0.09, 0.035, 0.02, g);
  const torso = box(0.36, 0.46, 0.22, bodyM, 0, 0.66, 0, g);
  box(0.38, 0.08, 0.24, std(dark, { rough: 0.55 }), 0, 0.88, 0, g); // collar / harness
  const head = cyl(0.11, 0.11, 0.16, 8, skinM, 0, 1.05, 0, g);
  const hair = cyl(0.115, 0.1, 0.07, 8, hairM, 0, 1.14, 0, g);
  // visor cap
  const cap = box(0.24, 0.05, 0.26, std(teamHex, { rough: 0.5, metal: 0.15 }), 0, 1.16, 0.02, g);
  cap.rotation.x = -0.15;

  const armL = new THREE.Group();
  armL.position.set(-0.22, 0.82, 0);
  const armR = new THREE.Group();
  armR.position.set(0.22, 0.82, 0);
  const sleeveM = std(bodyCol, { rough: 0.62 });
  box(0.1, 0.38, 0.1, sleeveM, 0, -0.16, 0, armL);
  box(0.1, 0.38, 0.1, sleeveM, 0, -0.16, 0, armR);
  box(0.08, 0.08, 0.08, skinM, 0, -0.36, 0, armL);
  box(0.08, 0.08, 0.08, skinM, 0, -0.36, 0, armR);
  g.add(armL, armR);

  return { group: g, armL, armR, torso, head, phase: seed * 1.7, style };
}

function poseCheers(p, t) {
  const bob = Math.sin(t * 3.1 + p.phase) * 0.03;
  if (p._baseY == null) p._baseY = p.group.position.y;
  p.group.position.y = p._baseY + bob;
  if (p.style === 'type') {
    p.armL.rotation.x = -1.05 + Math.sin(t * 8 + p.phase) * 0.12;
    p.armR.rotation.x = -1.05 + Math.sin(t * 9 + p.phase + 1) * 0.12;
    p.head.rotation.x = 0.25;
  } else if (p.style === 'clap') {
    const s = (Math.sin(t * 5 + p.phase) + 1) * 0.5;
    p.armL.rotation.z = 0.4 + s * 0.7;
    p.armR.rotation.z = -0.4 - s * 0.7;
    p.armL.rotation.x = -0.5;
    p.armR.rotation.x = -0.5;
  } else {
    // cheer: arms up, slight wave
    p.armL.rotation.z = 2.3 + Math.sin(t * 4 + p.phase) * 0.15;
    p.armR.rotation.z = -2.3 + Math.cos(t * 4.2 + p.phase) * 0.15;
    p.armL.rotation.x = -0.2;
    p.armR.rotation.x = -0.2;
  }
}

function makeDesk(teamHex) {
  const g = new THREE.Group();
  const wood = std(0x2a241c, { rough: 0.7, metal: 0.05 });
  const metal = std(0x4a4e55, { rough: 0.35, metal: 0.8 });
  const dark = std(0x15171c, { rough: 0.5, metal: 0.2 });
  // table
  box(1.7, 0.06, 0.7, wood, 0, 0.74, 0, g);
  cyl(0.04, 0.04, 0.74, 6, metal, -0.75, 0.37, -0.28, g);
  cyl(0.04, 0.04, 0.74, 6, metal, 0.75, 0.37, -0.28, g);
  cyl(0.04, 0.04, 0.74, 6, metal, -0.75, 0.37, 0.28, g);
  cyl(0.04, 0.04, 0.74, 6, metal, 0.75, 0.37, 0.28, g);
  // two laptops
  for (const x of [-0.4, 0.35]) {
    box(0.32, 0.02, 0.22, dark, x, 0.78, 0.05, g);
    const lid = box(0.32, 0.2, 0.012, dark, x, 0.88, -0.08, g);
    lid.rotation.x = -0.15;
    const scr = box(0.28, 0.16, 0.004, std(teamHex, { rough: 0.3, metal: 0.1, emissive: teamHex, emi: 0.55 }), x, 0.88, -0.072, g);
    scr.rotation.x = -0.15;
  }
  // tools: wrench, case, bottle, tablet
  box(0.22, 0.08, 0.14, std(0x3a3018, { rough: 0.6 }), 0.7, 0.81, 0.12, g);
  const wrench = box(0.28, 0.03, 0.06, metal, -0.85, 0.79, 0.15, g);
  wrench.rotation.y = 0.4;
  box(0.08, 0.14, 0.08, std(0x888c94, { rough: 0.3, metal: 0.7 }), 0.85, 0.85, -0.15, g);
  box(0.18, 0.02, 0.12, std(0x22242a, { rough: 0.4 }), -0.05, 0.78, 0.22, g);
  return g;
}

function makeRack() {
  const g = new THREE.Group();
  const steel = std(0x6a7078, { rough: 0.3, metal: 0.85 });
  const dark = std(0x1a1c20, { rough: 0.5, metal: 0.4 });
  const wheel = std(0x111214, { rough: 0.8 });
  // cart bed
  box(0.7, 0.05, 1.15, steel, 0, 0.28, 0, g);
  // posts / lifting frame
  cyl(0.03, 0.03, 1.35, 6, steel, -0.28, 0.95, -0.45, g);
  cyl(0.03, 0.03, 1.35, 6, steel, 0.28, 0.95, -0.45, g);
  cyl(0.03, 0.03, 1.35, 6, steel, -0.28, 0.95, 0.45, g);
  cyl(0.03, 0.03, 1.35, 6, steel, 0.28, 0.95, 0.45, g);
  box(0.64, 0.04, 0.08, steel, 0, 1.55, -0.45, g);
  box(0.64, 0.04, 0.08, steel, 0, 1.55, 0.45, g);
  // cradle beams
  box(0.62, 0.05, 0.08, dark, 0, 0.95, -0.2, g);
  box(0.62, 0.05, 0.08, dark, 0, 0.95, 0.2, g);
  // wheels
  for (const [x, z] of [[-0.28, -0.48], [0.28, -0.48], [-0.28, 0.48], [0.28, 0.48]]) {
    cyl(0.08, 0.08, 0.06, 10, wheel, x, 0.08, z, g).rotation.z = Math.PI / 2;
  }
  return g;
}

function makeSide(sign, teamHex) {
  const g = new THREE.Group();
  const a = ARENA.apothem;
  const r = a / Math.cos(Math.PI / 8);
  // Just outside the cage, on the blue (−X) and red (+X) sides, facing inward.
  const x = sign * (r + 1.85);
  g.position.set(x, 0, 0);
  g.rotation.y = sign > 0 ? -Math.PI / 2 : Math.PI / 2;

  // Platform sitting on / through the stadium floor so industrial mode has a solid pad.
  const floorY = STADIUM.floorY != null ? STADIUM.floorY : -0.3;
  const top = -0.04;
  const thick = top - (floorY - 0.02);
  const pad = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, thick, 2.6),
    std(sign < 0 ? 0x1a2740 : 0x3a1a1a, { rough: 0.85, metal: 0.05 }),
  );
  pad.position.set(0, top - thick / 2, 0);
  pad.receiveShadow = true;
  g.add(pad);
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(3.6, 0.01, 0.14),
    std(teamHex, { rough: 0.4, metal: 0.2, emissive: teamHex, emi: 0.25 }),
  );
  stripe.position.set(0, top + 0.008, 1.1);
  g.add(stripe);

  const desk = makeDesk(teamHex);
  desk.position.set(0, top, 0.15);
  g.add(desk);

  const rack = makeRack();
  rack.position.set(1.35, top, -0.15);
  rack.rotation.y = -0.2;
  g.add(rack);

  const styles = ['type', 'cheer', 'clap'];
  const spots = [[-0.45, 0.55], [0.4, 0.55], [-0.05, 0.95]];
  const people = [];
  for (let i = 0; i < 3; i++) {
    const p = makePerson(teamHex, sign * 10 + i + 3, styles[i]);
    p.group.position.set(spots[i][0], top, spots[i][1]);
    p.group.rotation.y = Math.PI; // face the cage / desk
    if (styles[i] === 'type') p.group.position.z = 0.42;
    g.add(p.group);
    p._baseY = p.group.position.y;
    people.push(p);
  }
  return { group: g, people };
}

export function initPitCrew(scene) {
  disposePitCrew();
  root = new THREE.Group();
  root.name = 'PitCrews';
  const blue = makeSide(-1, 0x2f74ff);
  const red = makeSide(1, 0xe23b3b);
  root.add(blue.group, red.group);
  cheerers.length = 0;
  cheerers.push(...blue.people, ...red.people);
  scene.add(root);
  return root;
}

export function setPitCrewGfx(key) {
  if (!root) return;
  root.visible = key !== 'low';
}

export function updatePitCrew(dt) {
  if (!root || !root.visible) return;
  const t = performance.now() / 1000;
  for (const p of cheerers) poseCheers(p, t);
}

export function disposePitCrew() {
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

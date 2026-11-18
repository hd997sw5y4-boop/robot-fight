// Polished chrome on select robot parts: knuckles and hands, forearm and shin plates, the head
// collar under the head, and the joints/pistons (elbows, knees, shoulders, hips, neck). The
// main armor (torso, upper arms, thighs, pelvis, feet) keeps the team tint so blue and red
// still read clearly.
//
// The model is one material and the parts are skinned, so the chrome is a per-vertex mask
// (attribute chromeMask) picked by each vertex's dominant bone; joint vertices are the ones
// whose skin weights are split between bones. A small shader patch turns masked areas into
// chrome (metalness up, roughness down, reflections boosted). Dents and damage darken the
// vertex colors (damage.js); the patch reads that darkening and dulls the chrome there:
// roughness up, metalness down. Low graphics uses a cheaper patch: chrome metal/roughness
// only, no damage dulling and no extra reflection boost.
import * as THREE from 'three';

const FULL = /^(Left|Right)(Hand|HandThumb\d|HandIndex\d|HandMiddle\d|HandRing\d|HandPinky\d)$/; // knuckles
const PLATE = /^(Left|Right)(ForeArm|Leg)$/; // forearm and shin plates
const HEAD = /^Neck$/;                        // neck collar under the head (the visor itself is the team glow)

function boneKey(name) {
  return String(name || '').replace(/^mixamorig[:._]*/i, '');
}

function buildMask(mesh) {
  const g = mesh.geometry;
  if (!g || g.attributes.chromeMask) return;
  const si = g.attributes.skinIndex;
  const sw = g.attributes.skinWeight;
  const n = g.attributes.position.count;
  const mask = new Float32Array(n);
  if (si && sw && mesh.skeleton) {
    const keys = mesh.skeleton.bones.map((b) => boneKey(b.name));
    for (let i = 0; i < n; i++) {
      let best = 0; let bestW = -1;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > bestW) { bestW = w; best = si.getComponent(i, k); }
      }
      const key = keys[best] || '';
      let m = 0;
      if (FULL.test(key)) m = 1;
      else if (PLATE.test(key)) m = 0.72;
      else if (HEAD.test(key)) m = 0.8;
      // Joints and pistons: weights split between two bones.
      if (bestW < 0.6) m = Math.max(m, Math.min(1, (0.6 - bestW) * 8 + 0.6));
      mask[i] = m;
    }
  }
  g.setAttribute('chromeMask', new THREE.BufferAttribute(mask, 1));
}

let lowGfx = false;
const chromeMats = new Set();

export function setChromeLow(low) {
  if (lowGfx === !!low) return;
  lowGfx = !!low;
  for (const m of chromeMats) {
    m.defines = m.defines || {};
    if (lowGfx) m.defines.CHROME_LOW = ''; else delete m.defines.CHROME_LOW;
    m.needsUpdate = true;
  }
}

export function applyChrome(mesh, mat, teamColor) {
  if (!mesh.isSkinnedMesh || !mat || !mat.isMeshStandardMaterial) return;
  buildMask(mesh);
  const col = new THREE.Color(0xdfe4ea).lerp(new THREE.Color(teamColor), 0.1);
  const uniforms = { uChromeCol: { value: col }, uChromeEnv: { value: 1.6 } };
  mat.userData.chrome = uniforms;
  mat.defines = mat.defines || {};
  if (lowGfx) mat.defines.CHROME_LOW = '';
  chromeMats.add(mat);
  mat.customProgramCacheKey = () => 'rf-chrome';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float chromeMask;\nvarying float vChrome;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChrome = chromeMask;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vChrome;\nuniform vec3 uChromeCol;\nuniform float uChromeEnv;')
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
float chromeDmg = 0.0;
#if defined( USE_COLOR ) && !defined( CHROME_LOW )
  chromeDmg = clamp( ( 1.0 - min( vColor.r, min( vColor.g, vColor.b ) ) ) * 2.5, 0.0, 1.0 );
#endif
float chromeK = vChrome * ( 1.0 - chromeDmg );
float chromeLum = dot( diffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
diffuseColor.rgb = mix( diffuseColor.rgb, uChromeCol * ( 0.7 + 0.5 * chromeLum ), vChrome );
metalnessFactor = mix( metalnessFactor, 1.0, chromeK );
roughnessFactor = mix( roughnessFactor, 0.1, chromeK );
#ifndef CHROME_LOW
  // Dents dull the chrome where hit.
  float chromeDull = vChrome * chromeDmg;
  diffuseColor.rgb *= 1.0 - 0.45 * chromeDull;
  metalnessFactor = mix( metalnessFactor, 0.35, chromeDull );
  roughnessFactor = mix( roughnessFactor, 0.72, chromeDull );
#endif`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && !defined( CHROME_LOW )
  radiance *= 1.0 + uChromeEnv * chromeK;
#endif`);
  };
  mat.needsUpdate = true;
}

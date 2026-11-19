// Joint limits, applied every frame after the clips, procedural bends and malfunction twitches
// (and before feet grounding). Rigid robot joints: knees and elbows are hinges that only bend
// one way, within a real range, with little sideways play; feet and toes can't twist about
// the leg (that twist is what made feet spin around their vertical axis). Each limit works
// on the bone's rotation relative to its rest (bind) pose, so the clip pose inside the
// limits is untouched.
import * as THREE from 'three';

const D = Math.PI / 180;
// Hinges: the bend axis is measured from the fighting idle (knees and elbows are bent there).
const HINGES = {
  LeftLeg: { min: -10, max: 150, side: 25 }, RightLeg: { min: -10, max: 150, side: 25 },
  LeftForeArm: { min: -10, max: 150, side: 30 }, RightForeArm: { min: -10, max: 150, side: 30 },
};
// Twist about the bone's own axis (+Y in a Mixamo rig) and total swing.
const TWISTS = {
  LeftFoot: { twist: 45, swing: 100 }, RightFoot: { twist: 45, swing: 100 },
  LeftToeBase: { twist: 20, swing: 80 }, RightToeBase: { twist: 20, swing: 80 },
  LeftHand: { twist: 70, swing: 85 }, RightHand: { twist: 70, swing: 85 },
};

const _r = new THREE.Quaternion();
const _t = new THREE.Quaternion();
const _s = new THREE.Quaternion();
const _id = new THREE.Quaternion();
const _a = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

function key(name) { return String(name || '').replace(/^mixamorig[:._]*/i, ''); }

export function initJointLimits(f) {
  const joints = [];
  f.model.traverse((o) => {
    if (!o.isBone && o.type !== 'Bone') return;
    const k = key(o.name);
    if (HINGES[k]) joints.push({ bone: o, kind: 'hinge', lim: HINGES[k], rest: o.quaternion.clone(), axis: null });
    else if (TWISTS[k]) joints.push({ bone: o, kind: 'twist', lim: TWISTS[k], rest: o.quaternion.clone() });
  });
  f.joints = joints;
  f.jointStats = { clamped: 0, flips: 0 };
}

// Split r into twist about unit axis a and the remaining swing; returns signed twist angle.
function decompose(r, a) {
  if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
  const p = r.x * a.x + r.y * a.y + r.z * a.z;
  _t.set(a.x * p, a.y * p, a.z * p, r.w);
  if (_t.lengthSq() < 1e-12) _t.identity(); else _t.normalize();
  _s.copy(r).multiply(_t.clone().invert());
  return 2 * Math.atan2(p, r.w);
}

function clampSwing(maxDeg) {
  if (_s.w < 0) _s.set(-_s.x, -_s.y, -_s.z, -_s.w);
  const ang = 2 * Math.acos(Math.min(1, _s.w));
  if (ang > maxDeg * D) { _id.identity(); _id.slerp(_s, (maxDeg * D) / ang); _s.copy(_id); return true; }
  return false;
}

function twistQ(a, ang) { return _t.setFromAxisAngle(a, ang); }

export function applyJointLimits(f) {
  if (!f.joints) return;
  const standing = f.state === 'idle' || f.state === 'walk' || f.state === 'block';
  for (const j of f.joints) {
    const b = j.bone;
    _r.copy(j.rest).invert().multiply(b.quaternion);
    if (j.kind === 'hinge') {
      if (!j.axis) {
        // Calibrate only from a standing pose. Measuring mid-punch or mid-knockdown
        // locked a bad hinge axis and then fought every later clip, including idle.
        if (!standing) continue;
        const r = _r.clone();
        if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
        const ang = 2 * Math.acos(Math.min(1, r.w));
        if (ang < 20 * D || ang > 90 * D) continue;
        j.axis = new THREE.Vector3(r.x, r.y, r.z).normalize();
      }
      const th = decompose(_r, j.axis);
      let changed = clampSwing(j.lim.side);
      const lo = j.lim.min * D;
      const hi = j.lim.max * D;
      let th2 = th;
      if (th < lo) th2 = lo; else if (th > hi) th2 = hi;
      const fold = Math.abs(th2 - th);
      if (th2 !== th) changed = true;
      if (!changed) continue;
      if (fold > 75 * D) f.jointStats.flips++;
      const sw = _s.clone();
      _r.copy(sw).multiply(twistQ(j.axis, th2));
    } else {
      const th = decompose(_r, Y);
      let changed = clampSwing(j.lim.swing);
      const lim = j.lim.twist * D;
      const th2 = Math.max(-lim, Math.min(lim, th));
      const fold = Math.abs(th2 - th);
      if (th2 !== th) changed = true;
      if (!changed) continue;
      if (fold > 80 * D) f.jointStats.flips++;
      const sw = _s.clone();
      _r.copy(sw).multiply(twistQ(Y, th2));
    }
    b.quaternion.copy(j.rest).multiply(_r);
    f.jointStats.clamped++;
  }
}

// Joint limits, applied every frame after the clips, procedural bends and malfunction twitches
// (and before feet grounding). Rigid robot joints: knees and elbows are hinges that only bend
// one way, within a real range, with little sideways play; feet and toes can't twist about
// the leg (that twist is what made feet spin around their vertical axis). Each limit works
// on the bone's rotation relative to its rest (bind) pose, so the clip pose inside the
// limits is untouched.
import * as THREE from 'three';

const D = Math.PI / 180;
// Hinges: the bend axis and range are fitted from the model's own clips at load (fitJointLimits).
// These are the minimum ranges; the authored envelope (plus a small margin) is added on top,
// so a keyframed pose is never rewritten and only procedural or blend errors get clamped.
const HINGES = {
  // Knees cannot hyperextend: 0 is straight along the fitted flex axis, negative is backward.
  LeftLeg: { min: 0, max: 140, side: 18 }, RightLeg: { min: 0, max: 140, side: 18 },
  LeftForeArm: { min: -10, max: 150, side: 30 }, RightForeArm: { min: -10, max: 150, side: 30 },
};
const FIT_MIN_BEND = 40 * D; // keys bent at least this much define the hinge axis
const FIT_MARGIN = 3 * D;
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
const _tInv = new THREE.Quaternion();
const _swHold = new THREE.Quaternion();
const _rCal = new THREE.Quaternion();
const _fq = new THREE.Quaternion();

function key(name) { return String(name || '').replace(/^mixamorig[:._]*/i, ''); }

// Bind rest saved by the loader before any clip posed the bone (userData.restQ).
function restOf(o) { return (o.userData && o.userData.restQ ? o.userData.restQ : o.quaternion).clone(); }

export function initJointLimits(f) {
  const joints = [];
  f.model.traverse((o) => {
    if (!o.isBone && o.type !== 'Bone') return;
    const k = key(o.name);
    if (HINGES[k]) joints.push({ bone: o, key: k, kind: 'hinge', lim: { ...HINGES[k] }, rest: restOf(o), axis: null });
    else if (TWISTS[k]) joints.push({ bone: o, key: k, kind: 'twist', lim: { ...TWISTS[k] }, rest: restOf(o) });
  });
  f.joints = joints;
  f.jointStats = { clamped: 0, flips: 0, flipBones: [] };
}

// Split r into twist about unit axis a and the remaining swing; returns signed twist angle.
function decompose(r, a) {
  if (r.w < 0) r.set(-r.x, -r.y, -r.z, -r.w);
  const p = r.x * a.x + r.y * a.y + r.z * a.z;
  _t.set(a.x * p, a.y * p, a.z * p, r.w);
  if (_t.lengthSq() < 1e-12) _t.identity(); else _t.normalize();
  _s.copy(r).multiply(_tInv.copy(_t).invert());
  return 2 * Math.atan2(p, r.w);
}

function clampSwing(maxDeg) {
  if (_s.w < 0) _s.set(-_s.x, -_s.y, -_s.z, -_s.w);
  const ang = 2 * Math.acos(Math.min(1, _s.w));
  if (ang > maxDeg * D) { _id.identity(); _id.slerp(_s, (maxDeg * D) / ang); _s.copy(_id); return true; }
  return false;
}

function twistQ(a, ang) { return _t.setFromAxisAngle(a, ang); }
function wrapPi(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

export function applyJointLimits(f) {
  if (!f.joints) return;
  for (const j of f.joints) {
    const b = j.bone;
    _r.copy(j.rest).invert().multiply(b.quaternion);
    if (j.kind === 'hinge') {
      if (!j.axis) continue; // Fitted once from the clips at load.
      const th = decompose(_r, j.axis);
      let changed = clampSwing(j.lim.side);
      const lo = j.lim.min * D;
      const hi = j.lim.max * D;
      // The flex angle wraps at +-180: an elbow folded past ~180 (Uppercut / ElbowPunching plus
      // the punch IK) reads as a large negative angle and was clamped to the far end of the
      // range, a half-turn snap (the jointFlip events). Out of range, take the limit that is
      // nearer around the circle.
      let th2 = th;
      if (th < lo || th > hi) {
        const dLo = wrapPi(lo - th), dHi = wrapPi(th - hi);
        th2 = Math.abs(dLo) <= Math.abs(dHi) ? lo : hi;
      }
      const fold = Math.abs(wrapPi(th2 - th));
      if (th2 !== th) changed = true;
      if (!changed) continue;
      if (fold > 75 * D) { f.jointStats.flips++; f.jointStats.flipBones.push(j.key); }
      _swHold.copy(_s);
      _r.copy(_swHold).multiply(twistQ(j.axis, th2));
    } else {
      const th = decompose(_r, Y);
      let changed = clampSwing(j.lim.swing);
      const lim = j.lim.twist * D;
      const th2 = Math.max(-lim, Math.min(lim, th));
      const fold = Math.abs(th2 - th);
      if (th2 !== th) changed = true;
      if (!changed) continue;
      if (fold > 80 * D) { f.jointStats.flips++; f.jointStats.flipBones.push(j.key); }
      _swHold.copy(_s);
      _r.copy(_swHold).multiply(twistQ(Y, th2));
    }
    if (!Number.isFinite(_r.x + _r.y + _r.z + _r.w)) continue; // never write a NaN pose
    b.quaternion.copy(j.rest).multiply(_r);
    f.jointStats.clamped++;
  }
}

// Fit each joint from the model's clips. Hinges: the axis is the mean rotation axis (from
// the bind rest) of every key bent at least FIT_MIN_BEND, which points in the flex direction.
// Every joint's limits then widen to the authored envelope. The old axis came from a single
// FightingIdle frame against a rest that was itself FightingIdle frame 0, so it was ~14 deg
// off on the left knee and the limits rewrote clip poses.
export function fitJointLimits(f, clips) {
  if (!f || !f.joints || !clips) return;
  for (const j of f.joints) {
    const tracks = [];
    for (const c of clips) {
      for (const t of c.tracks) {
        if (!t.name.endsWith('.quaternion')) continue;
        if (key(t.name.slice(0, -'.quaternion'.length)) === j.key) tracks.push(t.values);
      }
    }
    if (!tracks.length) continue;
    const restInv = _rCal.copy(j.rest).invert();
    if (j.kind === 'twist') {
      let tw = 0; let sw = 0;
      for (const v of tracks) {
        for (let i = 0; i < v.length; i += 4) {
          _r.copy(restInv).multiply(_fq.fromArray(v, i));
          tw = Math.max(tw, Math.abs(decompose(_r, Y)));
          if (_s.w < 0) _s.set(-_s.x, -_s.y, -_s.z, -_s.w);
          sw = Math.max(sw, 2 * Math.acos(Math.min(1, _s.w)));
        }
      }
      j.lim.twist = Math.max(j.lim.twist, (tw + FIT_MARGIN) / D);
      j.lim.swing = Math.max(j.lim.swing, (sw + FIT_MARGIN) / D);
      continue;
    }
    const sum = new THREE.Vector3();
    let n = 0;
    for (const v of tracks) {
      for (let i = 0; i < v.length; i += 4) {
        _r.copy(restInv).multiply(_fq.fromArray(v, i));
        if (_r.w < 0) _r.set(-_r.x, -_r.y, -_r.z, -_r.w);
        if (2 * Math.acos(Math.min(1, _r.w)) < FIT_MIN_BEND) continue;
        sum.add(_a.set(_r.x, _r.y, _r.z).normalize());
        n++;
      }
    }
    if (n < 20 || sum.lengthSq() < 1e-6) continue; // no reliable data: leave this joint free
    j.axis = sum.normalize();
    let lo = Infinity; let hi = -Infinity; let side = 0;
    for (const v of tracks) {
      for (let i = 0; i < v.length; i += 4) {
        _r.copy(restInv).multiply(_fq.fromArray(v, i));
        const th = decompose(_r, j.axis);
        if (_s.w < 0) _s.set(-_s.x, -_s.y, -_s.z, -_s.w);
        lo = Math.min(lo, th); hi = Math.max(hi, th);
        side = Math.max(side, 2 * Math.acos(Math.min(1, _s.w)));
      }
    }
    j.lim.min = Math.min(j.lim.min, (lo - FIT_MARGIN) / D);
    j.lim.max = Math.max(j.lim.max, (hi + FIT_MARGIN) / D);
    j.lim.side = Math.max(j.lim.side, (side + FIT_MARGIN) / D);
  }
  f.hinges = {};
  for (const j of f.joints) if (j.kind === 'hinge' && j.axis) f.hinges[j.key] = j;
}

// Hinge flex of a bone along its fitted axis: bend in radians (positive flexes) and the
// current flex angle. Used by the leg code instead of world-axis turns, which twist a knee
// whose leg is not square to the body.
export function hingeOf(f, bone) {
  return f && f.hinges ? f.hinges[key(bone && bone.name)] || null : null;
}
export function hingeAngle(j) {
  _r.copy(j.rest).invert().multiply(j.bone.quaternion);
  return decompose(_r, j.axis);
}
export function flexHinge(j, ang) {
  j.bone.quaternion.multiply(_fq.setFromAxisAngle(j.axis, ang));
}

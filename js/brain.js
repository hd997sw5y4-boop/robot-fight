'use strict';
/*
 * Fighter brains. A brain turns a compact state snapshot into an intent:
 *
 *   snapshot = {
 *     t, dt, dist,                       // seconds, frame dt, root-to-root distance (m)
 *     strikeRange: { punch, kick },      // distances where this robot's strikes connect
 *     self: { health, state, stateT, cooldown, canAct, canPunch, canKick, canBlock, blocking, parts },
 *     opp:  { health, state, stateT, attacking, blocking, down, parts },
 *   }
 *   parts = { head: 0..1 health or 0 if detached, torso, armL, armR, legL, legR }
 *
 *   intent = { move: -1..1 (toward/away), strafe: -1..1, attack: null | 'punch' | 'kick',
 *              block: bool, run: bool }
 *
 * The built-in paced brain below is every CPU's default. An outside brain (for example one
 * backed by an AI API) only has to implement think(snapshot) -> intent and be assigned to
 * fighter.brain; the game handles clip choice, physics and animation.
 */

const rand = (a, b) => a + Math.random() * (b - a);

// profile: AI_PERSONALITIES entry ({ think, react, punch, kick, block, aggression }).
export function createPacedBrain(getProfile) {
  const s = {
    mode: 'approach', // approach | strike | backoff | circle | guard | feint | wait
    modeT: 0,
    modeLen: 1,
    combo: 0,
    circleDir: Math.random() < 0.5 ? -1 : 1,
    seenAttackT: -1,  // time we noticed the opponent's current attack (reaction delay)
    guardDecided: false,
    guardUntil: 0,
    feintIn: true,
    lastSelfState: 'idle',
    hitsLanded: 0,
    t: 0,
  };

  function setMode(mode, len) {
    s.mode = mode;
    s.modeT = 0;
    s.modeLen = len;
  }

  function think(snap) {
    const prof = getProfile() || {};
    const aggr = prof.aggression || 1;
    const react = prof.react != null ? prof.react : 0.4;
    // Difficulty sets how fast the robot answers what it sees.
    const reactDelay = prof.think ? prof.think[0] + prof.think[1] * 0.6 : 0.26;
    const { self, opp, dist } = snap;
    s.t += snap.dt;
    s.modeT += snap.dt;
    const intent = { move: 0, strafe: 0, attack: null, block: false, run: false };

    // Count an attack that just finished into the combo, and choose what comes after.
    const wasAttacking = s.lastSelfState === 'punch' || s.lastSelfState === 'kick';
    const nowAttacking = self.state === 'punch' || self.state === 'kick';
    s.lastSelfState = self.state;
    if (wasAttacking && !nowAttacking && s.mode === 'strike') {
      s.combo -= 1;
      if (s.combo <= 0 || self.state === 'hit') {
        // Combo done: back off or circle, sometimes hold the guard. Calmer robots wait longer.
        const r = Math.random();
        if (r < (prof.block || 0.15) * 1.4) setMode('guard', rand(0.35, 0.7));
        else if (r < 0.62) setMode('backoff', rand(0.45, 0.9) / Math.sqrt(aggr));
        else setMode('circle', rand(0.6, 1.2) / Math.sqrt(aggr));
        s.circleDir = Math.random() < 0.5 ? -1 : 1;
      }
    }

    if (!self.canAct) return intent;

    const punchR = snap.strikeRange.punch;
    const kickR = snap.strikeRange.kick;

    // Opponent on the mat or getting up: no hitting a robot that is down. Step back and wait.
    if (opp.down) {
      if (s.mode !== 'wait') setMode('wait', 0);
      intent.move = dist < 2.3 ? -0.8 : (dist > 3.0 ? 0.35 : 0);
      intent.strafe = 0.35 * s.circleDir;
      return intent;
    }
    if (s.mode === 'wait') setMode('circle', rand(0.4, 0.8));

    // Defence: notice the attack after the reaction delay, then decide once per attack.
    if (opp.attacking && dist < kickR + 0.7) {
      if (s.seenAttackT < 0) { s.seenAttackT = s.t; s.guardDecided = false; }
      if (!s.guardDecided && s.t - s.seenAttackT >= reactDelay) {
        s.guardDecided = true;
        const r = Math.random();
        if (r < react && self.canBlock) s.guardUntil = s.t + 0.6;
        else if (r < react + (1 - react) * 0.35) { setMode('backoff', 0.45); }
      }
      if (s.t < s.guardUntil) {
        intent.block = true;
        intent.move = dist < punchR ? -0.25 : 0;
        return intent;
      }
    } else {
      s.seenAttackT = -1;
      if (s.t >= s.guardUntil) s.guardUntil = 0;
    }

    switch (s.mode) {
      case 'approach': {
        const want = punchR; // close to punch range; kicks are chosen at strike time
        intent.move = dist > want + 0.05 ? 1 : (dist < want - 0.25 ? -0.6 : 0);
        intent.strafe = 0.18 * s.circleDir * Math.sin(s.t * 1.7);
        intent.run = dist > 3.8 && aggr >= 1;
        if (dist <= kickR + 0.02 && self.cooldown <= 0) {
          if (Math.random() < 0.1 * (2 - Math.min(1.5, aggr))) {
            setMode('feint', rand(0.35, 0.5));
            s.feintIn = true;
          } else {
            // 1-3 hit combo; aggressive profiles chain more.
            const r = Math.random();
            s.combo = r < 0.45 / aggr ? 1 : (r < 0.85 ? 2 : 3);
            setMode('strike', 3);
          }
        }
        break;
      }
      case 'strike': {
        if (self.cooldown <= 0 && !nowAttacking) {
          const wP = (prof.punch || 0.5) * (self.canPunch ? 1 : 0);
          const wK = (prof.kick || 0.25) * (self.canKick ? 1 : 0);
          if (wP + wK <= 0) { setMode('backoff', 0.6); break; }
          const kickOk = self.canKick && dist <= kickR + 0.05;
          const punchOk = self.canPunch && dist <= punchR + 0.1;
          let kind = null;
          if (punchOk && kickOk) kind = Math.random() * (wP + wK) < wP ? 'punch' : 'kick';
          else if (kickOk) kind = 'kick';
          else if (punchOk) kind = 'punch';
          if (kind) intent.attack = kind;
          else intent.move = 1; // drifted out of range mid-combo: close in
        }
        if (s.modeT > s.modeLen) setMode('backoff', 0.5);
        break;
      }
      case 'backoff': {
        intent.move = dist < punchR + 0.85 ? -1 : 0;
        intent.strafe = 0.45 * s.circleDir;
        if (s.modeT > s.modeLen) setMode(Math.random() < 0.5 ? 'circle' : 'approach', rand(0.5, 1.1));
        break;
      }
      case 'circle': {
        const ring = punchR + 0.7;
        intent.move = dist > ring + 0.3 ? 0.5 : (dist < ring - 0.3 ? -0.5 : 0);
        intent.strafe = 0.75 * s.circleDir;
        if (s.modeT > s.modeLen) setMode('approach', 0);
        break;
      }
      case 'guard': {
        intent.block = true;
        if (s.modeT > s.modeLen) setMode('circle', rand(0.4, 0.8));
        break;
      }
      case 'feint': {
        // Quick step in, then out, with no strike: baits a block.
        intent.move = s.modeT < s.modeLen * 0.5 ? 1 : -1;
        intent.run = s.modeT < s.modeLen * 0.5;
        if (s.modeT > s.modeLen) setMode('circle', rand(0.4, 0.8));
        break;
      }
      default:
        setMode('approach', 0);
    }
    // Never walk into the other robot.
    if (dist < punchR - 0.3 && intent.move > 0) intent.move = 0;
    return intent;
  }

  return { kind: 'paced', think, state: s };
}

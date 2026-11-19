'use strict';
import { SIZE } from './config.js';
/*
 * Fighter brains. A brain turns a compact state snapshot into an intent:
 *
 *   snapshot = {
 *     t, dt, dist,                       // seconds, frame dt, root-to-root distance (m)
 *     strikeRange: { punch, kick },      // distances where this robot's strikes connect
 *     self: { health, state, stateT, cooldown, canAct, canPunch, canKick, canBlock, blocking,
 *             edge, parts },
 *     opp:  { health, state, stateT, attacking, blocking, down, groundable, groundDist,
 *             edge, parts },
 *   }
 *   parts = { head: 0..1 health or 0 if detached, torso, armL, armR, legL, legR }
 *   edge  = 0 at the ring centre .. 1 against the cage
 *   groundable = the opponent is down and a stomp / ground punch could land from here
 *
 *   intent = { move: -1..1 (toward/away), strafe: -1..1,
 *              attack: null | 'punch' | 'kick' | 'ground', block: bool, run: bool }
 *
 * The built-in paced brain below is every CPU's default. An outside brain (for example one
 * backed by an AI API) only has to implement think(snapshot) -> intent and be assigned to
 * fighter.brain; the game handles clip choice, physics and animation.
 *
 * Robots don't tire: nothing here rests or slows down over time. Pauses are short spacing
 * resets between combos; the only slowdowns come from the game (damage, stun).
 */

const rand = (a, b) => a + Math.random() * (b - a);

// profile: AI_PERSONALITIES entry ({ think, react, punch, kick, block, aggression }).
export function createPacedBrain(getProfile) {
  const s = {
    mode: 'read',     // read | approach | strike | reset | circle | guard | feint | ground | wait
    modeT: 0,
    modeLen: 0.8,
    plan: 'punch',    // strike the approach is aiming for (sets the range it walks to)
    combo: 0,
    circleDir: Math.random() < 0.5 ? -1 : 1,
    seenAttackT: -1,  // time we noticed the opponent's current attack (reaction delay)
    guardDecided: false,
    guardUntil: 0,
    lastSelfState: 'idle',
    upAt: -1,
    burst: false,
    readNext: false,
    downSeen: false,
    groundGo: false,
    t: 0,
    tempo: 1,         // fight pacing: drifts between cautious (<1) and pressure (>1) phases
    tempoGoal: 1,
    tempoT: 0,
    lastHp: null,     // [self, opp] health last frame: momentum from who is landing
    oppWasAtk: false,
    punishOk: false,
    inRangeT: 0,
  };

  function setMode(mode, len) {
    s.mode = mode;
    s.modeT = 0;
    // A quicker frame (stat profile) spends less time between exchanges.
    s.modeLen = mode === 'strike' ? len : len / Math.sqrt(s.quick || 1);
  }

  function planStrike(prof, self) {
    const wP = (prof.punch || 0.5) * (self.canPunch ? 1 : 0);
    const wK = (prof.kick || 0.25) * (self.canKick ? 1 : 0);
    if (wP + wK <= 0) return null;
    return Math.random() * (wP + wK) < wP ? 'punch' : 'kick';
  }

  function think(snap) {
    const prof = getProfile() || {};
    const { self: me0, opp: op0 } = snap;
    // Pacing and momentum. A slow random drift picks pressure or patient phases; landing hits
    // pushes the tempo up, eating them cools it (back off and reset). A robot near KO that is
    // well behind goes all in (comeback): higher tempo, longer combos, fewer pauses.
    s.tempoT -= snap.dt;
    if (s.tempoT <= 0) { s.tempoGoal = rand(0.7, 1.45); s.tempoT = rand(4, 9); }
    if (s.lastHp) {
      const dealt = Math.max(0, s.lastHp[1] - op0.health);
      const took = Math.max(0, s.lastHp[0] - me0.health);
      s.tempoGoal = Math.max(0.6, Math.min(1.7, s.tempoGoal + dealt * 0.02 - took * 0.015));
    }
    s.lastHp = [me0.health, op0.health];
    const comeback = me0.health < 25 && op0.health > me0.health * 2;
    const goal = comeback ? Math.max(1.5, s.tempoGoal) : s.tempoGoal;
    s.tempo += (goal - s.tempo) * Math.min(1, snap.dt * 0.8);
    s.comeback = comeback;
    const aggr = (prof.aggression || 1) * s.tempo;
    const react = Math.min(0.95, (prof.react != null ? prof.react : 0.4) * Math.sqrt(snap.self.quick || 1));
    // Difficulty sets how fast the robot answers what it sees.
    // Stat profile: a quicker frame (speed x recovery) reads and answers faster.
    const quick = Math.sqrt(snap.self.quick || 1); // softened: speed x recovery 1.2 -> ~1.1
    s.quick = snap.self.quick || 1;
    const reactDelay = (prof.think ? prof.think[0] + prof.think[1] * 0.6 : 0.26) / quick;
    const { self, opp } = snap;
    // A damaged head (optics) slows reactions and makes range judgement wobble.
    const headDmg = self.parts && self.parts.head != null ? Math.max(0, 1 - self.parts.head) : 0;
    const blur = Math.max(0, headDmg - 0.4);
    // Distances are judged in base-size units (robot size scales every spacing by SIZE).
    const dist = snap.dist / SIZE + Math.sin(s.t * 2.3) * blur * 0.45;
    const reactLag = blur * 0.4;
    s.t += snap.dt;
    s.modeT += snap.dt;
    const intent = { move: 0, strafe: 0, attack: null, block: false, run: false };

    // An attack that just finished counts toward the combo; then a short spacing reset.
    const atk = (st) => st === 'punch' || st === 'kick' || st === 'ground';
    const wasAttacking = atk(s.lastSelfState);
    const nowAttacking = atk(self.state);
    s.lastSelfState = self.state;
    if (wasAttacking && !nowAttacking && s.mode === 'strike') {
      s.combo -= 1;
      if (s.combo <= 0 || self.state === 'hit' || snap.tooClose) endCombo(prof, aggr, self);
    }

    // Whiff / blocked-strike punish: the opponent's attack just ended within reach and we were
    // not hit by it: answer straight away with a short combo (decided once per attack).
    const oppEnded = s.oppWasAtk && !opp.attacking;
    s.oppWasAtk = opp.attacking;
    if (opp.attacking && s.seenAttackT < 0) s.punishOk = Math.random() < Math.min(0.75, 0.25 + react * 0.6);
    if (oppEnded && s.punishOk && self.canAct && self.state !== 'hit' && !opp.down && snap.dist / SIZE <= snap.strikeRange.kick / SIZE + 0.15) {
      s.punishOk = false;
      s.combo = Math.random() < 0.5 ? 2 : 1;
      s.plan = snap.dist / SIZE <= snap.strikeRange.punch / SIZE + 0.05 ? 'punch' : 'kick';
      s.guardUntil = 0;
      setMode('strike', 1.4);
    }

    if (!self.canAct) return intent;

    const punchR = snap.strikeRange.punch / SIZE;
    const kickR = snap.strikeRange.kick / SIZE;

    // If the CPU has been able to act inside kick range for too long without throwing,
    // force a strike so it cannot stall in circle / read / approach.
    if (!opp.down && self.cooldown <= 0 && dist <= kickR + 0.2) {
      s.inRangeT += snap.dt;
      if (s.inRangeT > (aggr >= 1.2 ? 1.15 : 1.6) && s.mode !== 'strike') {
        s.plan = planStrike(prof, self) || 'punch';
        s.combo = aggr >= 1.2 ? 3 : 2;
        s.guardUntil = 0;
        setMode('strike', 2.2);
      }
    } else s.inRangeT = 0;

    // Opponent on the mat: sometimes go in for a stomp / ground punch (decided once per
    // knockdown), otherwise step off and wait for it to stand.
    if (opp.down) {
      if (!s.downSeen) {
        s.downSeen = true;
        s.groundGo = opp.state === 'down' && Math.random() < Math.min(0.85, (prof.ground != null ? prof.ground : 0.5) * aggr);
        setMode(s.groundGo ? 'ground' : 'wait', 0);
      }
      if (s.mode === 'ground' && opp.state === 'down') {
        if (opp.groundable && self.cooldown <= 0) intent.attack = 'ground';
        else if (opp.groundDist != null) intent.move = opp.groundDist > 0.62 * SIZE ? 1 : 0;
        if (s.modeT > 3) setMode('wait', 0);
        return intent;
      }
      if (s.mode !== 'wait') setMode('wait', 0);
      s.upAt = -1;
      intent.move = dist < 2.0 ? -0.8 : (dist > 2.9 ? 0.4 : 0);
      return intent;
    }
    s.downSeen = false;
    if (s.mode === 'wait' || s.mode === 'ground') {
      // Give a robot that just got up 0.4-0.6 s before pressing again (fair play).
      if (s.upAt < 0) s.upAt = s.t + rand(0.4, 0.6);
      if (s.t < s.upAt) return intent; // stand and watch it get up
      startRead(aggr);
    }

    // Defence: notice the attack after the reaction delay, then decide once per attack.
    if (opp.attacking && dist < kickR + 0.6) {
      if (s.seenAttackT < 0) { s.seenAttackT = s.t; s.guardDecided = false; }
      if (!s.guardDecided && s.t - s.seenAttackT >= reactDelay + reactLag) {
        s.guardDecided = true;
        const r = Math.random();
        if (r < react && self.canBlock) s.guardUntil = s.t + 0.45;
        else if (r < react + (1 - react) * 0.3) setMode('reset', 0.35);
      }
      if (s.t < s.guardUntil) {
        intent.block = true;
        return intent;
      }
    } else {
      s.seenAttackT = -1;
      if (s.t >= s.guardUntil) s.guardUntil = 0;
    }

    // Pinned against the cage: slide out along it rather than backing further in.
    const cornered = !!(self.atWall || self.edge > 0.8);

    switch (s.mode) {
      case 'read': {
        // Short look, still moving: circle and step in/out rather than planting.
        intent.strafe = 0.7 * s.circleDir;
        if (dist < punchR + 0.15) intent.move = -0.85;
        else if (dist > kickR + 0.45) intent.move = 0.75;
        else intent.move = 0.2 * Math.sin(s.t * 2.4);
        if (s.modeT > s.modeLen) { startApproach(prof, self); s.burst = true; }
        break;
      }
      case 'approach': {
        const want = s.plan === 'kick' ? kickR - 0.08 : punchR - 0.14;
        intent.move = dist > want + 0.04 ? 1 : (dist < want - 0.3 ? -0.5 : 0);
        intent.run = dist > 2.6 || (s.burst && dist > want + 0.2);
        // Cut the angle a little while closing, unless the target is on the ropes: then
        // walk straight in and keep it there.
        intent.strafe = opp.edge > 0.7 ? 0 : (s.burst ? 0.4 : 0.75) * s.circleDir;
        if (dist <= want + 0.06 && self.cooldown <= 0) {
          if (Math.random() < (s.tempo < 0.9 ? 0.22 : 0.1)) { // feints, more in patient phases
            setMode('feint', rand(0.3, 0.42));
          } else {
            const r = Math.random();
            s.combo = r < 0.3 / aggr ? 1 : (r < 0.75 ? 2 : 3);
            if (s.comeback || (s.tempo > 1.25 && Math.random() < 0.4)) s.combo += 1; // pressure phase: longer strings
            setMode('strike', 2.5);
            s.burst = false;
          }
        }
        if (s.modeT > 4) startApproach(prof, self); // re-plan if it can't get there
        break;
      }
      case 'strike': {
        if (self.cooldown <= 0 && !nowAttacking) {
          const kickOk = self.canKick && dist <= kickR + 0.02 && dist > punchR - 0.2;
          const punchOk = self.canPunch && dist <= punchR - 0.02;
          let kind = null;
          if (s.plan === 'kick' && kickOk) kind = 'kick';
          else if (punchOk) kind = 'punch';
          else if (kickOk) kind = 'kick';
          if (kind) {
            intent.attack = kind;
            s.inRangeT = 0;
            s.plan = planStrike(prof, self) || 'punch'; // next one in the chain
          } else {
            intent.move = dist > punchR - 0.14 ? 1 : -0.6;
            intent.run = dist > punchR + 0.1;
          }
        }
        if (s.modeT > s.modeLen) endCombo(prof, aggr, self);
        break;
      }
      case 'reset': {
        // Short step out of range after a combo (spacing, not resting), still circling.
        intent.move = dist < 1.9 && !cornered ? -1 : 0.15;
        intent.strafe = 0.8 * s.circleDir;
        if (s.modeT > s.modeLen) {
          if (s.readNext) startRead(aggr);
          else startApproach(prof, self);
        }
        break;
      }
      case 'circle': {
        const ring = 2.0;
        intent.move = dist > ring + 0.3 ? 0.6 : (dist < ring - 0.3 ? -0.6 : 0);
        intent.strafe = 0.85 * s.circleDir;
        if (s.modeT > s.modeLen) {
          if (s.readNext) startRead(aggr);
          else startApproach(prof, self);
        }
        break;
      }
      case 'guard': {
        intent.block = true;
        if (s.modeT > s.modeLen) startApproach(prof, self);
        break;
      }
      case 'feint': {
        // Quick step in, then out, with no strike: baits a block.
        intent.move = s.modeT < s.modeLen * 0.5 ? 1 : -1;
        if (s.modeT > s.modeLen) startRead(aggr);
        break;
      }
      default:
        startApproach(prof, self);
    }
    // Never walk into the other robot.
    if (dist < punchR - 0.3 && intent.move > 0) intent.move = 0;
    // Natural back-off after a strike or when clinched — footwork, not a root shove.
    // Against the cage, circle and step off toward the centre instead of backing into the wall.
    const tooClose = !!(snap.tooClose || dist < punchR - 0.15);
    const atWall = !!(self.atWall || cornered);
    if (tooClose && !opp.down && !nowAttacking) {
      if (atWall) {
        if (!intent.strafe) intent.strafe = s.circleDir;
        if (intent.move < 0) intent.move = 0.35; // step off the fence, not into it
      } else {
        intent.move = Math.min(intent.move, -0.85);
        if (s.mode === 'strike' && s.combo <= 0) endCombo(prof, aggr, self);
      }
    }

    const sp = self.specials || {};
    const rocketR = (snap.strikeRange.rocket || (snap.strikeRange.kick + SIZE)) / SIZE;
    if (sp.rocket_punch && dist > punchR * 0.65 && dist < rocketR && Math.random() < (prof.special || 0.12) * 0.9) {
      intent.attack = 'rocket_punch';
      intent.block = false;
      return intent;
    }
    if (sp.dash_back && (self.atWall || snap.tooClose || (opp.attacking && dist < punchR + 0.1)) && Math.random() < 0.42) {
      intent.attack = 'dash_back';
      intent.block = false;
      return intent;
    }
    if (sp.dash_forward && dist > kickR + 0.35 && dist < kickR + 1.85 && !opp.attacking && Math.random() < (prof.aggression || 1) * 0.18) {
      intent.attack = 'dash_forward';
      intent.run = false;
      return intent;
    }
    return intent;
  }

  function startApproach(prof, self) {
    s.plan = planStrike(prof, self) || 'punch';
    setMode('approach', 0);
  }

  // After an exchange: step out or circle, then come back in. Reads are short and mobile
  // (robots don't tire: these are spacing resets, never rests).
  function endCombo(prof, aggr, self) {
    const r = Math.random();
    s.circleDir = Math.random() < 0.5 ? -1 : 1;
    // Hard / high-tempo: cut the long circle and come back in.
    if (aggr >= 1.2) {
      if (r < Math.min(0.2, prof.block || 0.12)) setMode('guard', rand(0.16, 0.28));
      else if (r < 0.4) setMode('reset', rand(0.1, 0.2));
      else startApproach(prof, self);
      s.readNext = false;
      return;
    }
    if (r < (prof.block || 0.12)) setMode('guard', rand(0.25, 0.45));
    else if (r < 0.48) setMode('reset', rand(0.28, 0.5));
    else if (r < 0.88) setMode('circle', rand(0.7, 1.3) / Math.sqrt(aggr));
    else startApproach(prof, self); // straight back in
    s.readNext = r < 0.16;
  }

  function startRead(aggr) {
    setMode('read', rand(0.22, 0.5) / Math.sqrt(aggr));
  }

  return { kind: 'paced', think, state: s };
}

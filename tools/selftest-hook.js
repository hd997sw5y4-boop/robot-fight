/* Opt-in Robot Fight selftest hook.
   Loaded only by tools/selftest.mjs via CDP (Page.addScriptToEvaluateOnNewDocument).
   Activates when the page URL has ?selftest=1. Read-only: does not change game files.
   Exposes window.__rfTest. */
(function () {
  'use strict';
  try {
    if (new URLSearchParams(location.search).get('selftest') !== '1') return;
  } catch (_) {
    return;
  }

  const THRESH = {
    footTol: 0.03,          // metres: feet vs matTop while standing
    slideIdle: 0.30,        // m/s root XZ while idle/block clip
    slideAttack: 1.00,      // m/s root XZ while punch/kick
    torsoMin: 0.72,         // 2 * COMBAT.bodyRadius (0.36)
    spamGap: 0.30,          // seconds between attack starts
    ragHover: 0.08,         // metres: ragdoll lowest point above mat
    stuckAttack: 3.0,
    stuckHit: 2.5,
    stuckDown: 6.0,
    stuckGetup: 8.0,
    stuckIdle: 15.0,
  };

  const STANDING = new Set(['idle', 'block', 'punch', 'kick']);
  const DOWNED = new Set(['down', 'ko', 'getup']);
  const REACTION = new Set(['hit', 'down', 'ko']);
  const IDLE_OR_BLOCK_CLIPS = /^(FightingIdle|InjuredStumbleIdle|Idle|VictoryIdle|Victory|Taunt|CenterBlock|BodyBlock|LeftBlock|RightBlock)$/;
  const LOCO_CLIPS = /^(Walking|WalkingBackwards|JogStrafeLeft|JogStrafeRight|LongStepForward|StepBackward)$/;
  const ATTACK_STATES = new Set(['punch', 'kick']);

  const realNow = performance.now.bind(performance);
  const realRAF = window.requestAnimationFrame.bind(window);
  let timeScale = 1;
  try {
    const cfg = window.__rfTestConfig;
    if (cfg && cfg.timeScale != null) timeScale = Math.max(0.25, Math.min(8, +cfg.timeScale || 1));
  } catch (_) {}
  let realBase = realNow();
  let fakeBase = realBase;

  function fakeNow() {
    return fakeBase + (realNow() - realBase) * timeScale;
  }
  performance.now = fakeNow;
  if (window.Date) {
    const RealDate = Date;
    const startMS = RealDate.now();
    const t0 = fakeNow();
    const DateShim = function (...args) {
      if (new.target) {
        if (args.length === 0) return new RealDate(DateShim.now());
        return new RealDate(...args);
      }
      return RealDate(...args);
    };
    DateShim.now = () => startMS + (fakeNow() - t0);
    DateShim.parse = RealDate.parse;
    DateShim.UTC = RealDate.UTC;
    DateShim.prototype = RealDate.prototype;
    window.Date = DateShim;
  }
  window.requestAnimationFrame = function (cb) {
    return realRAF(function () { cb(fakeNow()); });
  };

  function setTimeScale(s) {
    fakeBase = fakeNow();
    realBase = realNow();
    timeScale = Math.max(0.25, Math.min(8, +s || 1));
    if (window.__rfTest) window.__rfTest.timeScale = timeScale;
    return timeScale;
  }

  let ready = false;
  let installedClock = false;
  const fights = [];
  let cur = null;
  let prev = null;
  let lastSampleT = null;
  const pendingHits = []; // { atk, atGame, defState0, blocked, resolved }

  const totals = blankTotals();

  function blankTotals() {
    return {
      footSamples: 0,
      footFlags: 0,
      footMaxAbove: 0,
      footMaxBelow: 0,
      slideFlags: 0,
      slideMaxSpeed: 0,
      interpenFlags: 0,
      interpenMinDist: Infinity,
      attacks: {},
      noReaction: 0,
      spam: 0,
      attackDowned: 0,
      ragHoverFlags: 0,
      ragHoverMax: 0,
      stuck: 0,
      downEvents: [],
      getupEvents: [],
      koEvents: [],
    };
  }

  function atkBucket(kind) {
    if (!totals.attacks[kind]) totals.attacks[kind] = { thrown: 0, landed: 0, whiff: 0 };
    return totals.attacks[kind];
  }

  function api() {
    const hook = window.RFShellHook || (window.RFShell && window.RFShell.api);
    const a = (window.RFShell && window.RFShell.api) || hook;
    if (!a || !a.p1 || !a.p2) return null;
    return a;
  }

  function hookClock(a) {
    if (installedClock || !a || !a.clock) return;
    const clock = a.clock;
    if (clock && typeof clock.getDelta === 'function' && !clock.__rfTestWrapped) {
      const gd = clock.getDelta.bind(clock);
      clock.getDelta = function () { return gd(); };
      clock.__rfTestWrapped = true;
    }
    installedClock = true;
  }

  function xzSpeed(f, prevF, dt) {
    if (!prevF || dt <= 0) return 0;
    const dx = f.root.position.x - prevF.x;
    const dz = f.root.position.z - prevF.z;
    return Math.hypot(dx, dz) / dt;
  }

  function torsoXZ(f, THREE) {
    const v = { x: f.root.position.x, z: f.root.position.z };
    try {
      if (THREE && f.hips && f.hips.getWorldPosition) {
        const t = new THREE.Vector3();
        f.hips.getWorldPosition(t);
        return { x: t.x, z: t.z, y: t.y };
      }
    } catch (_) {}
    return v;
  }

  function snapFighter(f) {
    const rag = !!(f.phys && f.phys.ragdoll && f.phys.ragdoll.active);
    return {
      id: f.id,
      state: f.state,
      stateT: f.stateT,
      hp: f.health,
      clip: f.current,
      hitThisAttack: !!f.hitThisAttack,
      atkContact: !!f.atkContact,
      blocking: !!f.blocking,
      cooldown: f.cooldown,
      rag,
      x: f.root.position.x,
      y: f.root.position.y,
      z: f.root.position.z,
      attackClip: f.attackClip || null,
    };
  }

  function startFight(match, p1, p2) {
    cur = {
      index: fights.length + 1,
      roundIndex: match && match.roundIndex,
      startedAt: fakeNow(),
      gameTime: 0,
      ended: false,
      endReason: null,
      winner: null,
      koAt: null,
      length: 0,
      p1hp0: p1.health,
      p2hp0: p2.health,
      flags: {
        feet: 0,
        slide: 0,
        interpen: 0,
        noReaction: 0,
        spam: 0,
        attackDowned: 0,
        ragHover: 0,
        stuck: 0,
      },
      attacks: {},
      down: { p1: [], p2: [] },
      getup: { p1: [], p2: [] },
      stuckEvents: [],
      lastAtkAt: { p1: -1e9, p2: -1e9 },
      stateEnter: { p1: { state: p1.state, t: 0 }, p2: { state: p2.state, t: 0 } },
      stillT: 0,
      footMaxAbove: 0,
      footMaxBelow: 0,
      slideMax: 0,
      interpenMin: Infinity,
      ragHoverMax: 0,
    };
  }

  function endFight(match, p1, p2) {
    if (!cur || cur.ended) return;
    cur.ended = true;
    cur.length = cur.gameTime;
    cur.winner = match ? match.winner : null;
    cur.endReason = (p1 && p1.state === 'ko') || (p2 && p2.state === 'ko') ? 'ko'
      : (match && match.winner == null ? 'draw' : 'end');
    cur.p1hp = p1 ? p1.health : null;
    cur.p2hp = p2 ? p2.health : null;
    fights.push(cur);
  }

  function addFlag(name) {
    if (!cur || cur.ended) return;
    cur.flags[name] = (cur.flags[name] || 0) + 1;
  }

  function episode(list, id, t, extra) {
    const ev = { id, t, dur: 0, ...(extra || {}) };
    list.push(ev);
    return ev;
  }

  function closeEpisode(list, t) {
    if (!list.length) return;
    const ev = list[list.length - 1];
    if (ev.dur === 0 && ev.t != null) ev.dur = Math.max(0, +(t - ev.t).toFixed(3));
  }

  function sample() {
    const a = api();
    if (!a) return;
    hookClock(a);
    const p1 = a.p1, p2 = a.p2, match = a.match;
    if (!p1 || !p2) return;
    ready = true;

    const now = fakeNow();
    const dt = lastSampleT == null ? 0 : Math.max(0, Math.min(0.08, (now - lastSampleT) / 1000));
    lastSampleT = now;

    const phase = match ? match.phase : null;
    const over = !!(match && match.over);
    const inFight = phase === 'fight' && !over;

    if (inFight && (!cur || cur.ended)) startFight(match, p1, p2);
    if (cur && !cur.ended && over) endFight(match, p1, p2);
    // Round restart without over sticking: new getup/intro after a finished fight is handled
    // when phase returns to fight (startFight above).

    if (cur && !cur.ended && inFight) cur.gameTime += dt;

    const t = cur && !cur.ended ? cur.gameTime : (cur ? cur.length : 0);
    const s1 = snapFighter(p1);
    const s2 = snapFighter(p2);
    const THREE = a.THREE || (window.RFShellHook && window.RFShellHook.THREE);

    let feet = null, probe = null;
    try { feet = window.__rfMeasureFeet ? window.__rfMeasureFeet() : null; } catch (_) {}
    try { probe = window.__rfFightProbe ? window.__rfFightProbe() : null; } catch (_) {}
    const matTop = (feet && feet.matTop != null) ? feet.matTop : 0;

    if (inFight && cur && !cur.ended && dt > 0) {
      // --- feet vs mat ---
      for (const id of ['p1', 'p2']) {
        const f = id === 'p1' ? p1 : p2;
        const st = id === 'p1' ? s1 : s2;
        if (!STANDING.has(st.state) || st.rag) continue;
        const fm = feet && feet[id];
        const y = fm && fm.minY != null ? fm.minY : (probe && (probe.find ? probe : null));
        let footY = fm && fm.minY != null ? fm.minY : null;
        if (footY == null && probe) {
          const row = Array.isArray(probe) ? probe.find((r) => r.id === id) : null;
          if (row && row.feet != null) footY = row.feet;
        }
        if (footY == null) continue;
        const err = footY - matTop;
        totals.footSamples += 1;
        if (err > 0) {
          totals.footMaxAbove = Math.max(totals.footMaxAbove, err);
          cur.footMaxAbove = Math.max(cur.footMaxAbove, err);
        } else {
          totals.footMaxBelow = Math.max(totals.footMaxBelow, -err);
          cur.footMaxBelow = Math.max(cur.footMaxBelow, -err);
        }
        if (Math.abs(err) > THRESH.footTol) {
          totals.footFlags += 1;
          addFlag('feet');
        }
      }

      // --- sliding: root speed while idle/attack clip ---
      for (const [st, prevF] of [[s1, prev && prev.p1], [s2, prev && prev.p2]]) {
        const clip = st.clip || '';
        const isLoco = LOCO_CLIPS.test(clip);
        const isIdleClip = IDLE_OR_BLOCK_CLIPS.test(clip) || st.state === 'idle' || st.state === 'block';
        const isAtk = ATTACK_STATES.has(st.state);
        if (isLoco || !(isIdleClip || isAtk)) continue;
        // If state is idle/block but a walk clip is playing, skipped above.
        if (isIdleClip && isLoco) continue;
        const spd = xzSpeed(st, prevF, dt);
        const lim = isAtk ? THRESH.slideAttack : THRESH.slideIdle;
        totals.slideMaxSpeed = Math.max(totals.slideMaxSpeed, spd);
        cur.slideMax = Math.max(cur.slideMax, spd);
        if (spd > lim) {
          totals.slideFlags += 1;
          addFlag('slide');
        }
      }

      // --- torso interpenetration ---
      const t1 = torsoXZ(p1, THREE);
      const t2 = torsoXZ(p2, THREE);
      const torsoDist = Math.hypot(t1.x - t2.x, t1.z - t2.z);
      totals.interpenMinDist = Math.min(totals.interpenMinDist, torsoDist);
      cur.interpenMin = Math.min(cur.interpenMin, torsoDist);
      if (torsoDist < THRESH.torsoMin && !s1.rag && !s2.rag
          && !DOWNED.has(s1.state) && !DOWNED.has(s2.state)) {
        totals.interpenFlags += 1;
        addFlag('interpen');
      }

      // --- attack start / end (whiff, spam, downed) ---
      for (const [st, pr, f] of [[s1, prev && prev.p1, p1], [s2, prev && prev.p2, p2]]) {
        const other = f === p1 ? p2 : p1;
        const ost = f === p1 ? s2 : s1;
        if (pr && !ATTACK_STATES.has(pr.state) && ATTACK_STATES.has(st.state)) {
          const kind = st.state;
          const b = atkBucket(kind);
          b.thrown += 1;
          if (!cur.attacks[kind]) cur.attacks[kind] = { thrown: 0, landed: 0, whiff: 0 };
          cur.attacks[kind].thrown += 1;
          const last = cur.lastAtkAt[st.id];
          const gap = t - last;
          if (last > -1e8 && gap < THRESH.spamGap) {
            totals.spam += 1;
            addFlag('spam');
          }
          cur.lastAtkAt[st.id] = t;
          if (DOWNED.has(ost.state) || ost.rag) {
            totals.attackDowned += 1;
            addFlag('attackDowned');
          }
        }
        if (pr && ATTACK_STATES.has(pr.state) && !ATTACK_STATES.has(st.state)) {
          const kind = pr.state;
          const landed = !!(pr.hitThisAttack || pr.atkContact || f.hitThisAttack);
          // f.hitThisAttack may already have been cleared in endAttack; use snapshot.
          const hit = !!pr.hitThisAttack || !!pr.atkContact;
          const b = atkBucket(kind);
          if (hit) { b.landed += 1; if (cur.attacks[kind]) cur.attacks[kind].landed += 1; }
          else { b.whiff += 1; if (cur.attacks[kind]) cur.attacks[kind].whiff += 1; }
        }
        // hitThisAttack rising: a connect happened this sample
        if (pr && ATTACK_STATES.has(st.state) && st.hitThisAttack && !pr.hitThisAttack) {
          pendingHits.push({
            atk: st.id,
            def: ost.id,
            at: t,
            defState0: ost.state,
            defHp0: ost.hp,
            blocked: !!ost.blocking,
            resolved: false,
          });
        }
      }

      // --- hits with no defender reaction ---
      for (const h of pendingHits) {
        if (h.resolved) continue;
        const def = h.def === 'p1' ? s1 : s2;
        if (REACTION.has(def.state) || h.blocked) {
          h.resolved = true;
          h.reaction = h.blocked ? 'block' : def.state;
          continue;
        }
        if (t - h.at >= 0.20) {
          h.resolved = true;
          h.reaction = def.state;
          totals.noReaction += 1;
          addFlag('noReaction');
        }
      }

      // --- down / getup durations ---
      for (const [st, pr, id] of [[s1, prev && prev.p1, 'p1'], [s2, prev && prev.p2, 'p2']]) {
        if (pr && pr.state !== 'down' && st.state === 'down') {
          episode(cur.down[id], id, t);
        }
        if (pr && pr.state === 'down' && st.state !== 'down') {
          closeEpisode(cur.down[id], t);
          if (cur.down[id].length) totals.downEvents.push(cur.down[id][cur.down[id].length - 1]);
        }
        if (pr && pr.state !== 'getup' && st.state === 'getup') {
          episode(cur.getup[id], id, t);
        }
        if (pr && pr.state === 'getup' && st.state !== 'getup') {
          closeEpisode(cur.getup[id], t);
          if (cur.getup[id].length) totals.getupEvents.push(cur.getup[id][cur.getup[id].length - 1]);
        }
        if (pr && pr.state !== 'ko' && st.state === 'ko') {
          const ev = { id, t, hpOther: (id === 'p1' ? s2.hp : s1.hp) };
          cur.koAt = cur.koAt || t;
          totals.koEvents.push(ev);
        }
      }

      // --- ragdoll hover ---
      if (probe && Array.isArray(probe)) {
        for (const row of probe) {
          const st = row.id === 'p1' ? s1 : s2;
          if (!st.rag && st.state !== 'down' && st.state !== 'ko') continue;
          const low = row.low;
          if (low == null) continue;
          const clear = low - matTop;
          totals.ragHoverMax = Math.max(totals.ragHoverMax, clear);
          cur.ragHoverMax = Math.max(cur.ragHoverMax, clear);
          if (clear > THRESH.ragHover) {
            totals.ragHoverFlags += 1;
            addFlag('ragHover');
          }
        }
      }

      // --- stuck states ---
      for (const [st, id] of [[s1, 'p1'], [s2, 'p2']]) {
        const ent = cur.stateEnter[id];
        if (ent.state !== st.state) {
          const dur = t - ent.t;
          let lim = null;
          if (ATTACK_STATES.has(ent.state)) lim = THRESH.stuckAttack;
          else if (ent.state === 'hit') lim = THRESH.stuckHit;
          else if (ent.state === 'down') lim = THRESH.stuckDown;
          else if (ent.state === 'getup') lim = THRESH.stuckGetup;
          if (lim != null && dur > lim) {
            totals.stuck += 1;
            addFlag('stuck');
            cur.stuckEvents.push({ id, state: ent.state, dur: +dur.toFixed(3), t });
          }
          cur.stateEnter[id] = { state: st.state, t };
        } else {
          const dur = t - ent.t;
          let lim = null;
          if (ATTACK_STATES.has(st.state)) lim = THRESH.stuckAttack;
          else if (st.state === 'hit') lim = THRESH.stuckHit;
          else if (st.state === 'down') lim = THRESH.stuckDown;
          else if (st.state === 'getup') lim = THRESH.stuckGetup;
          if (lim != null && dur > lim && !ent.flagged) {
            ent.flagged = true;
            totals.stuck += 1;
            addFlag('stuck');
            cur.stuckEvents.push({ id, state: st.state, dur: +dur.toFixed(3), t });
          }
        }
      }
      const moving = xzSpeed(s1, prev && prev.p1, dt) + xzSpeed(s2, prev && prev.p2, dt);
      const idleish = (s1.state === 'idle' || s1.state === 'block') && (s2.state === 'idle' || s2.state === 'block');
      if (idleish && moving < 0.15) cur.stillT += dt;
      else cur.stillT = 0;
      if (cur.stillT > THRESH.stuckIdle && !cur.stillFlagged) {
        cur.stillFlagged = true;
        totals.stuck += 1;
        addFlag('stuck');
        cur.stuckEvents.push({ id: 'both', state: 'idle', dur: +cur.stillT.toFixed(3), t });
      }
    }

    prev = { p1: s1, p2: s2, phase, over, t };
  }

  function loop() {
    try { sample(); } catch (e) { console.error('[selftest hook]', e && e.stack || e); }
    realRAF(loop);
  }
  realRAF(loop);

  function snapshot() {
    const a = api();
    const p1 = a && a.p1, p2 = a && a.p2, match = a && a.match;
    const shell = window.RFShell;
    return {
      ready,
      timeScale,
      thresholds: THRESH,
      screen: shell && shell.state && shell.state.screen,
      shellPhase: shell && shell.match && shell.match.phase,
      mode: shell && shell.state && shell.state.mode,
      phase: match && match.phase,
      over: !!(match && match.over),
      winner: match && match.winner,
      roundIndex: match && match.roundIndex,
      fightsDone: fights.length,
      current: cur && {
        index: cur.index,
        gameTime: +cur.gameTime.toFixed(3),
        ended: cur.ended,
        flags: cur.flags,
        winner: cur.winner,
      },
      p1: p1 ? { hp: p1.health, state: p1.state, clip: p1.current, rag: !!(p1.phys && p1.phys.ragdoll && p1.phys.ragdoll.active) } : null,
      p2: p2 ? { hp: p2.health, state: p2.state, clip: p2.current, rag: !!(p2.phys && p2.phys.ragdoll && p2.phys.ragdoll.active) } : null,
    };
  }

  function report() {
    const open = cur && !cur.ended ? { ...cur } : null;
    return {
      thresholds: THRESH,
      timeScale,
      fights: fights.map(summarizeFight),
      openFight: open && summarizeFight(open),
      totals: {
        ...totals,
        interpenMinDist: totals.interpenMinDist === Infinity ? null : totals.interpenMinDist,
        attacks: totals.attacks,
      },
    };
  }

  function summarizeFight(f) {
    const downDurs = ['p1', 'p2'].flatMap((id) => (f.down[id] || []).map((e) => e.dur));
    const getupDurs = ['p1', 'p2'].flatMap((id) => (f.getup[id] || []).map((e) => e.dur));
    return {
      index: f.index,
      roundIndex: f.roundIndex,
      length: +f.length.toFixed(3),
      gameTime: +f.gameTime.toFixed(3),
      ended: f.ended,
      endReason: f.endReason,
      winner: f.winner,
      koAt: f.koAt == null ? null : +f.koAt.toFixed(3),
      p1hp: f.p1hp,
      p2hp: f.p2hp,
      flags: f.flags,
      attacks: f.attacks,
      downDurations: downDurs,
      getupDurations: getupDurs,
      stuckEvents: f.stuckEvents,
      footMaxAbove: f.footMaxAbove,
      footMaxBelow: f.footMaxBelow,
      slideMax: f.slideMax,
      interpenMin: f.interpenMin === Infinity ? null : f.interpenMin,
      ragHoverMax: f.ragHoverMax,
    };
  }

  window.__rfTest = {
    enabled: true,
    ready: false,
    timeScale,
    thresholds: THRESH,
    setTimeScale,
    snapshot,
    report,
    fights: () => fights.map(summarizeFight),
  };
  Object.defineProperty(window.__rfTest, 'ready', { get() { return ready; } });
})();
